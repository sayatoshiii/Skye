use ashpd::desktop::location::{Accuracy, CreateSessionOptions, LocationProxy, StartOptions};
use futures_util::StreamExt;
use serde::Serialize;
use std::time::Duration;
use zbus::{zvariant::OwnedObjectPath, Connection, Proxy};

#[derive(Serialize)]
pub struct Fix {
  lat: f64,
  long: f64,
  accuracy: f64,
}

const WAIT: Duration = Duration::from_secs(15);

async fn portal() -> Result<Fix, String> {
  let proxy = LocationProxy::new().await.map_err(|error| error.to_string())?;
  let session = proxy.create_session(CreateSessionOptions::default().set_accuracy(Accuracy::Exact)).await.map_err(|error| error.to_string())?;
  let mut updates = proxy.receive_location_updated().await.map_err(|error| error.to_string())?;
  proxy.start(&session, None, StartOptions::default()).await.map_err(|error| error.to_string())?.response().map_err(|error| error.to_string())?;
  let fix = updates.next().await.map(|location| Fix { lat: location.latitude(), long: location.longitude(), accuracy: location.accuracy() }).ok_or("no location".to_string());
  let _ = session.close().await;
  fix
}

async fn geoclue() -> Result<Fix, String> {
  let bus = Connection::system().await.map_err(|error| error.to_string())?;
  let manager = Proxy::new(&bus, "org.freedesktop.GeoClue2", "/org/freedesktop/GeoClue2/Manager", "org.freedesktop.GeoClue2.Manager").await.map_err(|error| error.to_string())?;
  let path: OwnedObjectPath = manager.call("GetClient", &()).await.map_err(|error| error.to_string())?;
  let client = Proxy::new(&bus, "org.freedesktop.GeoClue2", path, "org.freedesktop.GeoClue2.Client").await.map_err(|error| error.to_string())?;
  client.set_property("DesktopId", "chat.skye.app").await.map_err(|error| error.to_string())?;
  client.set_property("RequestedAccuracyLevel", 8u32).await.map_err(|error| error.to_string())?;
  let mut updates = client.receive_signal("LocationUpdated").await.map_err(|error| error.to_string())?;
  client.call::<_, _, ()>("Start", &()).await.map_err(|error| error.to_string())?;
  let message = updates.next().await.ok_or("no location")?;
  let (_, at): (OwnedObjectPath, OwnedObjectPath) = message.body().deserialize().map_err(|error| error.to_string())?;
  let location = Proxy::new(&bus, "org.freedesktop.GeoClue2", at, "org.freedesktop.GeoClue2.Location").await.map_err(|error| error.to_string())?;
  let read = |name: &'static str| { let location = location.clone(); async move { location.get_property::<f64>(name).await.map_err(|error| error.to_string()) } };
  let fix = Fix { lat: read("Latitude").await?, long: read("Longitude").await?, accuracy: read("Accuracy").await? };
  let _ = client.call::<_, _, ()>("Stop", &()).await;
  Ok(fix)
}

#[tauri::command]
pub async fn location_current() -> Result<Fix, String> {
  match tokio::time::timeout(WAIT, portal()).await {
    Ok(Ok(fix)) => Ok(fix),
    first => tokio::time::timeout(WAIT, geoclue()).await.map_err(|_| "timed out".to_string())?.map_err(|error| format!("{} / {error}", first.map_or("timed out".to_string(), |result| result.err().unwrap_or_default()))),
  }
}
