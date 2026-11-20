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
  client: u32,
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
  links: HashMap<(u32, u32), pw::link::Link>,
  bound: HashMap<u32, (pw::node::Node, pw::node::NodeListener)>,
  clients: HashMap<u32, u32>,
  ours: Option<u32>,
}

fn parent(pid: u32) -> Option<u32> {
  let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
  stat.rsplit(')').next()?.split_whitespace().nth(1)?.parse().ok()
}

fn own(pid: u32) -> bool {
  let me = std::process::id();
  let name = |pid: u32| std::fs::read_link(format!("/proc/{pid}/exe")).ok().and_then(|path| path.file_name().map(|name| name.to_string_lossy().trim_end_matches(" (deleted)").to_owned()));
  let skye = std::env::current_exe().ok().and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()));
  pid > 1 && (std::iter::successors(Some(pid), |&pid| parent(pid).filter(|&next| next > 1)).take(16).any(|pid| pid == me) || (skye.is_some() && name(pid) == skye))
}

fn node(props: &spa::utils::dict::DictRef) -> Node {
  let get = |key: &str| props.get(key).unwrap_or_default().to_owned();
  Node { app: [get("application.name"), get("node.name")].into_iter().find(|name| !name.is_empty()).unwrap_or_default(), pid: get("application.process.id").parse().unwrap_or_default(), class: get("media.class"), binary: get("application.process.binary"), client: get("client.id").parse().unwrap_or_default() }
}

fn port(props: &spa::utils::dict::DictRef) -> Option<Port> {
  Some(Port { node: props.get("node.id")?.parse().ok()?, out: props.get("port.direction") == Some("out"), channel: props.get("audio.channel").unwrap_or("MONO").to_owned() })
}

fn shared(app: &Node, apps: &[String], clients: &HashMap<u32, u32>) -> bool {
  app.class == OUTPUT && !own(app.pid) && !clients.get(&app.client).is_some_and(|&pid| own(pid)) && app.binary != "skye" && (apps.iter().any(|name| name == EVERYTHING) || apps.contains(&app.app))
}

fn client(graph: &mut Graph, global: &pw::registry::GlobalObject<&spa::utils::dict::DictRef>) {
  (global.type_ == pw::types::ObjectType::Client).then(|| global.props.and_then(|props| props.get("pipewire.sec.pid")?.parse().ok()).map(|pid| graph.clients.insert(global.id, pid)));
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
  let wanted: Vec<(u32, u32, u32)> = graph.nodes.iter().filter(|(_, app)| shared(app, apps, &graph.clients)).flat_map(|(id, _)| pairs(graph, ours, *id).into_iter().map(move |(out, input)| (*id, out, input))).filter(|(_, out, input)| !graph.links.contains_key(&(*out, *input))).collect();
  wanted.into_iter().for_each(|(app, out, input)| {
    core
      .create_object::<pw::link::Link>("link-factory", &pw::properties::properties! { "link.output.node" => app.to_string(), "link.output.port" => out.to_string(), "link.input.node" => ours.to_string(), "link.input.port" => input.to_string(), "object.linger" => "false" })
      .map(|link| graph.links.insert((out, input), link))
      .ok();
  });
}

fn watch(graph: &Rc<RefCell<Graph>>, registry: &pw::registry::RegistryRc, global: &pw::registry::GlobalObject<&spa::utils::dict::DictRef>, then: impl Fn(&mut Graph) + 'static) {
  let Ok(bound) = registry.bind::<pw::node::Node, _>(global) else { return };
  let (store, id) = (graph.clone(), global.id);
  let listener = bound.add_listener_local().info(move |info| info.props().map(|props| { let mut graph = store.borrow_mut(); graph.nodes.insert(id, node(props)); then(&mut graph); }).unwrap_or_default()).register();
  graph.borrow_mut().bound.insert(id, (bound, listener));
}

fn output(global: &pw::registry::GlobalObject<&spa::utils::dict::DictRef>) -> bool {
  global.type_ == pw::types::ObjectType::Node && global.props.and_then(|props| props.get("media.class")) == Some(OUTPUT)
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
  let (added, removed, linker, binder) = (graph.clone(), graph.clone(), core.clone(), registry.clone());
  let _registry = registry
    .add_listener_local()
    .global(move |global| {
      let (core, picked) = (linker.clone(), apps.clone());
      output(global).then(|| watch(&added, &binder, global, move |graph| relink(graph, &core, &picked)));
      (global.type_ == pw::types::ObjectType::Port).then(|| global.props.and_then(port).map(|port| added.borrow_mut().ports.insert(global.id, port)));
      client(&mut added.borrow_mut(), global);
      relink(&mut added.borrow_mut(), &linker, &apps);
    })
    .global_remove(move |id| {
      let mut graph = removed.borrow_mut();
      graph.nodes.remove(&id);
      graph.ports.remove(&id);
      graph.bound.remove(&id);
      graph.clients.remove(&id);
      graph.links.retain(|(out, input), _| *out != id && *input != id);
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
  let graph = Rc::new(RefCell::new(Graph::default()));
  let (store, binder) = (graph.clone(), registry.clone());
  let _registry = registry
    .add_listener_local()
    .global(move |global| {
      client(&mut store.borrow_mut(), global);
      output(global).then(|| watch(&store, &binder, global, |_| ()));
    })
    .register();
  let pending = Rc::new(std::cell::Cell::new((core.sync(0)?, false)));
  let (quitter, again, waiting) = (mainloop.clone(), core.clone(), pending.clone());
  let _core = core
    .add_listener_local()
    .done(move |id, seq| match (id == pw::core::PW_ID_CORE && waiting.get().0 == seq, waiting.get().1) {
      (true, false) => again.sync(0).map(|next| waiting.set((next, true))).unwrap_or_else(|_| quitter.quit()),
      (true, true) => quitter.quit(),
      _ => {}
    })
    .register();
  let timer = mainloop.loop_().add_timer({
    let quitter = mainloop.clone();
    move |_| quitter.quit()
  });
  let _ = timer.update_timer(Some(Duration::from_secs(2)), None);
  mainloop.run();
  let mut names: Vec<String> = graph.borrow().nodes.values().filter(|app| shared(app, &[EVERYTHING.to_owned()], &graph.borrow().clients) && !app.app.is_empty()).map(|app| app.app.clone()).collect();
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
