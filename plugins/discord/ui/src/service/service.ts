// The Discord service the dashboard owner provides: `subscribe`/`unsubscribe` start and stop the connection and
// `plugin://discord/state` events follow it, `authorize`, `logout` and `voice` act on it.
import { emitPluginEvent, isRecord, type PluginService } from '@supadashboard/kit';
import type { VoiceCommand } from './actions';
import { Client } from './client';
import { validId } from './model';

const COMMANDS: VoiceCommand[] = ['toggleMute', 'toggleDeaf', 'leave', 'rejoin'];
const isCommand = (value: unknown): value is VoiceCommand =>
  COMMANDS.some((known) => known === value);

export function createDiscordService() {
  // ponytail: calls carry no window label, so this counts subscribe/unsubscribe pairs; a window that subscribes
  // twice without unsubscribing keeps the connection until the service restarts.
  let subscribers = 0;
  let client: Client | undefined;
  let latest: unknown;

  const running = () => {
    if (!client) {
      throw new Error('Connect Discord first');
    }
    return client;
  };
  const stop = () => {
    client?.destroy();
    client = undefined;
    latest = undefined;
  };

  const service: PluginService = {
    subscribe() {
      subscribers++;
      client ??= new Client((view) => {
        latest = view;
        void emitPluginEvent('discord', 'state', view);
      });
      return latest ?? { state: 'connecting' };
    },
    unsubscribe() {
      subscribers = Math.max(0, subscribers - 1);
      if (!subscribers) {
        stop();
      }
      return null;
    },
    async authorize(params) {
      const clientId =
        isRecord(params) && typeof params.clientId === 'string' ? params.clientId.trim() : '';
      if (!validId(clientId)) {
        throw new Error('Invalid Discord client ID');
      }
      await running().operate({ kind: 'authorize', clientId });
      return null;
    },
    async logout() {
      await running().operate({ kind: 'logout' });
      return null;
    },
    async voice(params) {
      const command = isRecord(params) ? params.command : undefined;
      if (!isCommand(command)) {
        throw new Error('Unknown Discord command');
      }
      await running().operate({ kind: 'voice', command });
      return null;
    },
  };
  return { service, destroy: stop };
}
