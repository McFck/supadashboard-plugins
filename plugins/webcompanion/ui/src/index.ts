import { emptyScenario, type Plugin } from '@supadashboard/kit';
import market from '../../market.json';
import PairingSection from './PairingSection.svelte';
import TabList from './TabList.svelte';

const plugin: Plugin = {
  id: 'webcompanion',
  ...market,
  settingsSection: PairingSection,
  setup(api) {
    api.registerIcon('webcompanion', 'M3 5h18v14H3zM3 9h18M6 7h1m2 0h1');
    api.registerControl({
      type: 'browserRemoteTabs',
      title: 'WebCompanion',
      icon: 'webcompanion',
      component: TabList,
      size: { w: 2, h: 2 },
      maxSize: { w: 8, h: 6 },
      triggers: [],
      create: () => ({
        name: 'WebCompanion',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
  },
};

export default plugin;
