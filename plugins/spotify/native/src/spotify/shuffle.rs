//! Spotify shuffle modes. The player-side switch is the app's media command for the Spotify session.
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    On,
    Off,
    Toggle,
}

impl Mode {
    pub(super) fn enabled(self, current: bool) -> bool {
        match self {
            Self::On => true,
            Self::Off => false,
            Self::Toggle => !current,
        }
    }

    /// The app's media command that switches the player itself.
    pub(super) fn media_command(self) -> &'static str {
        match self {
            Self::On => "shuffle:on",
            Self::Off => "shuffle:off",
            Self::Toggle => "shuffle:toggle",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shuffle_modes_use_the_current_session_state() {
        for (mode, current, expected) in [
            ("on", false, true),
            ("on", true, true),
            ("off", false, false),
            ("off", true, false),
            ("toggle", false, true),
            ("toggle", true, false),
        ] {
            let mode: Mode = serde_json::from_str(&format!("\"{mode}\"")).unwrap();
            assert_eq!(mode.enabled(current), expected);
        }
        assert!(serde_json::from_str::<Mode>("\"smart\"").is_err());
    }
}
