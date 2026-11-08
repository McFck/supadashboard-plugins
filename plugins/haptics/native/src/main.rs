//! Android compatibility plugin host: tablet haptics over one persistent `adb shell`, and the tablet's screen
//! turned off when the PC sleeps or shuts down.
// No console window: the app talks to this process over pipes only.
#![windows_subsystem = "windows"]
mod adb;
mod limiter;
mod power;
mod service;

use plugin_sdk::{Call, Host};
use serde::Deserialize;
use serde_json::Value;

use service::Haptics;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Tick,
    Tap,
    Confirm,
}

impl Kind {
    /// Pulse length: the Galaxy Tab's coin motor has no amplitude control and is barely felt below ~20 ms.
    fn millis(self, strength: Strength) -> u64 {
        let base = match self {
            Kind::Tick => 25,
            Kind::Tap => 40,
            Kind::Confirm => 70,
        };
        match strength {
            Strength::Light => base * 3 / 5,
            Strength::Medium => base,
            Strength::Strong => base * 8 / 5,
        }
    }
}

/// Scales every pulse's length, the only strength the motor has.
#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Strength {
    Light,
    #[default]
    Medium,
    Strong,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub adb_path: Option<String>,
    pub serial: Option<String>,
    #[serde(default)]
    pub strength: Strength,
    #[serde(default)]
    pub lock_with_pc: bool,
}

impl Config {
    fn valid(&self) -> bool {
        self.adb_path
            .as_deref()
            .is_none_or(|path| path.len() <= 1024)
            && self.serial.as_deref().is_none_or(adb::valid_serial)
    }

    /// False when `other` needs a new shell; strength and lock changes keep the connection.
    fn same_device(&self, other: &Config) -> bool {
        self.enabled == other.enabled
            && self.adb_path == other.adb_path
            && self.serial == other.serial
    }
}

#[derive(Deserialize)]
struct Pulse {
    kind: Kind,
}

/// `configure` applies the settings and answers whether a device is connected (false is silent when
/// disabled); `pulse` vibrates once.
async fn handle(haptics: Haptics, Call { method, params, .. }: Call) -> Result<Value, String> {
    match method.as_str() {
        "configure" => {
            let config: Config = serde_json::from_value(params)
                .ok()
                .filter(Config::valid)
                .ok_or("Invalid haptics settings")?;
            Ok(haptics.configure(config).await.into())
        }
        "pulse" => {
            let Pulse { kind } = serde_json::from_value(params).map_err(|_| "Unknown vibration")?;
            haptics.pulse(kind);
            Ok(Value::Null)
        }
        _ => Err(format!("Unknown method {method}")),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let haptics = Haptics::start();
    let locker = haptics.clone();
    power::watch(move || locker.lock_blocking());
    plugin_sdk::serve(&Host::connect(), |call| handle(haptics.clone(), call)).await;
}
