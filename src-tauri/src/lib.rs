use tauri::Manager;

#[cfg(target_os = "linux")]
mod voice;

#[cfg(target_os = "linux")]
mod screen;

#[cfg(target_os = "linux")]
fn unlock(window: &tauri::WebviewWindow) {
  let _ = window.with_webview(|webview| {
    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
    let view = webview.inner();
    WebViewExt::settings(&view).map(|settings| (settings.set_enable_media_stream(true), settings.set_enable_webrtc(true), settings.set_enable_mediasource(true), settings.set_media_playback_requires_user_gesture(false)));
    view.connect_permission_request(|_, request| (request.allow(), true).1);
  });
}

#[cfg(not(target_os = "linux"))]
fn unlock(_: &tauri::WebviewWindow) {}

#[cfg(target_os = "linux")]
unsafe extern "C" {
  #[link_name = "_ZN14modules_portal18InitializePipewireEPv"]
  fn initialize_pipewire(module: *mut std::ffi::c_void);
}

#[cfg(target_os = "linux")]
fn audio() {
  let module = unsafe { libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) };
  (!module.is_null()).then(|| unsafe { initialize_pipewire(module) });
  pipewire::init();
  std::mem::forget(cpal::default_host());
}

#[cfg(not(target_os = "linux"))]
fn audio() {}

fn reveal(app: &tauri::AppHandle) {
  app.get_webview_window("main").map(|window| (window.show(), window.unminimize(), window.set_focus()));
}

#[cfg(desktop)]
fn quit(app: &tauri::AppHandle) {
  use tauri::Emitter;
  let handle = app.clone();
  let _ = app.emit("skye:quit", ());
  std::thread::spawn(move || (std::thread::sleep(std::time::Duration::from_secs(2)), handle.exit(0)));
}

#[tauri::command]
fn leave(app: tauri::AppHandle) {
  app.exit(0);
}

#[cfg(desktop)]
fn tray(app: &tauri::App) -> tauri::Result<()> {
  use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
  use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
  let menu = Menu::with_items(app, &[&MenuItem::with_id(app, "show", "Open Skye", true, None::<&str>)?, &PredefinedMenuItem::separator(app)?, &MenuItem::with_id(app, "quit", "Quit Skye", true, None::<&str>)?])?;
  TrayIconBuilder::with_id("skye")
    .tooltip("Skye")
    .icon(app.default_window_icon().cloned().ok_or(tauri::Error::InvalidIcon(std::io::Error::other("missing icon")))?)
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() { "show" => reveal(app), "quit" => quit(app), _ => {} })
    .on_tray_icon_event(|icon, event| matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }).then(|| reveal(icon.app_handle())).unwrap_or_default())
    .build(app)
    .map(|_| ())
}

#[cfg(mobile)]
fn tray(_: &tauri::App) -> tauri::Result<()> { Ok(()) }

#[cfg(target_os = "linux")]
fn engine(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
  builder.manage(voice::Voice::default()).manage(screen::Screen::default()).invoke_handler(tauri::generate_handler![screen::screen_start, screen::screen_stop, screen::screen_audio, screen::screen_apps, screen::screen_sharing, screen::screen_watch, screen::screen_unwatch, voice::voice_connect, voice::voice_disconnect, voice::voice_key, voice::voice_mic, voice::voice_volume, voice::voice_tuning, voice::voice_devices, voice::voice_device, leave])
}

#[cfg(not(target_os = "linux"))]
fn engine(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
  builder.invoke_handler(tauri::generate_handler![leave])
}

#[cfg(desktop)]
fn single(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
  builder.plugin(tauri_plugin_single_instance::init(|app, _, _| reveal(app)))
}

#[cfg(mobile)]
fn single(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
  builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  audio();
  engine(single(tauri::Builder::default()))
    .plugin(tauri_plugin_log::Builder::default().level([log::LevelFilter::Warn, log::LevelFilter::Info][cfg!(debug_assertions) as usize]).build())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| Ok((app.get_webview_window("main").as_ref().map(unlock).unwrap_or_default(), tray(app)?).0))
    .on_window_event(|window, event| match event { tauri::WindowEvent::CloseRequested { api, .. } if cfg!(desktop) => (api.prevent_close(), window.hide()).1.unwrap_or_default(), _ => {} })
    .build(tauri::generate_context!())
    .expect("skye failed to start")
    .run(|_app, event| match event { #[cfg(target_os = "macos")] tauri::RunEvent::Reopen { .. } => reveal(_app), _ => {} });
}
