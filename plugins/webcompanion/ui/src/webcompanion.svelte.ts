import {
  ActionFailure,
  pluginBrowser,
  toast,
  type PluginBrowserAction,
  type PluginBrowserScrollFrame,
  type PluginBrowserSnapshot,
} from '@supadashboard/kit';

const plugin = 'webcompanion';

class WebCompanion {
  snapshot = $state<PluginBrowserSnapshot>({ kind: 'offline' });
  pairing = $state<{ code: string; expiresInMs: number } | null>(null);
  pairingPending = $state(false);
  unpairing = $state(false);
  private watch = $state<number | null>(null);
  readonly ready = $derived(this.watch !== null);
  private users = 0;
  private handle: Promise<number | null> | undefined;
  private stopping = Promise.resolve();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private publish: ((snapshot: PluginBrowserSnapshot) => void) | undefined;

  mount(publish?: (snapshot: PluginBrowserSnapshot) => void) {
    if (publish) {
      this.publish = publish;
      publish(this.snapshot);
    }
    this.users++;
    if (this.users === 1) {
      this.start();
    }
    return () => {
      if (publish) {
        this.publish = undefined;
      }
      this.destroy();
    };
  }

  private start() {
    const handle = this.stopping
      .then(() =>
        pluginBrowser.watch(plugin, (snapshot) => {
          if (this.handle === handle) {
            this.snapshot = snapshot;
            this.publish?.(snapshot);
            if (snapshot.kind === 'connected') {
              this.clearCode();
            }
          }
        }),
      )
      .then((id) => {
        if (this.handle === handle) {
          this.watch = id;
        }
        return id;
      })
      .catch((error: unknown) => {
        if (this.handle === handle) {
          this.error(error, 'Could not start WebCompanion');
        }
        return null;
      });
    this.handle = handle;
  }

  private destroy() {
    this.users--;
    if (this.users > 0) {
      return;
    }
    const handle = this.handle;
    this.handle = undefined;
    this.watch = null;
    this.snapshot = { kind: 'offline' };
    this.clearCode();
    if (handle) {
      this.stopping = handle
        .then(async (id) => {
          if (id !== null) {
            await pluginBrowser.unwatch(plugin, id);
          }
        })
        .catch((error: unknown) => this.error(error, 'Could not stop WebCompanion'));
    }
  }

  async pair() {
    if (this.pairingPending) {
      return;
    }
    this.pairingPending = true;
    const handle = this.handle;
    try {
      const watch = await handle;
      if (watch != null && this.handle === handle) {
        const pairing = await pluginBrowser.pair(plugin, watch);
        if (this.handle === handle && this.snapshot.kind !== 'connected') {
          this.clearCode();
          this.pairing = pairing;
          this.expiry = setTimeout(() => this.clearCode(), pairing.expiresInMs);
        }
      }
    } catch (error) {
      this.error(error, 'Could not create pairing code');
    } finally {
      this.pairingPending = false;
    }
  }

  async unpair() {
    if (this.watch === null || this.unpairing) {
      return;
    }
    this.unpairing = true;
    try {
      await pluginBrowser.unpair(plugin, this.watch);
      this.clearCode();
    } catch (error) {
      this.error(error, 'Could not unpair browser');
    } finally {
      this.unpairing = false;
    }
  }

  private clearCode() {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.pairing = null;
  }

  async action(action: PluginBrowserAction, report = true) {
    if (this.snapshot.kind !== 'connected') {
      return false;
    }
    try {
      await this.execute(action);
      return true;
    } catch (error) {
      if (report) {
        this.error(error instanceof Error ? error.message : error, 'Browser command failed');
      }
    }
    return false;
  }

  scroll = (frame: PluginBrowserScrollFrame): boolean => {
    if (this.snapshot.kind !== 'connected' || this.watch === null) {
      return false;
    }
    pluginBrowser.scroll(plugin, this.watch, frame);
    return true;
  };

  async execute(action: PluginBrowserAction) {
    const handle = this.handle;
    const watch = await handle;
    if (watch == null || this.handle !== handle || this.snapshot.kind !== 'connected') {
      throw new ActionFailure('WebCompanion is offline');
    }
    try {
      await pluginBrowser.action(plugin, watch, action);
    } catch (error) {
      throw new ActionFailure(typeof error === 'string' ? error : 'Browser command failed');
    }
  }

  private error(error: unknown, title: string) {
    toast.error(typeof error === 'string' ? error : title);
  }
}

export const webCompanion = new WebCompanion();
