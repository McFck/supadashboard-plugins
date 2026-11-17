// The haptics service, run by the dashboard owner: one persistent `adb shell` to the tablet, reconnected while
// enabled, and the tablet locked when the PC sleeps.
import { pluginProcess, type PluginProcessEvent } from '@supadashboard/kit';
import { adbCandidates, parseDevices, pickDevice, validSerial } from './adb';
import type { HapticsConfig, PulseKind } from './haptics';
import { Limiter, pulseMillis } from './pulse';

const PLUGIN = 'haptics';
const RECONNECT_MS = 5000;
/** Android's KEYCODE_SLEEP: screen off, and locked when the tablet has a lock screen. */
const SLEEP_KEY = '223';

type Shell = { handle: number; serial: string };

const sameDevice = (a: HapticsConfig, b: HapticsConfig) =>
  a.enabled === b.enabled && a.adbPath === b.adbPath && a.serial === b.serial;

const valid = (config: HapticsConfig) =>
  (config.adbPath?.length ?? 0) <= 1024 && (!config.serial || validSerial(config.serial));

export class HapticsService {
  private config: HapticsConfig | undefined;
  private shell: Shell | undefined;
  private adb = '';
  private armed = '';
  private readonly limiter = new Limiter();
  private readonly timer = setInterval(() => void this.sync().catch(() => {}), RECONNECT_MS);
  /** Serializes connecting, so the poll and `configure` never open two shells. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Applies the settings; true when a tablet is connected. */
  configure = (params: unknown) => {
    const next = params as HapticsConfig;
    if (!valid(next)) {
      throw new Error('Invalid haptics settings');
    }
    return this.enqueue(async () => {
      if (!this.config || !sameDevice(this.config, next)) {
        await this.drop();
      }
      this.config = next;
      await this.connectAndArm();
      return this.shell !== undefined;
    });
  };

  pulse = (params: unknown) => {
    const { kind } = params as { kind: PulseKind };
    const shell = this.shell;
    const ms = pulseMillis(kind, this.config?.strength ?? 'medium');
    if (!shell || !this.limiter.admit(Date.now(), ms)) {
      return;
    }
    pluginProcess
      .write(PLUGIN, shell.handle, `cmd vibrator_manager synced oneshot ${ms}\n`)
      .catch(() => {
        if (this.shell === shell) {
          this.shell = undefined;
        }
      });
  };

  destroy() {
    clearInterval(this.timer);
    void this.drop();
    if (this.adb) {
      pluginProcess.onPowerOff(PLUGIN, this.adb, null).catch(() => {});
    }
  }

  private enqueue<T>(job: () => Promise<T>) {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  private async drop() {
    const shell = this.shell;
    this.shell = undefined;
    if (shell) {
      await pluginProcess.kill(PLUGIN, shell.handle).catch(() => {});
    }
  }

  private sync() {
    return this.enqueue(() => this.connectAndArm());
  }

  /** Reconnects when enabled and the shell is gone, then keeps the power-off lock in step. */
  private async connectAndArm() {
    const config = this.config;
    if (config?.enabled && !this.shell) {
      this.shell = await this.connect(config).catch(() => undefined);
    }
    await this.armPowerOff();
  }

  private async connect(config: HapticsConfig): Promise<Shell | undefined> {
    let listing: string | undefined;
    for (const candidate of adbCandidates(config.adbPath)) {
      try {
        listing = (await pluginProcess.run(PLUGIN, candidate, ['devices'], 5000)).stdout;
        this.adb = candidate;
        break;
      } catch {
        // This candidate is not installed; the next one may be.
      }
    }
    const serial = listing && pickDevice(parseDevices(listing), config.serial);
    if (!serial) {
      return undefined;
    }
    const shell: Shell = { handle: -1, serial };
    const onEvent = (event: PluginProcessEvent) => {
      if (event.kind === 'exited' && this.shell === shell) {
        this.shell = undefined;
      }
    };
    shell.handle = await pluginProcess.spawn(PLUGIN, this.adb, ['-s', serial, 'shell'], onEvent);
    return shell;
  }

  /** The lock runs as its own adb call: it returns only once the tablet ran the key. */
  private async armPowerOff() {
    const lock = this.config?.enabled && this.config.lockWithPc && this.shell;
    const args = lock ? ['-s', lock.serial, 'shell', 'input', 'keyevent', SLEEP_KEY] : null;
    const key = `${this.adb}|${args?.join(' ') ?? ''}`;
    if (this.adb && key !== this.armed) {
      await pluginProcess.onPowerOff(PLUGIN, this.adb, args);
      this.armed = key;
    }
  }
}
