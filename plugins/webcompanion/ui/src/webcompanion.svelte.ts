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
  code = $state('');
  ready = $state(false);
  private users = 0;
  private handle: Promise<number | null> | undefined;
  private watch: number | null = null;
  private stopping = Promise.resolve();

  mount() {
    this.users++;
    if (this.users === 1) {
      this.start();
    }
    return () => this.destroy();
  }

  private start() {
    const handle = this.stopping
      .then(() =>
        pluginBrowser.watch(plugin, (snapshot) => {
          if (this.handle === handle) {
            this.snapshot = snapshot;
            if (snapshot.kind === 'connected') {
              this.code = '';
            }
          }
        }),
      )
      .then((id) => {
        if (this.handle === handle) {
          this.watch = id;
          this.ready = true;
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
    this.ready = false;
    this.snapshot = { kind: 'offline' };
    this.code = '';
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
    const handle = this.handle;
    try {
      const watch = await handle;
      if (watch != null && this.handle === handle) {
        const code = await pluginBrowser.pair(plugin, watch);
        if (this.handle === handle && this.snapshot.kind !== 'connected') {
          this.code = code;
        }
      }
    } catch (error) {
      this.error(error, 'Could not create pairing code');
    }
  }

  async action(action: PluginBrowserAction) {
    if (this.snapshot.kind !== 'connected') {
      return false;
    }
    const handle = this.handle;
    try {
      const watch = await handle;
      if (watch != null && this.handle === handle) {
        await pluginBrowser.action(plugin, watch, action);
        return true;
      }
    } catch (error) {
      this.error(error, 'Browser command failed');
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

  async open(url: string, destination: 'new' | 'current', signal?: AbortSignal) {
    const watch = await this.handle;
    if (signal?.aborted) {
      return;
    }
    if (watch == null) {
      throw new ActionFailure('WebCompanion is offline');
    }
    try {
      await pluginBrowser.action(plugin, watch, { kind: 'open', url, destination });
    } catch (error) {
      throw new ActionFailure(typeof error === 'string' ? error : 'Could not open website');
    }
  }

  private error(error: unknown, title: string) {
    toast.error(typeof error === 'string' ? error : title);
  }
}

export const webCompanion = new WebCompanion();
