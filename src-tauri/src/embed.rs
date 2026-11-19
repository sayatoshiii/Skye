use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Request};

static PORT: OnceLock<u16> = OnceLock::new();
static MEDIA: OnceLock<Mutex<HashMap<String, (String, Arc<Vec<u8>>)>>> = OnceLock::new();

const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style></head><body><script>
const target = new URL(decodeURIComponent(location.hash.slice(1)));
target.searchParams.has("origin") && target.searchParams.set("origin", location.origin);
target.protocol === "https:" && document.body.appendChild(Object.assign(document.createElement("iframe"), { src: target.href, allow: "fullscreen; picture-in-picture; encrypted-media; autoplay; clipboard-write", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" }));
</script></body></html>"#;

fn media() -> &'static Mutex<HashMap<String, (String, Arc<Vec<u8>>)>> {
  MEDIA.get_or_init(Default::default)
}

fn span(head: &str, size: usize) -> Option<(usize, usize)> {
  let range = head.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("range: bytes=").map(str::to_owned))?;
  let (from, to) = range.trim().split_once('-')?;
  let last = size.checked_sub(1)?;
  match (from.parse::<usize>().ok(), to.parse::<usize>().ok()) {
    (Some(from), to) => Some((from, to.unwrap_or(last).min(last))),
    (None, Some(tail)) => Some((size.saturating_sub(tail), last)),
    _ => None,
  }
  .filter(|(from, to)| from <= to)
}

fn answer(mut stream: TcpStream) {
  let mut request = [0u8; 4096];
  let read = stream.read(&mut request).unwrap_or_default();
  let head = String::from_utf8_lossy(&request[..read]).into_owned();
  let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
  let found = path.strip_prefix("/media/").and_then(|id| media().lock().ok()?.get(id).cloned());
  let _ = match found {
    Some((kind, bytes)) => match span(&head, bytes.len()) {
      Some((from, to)) => write!(stream, "HTTP/1.1 206 Partial Content\r\nContent-Type: {kind}\r\nAccept-Ranges: bytes\r\nCache-Control: private, max-age=31536000, immutable\r\nContent-Range: bytes {from}-{to}/{}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", bytes.len(), to - from + 1).and_then(|_| stream.write_all(&bytes[from..=to])),
      None => write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nAccept-Ranges: bytes\r\nCache-Control: private, max-age=31536000, immutable\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", bytes.len()).and_then(|_| stream.write_all(&bytes)),
    },
    None if path.starts_with("/media/") => write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
    None => write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{PAGE}", PAGE.len()),
  };
}

pub fn serve() {
  let Ok(listener) = TcpListener::bind("127.0.0.1:0") else { return };
  let _ = listener.local_addr().map(|address| PORT.set(address.port()));
  std::thread::spawn(move || listener.incoming().flatten().for_each(|stream| drop(std::thread::spawn(move || answer(stream)))));
}

#[tauri::command]
pub fn embed_port() -> u16 {
  PORT.get().copied().unwrap_or_default()
}

#[tauri::command]
pub fn media_put(request: Request<'_>) -> Result<String, String> {
  let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
  let kind = request.headers().get("x-type").and_then(|kind| kind.to_str().ok()).unwrap_or("application/octet-stream").to_owned();
  let id = format!("{:x}{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_nanos()).unwrap_or_default(), bytes.len());
  media().lock().map_err(|error| error.to_string())?.insert(id.clone(), (kind, Arc::new(bytes.clone())));
  Ok(id)
}

#[tauri::command]
pub fn media_drop(id: String) {
  let _ = media().lock().map(|mut stored| stored.remove(&id));
}

#[cfg(target_os = "linux")]
fn transcode(id: &str, input: &[u8]) -> Result<Vec<u8>, String> {
  use gstreamer::prelude::*;
  let fail = |error: &dyn std::fmt::Display| error.to_string();
  gstreamer::init().map_err(|error| fail(&error))?;
  let base = std::env::temp_dir().join(format!("skye-{id}"));
  let (from, to) = (base.with_extension("in"), base.with_extension("webm"));
  std::fs::write(&from, input).map_err(|error| fail(&error))?;
  let uri = |path: &std::path::Path| gstreamer::glib::filename_to_uri(path, None).map(|uri| uri.to_string()).map_err(|error| fail(&error));
  let pipeline = gstreamer::parse::launch(&format!("uritranscodebin profile=\"video/webm:video/x-vp9:audio/x-opus\" source-uri=\"{}\" dest-uri=\"{}\"", uri(&from)?, uri(&to)?)).map_err(|error| fail(&error))?;
  pipeline.connect("element-setup", false, |values| {
    let element = values.get(1).and_then(|value| value.get::<gstreamer::Element>().ok())?;
    (element.factory().map(|factory| factory.name()) == Some("vp9enc".into())).then(|| {
      element.set_property_from_str("deadline", "1");
      element.set_property("cpu-used", 8i32);
      element.set_property("row-mt", true);
      element.set_property("threads", std::thread::available_parallelism().map(|cores| cores.get() as i32).unwrap_or(4).min(16));
      element.set_property("target-bitrate", 4_000_000i32);
    });
    None
  });
  pipeline.set_state(gstreamer::State::Playing).map_err(|error| fail(&error))?;
  let ended = pipeline.bus().ok_or("no bus")?.iter_timed(gstreamer::ClockTime::NONE).find_map(|message| match message.view() {
    gstreamer::MessageView::Eos(_) => Some(Ok(())),
    gstreamer::MessageView::Error(error) => Some(Err(error.error().to_string())),
    _ => None,
  });
  let _ = pipeline.set_state(gstreamer::State::Null);
  let output = ended.unwrap_or(Err("stopped".into())).and_then(|_| std::fs::read(&to).map_err(|error| fail(&error)));
  let _ = (std::fs::remove_file(&from), std::fs::remove_file(&to));
  output
}

#[cfg(not(target_os = "linux"))]
fn transcode(_: &str, _: &[u8]) -> Result<Vec<u8>, String> {
  Err("unsupported".into())
}

#[tauri::command]
pub async fn media_transcode(id: String) -> Result<(), String> {
  let input = media().lock().map_err(|error| error.to_string())?.get(&id).map(|(_, bytes)| bytes.clone()).ok_or("missing")?;
  let output = tauri::async_runtime::spawn_blocking({
    let id = id.clone();
    move || transcode(&id, &input)
  })
  .await
  .map_err(|error| error.to_string())??;
  media().lock().map_err(|error| error.to_string())?.get_mut(&id).map(|entry| *entry = ("video/webm".into(), Arc::new(output)));
  Ok(())
}
