use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;

static PORT: OnceLock<u16> = OnceLock::new();

const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style></head><body><script>
const target = new URL(decodeURIComponent(location.hash.slice(1)));
target.searchParams.has("origin") && target.searchParams.set("origin", location.origin);
target.protocol === "https:" && document.body.appendChild(Object.assign(document.createElement("iframe"), { src: target.href, allow: "fullscreen; picture-in-picture; encrypted-media; autoplay; clipboard-write", allowFullscreen: true, referrerPolicy: "strict-origin-when-cross-origin" }));
</script></body></html>"#;

pub fn serve() {
  let Ok(listener) = TcpListener::bind("127.0.0.1:0") else { return };
  let _ = listener.local_addr().map(|address| PORT.set(address.port()));
  std::thread::spawn(move || {
    listener.incoming().flatten().for_each(|mut stream| {
      let mut request = [0u8; 2048];
      let _ = stream.read(&mut request);
      let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{PAGE}", PAGE.len());
    });
  });
}

#[tauri::command]
pub fn embed_port() -> u16 {
  PORT.get().copied().unwrap_or_default()
}
