import {
  ActionFailure,
  pluginBrowser,
  toast,
  type PluginBrowserAction,
  type PluginBrowserSnapshot,
} from '@supadashboard/kit';

const plugin = 'webcompanion';

class WebCompanion {
  snapshot = $state<PluginBrowserSnapshot>({ kind: 'offline' });
  code = $state('');
  ready = $state(false);
  private users = 0;
  private handle: Promise<number | null> | undefined;
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

  async action(action: PluginBrowserAction, signal?: AbortSignal) {
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'connected') {
      return false;
    }
    const handle = this.handle;
    try {
      const watch = await handle;
      if (watch != null && this.handle === handle && !signal?.aborted) {
        await pluginBrowser.action(plugin, watch, snapshot.revision, action);
        return true;
      }
    } catch (error) {
      if (!signal?.aborted) {
        this.error(error, 'Browser command failed');
      }
    }
    return false;
  }

  async open(url: string, destination: 'new' | 'current', signal?: AbortSignal) {
    const watch = await this.handle;
    if (signal?.aborted) {
      return;
    }
    if (watch == null) {
      throw new ActionFailure('WebCompanion is offline');
    }
    try {
      await pluginBrowser.open(plugin, watch, url, destination);
    } catch (error) {
      throw new ActionFailure(typeof error === 'string' ? error : 'Could not open website');
    }
  }

  private error(error: unknown, title: string) {
    toast.error(typeof error === 'string' ? error : title);
  }
}

export const webCompanion = new WebCompanion();
