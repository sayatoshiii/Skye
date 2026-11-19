use pipewire as pw;
use pw::spa;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

const RATE: u32 = 48_000;
const OUTPUT: &str = "Stream/Output/Audio";
const EVERYTHING: &str = "*";

static RUNNING: LazyLock<Mutex<Option<pw::channel::Sender<()>>>> = LazyLock::new(Mutex::default);

#[derive(Clone)]
struct Node {
  app: String,
  pid: u32,
  class: String,
  binary: String,
}

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

fn parent(pid: u32) -> Option<u32> {
  let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
  stat.rsplit(')').next()?.split_whitespace().nth(1)?.parse().ok()
}

fn own(pid: u32) -> bool {
  let me = std::process::id();
  std::iter::successors(Some(pid), |&pid| parent(pid).filter(|&next| next > 1)).take(16).any(|pid| pid == me)
}

fn node(props: &spa::utils::dict::DictRef) -> Node {
  let get = |key: &str| props.get(key).unwrap_or_default().to_owned();
  Node { app: [get("application.name"), get("node.name")].into_iter().find(|name| !name.is_empty()).unwrap_or_default(), pid: get("application.process.id").parse().unwrap_or_default(), class: get("media.class"), binary: get("application.process.binary") }
}

fn port(props: &spa::utils::dict::DictRef) -> Option<Port> {
  Some(Port { node: props.get("node.id")?.parse().ok()?, out: props.get("port.direction") == Some("out"), channel: props.get("audio.channel").unwrap_or("MONO").to_owned() })
}

fn shared(app: &Node, apps: &[String]) -> bool {
  app.class == OUTPUT && !own(app.pid) && app.binary != "skye" && (apps.iter().any(|name| name == EVERYTHING) || apps.contains(&app.app))
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

fn relink(graph: &mut Graph, core: &pw::core::CoreRc, apps: &[String]) {
  let Some(ours) = graph.ours else { return };
  let wanted: Vec<u32> = graph.nodes.iter().filter(|(id, app)| shared(app, apps) && !graph.links.contains_key(id)).map(|(id, _)| *id).collect();
  wanted.into_iter().for_each(|app| {
    let made: Vec<pw::link::Link> = pairs(graph, ours, app)
      .into_iter()
      .filter_map(|(out, input)| core.create_object::<pw::link::Link>("link-factory", &pw::properties::properties! { "link.output.node" => app.to_string(), "link.output.port" => out.to_string(), "link.input.node" => ours.to_string(), "link.input.port" => input.to_string(), "object.linger" => "false" }).ok())
      .collect();
    (!made.is_empty()).then(|| graph.links.insert(app, made));
  });
}

fn format() -> Vec<u8> {
  let mut info = spa::param::audio::AudioInfoRaw::new();
  info.set_format(spa::param::audio::AudioFormat::F32LE);
  info.set_rate(RATE);
  info.set_channels(2);
  let mut position = [0u32; spa::param::audio::MAX_CHANNELS];
  position[..2].copy_from_slice(&[spa::sys::SPA_AUDIO_CHANNEL_FL, spa::sys::SPA_AUDIO_CHANNEL_FR]);
  info.set_position(position);
  let object = spa::pod::Object { type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(), id: spa::param::ParamType::EnumFormat.as_raw(), properties: info.into() };
  spa::pod::serialize::PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &spa::pod::Value::Object(object)).map(|written| written.0.into_inner()).unwrap_or_default()
}

fn run(apps: Vec<String>, channel: Channel<InvokeResponseBody>, stop: pw::channel::Receiver<()>) -> Result<(), pw::Error> {
  pw::init();
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
  let (grow, ready, picked) = (graph.clone(), core.clone(), apps.clone());
  let _listener = stream
    .add_local_listener_with_user_data(())
    .state_changed(move |stream, _, _, state| {
      let mut graph = grow.borrow_mut();
      graph.ours = matches!(state, pw::stream::StreamState::Paused | pw::stream::StreamState::Streaming).then(|| stream.node_id()).or(graph.ours);
      relink(&mut graph, &ready, &picked);
    })
    .process(move |stream, _| {
      stream.dequeue_buffer().map(|mut buffer| {
        let data = buffer.datas_mut().first_mut()?;
        let size = data.chunk().size() as usize;
        let bytes = data.data()?;
        (size > 0).then(|| channel.send(InvokeResponseBody::Raw(bytes[..size.min(bytes.len())].to_vec())))
      });
    })
    .register()?;
  let values = format();
  let mut params = [spa::pod::Pod::from_bytes(&values).ok_or(pw::Error::CreationFailed)?];
  stream.connect(spa::utils::Direction::Input, None, pw::stream::StreamFlags::MAP_BUFFERS, &mut params)?;
  let (added, removed, linker) = (graph.clone(), graph.clone(), core.clone());
  let _registry = registry
    .add_listener_local()
    .global(move |global| {
      let mut graph = added.borrow_mut();
      match global.type_ {
        pw::types::ObjectType::Node => global.props.map(|props| graph.nodes.insert(global.id, node(props))).map(drop),
        pw::types::ObjectType::Port => global.props.and_then(port).map(|port| graph.ports.insert(global.id, port)).map(drop),
        _ => None,
      };
      relink(&mut graph, &linker, &apps);
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

fn stop() {
  RUNNING.lock().ok().and_then(|mut running| running.take()).map(|sender| sender.send(()));
}

fn names() -> Result<Vec<String>, pw::Error> {
  pw::init();
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
  let mut names: Vec<String> = found.borrow().iter().filter(|app| shared(app, &[EVERYTHING.to_owned()]) && !app.app.is_empty()).map(|app| app.app.clone()).collect();
  names.sort();
  names.dedup();
  Ok(names)
}

#[tauri::command]
pub async fn screen_apps() -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(|| names().unwrap_or_default()).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn screen_audio_capture(apps: Vec<String>, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
  stop();
  let (sender, receiver) = pw::channel::channel::<()>();
  std::thread::spawn(move || run(apps, channel, receiver).map_err(|error| log::warn!("screen audio: {error}")));
  *RUNNING.lock().map_err(|error| error.to_string())? = Some(sender);
  Ok(())
}

#[tauri::command]
pub fn screen_audio_release() {
  stop();
}
