// The haptics service, run by the dashboard owner: one persistent `adb shell` to the tablet, reconnected while
// enabled, with tablet lock on sleep and Artemis launch on resume or reconnect.
import { emitPluginEvent, pluginProcess, toast, type PluginProcessEvent } from '@supadashboard/kit';
import { adbCandidates, parseDevices, pickDevice, powerOffArgs, validSerial } from './adb';
import { enableUsbTethering, openArtemis, type Tablet } from './artemis';
import type { HapticsConfig, PulseKind } from './haptics';
import { Limiter, pulseMillis } from './pulse';

const PLUGIN = 'haptics';
const RECONNECT_MS = 5000;
const LAUNCH_DEBOUNCE_MS = 8000;
const sameDevice = (a: HapticsConfig, b: HapticsConfig) =>
  a.enabled === b.enabled && a.adbPath === b.adbPath && a.serial === b.serial;

const valid = (config: HapticsConfig) =>
  (config.adbPath?.length ?? 0) <= 1024 && (!config.serial || validSerial(config.serial));

export class HapticsService {
  private config: HapticsConfig | undefined;
  private shell: number | undefined;
  private tablet: Tablet | undefined;
  private armed: Tablet | undefined;
  private disposed = false;
  private syncing = false;
  private transportLost = false;
  private lastRecoveryLaunch: { tablet: Tablet; resumed: boolean; at: number } | undefined;
  private readonly limiter = new Limiter();
  private readonly timer = setInterval(() => this.poll(), RECONNECT_MS);
  /** Serializes connecting, so the poll and `configure` never open two shells. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Applies the settings; true when a tablet is connected. */
  configure = (params: unknown) => {
    const next = params as HapticsConfig;
    if (!valid(next)) {
      throw new Error('Invalid haptics settings');
    }
    return this.enqueue(async () => {
      const previous = this.config;
      if (previous && !sameDevice(previous, next)) {
        this.setTablet(undefined);
        this.lastRecoveryLaunch = undefined;
        this.transportLost = false;
        await this.armPowerOff();
        await this.drop();
      }
      this.config = next;
      await this.connectAndArm(previous);
      return this.tabletReady();
    });
  };

  tabletReady = () => this.tablet !== undefined;

  launchArtemis = () =>
    this.enqueue(async () => {
      if (!this.config?.artemis || !this.tablet || this.disposed) {
        throw new Error('Artemis unavailable');
      }
      const failure = await openArtemis(
        this.tablet,
        this.config.artemisHost,
        this.config.artemisApp,
      );
      if (failure) {
        throw new Error(failure);
      }
      return true;
    });

  resume = () => this.enqueue(() => this.connectAndArm(this.config, true));

  pulse = (params: unknown) => {
    const { kind } = params as { kind: PulseKind };
    const shell = this.shell;
    const ms = pulseMillis(kind, this.config?.strength ?? 'medium');
    if (shell === undefined || !this.limiter.admit(Date.now(), ms)) {
      return;
    }
    pluginProcess.write(PLUGIN, shell, `cmd vibrator_manager synced oneshot ${ms}\n`).catch(() => {
      if (this.shell === shell) {
        this.shell = undefined;
        this.transportLost = true;
      }
    });
  };

  destroy() {
    this.disposed = true;
    clearInterval(this.timer);
    void this.enqueue(async () => {
      this.setTablet(undefined);
      await this.drop();
      await this.armPowerOff();
    }).catch(console.warn);
  }

  private enqueue<T>(job: () => Promise<T>) {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  private async drop() {
    const shell = this.shell;
    this.shell = undefined;
    if (shell !== undefined) {
      await pluginProcess.kill(PLUGIN, shell).catch(() => {});
    }
  }

  private poll() {
    if (!this.config?.enabled || this.syncing) {
      return;
    }
    this.syncing = true;
    void this.enqueue(() => this.connectAndArm(this.config))
      .catch(console.warn)
      .finally(() => {
        this.syncing = false;
      });
  }

  private async connectAndArm(previous: HapticsConfig | undefined, resumed = false) {
    const config = this.config;
    if (!config?.enabled || this.disposed) {
      return;
    }
    const oldTablet = this.tablet;
    const transportLost = this.transportLost;
    this.transportLost = false;
    if (this.shell === undefined || resumed) {
      this.setTablet(await this.findTablet(config));
    }
    if (this.disposed) {
      return;
    }
    // Locking only needs an ADB transport. The interactive vibration shell can fail independently.
    await this.armPowerOff();
    const tablet = this.tablet;
    if (!tablet || this.disposed) {
      await this.drop();
      return;
    }
    const connected = oldTablet?.serial !== tablet.serial || oldTablet.adb !== tablet.adb;
    if (connected && oldTablet) {
      await this.drop();
    }
    const launch = config.artemis && (connected || transportLost || resumed || !previous?.artemis);
    const tether = config.artemis && config.usbTethering && (launch || !previous?.usbTethering);
    if (tether) {
      this.report(await enableUsbTethering(tablet));
    }
    const recovering = resumed || transportLost || (connected && previous?.artemis === true);
    const last = this.lastRecoveryLaunch;
    // A resume can also drop ADB. Coalesce those two triggers for the same tablet.
    const duplicate =
      recovering &&
      last?.tablet.serial === tablet.serial &&
      last.tablet.adb === tablet.adb &&
      last.resumed !== resumed &&
      Date.now() - last.at < LAUNCH_DEBOUNCE_MS;
    if (duplicate) {
      this.lastRecoveryLaunch = undefined;
    }
    if (launch && !this.disposed && !duplicate) {
      const failure = await openArtemis(tablet, config.artemisHost, config.artemisApp);
      if (!failure && recovering && previous?.artemis) {
        this.lastRecoveryLaunch = { tablet, resumed, at: Date.now() };
      }
      this.report(failure);
    }
    if (this.shell === undefined && !this.disposed) {
      await this.startShell(tablet);
    }
  }

  private async findTablet(config: HapticsConfig): Promise<Tablet | undefined> {
    for (const candidate of adbCandidates(config.adbPath)) {
      try {
        const listing = await pluginProcess.run(PLUGIN, candidate, ['devices'], 5000);
        if (listing.code === 0) {
          const serial = pickDevice(parseDevices(listing.stdout), config.serial);
          return serial && validSerial(serial) ? { adb: candidate, serial } : undefined;
        }
      } catch {
        // This candidate is not installed; the next one may be.
      }
    }
  }

  private async startShell({ adb, serial }: Tablet) {
    let handle: number | undefined;
    let exited = false;
    const onEvent = (event: PluginProcessEvent) => {
      if (event.kind === 'exited') {
        exited = true;
        if (handle !== undefined && this.shell === handle) {
          this.shell = undefined;
          this.transportLost = true;
        }
      }
    };
    try {
      handle = await pluginProcess.spawn(PLUGIN, adb, ['-s', serial, 'shell'], onEvent);
      if (!exited) {
        this.shell = handle;
      }
    } catch (error) {
      // The transport may have gone away after `adb devices`; the next poll checks it again.
      console.warn('Android vibration unavailable', error);
    }
  }

  private setTablet(tablet: Tablet | undefined) {
    const changed = this.tabletReady() !== (tablet !== undefined);
    this.tablet = tablet;
    if (changed) {
      void emitPluginEvent(PLUGIN, 'tablet-ready', this.tabletReady()).catch(console.warn);
    }
  }

  private report(failure: string | undefined) {
    if (failure && !this.disposed) {
      toast.error(failure);
      void emitPluginEvent(PLUGIN, 'connection-error', failure).catch(console.warn);
    }
  }

  /** The lock runs as its own adb call: it returns only once the tablet ran the key. */
  private async armPowerOff() {
    const tablet = this.tablet;
    const args = powerOffArgs(this.config?.lockWithPc === true, tablet?.serial);
    if (tablet && args) {
      if (tablet.adb !== this.armed?.adb || tablet.serial !== this.armed.serial) {
        await pluginProcess.onPowerOff(PLUGIN, tablet.adb, args);
        this.armed = tablet;
      }
    } else if (this.armed) {
      await pluginProcess.onPowerOff(PLUGIN, this.armed.adb, null);
      this.armed = undefined;
    }
  }
}
