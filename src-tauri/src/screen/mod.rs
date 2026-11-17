mod sound;
mod video;

use futures_util::StreamExt;
use jpeg_encoder::{ColorType, Encoder};
use livekit::options::{TrackPublishOptions, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, VideoBuffer, VideoResolution};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_source::RtcVideoSource;
use livekit::webrtc::video_stream::native::NativeVideoStream;
use pipewire as pw;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

pub const LOCAL: &str = "local:screen";
const QUALITY: u8 = 78;
const REMOTE_WIDTH: u32 = 1920;
const PACE: Duration = Duration::from_millis(33);

static ROOMS: LazyLock<Mutex<HashMap<String, (Arc<Room>, bool)>>> = LazyLock::new(Mutex::default);
static WATCHERS: LazyLock<Mutex<HashMap<String, Channel<InvokeResponseBody>>>> = LazyLock::new(Mutex::default);

struct Running {
  stop: pw::channel::Sender<()>,
  publication: LocalTrackPublication,
}

struct Sound {
  source: NativeAudioSource,
  publication: LocalTrackPublication,
  stop: pw::channel::Sender<()>,
  apps: Vec<String>,
}

struct Share {
  room: Arc<Room>,
  video: Running,
  audio: Option<Sound>,
  window: bool,
}

#[derive(Default)]
pub struct Screen {
  share: tokio::sync::Mutex<Option<Share>>,
}

#[derive(Serialize, Clone)]
struct Remote {
  key: String,
  identity: String,
  source: &'static str,
  live: bool,
}

#[derive(Serialize)]
pub struct Started {
  window: bool,
  apps: Vec<String>,
}

type Answer<T = ()> = Result<T, String>;

fn fail(error: impl std::fmt::Display) -> String {
  error.to_string()
}

pub fn deliver(key: &str, buffer: &mut I420Buffer, widest: u32) {
  let Some(channel) = WATCHERS.lock().ok().and_then(|watchers| watchers.get(key).cloned()) else { return };
  let (width, height) = (buffer.width(), buffer.height());
  let scale = (widest as f32 / width as f32).min(1.0);
  let (fit_width, fit_height) = (((width as f32 * scale) as u32 & !1).max(2), ((height as f32 * scale) as u32 & !1).max(2));
  let mut fitted = [None, Some(())][(scale < 1.0) as usize].map(|_| buffer.scale(fit_width as i32, fit_height as i32));
  let source = fitted.as_mut().unwrap_or(buffer);
  let (sy, su, sv) = source.strides();
  let (y, u, v) = source.data();
  let mut rgba = vec![0u8; (fit_width * fit_height * 4) as usize];
  yuv_helper::i420_to_abgr(y, sy, u, su, v, sv, &mut rgba, fit_width * 4, fit_width as i32, fit_height as i32);
  let mut jpeg = Vec::with_capacity(rgba.len() / 10);
  let encoded = Encoder::new(&mut jpeg, QUALITY).encode(&rgba, fit_width as u16, fit_height as u16, ColorType::Rgba).is_ok();
  encoded.then(|| channel.send(InvokeResponseBody::Raw(jpeg)));
}

pub fn joined(link: &str, room: Arc<Room>, publish: bool) {
  ROOMS.lock().map(|mut rooms| rooms.insert(link.to_owned(), (room, publish))).ok();
}

pub fn left(link: &str) {
  ROOMS.lock().map(|mut rooms| rooms.remove(link)).ok();
}

fn publisher() -> Option<Arc<Room>> {
  ROOMS.lock().ok()?.values().find(|(_, publish)| *publish).map(|(room, _)| room.clone())
}

pub fn subscribed(app: &AppHandle, link: &str, identity: String, source: TrackSource, sid: String, track: RemoteVideoTrack) {
  let key = format!("{link}:{sid}");
  let _ = app.emit(&format!("screen:{link}"), Remote { key: key.clone(), identity, source: ["camera", "screen"][(source == TrackSource::Screenshare) as usize], live: true });
  remote(key, track);
}

pub fn unsubscribed(app: &AppHandle, link: &str, identity: String, sid: String) {
  let key = format!("{link}:{sid}");
  WATCHERS.lock().map(|mut watchers| watchers.remove(&key)).ok();
  let _ = app.emit(&format!("screen:{link}"), Remote { key, identity, source: "screen", live: false });
}

fn remote(key: String, track: RemoteVideoTrack) {
  tauri::async_runtime::spawn(async move {
    let mut stream = NativeVideoStream::new(track.rtc_track());
    let mut shown = Instant::now() - PACE;
    while let Some(frame) = stream.next().await {
      let due = shown.elapsed() >= PACE && WATCHERS.lock().map(|watchers| watchers.contains_key(&key)).unwrap_or(false);
      due.then(|| (deliver(&key, &mut frame.buffer.to_i420(), REMOTE_WIDTH), shown = Instant::now()));
    }
  });
}

fn spawn<F: FnOnce(pw::channel::Receiver<()>) -> Result<(), pw::Error> + Send + 'static>(work: F) -> pw::channel::Sender<()> {
  let (stop, wait) = pw::channel::channel();
  std::thread::spawn(move || work(wait).map_err(|error| log::warn!("screen: {error}")));
  stop
}

fn target(apps: &[String]) -> sound::Target {
  [sound::Target::Apps(apps.to_vec()), sound::Target::System][apps.iter().any(|app| app == "*") as usize].clone()
}

async fn audio(room: &Room, apps: Vec<String>) -> Answer<Sound> {
  let source = NativeAudioSource::new(AudioSourceOptions { echo_cancellation: false, noise_suppression: false, auto_gain_control: false }, sound::RATE, 2, 100);
  let track = LocalAudioTrack::create_audio_track("screen-audio", RtcAudioSource::Native(source.clone()));
  let publication = room.local_participant().publish_track(LocalTrack::Audio(track), TrackPublishOptions { source: TrackSource::ScreenshareAudio, dtx: false, red: false, ..Default::default() }).await.map_err(fail)?;
  let (feed, chosen) = (source.clone(), target(&apps));
  Ok(Sound { stop: spawn(move |wait| sound::run(chosen, feed, wait)), source, publication, apps })
}

fn retarget(sound: &mut Sound, apps: Vec<String>) {
  let _ = sound.stop.send(());
  let (feed, chosen) = (sound.source.clone(), target(&apps));
  sound.stop = spawn(move |wait| sound::run(chosen, feed, wait));
  sound.apps = apps;
}

async fn silence(room: &Room, sound: Sound) {
  let _ = sound.stop.send(());
  let _ = room.local_participant().unpublish_track(&sound.publication.sid()).await;
}

async fn halt(room: &Room, running: Running) {
  let _ = running.stop.send(());
  let _ = room.local_participant().unpublish_track(&running.publication.sid()).await;
}

#[tauri::command]
pub async fn screen_start(screen: State<'_, Screen>) -> Answer<Started> {
  log::warn!("screen: start");
  let room = publisher().ok_or("not_in_call")?;
  let mut slot = screen.share.lock().await;
  let previous = slot.take();
  match previous { Some(share) => stop(share).await, None => () };
  let picked = video::pick().await.map_err(|error| (log::warn!("screen: pick failed {error}"), error).1)?;
  log::warn!("screen: picked node {} window {}", picked.node, picked.window);
  let window = picked.window;
  let source = NativeVideoSource::new(VideoResolution { width: 1920, height: 1080 }, true);
  let track = LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(source.clone()));
  let options = TrackPublishOptions { source: TrackSource::Screenshare, video_encoding: Some(VideoEncoding { max_bitrate: 6_000_000, max_framerate: 30.0 }), simulcast: false, ..Default::default() };
  let publication = room.local_participant().publish_track(LocalTrack::Video(track), options).await.map_err(fail)?;
  log::warn!("screen: published");
  let video = Running { stop: spawn(move |wait| video::run(picked, source, wait)), publication };
  let sound = match window { true => None, false => audio(&room, vec!["*".into()]).await.ok() };
  let apps = sound.as_ref().map(|sound| sound.apps.clone()).unwrap_or_default();
  *slot = Some(Share { room, video, audio: sound, window });
  Ok(Started { window, apps })
}

async fn stop(share: Share) {
  halt(&share.room, share.video).await;
  match share.audio { Some(sound) => silence(&share.room, sound).await, None => () };
}

#[tauri::command]
pub async fn screen_stop(screen: State<'_, Screen>) -> Answer {
  let share = screen.share.lock().await.take();
  match share { Some(share) => stop(share).await, None => () };
  WATCHERS.lock().map_err(fail)?.remove(LOCAL);
  Ok(())
}

#[tauri::command]
pub async fn screen_audio(screen: State<'_, Screen>, apps: Vec<String>) -> Answer {
  let mut slot = screen.share.lock().await;
  let share = slot.as_mut().ok_or("not_sharing")?;
  let current = share.audio.take();
  share.audio = match (current, apps.is_empty()) {
    (Some(sound), true) => (silence(&share.room, sound).await, None).1,
    (Some(mut sound), false) => (retarget(&mut sound, apps), Some(sound)).1,
    (None, false) => Some(audio(&share.room, apps).await?),
    (None, true) => None,
  };
  Ok(())
}

#[tauri::command]
pub async fn screen_apps() -> Answer<Vec<String>> {
  tauri::async_runtime::spawn_blocking(sound::apps).await.map_err(fail)
}

#[tauri::command]
pub async fn screen_sharing(screen: State<'_, Screen>) -> Answer<Option<Started>> {
  Ok(screen.share.lock().await.as_ref().map(|share| Started { window: share.window, apps: share.audio.as_ref().map(|sound| sound.apps.clone()).unwrap_or_default() }))
}

#[tauri::command]
pub fn screen_watch(key: String, channel: Channel<InvokeResponseBody>) -> Answer {
  WATCHERS.lock().map_err(fail)?.insert(key, channel);
  Ok(())
}

#[tauri::command]
pub fn screen_unwatch(key: String) -> Answer {
  WATCHERS.lock().map_err(fail)?.remove(&key);
  Ok(())
}
