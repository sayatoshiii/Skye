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
      Some((from, to)) => write!(stream, "HTTP/1.1 206 Partial Content\r\nContent-Type: {kind}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {from}-{to}/{}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", bytes.len(), to - from + 1).and_then(|_| stream.write_all(&bytes[from..=to])),
      None => write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", bytes.len()).and_then(|_| stream.write_all(&bytes)),
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
