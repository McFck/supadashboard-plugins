import { ActionFailure, emptyScenario, whileOwner, type Plugin } from '@supadashboard/kit';
import market from '../../market.json';
import PairingSection from './PairingSection.svelte';
import BrowserControls from './BrowserControls.svelte';
import { webCompanion } from './webcompanion.svelte';

const plugin: Plugin = {
  id: 'webcompanion',
  ...market,
  settingsSection: PairingSection,
  setup(api) {
    api.registerIcon('webcompanion', 'M3 5h18v14H3zM3 9h18M6 7h1m2 0h1');
    api.registerControl({
      // This type is stored in existing deck layouts.
      type: 'browserRemoteTabs',
      title: 'WebCompanion',
      icon: 'webcompanion',
      component: BrowserControls,
      size: { w: 3, h: 2 },
      maxSize: { w: 8, h: 6 },
      triggers: [],
      create: () => ({
        name: 'WebCompanion',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    api.registerAction({
      id: 'webcompanion.open',
      title: 'Open website',
      params: [
        { key: 'url', label: 'URL', type: 'text' },
        {
          key: 'destination',
          label: 'Open in',
          type: 'select',
          default: 'new',
          suggestions: [
            { value: 'new', label: 'New tab' },
            { value: 'current', label: 'Current tab' },
          ],
        },
      ],
      run(args, context) {
        const destination = args.destination ?? 'new';
        if (typeof args.url !== 'string') {
          throw new ActionFailure('Enter a valid HTTP or HTTPS URL');
        }
        if (destination !== 'new' && destination !== 'current') {
          throw new ActionFailure('Choose a tab destination');
        }
        return webCompanion.open(args.url, destination, context?.signal);
      },
    });
    whileOwner(() => webCompanion.mount());
  },
};

export default plugin;
