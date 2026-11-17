use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use pipewire as pw;
use pw::spa;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

pub const RATE: u32 = 48_000;
const FRAME: usize = 480;
const OUTPUT: &str = "Stream/Output/Audio";

#[derive(Clone, PartialEq)]
pub enum Target {
  System,
  Apps(Vec<String>),
}

#[derive(Clone)]
struct Node {
  app: String,
  pid: u32,
  class: String,
}

#[derive(Clone)]
struct Port {
  node: u32,
  out: bool,
  channel: String,
}

#[derive(Default)]
struct Graph {
  nodes: HashMap<u32, Node>,
  ports: HashMap<u32, Port>,
  links: HashMap<u32, Vec<pw::link::Link>>,
  ours: Option<u32>,
}

fn node(props: &spa::utils::dict::DictRef) -> Node {
  let get = |key: &str| props.get(key).unwrap_or_default().to_owned();
  Node { app: [get("application.name"), get("node.name")].into_iter().find(|name| !name.is_empty()).unwrap_or_default(), pid: get("application.process.id").parse().unwrap_or_default(), class: get("media.class") }
}

fn port(props: &spa::utils::dict::DictRef) -> Option<Port> {
  Some(Port { node: props.get("node.id")?.parse().ok()?, out: props.get("port.direction") == Some("out"), channel: props.get("audio.channel").unwrap_or("MONO").to_owned() })
}

fn shared(app: &Node, target: &Target) -> bool {
  app.class == OUTPUT && app.pid != std::process::id() && match target { Target::System => true, Target::Apps(names) => names.contains(&app.app) }
}

fn pairs(graph: &Graph, ours: u32, app: u32) -> Vec<(u32, u32)> {
  let ins: Vec<(u32, &Port)> = graph.ports.iter().filter(|(_, port)| port.node == ours && !port.out).map(|(id, port)| (*id, port)).collect();
  graph
    .ports
    .iter()
    .filter(|(_, port)| port.node == app && port.out)
    .flat_map(|(out, port)| ins.iter().filter(move |(_, input)| port.channel == "MONO" || input.channel == port.channel).map(move |(input, _)| (*out, *input)))
    .collect()
}

fn relink(graph: &mut Graph, core: &pw::core::CoreRc, target: &Target) {
  let Some(ours) = graph.ours else { return };
  let wanted: Vec<u32> = graph.nodes.iter().filter(|(id, app)| shared(app, target) && !graph.links.contains_key(id)).map(|(id, _)| *id).collect();
  wanted.into_iter().for_each(|app| {
    let made: Vec<pw::link::Link> = pairs(graph, ours, app)
      .into_iter()
      .filter_map(|(out, input)| {
        core
          .create_object::<pw::link::Link>("link-factory", &pw::properties::properties! { "link.output.node" => app.to_string(), "link.output.port" => out.to_string(), "link.input.node" => ours.to_string(), "link.input.port" => input.to_string(), "object.linger" => "false" })
          .ok()
      })
      .collect();
    (!made.is_empty()).then(|| graph.links.insert(app, made));
  });
}

fn format() -> Vec<u8> {
  let mut info = spa::param::audio::AudioInfoRaw::new();
  info.set_format(spa::param::audio::AudioFormat::F32LE);
  info.set_rate(RATE);
  info.set_channels(2);
  let object = spa::pod::Object { type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(), id: spa::param::ParamType::EnumFormat.as_raw(), properties: info.into() };
  spa::pod::serialize::PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &spa::pod::Value::Object(object)).map(|written| written.0.into_inner()).unwrap_or_default()
}

fn send(source: &NativeAudioSource, pending: &mut Vec<i16>) {
  while pending.len() >= FRAME * 2 {
    let chunk: Vec<i16> = pending.drain(..FRAME * 2).collect();
    let _ = tauri::async_runtime::block_on(source.capture_frame(&AudioFrame { data: Cow::Owned(chunk), sample_rate: RATE, num_channels: 2, samples_per_channel: FRAME as u32 }));
  }
}

pub fn run(target: Target, source: NativeAudioSource, stop: pw::channel::Receiver<()>) -> Result<(), pw::Error> {
  let mainloop = pw::main_loop::MainLoopRc::new(None)?;
  let context = pw::context::ContextRc::new(&mainloop, None)?;
  let core = context.connect_rc(None)?;
  let registry = core.get_registry_rc()?;
  let graph = Rc::new(RefCell::new(Graph::default()));
  let stream = pw::stream::StreamBox::new(
    &core,
    "skye-share-audio",
    pw::properties::properties! { *pw::keys::MEDIA_TYPE => "Audio", *pw::keys::MEDIA_CATEGORY => "Capture", *pw::keys::MEDIA_ROLE => "Screen", *pw::keys::NODE_NAME => "skye-share-audio", "node.autoconnect" => "false", "node.passive" => "true" },
  )?;
  let (grow, ready) = (graph.clone(), core.clone());
  let picked = target.clone();
  let _listener = stream
    .add_local_listener_with_user_data(Vec::<i16>::with_capacity(FRAME * 4))
    .state_changed(move |stream, _, _, state| {
      let mut graph = grow.borrow_mut();
      graph.ours = matches!(state, pw::stream::StreamState::Paused | pw::stream::StreamState::Streaming).then(|| stream.node_id()).or(graph.ours);
      relink(&mut graph, &ready, &picked);
    })
    .process(move |stream, pending| {
      stream.dequeue_buffer().map(|mut buffer| {
        let data = buffer.datas_mut().first_mut()?;
        let size = data.chunk().size() as usize;
        let bytes = data.data()?;
        pending.extend(bytes[..size.min(bytes.len())].chunks_exact(4).map(|sample| (f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]) * 32767.0).clamp(-32768.0, 32767.0) as i16));
        Some(send(&source, pending))
      });
    })
    .register()?;
  let values = format();
  let mut params = [spa::pod::Pod::from_bytes(&values).ok_or(pw::Error::CreationFailed)?];
  stream.connect(spa::utils::Direction::Input, None, pw::stream::StreamFlags::MAP_BUFFERS | pw::stream::StreamFlags::RT_PROCESS, &mut params)?;
  let (added, removed, linker) = (graph.clone(), graph.clone(), core.clone());
  let _registry = registry
    .add_listener_local()
    .global(move |global| {
      let mut graph = added.borrow_mut();
      let props = global.props;
      match global.type_ {
        pw::types::ObjectType::Node => props.map(|props| graph.nodes.insert(global.id, node(props))).map(drop),
        pw::types::ObjectType::Port => props.and_then(port).map(|port| graph.ports.insert(global.id, port)).map(drop),
        _ => None,
      };
      relink(&mut graph, &linker, &target);
    })
    .global_remove(move |id| {
      let mut graph = removed.borrow_mut();
      graph.nodes.remove(&id);
      graph.ports.remove(&id);
      graph.links.remove(&id);
    })
    .register();
  let quitter = mainloop.clone();
  let _stop = stop.attach(mainloop.loop_(), move |_| quitter.quit());
  mainloop.run();
  Ok(())
}

pub fn apps() -> Vec<String> {
  let listed = (|| -> Result<Vec<String>, pw::Error> {
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_rc(None)?;
    let registry = core.get_registry_rc()?;
    let found = Rc::new(RefCell::new(Vec::<Node>::new()));
    let store = found.clone();
    let _registry = registry.add_listener_local().global(move |global| (global.type_ == pw::types::ObjectType::Node).then(|| global.props.map(|props| store.borrow_mut().push(node(props)))).flatten().unwrap_or_default()).register();
    let pending = core.sync(0)?;
    let quitter = mainloop.clone();
    let _core = core.add_listener_local().done(move |id, seq| (id == pw::core::PW_ID_CORE && seq == pending).then(|| quitter.quit()).unwrap_or_default()).register();
    let timer = mainloop.loop_().add_timer({
      let quitter = mainloop.clone();
      move |_| quitter.quit()
    });
    let _ = timer.update_timer(Some(Duration::from_secs(2)), None);
    mainloop.run();
    let mut names: Vec<String> = found.borrow().iter().filter(|app| shared(app, &Target::System) && !app.app.is_empty()).map(|app| app.app.clone()).collect();
    names.sort();
    names.dedup();
    Ok(names)
  })();
  listed.unwrap_or_default()
}
