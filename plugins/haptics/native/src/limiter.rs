//! Drops a pulse while the previous one is still playing, so a flick cannot queue seconds of buzzing.
use std::time::{Duration, Instant};

/// Pause after a pulse; the motor needs it to spin down and `cmd` needs time to start.
const GAP: Duration = Duration::from_millis(25);

#[derive(Default)]
pub struct Limiter {
    free_at: Option<Instant>,
}

impl Limiter {
    pub fn admit(&mut self, now: Instant, ms: u64) -> bool {
        if self.free_at.is_some_and(|free_at| now < free_at) {
            return false;
        }
        self.free_at = Some(now + Duration::from_millis(ms) + GAP);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_plays_once_until_the_pulse_ends() {
        let mut limiter = Limiter::default();
        let start = Instant::now();
        assert!(limiter.admit(start, 30));
        assert!(!limiter.admit(start + Duration::from_millis(10), 8));
        assert!(!limiter.admit(start + Duration::from_millis(54), 8));
        assert!(limiter.admit(start + Duration::from_millis(56), 8));
    }
}
