import { emptyScenario, whileOwner, type Plugin } from '@supadashboard/kit';
import market from '../../market.json';
import PairingSection from './PairingSection.svelte';
import BrowserTouchpad from './BrowserTouchpad.svelte';
import BrowserTabs from './BrowserTabs.svelte';
import TouchpadEditor from './TouchpadEditor.svelte';
import { browserActions } from './actions';
import { webCompanion } from './webcompanion.svelte';

const plugin: Plugin = {
  id: 'webcompanion',
  ...market,
  settingsSection: PairingSection,
  setup(api) {
    api.registerIcon('webcompanion', 'M3 5h18v14H3zM3 9h18M6 7h1m2 0h1');
    api.registerIcon('webcompanion-touchpad', 'M3 4h18v16H3zM7 8l7 3-3 1-1 3z');
    api.registerIcon('webcompanion-tabs', 'M3 7h6l2-3h7l3 3v13H3zM3 9h18M7 13h10m-10 3h7');
    api.registerControl({
      type: 'webcompanionTouchpad',
      title: 'Browser Touchpad',
      icon: 'webcompanion-touchpad',
      component: BrowserTouchpad,
      editor: TouchpadEditor,
      size: { w: 3, h: 3 },
      maxSize: { w: 8, h: 8 },
      triggers: [],
      create: () => ({
        name: 'Browser Touchpad',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    api.registerControl({
      type: 'browserRemoteTabs',
      title: 'Browser Tabs',
      icon: 'webcompanion-tabs',
      component: BrowserTabs,
      size: { w: 2, h: 4 },
      minSize: { w: 2, h: 2 },
      maxSize: { w: 8, h: 8 },
      triggers: [],
      create: () => ({
        name: 'Browser Tabs',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    for (const action of browserActions) {
      api.registerAction(action);
    }
    for (const field of ['connected', 'playing', 'mediaSuspended'] as const) {
      api.registerVariable({
        id: `webcompanion.${field}`,
        name: `webcompanion.${field}`,
        type: 'boolean',
        initialValue: false,
        persistent: false,
        readOnly: true,
      });
    }
    whileOwner(() =>
      webCompanion.mount((snapshot) => {
        const connected = snapshot.kind === 'connected';
        void api.setVariable('webcompanion.connected', connected);
        void api.setVariable('webcompanion.playing', connected && snapshot.media?.paused === false);
        void api.setVariable('webcompanion.mediaSuspended', connected && snapshot.suspended);
      }),
    );
  },
};

export default plugin;
