// The haptics service, run by the dashboard owner: one persistent `adb shell` to the tablet, reconnected while
// enabled, with tablet lock on sleep and Artemis launch on resume or reconnect.
import {
  emitPluginEvent,
  isRecord,
  pluginProcess,
  toast,
  type PluginProcessEvent,
} from '@supadashboard/kit';
import { adbCandidates, parseDevices, pickDevice, powerOffArgs, validSerial } from './adb';
import { enableUsbTethering, openArtemis, type Tablet } from './artemis';
import { isPulseKind, STRENGTHS, type HapticsConfig } from './haptics';
import { Limiter, pulseMillis } from './pulse';

const PLUGIN = 'haptics';
const RECONNECT_MS = 5000;
const LAUNCH_DEBOUNCE_MS = 8000;
const sameDevice = (a: HapticsConfig, b: HapticsConfig) =>
  a.enabled === b.enabled && a.adbPath === b.adbPath && a.serial === b.serial;

const optionalText = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === 'string' && value.length <= 1024);

/** The settings a window sends; anything else is rejected before it reaches adb. */
function readConfig(raw: unknown): HapticsConfig {
  const strength = isRecord(raw) ? STRENGTHS.find((known) => known === raw.strength) : undefined;
  if (
    !isRecord(raw) ||
    !strength ||
    !optionalText(raw.adbPath) ||
    !optionalText(raw.serial) ||
    (raw.serial !== undefined && !validSerial(raw.serial)) ||
    typeof raw.artemisHost !== 'string' ||
    typeof raw.artemisApp !== 'string' ||
    raw.artemisHost.length > 1024 ||
    raw.artemisApp.length > 1024 ||
    ![raw.enabled, raw.lockWithPc, raw.artemis, raw.usbTethering].every(
      (flag) => typeof flag === 'boolean',
    )
  ) {
    throw new Error('Invalid haptics settings');
  }
  return {
    enabled: raw.enabled === true,
    adbPath: raw.adbPath,
    serial: raw.serial,
    strength,
    lockWithPc: raw.lockWithPc === true,
    artemis: raw.artemis === true,
    artemisHost: raw.artemisHost,
    artemisApp: raw.artemisApp,
    usbTethering: raw.usbTethering === true,
  };
}

/** The tablet found over ADB, and the interactive vibration shell that belongs to it. */
type Link =
  | { kind: 'none' }
  | { kind: 'found'; tablet: Tablet }
  | { kind: 'open'; tablet: Tablet; shell: number };

const sameTablet = (a: Tablet | undefined, b: Tablet | undefined) =>
  a?.serial === b?.serial && a?.adb === b?.adb;
const linkedTablet = (link: Link) => (link.kind === 'none' ? undefined : link.tablet);

export class HapticsService {
  private config: HapticsConfig | undefined;
  private link: Link = { kind: 'none' };
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
    const next = readConfig(params);
    return this.enqueue(async () => {
      const previous = this.config;
      if (previous && !sameDevice(previous, next)) {
        await this.drop();
        this.setTablet(undefined);
        this.lastRecoveryLaunch = undefined;
        this.transportLost = false;
        await this.armPowerOff();
      }
      this.config = next;
      await this.connectAndArm(previous);
      return this.tabletReady();
    });
  };

  tabletReady = () => this.link.kind !== 'none';

  launchArtemis = () =>
    this.enqueue(async () => {
      const tablet = linkedTablet(this.link);
      if (!this.config?.artemis || !tablet || this.disposed) {
        throw new Error('Artemis unavailable');
      }
      const failure = await openArtemis(tablet, this.config.artemisHost, this.config.artemisApp);
      if (failure) {
        throw new Error(failure);
      }
      return true;
    });

  resume = () => this.enqueue(() => this.connectAndArm(this.config, true));

  pulse = (params: unknown) => {
    const kind = isRecord(params) ? params.kind : undefined;
    if (!isPulseKind(kind)) {
      return;
    }
    const link = this.link;
    const ms = pulseMillis(kind, this.config?.strength ?? 'medium');
    if (link.kind !== 'open' || !this.limiter.admit(Date.now(), ms)) {
      return;
    }
    pluginProcess
      .write(PLUGIN, link.shell, `cmd vibrator_manager synced oneshot ${ms}\n`)
      .catch(() => this.shellLost(link.shell));
  };

  destroy() {
    this.disposed = true;
    clearInterval(this.timer);
    void this.enqueue(async () => {
      await this.drop();
      this.setTablet(undefined);
      await this.armPowerOff();
    }).catch(console.warn);
  }

  private enqueue<T>(job: () => Promise<T>) {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  private async drop() {
    const link = this.link;
    if (link.kind === 'open') {
      this.link = { kind: 'found', tablet: link.tablet };
      await pluginProcess.kill(PLUGIN, link.shell).catch(() => {});
    }
  }

  private shellLost(shell: number) {
    if (this.link.kind === 'open' && this.link.shell === shell) {
      this.link = { kind: 'found', tablet: this.link.tablet };
      this.transportLost = true;
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
    const oldTablet = linkedTablet(this.link);
    const transportLost = this.transportLost;
    this.transportLost = false;
    if (this.link.kind !== 'open' || resumed) {
      const found = await this.findTablet(config);
      // A shell belongs to one tablet; it goes before the tablet changes.
      if (!sameTablet(found, oldTablet)) {
        await this.drop();
      }
      this.setTablet(found);
    }
    if (this.disposed) {
      return;
    }
    // Locking only needs an ADB transport. The interactive vibration shell can fail independently.
    await this.armPowerOff();
    const tablet = linkedTablet(this.link);
    if (!tablet || this.disposed) {
      await this.drop();
      return;
    }
    const connected = !sameTablet(oldTablet, tablet);
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
    if (this.link.kind === 'found' && !this.disposed) {
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
        if (handle !== undefined) {
          this.shellLost(handle);
        }
      }
    };
    try {
      handle = await pluginProcess.spawn(PLUGIN, adb, ['-s', serial, 'shell'], onEvent);
      const link = this.link;
      if (!exited && link.kind === 'found' && sameTablet(link.tablet, { adb, serial })) {
        this.link = { kind: 'open', tablet: link.tablet, shell: handle };
      }
    } catch (error) {
      // The transport may have gone away after `adb devices`; the next poll checks it again.
      console.warn('Android vibration unavailable', error);
    }
  }

  /** Callers drop the shell first when the tablet changes. */
  private setTablet(tablet: Tablet | undefined) {
    const changed = this.tabletReady() !== (tablet !== undefined);
    if (!tablet) {
      this.link = { kind: 'none' };
    } else if (!sameTablet(tablet, linkedTablet(this.link))) {
      this.link = { kind: 'found', tablet };
    }
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
    const tablet = linkedTablet(this.link);
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
