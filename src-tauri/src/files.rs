use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

fn bytes(request: &Request<'_>) -> Result<Vec<u8>, String> {
  match request.body() {
    InvokeBody::Raw(data) => Ok(data.clone()),
    _ => Err("expected raw bytes".into()),
  }
}

fn free(folder: PathBuf, name: &str) -> PathBuf {
  let path = std::path::Path::new(name);
  let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("file");
  let extension = path.extension().and_then(|extension| extension.to_str()).map(|extension| format!(".{extension}")).unwrap_or_default();
  (0..)
    .map(|index| folder.join([format!("{stem}{extension}"), format!("{stem} ({index}){extension}")][(index > 0) as usize].clone()))
    .find(|candidate| !candidate.exists())
    .unwrap_or_else(|| folder.join(name))
}

#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> Result<String, String> {
  let name = request.headers().get("x-name").and_then(|value| value.to_str().ok()).map(|value| value.replace(['/', '\\'], "_")).filter(|value| !value.is_empty()).unwrap_or_else(|| "download".into());
  let data = bytes(&request)?;
  let folder = app.path().download_dir().map_err(|error| error.to_string())?;
  let suggested = free(folder.clone(), &name).file_name().and_then(|file| file.to_str()).unwrap_or(&name).to_owned();
  let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_directory(folder).set_file_name(suggested).blocking_save_file()).await.map_err(|error| error.to_string())?;
  let target = picked.and_then(|path| path.into_path().ok()).ok_or("cancelled")?;
  std::fs::write(&target, data).map_err(|error| error.to_string())?;
  Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn copy_image(app: AppHandle, request: Request<'_>) -> Result<(), String> {
  let png = bytes(&request)?;
  let image = tauri::image::Image::from_bytes(&png).map_err(|error| error.to_string())?;
  app.clipboard().write_image(&image).map_err(|error| error.to_string())
}

#[derive(Default)]
pub struct Dropped(std::sync::Mutex<std::collections::HashSet<PathBuf>>);

pub fn track(window: &tauri::WebviewWindow) {
  let app = window.app_handle().clone();
  window.on_window_event(move |event| {
    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
      app.state::<Dropped>().0.lock().unwrap().extend(paths.iter().filter(|path| path.is_file()).cloned());
    }
  });
}

#[tauri::command]
pub async fn dropped_file(app: AppHandle, path: PathBuf) -> Result<tauri::ipc::Response, String> {
  if !app.state::<Dropped>().0.lock().unwrap().remove(&path) {
    return Err("not dropped".into());
  }
  std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}
