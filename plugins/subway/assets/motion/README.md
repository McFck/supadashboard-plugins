# Movement sound

Motor, rolling, track, brake and cabin sound for the Subway applet's immersion audio. `motion.json` describes one
train per line (E235 on the Yamanote, Tokyo Metro 13000 on the Hibiya, Hankyu 1300 on the Sakaisuji) and lists
every clip under `clips/` with its SHA-256; the app validates it at load (`audio/motion/manifest.ts`) and the
staging script refuses a clip whose bytes no longer match. The engine lives in `app/src/plugins/subway/audio/motion/`.
`door-sequence.js` plans door cues; `cues.js` holds the measured trim points that verify `runtime-cues.json`.

Credits and licences for every clip are in `../sources.json` (`movement`). New material is CC0 or public domain.

## Layers

| Layer             | Source                                                     | Behaviour                                                                                    |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Standing cabin    | `shared/standing` (stopped car interior)                   | Always on, slow drift                                                                        |
| HVAC              | `shared/hvac`                                              | Compressor cycles on and off every few minutes, scheduled hours ahead on the audio clock     |
| Rolling           | per train and section (`open`, `tunnel`)                   | Level, pitch (narrow band) and lowpass follow speed; crossfades at portals                   |
| Body rumble       | synthesised noise                                          | Rises with speed squared                                                                     |
| Motor             | 13000: 21854F's BVE layers and tables; others: synthesised | Follows speed and the slewed power/brake effort; the cruise alternates notching and coasting |
| Joints and points | `shared/joint-*` pool                                      | Every axle of the car and the neighbours' near bogies, from a seeded per-segment layout      |
| Squeal            | synthesised                                                | Curve stretches (per segment) and below 8 km/h under braking (chance per stop)               |
| Events            | `shared/release-*`, `shared/rattle-*`, 13000 `air-release` | Release on the brake-to-zero edge, stop jolt, creaks on effort changes, rare rattles         |
| Platform air      | `platform/*` (one station kind loaded at a time)           | Fades in while the doors are open                                                            |
| Space             | native EQ and a short slapback delay                       | Tunnel: more low end, duller top, slapback on transients                                     |

Beds play through a region shuffler (random regions with 3 s equal-power crossfades, never the same region twice
in a row); one-shots come from pools that never repeat the last two picks and get rate, gain and timing jitter.
Three oscillators with periods of 97, 151 and 223 s add slow drift. Everything is native Web Audio; JS only sets
targets and schedules one-shots on each run tick.

The train goes through a pre-limiter trim, a duck (−5 dB under voice cues), the limiter, then the cue bus, so
mute, volume and visibility apply in one place. After a pause, catch-up or line change the engine snaps to the
new state and plays no event for the skipped time.

## Sources of the kept 13000 pack

| Material                                                                        | Creator / original source                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Metro 13000 motor samples and curves, brake rub (first 8 s), full brake release | 21854F / @F21854, [TM13000Sound.zip v0.4](https://uu.getuploader.com/Tob21854F_BVEdate/download/15) |

The motor layers are converted losslessly to FLAC (stereo, as recorded); the release is peak-normalised. The
pack's narrow-tunnel rolling loop and cabin loop are no longer used. Keep the preserved
[Tokyo readme](tokyo-source-readme.txt) with the pack. The layer separation follows
[BVE's vehicle sound model](https://bvets.net/jp/edit/formats/vehicle/sound.html).
