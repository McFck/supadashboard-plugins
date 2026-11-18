import { emptyScenario, type Plugin } from '@supadashboard/kit';
import market from '../../market.json';
import PairingSection from './PairingSection.svelte';
import TabList from './TabList.svelte';

const browserRemote: Plugin = {
  id: 'browser-remote',
  ...market,
  settingsSection: PairingSection,
  setup(api) {
    api.registerIcon('browser-remote', 'M3 5h18v14H3zM3 9h18M6 7h1m2 0h1');
    api.registerControl({
      type: 'browserRemoteTabs',
      title: 'Browser tabs',
      icon: 'browser-remote',
      component: TabList,
      size: { w: 2, h: 2 },
      maxSize: { w: 8, h: 6 },
      triggers: [],
      create: () => ({
        name: 'Browser tabs',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
  },
};

export default browserRemote;
