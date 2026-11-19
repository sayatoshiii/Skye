use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use livekit::e2ee::key_provider::{KeyDerivationAlgorithm, KeyProvider, KeyProviderOptions, MAX_KEY_RING_SIZE};
use livekit::e2ee::{E2eeOptions, EncryptionType};
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use livekit::webrtc::native::apm::AudioProcessingModule;
use livekit::webrtc::peer_connection_factory::IceTransportsType;
use nnnoiseless::DenoiseState;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const RATE: u32 = 48_000;
const FRAME: usize = 480;
const BUFFERED: usize = RATE as usize / 5;
const HOLD: Duration = Duration::from_millis(350);
const VOICE: f32 = 0.55;
const FLOOR: f32 = -100.0;
const SPEAKING: f32 = -62.0;

static AUDIO: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Clone, Copy)]
pub struct Tuning {
  noise: bool,
  echo: bool,
  auto: bool,
  threshold: f32,
}

impl Default for Tuning {
  fn default() -> Self {
    Self { noise: true, echo: true, auto: true, threshold: -50.0 }
  }
}

struct Engine {
  app: AppHandle,
  tuning: Mutex<Tuning>,
  apm: Mutex<AudioProcessingModule>,
  source: NativeAudioSource,
  remotes: Mutex<HashMap<String, (String, VecDeque<i16>)>>,
  gains: Mutex<HashMap<String, f32>>,
  input: Mutex<String>,
  output: Mutex<String>,
  running: Mutex<Option<mpsc::Sender<()>>>,
  levels: Mutex<(Instant, HashMap<String, f32>, Vec<String>)>,
}

struct Link {
  room: Arc<Room>,
  keys: Option<KeyProvider>,
  mic: Option<LocalTrackPublication>,
}

pub struct Voice {
  links: Mutex<HashMap<String, Link>>,
  engine: Mutex<Option<Arc<Engine>>>,
  tuning: Mutex<Tuning>,
  input: Mutex<String>,
  output: Mutex<String>,
}

impl Default for Voice {
  fn default() -> Self {
    Self { links: Mutex::default(), engine: Mutex::default(), tuning: Mutex::default(), input: Mutex::new("default".into()), output: Mutex::new("default".into()) }
  }
}

#[derive(Serialize, Clone)]
struct Member {
  identity: String,
  mic: bool,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Update {
  Members { members: Vec<Member> },
  Speakers { identities: Vec<String> },
  Quality { quality: &'static str },
  Status { status: &'static str },
}

#[derive(Serialize, Clone)]
struct Level {
  db: f32,
  open: bool,
}

#[derive(Serialize)]
pub struct Device {
  id: String,
  label: String,
}

#[derive(Serialize)]
pub struct Devices {
  inputs: Vec<Device>,
  outputs: Vec<Device>,
}

type Answer<T = ()> = Result<T, String>;

fn fail(error: impl std::fmt::Display) -> String {
  error.to_string()
}

fn processor(echo: bool) -> AudioProcessingModule {
  AudioProcessingModule::new(echo, true, true, false)
}

fn pick(device: &str, list: Option<Vec<cpal::Device>>, fallback: Option<cpal::Device>) -> Option<cpal::Device> {
  list.and_then(|devices| devices.into_iter().find(|candidate| candidate.id().map(|id| id.to_string() == device).unwrap_or(false))).or(fallback)
}

fn config(ranges: Vec<cpal::SupportedStreamConfigRange>) -> Option<cpal::StreamConfig> {
  ranges
    .into_iter()
    .filter(|range| range.min_sample_rate() <= RATE && range.max_sample_rate() >= RATE && range.sample_format() == cpal::SampleFormat::F32)
    .min_by_key(|range| range.channels())
    .map(|range| range.with_sample_rate(RATE).config())
}

fn decibels(frame: &[f32]) -> f32 {
  frame.is_empty().then_some(FLOOR).unwrap_or_else(|| (20.0 * ((frame.iter().map(|sample| sample * sample).sum::<f32>() / frame.len() as f32).sqrt() / 32768.0).max(1e-6).log10()).max(FLOOR))
}

fn process(engine: &Engine, denoise: &mut DenoiseState, raw: &[f32], loud: &mut Instant, tick: &mut (u8, bool)) {
  let tuning = *engine.tuning.lock().unwrap();
  let mut pcm: Vec<i16> = raw.iter().map(|sample| (sample * 32767.0).clamp(-32768.0, 32767.0) as i16).collect();
  let _ = engine.apm.lock().unwrap().process_stream(&mut pcm, RATE as i32, 1);
  let scaled: Vec<f32> = pcm.iter().map(|&sample| sample as f32).collect();
  let mut clean = vec![0.0f32; FRAME];
  let speech = denoise.process_frame(&mut clean, &scaled);
  let heard = [&scaled, &clean][tuning.noise as usize];
  let db = decibels(heard);
  *loud = [*loud, Instant::now()][([db > tuning.threshold, speech > VOICE][tuning.auto as usize]) as usize];
  let open = loud.elapsed() < HOLD;
  let out: Vec<i16> = heard.iter().map(|&sample| (sample * open as u8 as f32).clamp(-32768.0, 32767.0) as i16).collect();
  let _ = tauri::async_runtime::block_on(engine.source.capture_frame(&AudioFrame { data: Cow::Owned(out), sample_rate: RATE, num_channels: 1, samples_per_channel: FRAME as u32 }));
  tick.0 = (tick.0 + 1) % 6;
  (open != tick.1 || (tick.0 == 0 && (open || db > SPEAKING))).then(|| (tick.1 = open, engine.app.emit("voice:level", Level { db, open })));
}

fn mix(engine: &Engine, out: &mut [f32], channels: usize) {
  let frames = out.len() / channels;
  let gains = engine.gains.lock().unwrap().clone();
  let mut mixed = vec![0i32; frames];
  let mut heard = HashMap::new();
  engine.remotes.lock().unwrap().values_mut().for_each(|(identity, buffer)| {
    let gain = gains.get(identity).copied().unwrap_or(1.0);
    let chunk: Vec<f32> = buffer.drain(..frames.min(buffer.len())).map(|sample| sample as f32).collect();
    heard.insert(identity.clone(), decibels(&chunk).max(heard.get(identity).copied().unwrap_or(FLOOR)));
    mixed.iter_mut().zip(&chunk).for_each(|(slot, sample)| *slot += (sample * gain) as i32);
  });
  let mut levels = engine.levels.lock().unwrap();
  heard.into_iter().for_each(|(identity, db)| (*levels.1.entry(identity).or_insert(db) = db.max(FLOOR), ()).1);
  let mut speaking: Vec<String> = levels.1.iter().filter(|(_, db)| **db > SPEAKING).map(|(identity, _)| identity.clone()).collect();
  speaking.sort();
  (speaking != levels.2 || (!speaking.is_empty() && levels.0.elapsed() > Duration::from_millis(60))).then(|| (engine.app.emit("voice:levels", std::mem::take(&mut levels.1)), levels.0 = Instant::now(), levels.2 = speaking));
  drop(levels);
  let mut reference: Vec<i16> = mixed.iter().map(|&sample| sample.clamp(-32768, 32767) as i16).collect();
  out.chunks_mut(channels).zip(&reference).for_each(|(chunk, &sample)| chunk.fill(sample as f32 / 32768.0));
  let whole = reference.len() / FRAME * FRAME;
  (whole > 0).then(|| engine.apm.lock().unwrap().process_reverse_stream(&mut reference[..whole], RATE as i32, 1));
}

fn run(engine: Arc<Engine>, stop: mpsc::Receiver<()>) {
  let guard = AUDIO.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let host = cpal::default_host();
  let input = pick(&engine.input.lock().unwrap(), host.input_devices().ok().map(Iterator::collect), host.default_input_device());
  let output = pick(&engine.output.lock().unwrap(), host.output_devices().ok().map(Iterator::collect), host.default_output_device());
  let (frames, incoming) = mpsc::channel::<Vec<f32>>();
  let capture = input.as_ref().and_then(|device| {
    let config = config(device.supported_input_configs().ok()?.collect())?;
    let channels = config.channels as usize;
    let mut pending = Vec::with_capacity(FRAME * 2);
    device
      .build_input_stream::<f32, _, _>(
        config,
        move |data, _| {
          pending.extend(data.chunks(channels).map(|chunk| chunk.iter().sum::<f32>() / channels as f32));
          while pending.len() >= FRAME {
            let _ = frames.send(pending.drain(..FRAME).collect());
          }
        },
        |error| log::warn!("voice input: {error}"),
        None,
      )
      .ok()
  });
  let playback = output.as_ref().and_then(|device| {
    let config = config(device.supported_output_configs().ok()?.collect())?;
    let channels = config.channels as usize;
    let mixer = engine.clone();
    device.build_output_stream::<f32, _, _>(config, move |data, _| mix(&mixer, data, channels), |error| log::warn!("voice output: {error}"), None).ok()
  });
  let _ = capture.as_ref().map(StreamTrait::play);
  let _ = playback.as_ref().map(StreamTrait::play);
  drop(guard);
  let worker = engine.clone();
  let alive = Arc::new(AtomicBool::new(true));
  let flag = alive.clone();
  let thread = std::thread::spawn(move || {
    let mut denoise = DenoiseState::new();
    let mut loud = Instant::now() - HOLD;
    let mut tick = (0u8, false);
    while flag.load(Ordering::Relaxed) {
      let _ = incoming.recv_timeout(Duration::from_millis(100)).map(|frame| process(&worker, &mut denoise, &frame, &mut loud, &mut tick));
    }
  });
  let _ = stop.recv();
  alive.store(false, Ordering::Relaxed);
  drop((capture, playback));
  let _ = thread.join();
}

fn start(engine: &Arc<Engine>) {
  let (stop, wait) = mpsc::channel();
  let previous = engine.running.lock().unwrap().replace(stop);
  previous.map(|previous| previous.send(()));
  let runner = engine.clone();
  std::thread::spawn(move || run(runner, wait));
}

fn engine(app: &AppHandle, voice: &Voice) -> Answer<Arc<Engine>> {
  let mut slot = voice.engine.lock().map_err(fail)?;
  let tuning = *voice.tuning.lock().map_err(fail)?;
  let fresh = || {
    let engine = Arc::new(Engine {
      app: app.clone(),
      tuning: Mutex::new(tuning),
      apm: Mutex::new(processor(tuning.echo)),
      source: NativeAudioSource::new(AudioSourceOptions { echo_cancellation: false, noise_suppression: false, auto_gain_control: false }, RATE, 1, 100),
      remotes: Mutex::default(),
      gains: Mutex::default(),
      input: Mutex::new(voice.input.lock().unwrap().clone()),
      output: Mutex::new(voice.output.lock().unwrap().clone()),
      running: Mutex::default(),
      levels: Mutex::new((Instant::now(), HashMap::new(), Vec::new())),
    });
    start(&engine);
    engine
  };
  Ok(slot.get_or_insert_with(fresh).clone())
}

fn members(room: &Room) -> Vec<Member> {
  room
    .remote_participants()
    .values()
    .map(|participant| Member {
      identity: participant.identity().to_string(),
      mic: participant.track_publications().values().any(|publication| publication.source() == TrackSource::Microphone && !publication.is_muted()),
    })
    .collect()
}

fn quality(quality: ConnectionQuality) -> &'static str {
  match quality { ConnectionQuality::Excellent => "excellent", ConnectionQuality::Good => "good", ConnectionQuality::Poor => "poor", ConnectionQuality::Lost => "lost" }
}

fn listen(engine: &Arc<Engine>, key: String, identity: String, track: RemoteAudioTrack) {
  let engine = engine.clone();
  tauri::async_runtime::spawn(async move {
    let mut stream = NativeAudioStream::new(track.rtc_track(), RATE as i32, 1);
    engine.remotes.lock().unwrap().insert(key.clone(), (identity.clone(), VecDeque::with_capacity(BUFFERED)));
    while let Some(frame) = stream.next().await {
      engine.remotes.lock().unwrap().get_mut(&key).map(|(_, buffer)| (buffer.extend(frame.data.iter()), buffer.drain(..buffer.len().saturating_sub(BUFFERED))));
    }
    engine.remotes.lock().unwrap().remove(&key);
  });
}

fn translate(room: &Room, engine: &Arc<Engine>, link: &str, event: RoomEvent) -> Option<Update> {
  let roster = || Some(Update::Members { members: members(room) });
  match event {
    RoomEvent::ActiveSpeakersChanged { speakers } => Some(Update::Speakers { identities: speakers.iter().map(|speaker| speaker.identity().to_string()).collect() }),
    RoomEvent::ConnectionQualityChanged { quality: level, participant } => (participant.identity() == room.local_participant().identity()).then(|| Update::Quality { quality: quality(level) }),
    RoomEvent::Reconnecting => Some(Update::Status { status: "reconnecting" }),
    RoomEvent::Reconnected => Some(Update::Status { status: "reconnected" }),
    RoomEvent::Disconnected { .. } => Some(Update::Status { status: "disconnected" }),
    RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(track), publication, participant } => (listen(engine, format!("{link}:{}", publication.sid()), format!("{}{}", participant.identity(), ["", "#screen"][(publication.source() == TrackSource::ScreenshareAudio) as usize]), track), roster()).1,
    RoomEvent::TrackSubscribed { track: RemoteTrack::Video(track), publication, participant } => (crate::screen::subscribed(&engine.app, link, participant.identity().to_string(), publication.source(), publication.sid().to_string(), track), roster()).1,
    RoomEvent::TrackUnsubscribed { publication, participant, .. } => (engine.remotes.lock().unwrap().remove(&format!("{link}:{}", publication.sid())), (publication.kind() == TrackKind::Video).then(|| crate::screen::unsubscribed(&engine.app, link, participant.identity().to_string(), publication.sid().to_string())), roster()).2,
    RoomEvent::ParticipantConnected(_) | RoomEvent::ParticipantDisconnected(_) | RoomEvent::TrackPublished { .. } | RoomEvent::TrackUnpublished { .. } | RoomEvent::TrackMuted { .. } | RoomEvent::TrackUnmuted { .. } => roster(),
    _ => None,
  }
}

fn provider() -> KeyProvider {
  KeyProvider::new(KeyProviderOptions { ratchet_window_size: 10, key_ring_size: MAX_KEY_RING_SIZE.min(256), key_derivation_algorithm: KeyDerivationAlgorithm::HKDF, ..Default::default() })
}

fn options(keys: &Option<KeyProvider>, relay: bool) -> RoomOptions {
  let mut options = RoomOptions::default();
  options.adaptive_stream = true;
  options.dynacast = true;
  options.encryption = keys.clone().map(|key_provider| E2eeOptions { encryption_type: EncryptionType::Gcm, key_provider });
  options.rtc_config.ice_transport_type = [IceTransportsType::All, IceTransportsType::Relay][relay as usize];
  options
}

#[tauri::command]
pub async fn voice_connect(app: AppHandle, voice: State<'_, Voice>, link: String, url: String, token: String, encrypted: bool, publish: bool, keys: Vec<(String, i32, Vec<u8>)>) -> Answer {
  let provider = encrypted.then(provider);
  keys.into_iter().for_each(|(identity, index, key)| provider.iter().for_each(|provider| (provider.set_key(&identity.clone().into(), index, key.clone()), ()).1));
  let (room, mut events) = match Room::connect(&url, &token, options(&provider, false)).await { Ok(joined) => joined, Err(_) => Room::connect(&url, &token, options(&provider, true)).await.map_err(fail)? };
  let room = Arc::new(room);
  room.e2ee_manager().set_enabled(encrypted);
  let engine = engine(&app, &voice)?;
  let track = LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(engine.source.clone()));
  track.mute();
  let mic = match publish {
    true => Some(room.local_participant().publish_track(LocalTrack::Audio(track), TrackPublishOptions { source: TrackSource::Microphone, dtx: false, red: true, ..Default::default() }).await.map_err(fail)?),
    false => None,
  };
  voice.links.lock().map_err(fail)?.insert(link.clone(), Link { room: room.clone(), keys: provider, mic });
  crate::screen::joined(&link, room.clone(), publish);
  let channel = format!("voice:{link}");
  let _ = app.emit(&channel, Update::Members { members: members(&room) });
  tauri::async_runtime::spawn(async move {
    while let Some(event) = events.recv().await {
      translate(&room, &engine, &link, event).map(|update| app.emit(&channel, update));
    }
  });
  Ok(())
}

#[tauri::command]
pub async fn voice_disconnect(voice: State<'_, Voice>, link: String) -> Answer {
  let gone = voice.links.lock().map_err(fail)?.remove(&link);
  crate::screen::left(&link);
  let _ = match gone { Some(link) => link.room.close().await.map_err(fail), None => Ok(()) };
  let idle = voice.links.lock().map_err(fail)?.is_empty();
  let engine = idle.then(|| voice.engine.lock().ok().and_then(|mut slot| slot.take())).flatten();
  engine.and_then(|engine| engine.running.lock().ok().and_then(|mut running| running.take())).map(|stop| stop.send(()));
  Ok(())
}

#[tauri::command]
pub async fn voice_key(voice: State<'_, Voice>, link: String, identity: String, index: i32, key: Vec<u8>) -> Answer {
  voice.links.lock().map_err(fail)?.get(&link).and_then(|link| link.keys.as_ref()).map(|keys| keys.set_key(&identity.into(), index, key));
  Ok(())
}

#[tauri::command]
pub async fn voice_mic(voice: State<'_, Voice>, link: String, open: bool) -> Answer {
  voice.links.lock().map_err(fail)?.get(&link).and_then(|link| link.mic.as_ref()).map(|mic| [LocalTrackPublication::mute, LocalTrackPublication::unmute][open as usize](mic));
  Ok(())
}

#[tauri::command]
pub async fn voice_volume(voice: State<'_, Voice>, identity: String, volume: f32) -> Answer {
  voice.engine.lock().map_err(fail)?.as_ref().map(|engine| engine.gains.lock().map(|mut gains| gains.insert(identity, volume)));
  Ok(())
}

#[tauri::command]
pub async fn voice_tuning(voice: State<'_, Voice>, tuning: Tuning) -> Answer {
  let previous = std::mem::replace(&mut *voice.tuning.lock().map_err(fail)?, tuning);
  voice.engine.lock().map_err(fail)?.as_ref().map(|engine| {
    *engine.tuning.lock().unwrap() = tuning;
    (previous.echo != tuning.echo).then(|| *engine.apm.lock().unwrap() = processor(tuning.echo));
  });
  Ok(())
}

#[tauri::command]
pub async fn voice_devices() -> Answer<Devices> {
  tauri::async_runtime::spawn_blocking(devices).await.map_err(fail)
}

fn devices() -> Devices {
  let _guard = AUDIO.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let host = cpal::default_host();
  let list = |devices: Option<Vec<cpal::Device>>| {
    let mut seen = std::collections::HashSet::new();
    devices
      .unwrap_or_default()
      .into_iter()
      .filter_map(|device| Some(Device { id: device.id().ok()?.to_string(), label: device.description().ok()?.name().to_owned() }))
      .filter(|device| !device.label.starts_with("Monitor of") && !device.id.contains("default") && seen.insert(device.label.clone()))
      .collect::<Vec<_>>()
  };
  let inputs = list(host.input_devices().ok().map(Iterator::collect)).into_iter().filter(|device| !device.id.contains("output") && !device.id.ends_with("_sink")).collect();
  Devices { inputs, outputs: list(host.output_devices().ok().map(Iterator::collect)) }
}

#[tauri::command]
pub async fn voice_device(voice: State<'_, Voice>, output: bool, id: String) -> Answer {
  *[&voice.input, &voice.output][output as usize].lock().map_err(fail)? = id.clone();
  voice.engine.lock().map_err(fail)?.as_ref().map(|engine| (*[&engine.input, &engine.output][output as usize].lock().unwrap() = id, start(engine)));
  Ok(())
}
