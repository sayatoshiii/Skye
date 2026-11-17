use super::{deliver, LOCAL};
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::{CreateSessionOptions, PersistMode};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use pipewire as pw;
use pw::spa;
use std::os::fd::OwnedFd;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PREVIEW: Duration = Duration::from_millis(100);

pub struct Picked {
  pub fd: OwnedFd,
  pub node: u32,
  pub window: bool,
  pub session: Box<dyn std::any::Any + Send>,
}

pub async fn pick() -> Result<Picked, String> {
  let fail = |error: ashpd::Error| error.to_string();
  let portal = Screencast::new().await.map_err(fail)?;
  let session = portal.create_session(CreateSessionOptions::default()).await.map_err(fail)?;
  portal
    .select_sources(&session, SelectSourcesOptions::default().set_cursor_mode(CursorMode::EMBEDDED).set_sources(SourceType::MONITOR | SourceType::WINDOW).set_multiple(false).set_persist_mode(PersistMode::DoNot))
    .await
    .map_err(fail)?
    .response()
    .map_err(fail)?;
  let streams = portal.start(&session, None, Default::default()).await.map_err(fail)?.response().map_err(|_| "cancelled".to_string())?;
  let stream = streams.streams().first().ok_or("cancelled")?;
  let fd = portal.open_pipe_wire_remote(&session, Default::default()).await.map_err(fail)?;
  Ok(Picked { fd, node: stream.pipe_wire_node_id(), window: stream.source_type() == Some(SourceType::WINDOW), session: Box::new((portal, session)) })
}

fn format() -> Vec<u8> {
  let object = spa::pod::object!(
    spa::utils::SpaTypes::ObjectParamFormat,
    spa::param::ParamType::EnumFormat,
    spa::pod::property!(spa::param::format::FormatProperties::MediaType, Id, spa::param::format::MediaType::Video),
    spa::pod::property!(spa::param::format::FormatProperties::MediaSubtype, Id, spa::param::format::MediaSubtype::Raw),
    spa::pod::property!(
      spa::param::format::FormatProperties::VideoFormat,
      Choice,
      Enum,
      Id,
      spa::param::video::VideoFormat::BGRx,
      spa::param::video::VideoFormat::BGRx,
      spa::param::video::VideoFormat::BGRA,
      spa::param::video::VideoFormat::RGBx,
      spa::param::video::VideoFormat::RGBA
    ),
    spa::pod::property!(
      spa::param::format::FormatProperties::VideoSize,
      Choice,
      Range,
      Rectangle,
      spa::utils::Rectangle { width: 1920, height: 1080 },
      spa::utils::Rectangle { width: 1, height: 1 },
      spa::utils::Rectangle { width: 8192, height: 8192 }
    ),
    spa::pod::property!(
      spa::param::format::FormatProperties::VideoFramerate,
      Choice,
      Range,
      Fraction,
      spa::utils::Fraction { num: 30, denom: 1 },
      spa::utils::Fraction { num: 0, denom: 1 },
      spa::utils::Fraction { num: 60, denom: 1 }
    ),
  );
  spa::pod::serialize::PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &spa::pod::Value::Object(object)).map(|written| written.0.into_inner()).unwrap_or_default()
}

struct Feed {
  info: spa::param::video::VideoInfoRaw,
  source: NativeVideoSource,
  shown: Instant,
}

fn convert(info: &spa::param::video::VideoInfoRaw, bytes: &[u8], stride: u32) -> Option<I420Buffer> {
  let (width, height) = (info.size().width, info.size().height);
  let rgb = matches!(info.format(), spa::param::video::VideoFormat::RGBx | spa::param::video::VideoFormat::RGBA);
  let mut buffer = I420Buffer::new(width, height);
  let (sy, su, sv) = buffer.strides();
  let (y, u, v) = buffer.data_mut();
  (bytes.len() >= (stride * height) as usize).then(|| [yuv_helper::argb_to_i420, yuv_helper::abgr_to_i420][rgb as usize](bytes, stride, y, sy, u, su, v, sv, width as i32, height as i32))?;
  Some(buffer)
}

fn frame(feed: &mut Feed, bytes: &[u8], stride: u32) {
  let Some(mut buffer) = convert(&feed.info, bytes, stride) else { return log::warn!("screen: frame skipped {} bytes stride {stride}", bytes.len()) };
  let due = feed.shown.elapsed() >= PREVIEW;
  due.then(|| (deliver(LOCAL, &mut buffer, 960), feed.shown = Instant::now()));
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_micros() as i64).unwrap_or_default();
  feed.source.capture_frame(&VideoFrame { rotation: VideoRotation::VideoRotation0, timestamp_us: stamp, frame_metadata: None, buffer });
}

pub fn run(picked: Picked, source: NativeVideoSource, stop: pw::channel::Receiver<()>) -> Result<(), pw::Error> {
  let mainloop = pw::main_loop::MainLoopRc::new(None)?;
  let context = pw::context::ContextRc::new(&mainloop, None)?;
  let core = context.connect_fd_rc(picked.fd, None)?;
  let stream = pw::stream::StreamBox::new(&core, "skye-screen", pw::properties::properties! { *pw::keys::MEDIA_TYPE => "Video", *pw::keys::MEDIA_CATEGORY => "Capture", *pw::keys::MEDIA_ROLE => "Screen" })?;
  let feed = Feed { info: Default::default(), source, shown: Instant::now() - PREVIEW };
  let _listener = stream
    .add_local_listener_with_user_data(feed)
    .param_changed(|_, feed, id, param| {
      let wanted = id == spa::param::ParamType::Format.as_raw();
      param.filter(|_| wanted).map(|param| (feed.info.parse(param), log::warn!("screen: format {:?} {}x{}", feed.info.format(), feed.info.size().width, feed.info.size().height)));
    })
    .process(|stream, feed| {
      stream.dequeue_buffer().map(|mut buffer| {
        let data = buffer.datas_mut().first_mut()?;
        let (offset, size, stride) = (data.chunk().offset() as usize, data.chunk().size() as usize, data.chunk().stride().max(0) as u32);
        let bytes = data.data()?;
        let end = (offset + size).min(bytes.len());
        Some(frame(feed, &bytes[offset.min(end)..end], stride.max(feed.info.size().width * 4)))
      });
    })
    .register()?;
  let values = format();
  let mut params = [spa::pod::Pod::from_bytes(&values).ok_or(pw::Error::CreationFailed)?];
  log::warn!("screen: connecting pipewire");
  stream.connect(spa::utils::Direction::Input, Some(picked.node), pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS, &mut params)?;
  let quitter = mainloop.clone();
  let _stop = stop.attach(mainloop.loop_(), move |_| quitter.quit());
  mainloop.run();
  drop(picked.session);
  Ok(())
}
