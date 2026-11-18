import { pluginBrowser, toast, type PluginBrowserSnapshot } from '@supadashboard/kit';

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

  async activate(tab: number) {
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'connected') {
      return;
    }
    const handle = this.handle;
    try {
      const watch = await handle;
      if (watch != null && this.handle === handle) {
        await pluginBrowser.activate(plugin, watch, snapshot.revision, tab);
      }
    } catch (error) {
      this.error(error, 'Could not activate the tab');
    }
  }

  private error(error: unknown, title: string) {
    toast.error(typeof error === 'string' ? error : title);
  }
}

export const webCompanion = new WebCompanion();
