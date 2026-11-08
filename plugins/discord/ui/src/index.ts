import {
  toast,
  currentRuntime,
  emptyScenario,
  type Plugin,
  type PluginApi,
  ownerAction,
  whileOwner,
} from '@supadashboard/kit';
import { subscribeVoice, voiceCommand } from './discord';
import ConnectionSection from './components/ConnectionSection.svelte';
import VoiceTile from './components/VoiceTile.svelte';
import guide from '../../guide.md?raw';
import market from '../../market.json';
import './plugin.css';

function followVoice(api: PluginApi) {
  return subscribeVoice((view) => {
    if (!currentRuntime()?.isOwner) {
      return;
    }
    const connected = view.state === 'idle' || view.state === 'inVoice';
    void Promise.all([
      api.setVariable('discord.muted', connected && view.muted),
      api.setVariable('discord.deafened', connected && view.deafened),
      api.setVariable('discord.inChannel', view.state === 'inVoice'),
    ]).catch(() => toast.error('Discord state unavailable'));
  });
}

const discordPlugin: Plugin = {
  id: 'discord',
  ...market,
  settingsSection: ConnectionSection,
  guide,
  setup(api) {
    api.registerIcon(
      'discord-voice',
      'M8 4 5 5C3 8 2 12 2 16l4 2 1-2m10 0 1 2 4-2c0-4-1-8-3-11l-3-1-1 2H9L8 4M9 11v2m6-2v2M7 16c3 1 7 1 10 0',
    );
    api.registerAppIcon('discord', 'discord-voice');
    api.registerControl({
      type: 'discordVoice',
      title: 'Voice channel',
      icon: 'discord-voice',
      component: VoiceTile,
      size: { w: 2, h: 2 },
      minSize: { w: 1, h: 1 },
      maxSize: { w: 8, h: 6 },
      triggers: ['press', 'longPress', 'doubleTap'],
      create: () => ({
        name: 'Voice channel',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    for (const [command, title] of [
      ['toggleMute', 'Toggle mute'],
      ['toggleDeaf', 'Toggle deafen'],
      ['leave', 'Leave channel'],
      ['rejoin', 'Rejoin last channel'],
    ] as const) {
      api.registerAction({
        id: `discord.${command}`,
        title,
        run: ownerAction('Discord', () => voiceCommand(command)),
      });
    }
    for (const field of ['muted', 'deafened', 'inChannel'] as const) {
      api.registerVariable({
        id: `discord.${field}`,
        name: `discord.${field}`,
        type: 'boolean',
        initialValue: false,
        persistent: false,
        readOnly: true,
      });
    }
    whileOwner(() => followVoice(api));
  },
};
export default discordPlugin;
