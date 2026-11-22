use tauri::Manager;

mod embed;

#[cfg(desktop)]
mod files;

#[cfg(any())]
mod voice;

#[cfg(any())]
mod screen;

#[cfg(windows)]
mod screen_win;

#[cfg(target_os = "linux")]
mod screen_pw;

#[cfg(target_os = "linux")]
mod location;

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
mod ptt;

#[cfg(any())]
fn unlock(window: &tauri::WebviewWindow) {
  let app = window.app_handle().clone();
  let (enter, leave) = (window.clone(), window.clone());
  let _ = window.with_webview(move |webview| {
    use webkit2gtk::{CacheModel, PermissionRequestExt, SettingsExt, WebContextExt, WebViewExt};
    let view = webview.inner();
    view.context().map(|context| context.set_cache_model(CacheModel::DocumentBrowser));
    WebViewExt::settings(&view).map(|settings| (settings.set_enable_page_cache(false), settings.set_enable_back_forward_navigation_gestures(false)));
    WebViewExt::settings(&view).map(|settings| (settings.set_enable_media_stream(true), settings.set_enable_webrtc(true), settings.set_enable_mediasource(true), settings.set_media_playback_requires_user_gesture(false)));
    view.connect_permission_request(|_, request| (request.allow(), true).1);
    WebViewExt::settings(&view).map(|settings| settings.set_enable_fullscreen(true));
    view.connect_enter_fullscreen(move |_| (enter.set_fullscreen(true), false).1);
    view.connect_leave_fullscreen(move |_| (leave.set_fullscreen(false), false).1);
    view.connect_create(move |_, action| {
      use tauri_plugin_opener::OpenerExt;
      use webkit2gtk::URIRequestExt;
      let target = action.clone().request().and_then(|request| request.uri()).map(|uri| uri.to_string()).filter(|uri| uri.starts_with("http") || uri.starts_with("mailto:"));
      target.map(|uri| app.opener().open_url(uri, None::<&str>));
      None
    });
  });
}

fn unlock(_: &tauri::WebviewWindow) {}

#[cfg(any())]
unsafe extern "C" {
  #[link_name = "_ZN14modules_portal18InitializePipewireEPv"]
  fn initialize_pipewire(module: *mut std::ffi::c_void);
}

#[cfg(any())]
fn audio() {
  let module = unsafe { libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) };
  (!module.is_null()).then(|| unsafe { initialize_pipewire(module) });
  pipewire::init();
  std::mem::forget(cpal::default_host());
}

fn audio() {}

#[cfg(target_os = "linux")]
fn style<'a>(app: &tauri::App, builder: tauri::WebviewWindowBuilder<'a, tauri::DynRuntime, tauri::App>) -> tauri::WebviewWindowBuilder<'a, tauri::DynRuntime, tauri::App> {
  use tauri_runtime_cef::WebviewWindowBuilderCefExt;
  let profile = app.path().cache_dir().map(|cache| cache.join(&app.config().identifier).join("cef").join("skye"));
  profile.into_iter().fold(builder, |builder, path| builder.data_directory(path)).browser_runtime_style(tauri_runtime_cef::RuntimeStyle::Alloy)
}

#[cfg(not(target_os = "linux"))]
fn style<'a>(_: &tauri::App, builder: tauri::WebviewWindowBuilder<'a, tauri::DynRuntime, tauri::App>) -> tauri::WebviewWindowBuilder<'a, tauri::DynRuntime, tauri::App> {
  builder
}

fn window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
  use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
  use tauri_plugin_opener::OpenerExt;
  let opener = app.handle().clone();
  style(app, tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?)
    .on_permission_request(|_, kind| [PermissionResponse::Allow, PermissionResponse::Default][matches!(kind, PermissionKind::Other) as usize])
    .on_new_window(move |url, _| (["http", "https", "mailto"].contains(&url.scheme()).then(|| opener.opener().open_url(url.as_str(), None::<&str>)), NewWindowResponse::Deny).1)
    .devtools(debugging())
    .build()
}

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

#[cfg(all(unix, desktop))]
fn signals(app: &tauri::AppHandle) {
  use tokio::signal::unix::{signal, SignalKind};
  let handle = app.clone();
  tauri::async_runtime::spawn(async move {
    let (Ok(mut term), Ok(mut int), Ok(mut hup)) = (signal(SignalKind::terminate()), signal(SignalKind::interrupt()), signal(SignalKind::hangup())) else { return };
    tokio::select! { _ = term.recv() => {}, _ = int.recv() => {}, _ = hup.recv() => {} }
    quit(&handle);
  });
}

#[cfg(not(all(unix, desktop)))]
fn signals(_: &tauri::AppHandle) {}

#[tauri::command]
fn leave(app: tauri::AppHandle) {
  app.exit(0);
}

#[cfg(target_os = "linux")]
fn label(builder: tauri::tray::TrayIconBuilder<tauri::DynRuntime>) -> tauri::tray::TrayIconBuilder<tauri::DynRuntime> {
  builder.title("Skye")
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn label(builder: tauri::tray::TrayIconBuilder<tauri::DynRuntime>) -> tauri::tray::TrayIconBuilder<tauri::DynRuntime> {
  builder.tooltip("Skye")
}

#[cfg(desktop)]
fn tray(app: &tauri::App) -> tauri::Result<()> {
  use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
  use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
  let menu = Menu::with_items(app, &[&MenuItem::with_id(app, "show", "Open Skye", true, None::<&str>)?, &PredefinedMenuItem::separator(app)?, &MenuItem::with_id(app, "quit", "Quit Skye", true, None::<&str>)?])?;
  label(TrayIconBuilder::with_id("skye"))
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
fn engine(builder: tauri::Builder) -> tauri::Builder {
  builder.invoke_handler(tauri::generate_handler![screen_pw::screen_apps, screen_pw::screen_audio_capture, screen_pw::screen_audio_release, location::location_current, ptt::ptt_bind, embed::embed_port, embed::media_put, embed::media_transcode, embed::media_drop, files::save_download, files::copy_image, leave])
}

#[cfg(windows)]
fn engine(builder: tauri::Builder) -> tauri::Builder {
  builder.invoke_handler(tauri::generate_handler![screen_win::screen_apps, screen_win::screen_audio_capture, screen_win::screen_audio_release, ptt::ptt_bind, embed::embed_port, embed::media_put, embed::media_transcode, embed::media_drop, files::save_download, files::copy_image, leave])
}

#[cfg(target_os = "macos")]
fn engine(builder: tauri::Builder) -> tauri::Builder {
  builder.invoke_handler(tauri::generate_handler![ptt::ptt_bind, embed::embed_port, embed::media_put, embed::media_transcode, embed::media_drop, files::save_download, files::copy_image, leave])
}

#[cfg(mobile)]
fn engine(builder: tauri::Builder) -> tauri::Builder {
  builder.invoke_handler(tauri::generate_handler![embed::embed_port, embed::media_put, embed::media_transcode, embed::media_drop, leave])
}

#[cfg(desktop)]
fn single(builder: tauri::Builder) -> tauri::Builder {
  builder.plugin(tauri_plugin_single_instance::init(|app, _, _| reveal(app))).plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init())
}

#[cfg(mobile)]
fn single(builder: tauri::Builder) -> tauri::Builder {
  builder
}

fn debugging() -> bool {
  std::env::args().any(|arg| arg == "--debug")
}

fn debug_port() -> Option<u16> {
  let args: Vec<String> = std::env::args().collect();
  let port = args.iter().enumerate().find_map(|(at, arg)| arg.strip_prefix("--port=").map(str::to_owned).or_else(|| (arg == "--port").then(|| args.get(at + 1).cloned()).flatten())).and_then(|value| value.parse::<u16>().ok());
  match (debugging(), port) {
    (true, Some(port)) => (log::warn!("debug: DevTools protocol open on 127.0.0.1:{port}; anything on this machine can control Skye while it runs"), Some(port)).1,
    (false, Some(_)) => (log::warn!("debug: --port needs --debug, ignoring it"), None).1,
    _ => None,
  }
}

#[cfg(target_os = "linux")]
fn runtime() -> tauri_runtime_cef::Cef {
  use tauri_runtime_cef::{DevToolsPolicy, RemoteDebugging};
  let cef = tauri_runtime_cef::Cef::default().enable_features(["WebRTCPipeWireCapturer"]).devtools([DevToolsPolicy::Auto, DevToolsPolicy::Allowed][debugging() as usize]);
  match debug_port() { Some(port) => cef.remote_debugging(RemoteDebugging::Port { port, allowed_origins: Vec::new() }), None => cef }
}

#[cfg(not(target_os = "linux"))]
fn runtime() -> tauri_runtime_wry::Wry { tauri_runtime_wry::Wry::default() }

#[cfg(target_os = "linux")]
fn handoff(identifier: &str) {
  let name = format!("{identifier}.SingleInstance");
  let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
  let argv: Vec<String> = std::env::args_os().map(|arg| arg.to_string_lossy().into_owned()).collect();
  let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
  let answered = zbus::blocking::Connection::session().and_then(|bus| bus.call_method(Some(name.as_str()), path.as_str(), Some("org.SingleInstance.DBus"), "ExecuteCallback", &(argv, cwd))).is_ok();
  answered.then(|| std::process::exit(0));
}

#[cfg(not(target_os = "linux"))]
fn handoff(_: &str) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let context = tauri::generate_context!();
  handoff(&context.config().identifier);
  audio();
  embed::serve();
  engine(single(tauri::Builder::default().runtime(runtime())))
    .plugin(tauri_plugin_log::Builder::default().level([log::LevelFilter::Warn, log::LevelFilter::Info][cfg!(debug_assertions) as usize]).build())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      let main = window(app)?;
      debugging().then(|| main.open_devtools());
      Ok((unlock(&main), tray(app)?, signals(app.handle())).0)
    })
    .on_window_event(|window, event| match event { tauri::WindowEvent::CloseRequested { api, .. } if cfg!(desktop) => (api.prevent_close(), window.hide()).1.unwrap_or_default(), _ => {} })
    .build(context)
    .expect("skye failed to start")
    .run(|_app, event| match event {
      #[cfg(target_os = "macos")]
      tauri::RunEvent::Reopen { .. } => reveal(_app),
      #[cfg(desktop)]
      tauri::RunEvent::ExitRequested { code: None, api, .. } => (api.prevent_exit(), quit(_app)).1,
      _ => {}
    });
}
