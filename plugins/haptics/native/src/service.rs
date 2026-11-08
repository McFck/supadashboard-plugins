//! The owner task: holds the persistent adb shell, reconnects while the tablet is enabled, rate-limits pulses and
//! locks the tablet on request.
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{MissedTickBehavior, interval, timeout};

use super::adb::{Device, adb_path, parse_devices, pick_device};
use super::limiter::Limiter;
use super::{Config, Kind};

const RECONNECT: Duration = Duration::from_secs(5);
const ADB_TIMEOUT: Duration = Duration::from_secs(5);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Windows gives a sleeping or ending session about two seconds; the lock must finish inside that.
const LOCK_WAIT: Duration = Duration::from_millis(1500);
/// Android's KEYCODE_SLEEP: screen off, and locked when the tablet has a lock screen.
const SLEEP_KEY: &str = "223";

enum Message {
    Configure(Config, oneshot::Sender<bool>),
    Pulse(Kind),
    /// Answered (or dropped) once the tablet ran the sleep key, or when there is nothing to lock.
    Lock(std::sync::mpsc::Sender<()>),
}

struct Shell {
    // Dropping the child kills the shell (kill_on_drop).
    child: Child,
    stdin: ChildStdin,
    serial: String,
}

#[derive(Clone)]
pub struct Haptics {
    tx: mpsc::UnboundedSender<Message>,
}

impl Haptics {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(rx));
        Self { tx }
    }

    pub async fn configure(&self, config: Config) -> bool {
        let (reply, connected) = oneshot::channel();
        if self.tx.send(Message::Configure(config, reply)).is_err() {
            return false;
        }
        connected.await.unwrap_or(false)
    }

    pub fn pulse(&self, kind: Kind) {
        let _ = self.tx.send(Message::Pulse(kind));
    }

    /// Locks the tablet when that is enabled, blocking the calling thread (the power window) until it is done.
    pub fn lock_blocking(&self) {
        let (done, wait) = std::sync::mpsc::channel();
        if self.tx.send(Message::Lock(done)).is_ok() {
            let _ = wait.recv_timeout(LOCK_WAIT);
        }
    }
}

fn command(adb: &std::path::Path) -> Command {
    let mut command = Command::new(adb);
    command
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .stderr(Stdio::null());
    command
}

async fn connect(config: &Config) -> Option<Shell> {
    let adb = adb_path(config.adb_path.as_deref());
    let listing = timeout(
        ADB_TIMEOUT,
        command(&adb).arg("devices").stdin(Stdio::null()).output(),
    )
    .await
    .ok()?
    .ok()?;
    let devices: Vec<Device> = parse_devices(&String::from_utf8_lossy(&listing.stdout));
    let serial = pick_device(&devices, config.serial.as_deref())?;
    let mut child = command(&adb)
        .args(["-s", &serial, "shell"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    Some(Shell {
        child,
        stdin,
        serial,
    })
}

/// False once the shell has exited (device unplugged).
fn alive(shell: &mut Shell) -> bool {
    matches!(shell.child.try_wait(), Ok(None))
}

async fn run(mut rx: mpsc::UnboundedReceiver<Message>) {
    let mut config: Option<Config> = None;
    let mut shell: Option<Shell> = None;
    let mut limiter = Limiter::default();
    let mut poll = interval(RECONNECT);
    poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            message = rx.recv() => match message {
                None => return,
                Some(Message::Configure(next, reply)) => {
                    if !config.as_ref().is_some_and(|c| c.same_device(&next)) {
                        shell = None;
                    }
                    config = Some(next);
                    if let Some(active) = config.as_ref().filter(|c| c.enabled)
                        && shell.as_mut().is_none_or(|s| !alive(s)) {
                            shell = connect(active).await;
                        }
                    let _ = reply.send(shell.is_some());
                }
                Some(Message::Pulse(kind)) => {
                    let Some(active) = shell.as_mut() else { continue };
                    let ms = kind.millis(config.as_ref().map(|c| c.strength).unwrap_or_default());
                    if !limiter.admit(Instant::now(), ms) {
                        continue;
                    }
                    let line = format!("cmd vibrator_manager synced oneshot {ms}\n");
                    if active.stdin.write_all(line.as_bytes()).await.is_err() {
                        shell = None;
                    }
                }
                Some(Message::Lock(done)) => {
                    let (Some(active), Some(settings)) = (shell.as_ref(), config.as_ref()) else { continue };
                    if !settings.lock_with_pc {
                        continue;
                    }
                    // Its own adb call, not the shell: it returns only once the tablet ran the key.
                    let adb = adb_path(settings.adb_path.as_deref());
                    let lock = command(&adb)
                        .args(["-s", &active.serial, "shell", "input", "keyevent", SLEEP_KEY])
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .status();
                    let _ = timeout(LOCK_WAIT, lock).await;
                    let _ = done.send(());
                }
            },
            _ = poll.tick() => {
                if let Some(active) = config.as_ref().filter(|c| c.enabled)
                    && shell.as_mut().is_none_or(|s| !alive(s)) {
                        shell = connect(active).await;
                    }
            }
        }
    }
}
