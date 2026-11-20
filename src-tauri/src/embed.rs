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
  let target = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
  let path = target.split('?').next().unwrap_or("/").to_owned();
  #[cfg(target_os = "linux")]
  if let Some((route, id)) = path.strip_prefix('/').and_then(|rest| rest.split_once('/')).filter(|(route, _)| ["thumb", "info", "live"].contains(route)) {
    let _ = match route {
      "live" => live(&mut stream, id, target.split_once("?t=").and_then(|(_, time)| time.split('&').next()?.parse::<f64>().ok()).unwrap_or(0.0).max(0.0)).or_else(|error| write!(stream, "HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{error}", error.len()).map_err(|error| error.to_string())),
      "thumb" => match probe(id) {
        Ok((frame, _)) => write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\nCache-Control: private, max-age=31536000, immutable\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", frame.len()).and_then(|_| stream.write_all(&frame)).map_err(|error| error.to_string()),
        Err(error) => write!(stream, "HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{error}", error.len()).map_err(|error| error.to_string()),
      },
      _ => {
        let body = probe(id).map(|(_, duration)| format!("{{\"duration\":{duration}}}")).unwrap_or_else(|error| format!("{{\"error\":\"{error}\"}}"));
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{body}", body.len()).map_err(|error| error.to_string())
      }
    };
    return;
  }
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
  #[cfg(target_os = "linux")]
  let _ = (std::fs::remove_file(std::env::temp_dir().join(format!("skye-{id}.src"))), PROBES.get().map(|probes| probes.lock().map(|mut found| found.remove(&id))));
}

#[cfg(target_os = "linux")]
static READY: OnceLock<bool> = OnceLock::new();

#[cfg(target_os = "linux")]
static PROBES: OnceLock<Mutex<HashMap<String, (Arc<Vec<u8>>, f64)>>> = OnceLock::new();

#[cfg(target_os = "linux")]
fn system() {
  use std::path::Path;
  let host = |parts: &[&str]| format!("/{}", parts.join("/"));
  let dirs: Vec<String> = [host(&["usr", "lib", "gstreamer-1.0"]), host(&["usr", "lib64", "gstreamer-1.0"]), host(&["usr", "lib", "x86_64-linux-gnu", "gstreamer-1.0"]), host(&["usr", "lib", "aarch64-linux-gnu", "gstreamer-1.0"])].into_iter().filter(|dir| Path::new(dir).is_dir()).collect();
  let scanner = [host(&["usr", "lib", "gstreamer-1.0", "gst-plugin-scanner"]), host(&["usr", "libexec", "gstreamer-1.0", "gst-plugin-scanner"]), host(&["usr", "lib", "x86_64-linux-gnu", "gstreamer1.0", "gstreamer-1.0", "gst-plugin-scanner"])].into_iter().find(|path| Path::new(path).exists());
  let registry = std::env::var_os("HOME").map(|home| Path::new(&home).join(".cache/skye-gstreamer-registry.bin"));
  unsafe {
    (!dirs.is_empty()).then(|| std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", dirs.join(":")));
    scanner.map(|path| std::env::set_var("GST_PLUGIN_SCANNER_1_0", path));
    registry.map(|path| std::env::set_var("GST_REGISTRY_1_0", path));
  }
}

#[cfg(target_os = "linux")]
fn ready() -> Result<(), String> {
  READY
    .get_or_init(|| {
      std::env::var_os("APPDIR").is_some().then(system);
      gstreamer::init().is_ok() && ["uritranscodebin", "decodebin3", "vp9enc", "opusenc", "webmmux", "playbin3", "jpegenc", "appsink"].iter().all(|name| gstreamer::ElementFactory::find(name).is_some())
    })
    .then_some(())
    .ok_or_else(|| "gstreamer".to_owned())
}

#[cfg(target_os = "linux")]
fn tune(element: &gstreamer::Element) {
  use gstreamer::prelude::*;
  match element.factory().map(|factory| factory.name().to_string()).unwrap_or_default().as_str() {
    "vp9enc" => {
      element.set_property_from_str("deadline", "1");
      element.set_property("cpu-used", 8i32);
      element.set_property("row-mt", true);
      element.set_property("lag-in-frames", 0i32);
      element.set_property("threads", std::thread::available_parallelism().map(|cores| cores.get() as i32).unwrap_or(4).min(16));
      element.set_property("target-bitrate", 4_000_000i32);
    }
    "appsink" => (element.set_property("sync", false), element.set_property("max-buffers", 8u32)).1,
    _ => {}
  }
}

#[cfg(target_os = "linux")]
fn source(id: &str) -> Result<std::path::PathBuf, String> {
  let path = std::env::temp_dir().join(format!("skye-{id}.src"));
  let bytes = media().lock().map_err(|error| error.to_string())?.get(id).map(|(_, bytes)| bytes.clone()).ok_or("missing")?;
  (path.exists() || std::fs::write(&path, bytes.as_slice()).is_ok()).then_some(path).ok_or_else(|| "write failed".to_owned())
}

#[cfg(target_os = "linux")]
fn uri(path: &std::path::Path) -> Result<String, String> {
  gstreamer::glib::filename_to_uri(path, None).map(|uri| uri.to_string()).map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
fn probe(id: &str) -> Result<(Arc<Vec<u8>>, f64), String> {
  use gstreamer::prelude::*;
  let probes = PROBES.get_or_init(Default::default);
  if let Some(found) = probes.lock().map_err(|error| error.to_string())?.get(id).cloned() {
    return Ok(found);
  }
  ready()?;
  let pipeline = gstreamer::parse::launch(&format!("playbin3 uri=\"{}\" flags=1 audio-sink=fakesink video-sink=\"videoconvert ! videoscale ! video/x-raw,width=640,pixel-aspect-ratio=1/1 ! jpegenc ! appsink name=frame\"", uri(&source(id)?)?)).map_err(|error| error.to_string())?;
  pipeline.set_state(gstreamer::State::Paused).map_err(|error| error.to_string())?;
  let settled = pipeline.bus().ok_or("no bus")?.timed_pop_filtered(gstreamer::ClockTime::from_seconds(10), &[gstreamer::MessageType::AsyncDone, gstreamer::MessageType::Error]);
  let sink = pipeline.property::<gstreamer::Element>("video-sink").downcast::<gstreamer::Bin>().ok().and_then(|bin| bin.by_name("frame"));
  let frame = settled.filter(|message| matches!(message.view(), gstreamer::MessageView::AsyncDone(_))).and(sink).and_then(|sink| sink.emit_by_name::<Option<gstreamer::Sample>>("pull-preroll", &[])).and_then(|sample| sample.buffer().and_then(|buffer| buffer.map_readable().ok().map(|map| map.to_vec())));
  let duration = pipeline.query_duration::<gstreamer::ClockTime>().map(|time| time.nseconds() as f64 / 1e9).unwrap_or_default();
  let _ = pipeline.set_state(gstreamer::State::Null);
  let found = (Arc::new(frame.ok_or("no frame")?), duration);
  probes.lock().map_err(|error| error.to_string())?.insert(id.to_owned(), found.clone());
  Ok(found)
}

#[cfg(target_os = "linux")]
fn sink(holder: &gstreamer::Element, property: &str) -> Option<gstreamer::Element> {
  use gstreamer::prelude::*;
  let element = holder.property::<gstreamer::Element>(property);
  element.clone().downcast::<gstreamer::Bin>().ok().and_then(|bin| bin.iterate_sinks().into_iter().flatten().next()).or(Some(element))
}

#[cfg(target_os = "linux")]
fn pump(from: gstreamer::Element, to: gstreamer::Element) {
  use gstreamer::prelude::*;
  std::thread::spawn(move || {
    std::iter::from_fn(|| from.emit_by_name::<Option<gstreamer::Sample>>("pull-sample", &[]))
      .try_for_each(|sample| {
        let mut buffer = sample.buffer_owned().ok_or(())?;
        let segment = sample.segment().and_then(|segment| segment.downcast_ref::<gstreamer::ClockTime>().cloned());
        let shifted = |time: Option<gstreamer::ClockTime>| time.and_then(|time| segment.as_ref().map_or(Some(time), |segment| segment.to_running_time(time)));
        let writable = buffer.make_mut();
        let (pts, dts) = (shifted(writable.pts()), shifted(writable.dts()));
        writable.set_pts(pts);
        writable.set_dts(dts);
        (to.emit_by_name::<gstreamer::FlowReturn>("push-buffer", &[&buffer]) == gstreamer::FlowReturn::Ok).then_some(()).ok_or(())
      })
      .ok();
    let _ = to.emit_by_name::<gstreamer::FlowReturn>("end-of-stream", &[]);
  });
}

#[cfg(target_os = "linux")]
fn live(stream: &mut TcpStream, id: &str, start: f64) -> Result<(), String> {
  use gstreamer::prelude::*;
  ready()?;
  let fail = |error: &dyn std::fmt::Display| error.to_string();
  let decode = gstreamer::parse::launch(&format!("playbin3 uri=\"{}\" flags=3 video-sink=\"appsink name=video sync=false max-buffers=4\" audio-sink=\"appsink name=audio sync=false max-buffers=16\"", uri(&source(id)?)?)).map_err(|error| fail(&error))?;
  let (video, audio) = (sink(&decode, "video-sink").ok_or("no video sink")?, sink(&decode, "audio-sink").ok_or("no audio sink")?);
  video.set_property("caps", gstreamer::Caps::builder("video/x-raw").build());
  audio.set_property("caps", gstreamer::Caps::builder("audio/x-raw").build());
  let settle = |pipeline: &gstreamer::Element| pipeline.bus().and_then(|bus| bus.timed_pop_filtered(gstreamer::ClockTime::from_seconds(15), &[gstreamer::MessageType::AsyncDone, gstreamer::MessageType::Error])).filter(|message| matches!(message.view(), gstreamer::MessageView::AsyncDone(_))).ok_or_else(|| "decode failed".to_owned());
  let _decoding = Halt(decode.clone());
  let begun = (|| {
    decode.set_state(gstreamer::State::Paused).map_err(|error| fail(&error))?;
    settle(&decode)?;
    (start > 0.0).then(|| decode.seek_simple(gstreamer::SeekFlags::FLUSH | gstreamer::SeekFlags::ACCURATE, gstreamer::ClockTime::from_nseconds((start * 1e9) as u64)).map_err(|error| fail(&error)).and_then(|_| settle(&decode))).transpose()?;
    Ok::<_, String>(())
  })();
  begun?;
  let first = |sink: &gstreamer::Element| sink.emit_by_name::<Option<gstreamer::Sample>>("try-pull-preroll", &[&gstreamer::ClockTime::ZERO]);
  let (pictures, sounds) = (first(&video), first(&audio));
  let caps = |sample: &Option<gstreamer::Sample>| sample.as_ref().and_then(|sample| sample.caps_owned());
  let (picture, sound) = (caps(&pictures).ok_or("no video")?, caps(&sounds));
  let encode = gstreamer::parse::launch(&format!(
    "appsrc name=pictures format=time block=true max-bytes=33554432 ! queue ! videoconvert ! vp9enc name=vp9 ! queue ! webmmux name=mux streamable=true ! appsink name=out sync=false max-buffers=8{}",
    sound.as_ref().map(|_| " appsrc name=sounds format=time block=true max-bytes=4194304 ! queue ! audioconvert ! audioresample ! opusenc ! queue ! mux.").unwrap_or("")
  ))
  .map_err(|error| fail(&error))?
  .downcast::<gstreamer::Bin>()
  .map_err(|_| "not a bin".to_owned())?;
  let named = |name: &str| encode.by_name(name).ok_or_else(|| format!("missing {name}"));
  tune(&named("vp9")?);
  named("pictures")?.set_property("caps", &picture);
  sound.as_ref().map(|sound| named("sounds").map(|element| element.set_property("caps", sound))).transpose()?;
  let out = named("out")?;
  let encode = encode.upcast::<gstreamer::Element>();
  let _encoding = Halt(encode.clone());
  encode.set_state(gstreamer::State::Playing).map_err(|error| fail(&error))?;
  pump(video.clone(), named_element(&encode, "pictures")?);
  sound.is_some().then(|| named_element(&encode, "sounds").map(|sounds| pump(audio.clone(), sounds))).transpose()?;
  decode.set_state(gstreamer::State::Playing).map_err(|error| fail(&error))?;
  let sent = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: video/webm\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").map_err(|error| fail(&error)).and_then(|_| {
    std::iter::from_fn(|| out.emit_by_name::<Option<gstreamer::Sample>>("pull-sample", &[]))
      .try_for_each(|sample| sample.buffer().and_then(|buffer| buffer.map_readable().ok().map(|map| stream.write_all(&map))).unwrap_or(Ok(())))
      .map_err(|error| fail(&error))
  });
  sent
}

#[cfg(target_os = "linux")]
struct Halt(gstreamer::Element);

#[cfg(target_os = "linux")]
impl Drop for Halt {
  fn drop(&mut self) {
    use gstreamer::prelude::*;
    let _ = self.0.set_state(gstreamer::State::Null);
  }
}

#[cfg(target_os = "linux")]
fn named_element(pipeline: &gstreamer::Element, name: &str) -> Result<gstreamer::Element, String> {
  use gstreamer::prelude::*;
  pipeline.clone().downcast::<gstreamer::Bin>().ok().and_then(|bin| bin.by_name(name)).ok_or_else(|| format!("missing {name}"))
}

#[cfg(target_os = "linux")]
fn transcode(id: &str, input: &[u8]) -> Result<Vec<u8>, String> {
  use gstreamer::prelude::*;
  let fail = |error: &dyn std::fmt::Display| error.to_string();
  ready()?;
  let base = std::env::temp_dir().join(format!("skye-{id}"));
  let (from, to) = (base.with_extension("in"), base.with_extension("webm"));
  std::fs::write(&from, input).map_err(|error| fail(&error))?;
  let pipeline = gstreamer::parse::launch(&format!("uritranscodebin profile=\"video/webm:video/x-vp9:audio/x-opus\" source-uri=\"{}\" dest-uri=\"{}\"", uri(&from)?, uri(&to)?)).map_err(|error| fail(&error))?;
  pipeline.connect("element-setup", false, |values| values.get(1).and_then(|value| value.get::<gstreamer::Element>().ok()).map(|element| tune(&element)).and(None));
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
