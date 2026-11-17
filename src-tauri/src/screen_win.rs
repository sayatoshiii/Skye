use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use wasapi::{initialize_mta, AudioClient, DeviceEnumerator, Direction, SampleType, SessionState, StreamMode, WaveFormat};
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

const RATE: usize = 48_000;
const CHUNK: usize = 960;
const EVERYTHING: &str = "*";

type Queues = Arc<Mutex<Vec<VecDeque<f32>>>>;

static RUNNING: LazyLock<Mutex<Option<Arc<AtomicBool>>>> = LazyLock::new(Mutex::default);

fn name(pid: u32) -> Option<String> {
  let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
  let mut path = [0u16; 1024];
  let mut size = path.len() as u32;
  let found = !handle.is_null() && unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) } != 0;
  (!handle.is_null()).then(|| unsafe { CloseHandle(handle) });
  found.then(|| String::from_utf16_lossy(&path[..size as usize])).and_then(|full| full.rsplit('\\').next().map(|file| file.trim_end_matches(".exe").to_owned()))
}

fn sessions() -> HashMap<String, Vec<u32>> {
  let _ = initialize_mta();
  let own = std::process::id();
  let mut found: HashMap<String, Vec<u32>> = HashMap::new();
  let pids: Vec<u32> = DeviceEnumerator::new()
    .and_then(|devices| devices.get_default_device(Direction::Render))
    .and_then(|device| device.get_iaudiosessionmanager())
    .and_then(|manager| manager.get_audiosessionenumerator())
    .map(|sessions| (0..sessions.get_count().unwrap_or(0)).filter_map(|index| sessions.get_session(index).ok()).filter(|session| session.get_state().map(|state| state != SessionState::Expired).unwrap_or(false)).filter_map(|session| session.get_process_id().ok()).collect())
    .unwrap_or_default();
  pids.into_iter().filter(|pid| *pid != own && *pid != 0).for_each(|pid| name(pid).into_iter().for_each(|app| found.entry(app).or_default().push(pid)));
  found
}

fn capture(pid: u32, include: bool, queues: Queues, slot: usize, alive: Arc<AtomicBool>) {
  let run = || -> Result<(), Box<dyn std::error::Error>> {
    let _ = initialize_mta();
    let format = WaveFormat::new(32, 32, SampleType::Float, RATE, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, include)?;
    client.initialize_client(&format, Direction::Capture, StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }, None)?;
    let event = client.set_get_eventhandle()?;
    let reader = client.get_audiocaptureclient()?;
    let mut bytes = VecDeque::new();
    client.start_stream()?;
    while alive.load(Ordering::Relaxed) {
      let _ = reader.read_from_device_to_deque(&mut bytes);
      let floats: Vec<f32> = bytes.drain(..bytes.len() / 4 * 4).collect::<Vec<u8>>().chunks_exact(4).map(|sample| f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]])).collect();
      queues.lock().map(|mut queues| queues[slot].extend(floats)).ok();
      let _ = event.wait_for_event(200);
    }
    client.stop_stream()?;
    Ok(())
  };
  let _ = run().map_err(|error| log::warn!("screen audio: {error}"));
}

fn mix(queues: Queues, channel: Channel<InvokeResponseBody>, alive: Arc<AtomicBool>) {
  while alive.load(Ordering::Relaxed) {
    let ready = queues.lock().map(|queues| queues.iter().any(|queue| queue.len() >= CHUNK)).unwrap_or(false);
    let mixed = ready.then(|| {
      let mut out = vec![0f32; CHUNK];
      queues.lock().map(|mut queues| queues.iter_mut().for_each(|queue| out.iter_mut().zip(queue.drain(..CHUNK.min(queue.len()))).for_each(|(slot, sample)| *slot += sample))).ok();
      out.iter().flat_map(|sample| sample.clamp(-1.0, 1.0).to_le_bytes()).collect::<Vec<u8>>()
    });
    match mixed { Some(bytes) => (channel.send(InvokeResponseBody::Raw(bytes)), ()).1, None => std::thread::sleep(Duration::from_millis(5)) };
  }
}

fn stop() {
  RUNNING.lock().ok().and_then(|mut running| running.take()).map(|alive| alive.store(false, Ordering::Relaxed));
}

#[tauri::command]
pub async fn screen_apps() -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(|| {
    let mut names: Vec<String> = sessions().into_keys().collect();
    names.sort();
    names
  })
  .await
  .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn screen_audio_capture(apps: Vec<String>, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
  stop();
  let alive = Arc::new(AtomicBool::new(true));
  let everything = apps.iter().any(|app| app == EVERYTHING);
  let known = tauri::async_runtime::spawn_blocking(sessions).await.map_err(|error| error.to_string())?;
  let targets: Vec<(u32, bool)> = match everything {
    true => vec![(std::process::id(), false)],
    false => apps.iter().flat_map(|app| known.get(app).cloned().unwrap_or_default()).map(|pid| (pid, true)).collect(),
  };
  let queues: Queues = Arc::new(Mutex::new(vec![VecDeque::new(); targets.len()]));
  targets.into_iter().enumerate().for_each(|(slot, (pid, include))| {
    let (queues, alive) = (queues.clone(), alive.clone());
    std::thread::spawn(move || capture(pid, include, queues, slot, alive));
  });
  let (mixer, flag) = (queues.clone(), alive.clone());
  std::thread::spawn(move || mix(mixer, channel, flag));
  *RUNNING.lock().map_err(|error| error.to_string())? = Some(alive);
  Ok(())
}

#[tauri::command]
pub fn screen_audio_release() {
  stop();
}
