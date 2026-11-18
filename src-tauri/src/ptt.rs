use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct Press {
  held: bool,
}

static KEY: Mutex<String> = Mutex::new(String::new());
static STARTED: OnceLock<()> = OnceLock::new();

fn wayland() -> bool {
  cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn rdev_name(code: &str) -> String {
  [("Digit", "Num"), ("AltLeft", "Alt"), ("AltRight", "AltGr"), ("Backquote", "BackQuote"), ("Backslash", "BackSlash"), ("Enter", "Return"), ("Numpad", "Kp"), ("BracketLeft", "LeftBracket"), ("BracketRight", "RightBracket")]
    .iter()
    .fold(code.to_owned(), |name, (from, to)| name.replace(from, to))
}

fn trigger(code: &str) -> String {
  code.strip_prefix("Key").or(code.strip_prefix("Digit")).map(str::to_lowercase).unwrap_or_else(|| code.replace("Left", "").replace("Right", "").to_lowercase())
}

fn send(app: &AppHandle, held: bool) {
  let _ = app.emit("ptt", Press { held });
}

fn listen_keys(app: AppHandle) {
  std::thread::spawn(move || {
    let _ = rdev::listen(move |event| {
      let key = KEY.lock().map(|key| key.clone()).unwrap_or_default();
      let name = |pressed: &rdev::Key| format!("{pressed:?}") == rdev_name(&key);
      match event.event_type {
        rdev::EventType::KeyPress(pressed) if !key.is_empty() && name(&pressed) => send(&app, true),
        rdev::EventType::KeyRelease(pressed) if !key.is_empty() && name(&pressed) => send(&app, false),
        _ => {}
      }
    });
  });
}

#[cfg(target_os = "linux")]
async fn portal(app: AppHandle, code: String) -> ashpd::Result<()> {
  use ashpd::desktop::global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut};
  use ashpd::desktop::CreateSessionOptions;
  use futures_util::StreamExt;
  let shortcuts = GlobalShortcuts::new().await?;
  let session = shortcuts.create_session(CreateSessionOptions::default()).await?;
  let wanted = trigger(&code);
  shortcuts.bind_shortcuts(&session, &[NewShortcut::new("ptt", "Push to talk").preferred_trigger(Some(wanted.as_str()))], None, BindShortcutsOptions::default()).await?.response()?;
  let mut down = shortcuts.receive_activated().await?;
  let mut up = shortcuts.receive_deactivated().await?;
  loop {
    tokio::select! {
      Some(event) = down.next() => (event.shortcut_id() == "ptt").then(|| send(&app, true)),
      Some(event) = up.next() => (event.shortcut_id() == "ptt").then(|| send(&app, false)),
      else => break Ok(()),
    };
  }
}

#[cfg(not(target_os = "linux"))]
async fn portal(_: AppHandle, _: String) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub async fn ptt_bind(app: AppHandle, code: String) -> Result<(), String> {
  *KEY.lock().map_err(|error| error.to_string())? = code.clone();
  let fresh = !code.is_empty() && STARTED.set(()).is_ok();
  match (wayland(), fresh) {
    (true, true) => drop(tauri::async_runtime::spawn(async move { let _ = portal(app, code).await.map_err(|error| log::warn!("ptt portal: {error}")); })),
    (false, true) => listen_keys(app),
    _ => {}
  }
  Ok(())
}
