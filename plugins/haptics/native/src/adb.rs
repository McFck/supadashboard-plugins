//! Locating adb and choosing the tablet: the pure parts.
use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub struct Device {
    pub serial: String,
    pub state: String,
}

/// Lines of `adb devices` after the header: `<serial>\t<state>`.
pub fn parse_devices(output: &str) -> Vec<Device> {
    output
        .lines()
        .skip_while(|line| !line.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some(Device {
                serial: parts.next()?.to_owned(),
                state: parts.next()?.to_owned(),
            })
        })
        .collect()
}

/// The configured serial if it is ready, else the only ready device. Unauthorized and offline ones never count.
pub fn pick_device(devices: &[Device], wanted: Option<&str>) -> Option<String> {
    let mut ready = devices.iter().filter(|device| device.state == "device");
    match wanted {
        Some(serial) => ready.find(|device| device.serial == serial),
        None => {
            let first = ready.next()?;
            ready.next().is_none().then_some(first)
        }
    }
    .map(|device| device.serial.clone())
}

pub fn valid_serial(serial: &str) -> bool {
    !serial.is_empty()
        && serial.len() <= 64
        && serial
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}

/// The override, else an installed SDK's platform-tools, else whatever `adb` is on PATH.
pub fn adb_path(override_path: Option<&str>) -> PathBuf {
    if let Some(path) = override_path {
        return path.into();
    }
    let sdk_roots = [
        std::env::var_os("ANDROID_HOME"),
        std::env::var_os("ANDROID_SDK_ROOT"),
        std::env::var_os("LOCALAPPDATA")
            .map(|local| PathBuf::from(local).join("Android/Sdk").into()),
    ];
    sdk_roots
        .into_iter()
        .flatten()
        .map(|root| PathBuf::from(root).join("platform-tools/adb.exe"))
        .find(|path| path.is_file())
        .unwrap_or_else(|| "adb".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTPUT: &str = "* daemon started successfully\nList of devices attached\nR52Y208M6XE\tdevice\nAAA\tunauthorized\nBBB\toffline\n\n";

    #[test]
    fn only_a_ready_device_is_picked() {
        let devices = parse_devices(OUTPUT);
        assert_eq!(devices.len(), 3);
        assert_eq!(pick_device(&devices, None).as_deref(), Some("R52Y208M6XE"));
        assert_eq!(pick_device(&devices, Some("AAA")), None);
        assert_eq!(
            pick_device(&devices, Some("R52Y208M6XE")).as_deref(),
            Some("R52Y208M6XE")
        );
    }

    #[test]
    fn two_ready_devices_need_a_serial() {
        let devices = parse_devices("List of devices attached\nA\tdevice\nB\tdevice\n");
        assert_eq!(pick_device(&devices, None), None);
        assert_eq!(pick_device(&devices, Some("B")).as_deref(), Some("B"));
    }
}
