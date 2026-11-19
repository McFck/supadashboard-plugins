// Operations, dispatches and the 50 ms tick run one at a time, so two toggles cannot read the same state.
import { executeVoice, type VoiceCommand } from './actions';
import { connect, readAccess, refresh, refreshRejected } from './connection';
import { Rpc } from './rpc';
import { needsRefresh, readCredentials, saveLastChannel, signOut, type Credentials } from './store';
import {
  applyEvent,
  applySelected,
  emptyVoice,
  subscriptions,
  voiceView,
  type VoiceState,
} from './voice';

export type Phase =
  'absent' | 'handshake' | 'needsAuth' | 'authorizing' | 'authenticating' | 'ready';
export type Operation =
  | { kind: 'authorize'; clientId: string }
  | { kind: 'logout' }
  | { kind: 'voice'; command: VoiceCommand };

const BACKOFF_SECONDS = [1, 2, 5, 10, 30];
const CHANNEL_REFRESH_MS = 2000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Client {
  phase: Phase = 'absent';
  rpc?: Rpc;
  credentials: Credentials | null = null;
  voice: VoiceState = emptyVoice();
  muteBeforeDeaf?: boolean;
  private subscribed?: VoiceState['channel'];
  private retry = 0;
  private nextRetry = 0;
  private nextChannelRefresh = 0;
  private lastView = '';
  private fault?: string;
  private stopped = false;
  private ticking = false;
  private timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly publishView: (view: unknown) => void) {
    this.run(() => this.load()).catch(() => {});
  }

  destroy() {
    this.stopped = true;
    clearInterval(this.timer);
    this.closeRpc();
  }

  /** Queues `job` behind everything else, then reduces the dispatches that arrived meanwhile. */
  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.stopped) {
        throw new Error('Discord connection stopped');
      }
      try {
        return await job();
      } finally {
        await this.drain();
        this.publish();
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }

  operate(operation: Operation) {
    return this.run(() => this.execute(operation));
  }

  private async load() {
    try {
      this.credentials = await readCredentials();
    } catch (error) {
      // An unreadable record stays as it is; every operation reports it.
      this.fault = message(error);
      this.phase = 'needsAuth';
    }
    this.voice = emptyVoice(this.credentials?.lastChannel);
    if (!this.credentials) {
      this.phase = 'needsAuth';
    }
    this.nextRetry = Date.now();
    this.timer = setInterval(() => this.tick(), 50);
    this.publish();
  }

  private tick() {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    this.run(async () => {
      if (
        !this.rpc &&
        this.phase !== 'needsAuth' &&
        this.credentials &&
        Date.now() >= this.nextRetry
      ) {
        await connect(this).catch(() => this.disconnected());
      }
      if (this.phase === 'ready' && this.credentials && needsRefresh(this.credentials)) {
        try {
          await refresh(this);
          this.phase = 'absent';
          this.nextRetry = Date.now();
          // Re-authenticate the new token on a fresh RPC session without reopening consent.
          this.closeRpc();
        } catch (error) {
          console.error('Discord refresh failed', message(error));
          if (refreshRejected(error)) {
            this.phase = 'needsAuth';
          }
          this.disconnected();
        }
      }
      if (this.phase === 'ready' && Date.now() >= this.nextChannelRefresh) {
        try {
          await this.selected();
        } catch (error) {
          if (this.rpc) {
            console.warn('Discord channel refresh failed', message(error));
            this.disconnected();
          }
        }
      }
    })
      .catch(() => {})
      .finally(() => {
        this.ticking = false;
      });
  }

  async openRpc(clientId: string) {
    const rpc = await Rpc.connect(
      clientId,
      () => void this.run(async () => {}).catch(() => {}),
      () =>
        void this.run(async () => {
          if (this.rpc === rpc) {
            this.disconnected();
          }
        }).catch(() => {}),
    );
    this.rpc = rpc;
    this.subscribed = undefined;
    return rpc;
  }

  closeRpc() {
    const rpc = this.rpc;
    this.rpc = undefined;
    rpc?.close();
  }

  setPhase(phase: Phase) {
    this.phase = phase;
    this.publish();
  }

  publish() {
    if (this.stopped) {
      return;
    }
    const view = this.view();
    const text = JSON.stringify(view);
    if (text !== this.lastView) {
      this.lastView = text;
      this.publishView(view);
    }
  }

  private view() {
    switch (this.phase) {
      case 'absent':
        return { state: 'absent' };
      case 'needsAuth':
        return { state: 'needsAuth' };
      case 'authorizing':
        return { state: 'authorizing' };
      case 'handshake':
      case 'authenticating':
        return { state: 'connecting' };
      case 'ready':
        return voiceView(this.voice);
    }
  }

  disconnected() {
    this.closeRpc();
    if (this.phase !== 'needsAuth') {
      this.phase = 'absent';
    }
    const seconds = BACKOFF_SECONDS[Math.min(this.retry, BACKOFF_SECONDS.length - 1)];
    this.retry++;
    this.nextRetry = Date.now() + seconds * 1000;
    this.publish();
  }

  connected() {
    this.retry = 0;
    this.setPhase('ready');
  }

  async request(cmd: string, args: unknown, event?: string): Promise<unknown> {
    if (!this.rpc) {
      throw new Error("Discord isn't running");
    }
    const rpc = this.rpc;
    const queued = rpc.events.length;
    try {
      const data = await rpc.request(cmd, args, event);
      // A snapshot supersedes older deltas. A dispatch received during the request may be newer than the reply,
      // and channel-selection events always deserve a fresh read.
      const stale = {
        GET_SELECTED_VOICE_CHANNEL: [
          'VOICE_STATE_CREATE',
          'VOICE_STATE_UPDATE',
          'VOICE_STATE_DELETE',
        ],
        GET_VOICE_SETTINGS: ['VOICE_SETTINGS_UPDATE'],
      }[cmd];
      if (stale) {
        const kept = rpc.events.filter(
          (frame, index) => index >= queued || !stale.includes(String(frame.evt)),
        );
        rpc.events.splice(0, rpc.events.length, ...kept);
      }
      return data;
    } catch (error) {
      if (!message(error).startsWith('Discord rejected ')) {
        // A timed-out write may have reached Discord; close it and never replay the action.
        this.disconnected();
      }
      throw error;
    }
  }

  /** Re-reads the selected channel and moves the per-channel subscriptions with it. */
  async selected() {
    this.nextChannelRefresh = Date.now() + CHANNEL_REFRESH_MS;
    const next = applySelected(this.voice, await this.request('GET_SELECTED_VOICE_CHANNEL', {}));
    const moves = subscriptions(this.subscribed, next.channel);
    if (this.voice.lastChannel?.id !== next.lastChannel?.id) {
      try {
        await saveLastChannel(next.lastChannel);
      } catch (error) {
        this.phase = 'needsAuth';
        this.disconnected();
        throw error;
      }
    }
    this.voice = next;
    for (const { cmd, event, channelId } of moves) {
      if (!this.rpc) {
        throw new Error("Discord isn't running");
      }
      await this.rpc.request(cmd, { channel_id: channelId }, event);
    }
    this.subscribed = next.channel;
    const channel = next.channel;
    if (moves.length && channel?.guildId && channel.access === undefined) {
      this.publish();
      const access = await readAccess(this, channel.guildId, channel.id);
      if (access !== undefined) {
        this.voice = { ...next, channel: { ...channel, access } };
      }
    }
  }

  private async drain() {
    while (this.rpc?.events.length) {
      const frame = this.rpc.events.shift();
      try {
        await this.dispatch(frame ?? {});
      } catch (error) {
        // Fixed internal errors contain no RPC bodies or credentials.
        console.error('Discord state update failed', message(error));
        this.disconnected();
        return;
      }
    }
  }

  private async dispatch(frame: Record<string, unknown>) {
    if (frame.cmd !== 'DISPATCH') {
      return;
    }
    if (typeof frame.evt !== 'string') {
      throw new Error('Invalid Discord event');
    }
    if (frame.evt === 'VOICE_CHANNEL_SELECT') {
      await this.selected();
      return;
    }
    const next = applyEvent(this.voice, frame.evt, frame.data);
    if (frame.evt === 'VOICE_SETTINGS_UPDATE' && next.settings) {
      const before = this.voice.settings;
      if (before && !before[1] && next.settings[1]) {
        this.muteBeforeDeaf = before[0];
      } else if (!next.settings[1]) {
        this.muteBeforeDeaf = undefined;
      }
    }
    this.voice = next;
  }

  private async execute(operation: Operation) {
    if (this.fault) {
      throw new Error(this.fault);
    }
    switch (operation.kind) {
      case 'authorize':
        this.closeRpc();
        try {
          await connect(this, operation.clientId);
        } catch (error) {
          if (this.phase !== 'handshake') {
            this.phase = 'needsAuth';
          }
          this.disconnected();
          throw error;
        }
        return;
      case 'logout':
        await signOut();
        this.credentials = null;
        this.closeRpc();
        this.voice = emptyVoice();
        this.setPhase('needsAuth');
        return;
      case 'voice':
        if (this.phase !== 'ready') {
          throw new Error(
            this.phase === 'absent' ? "Discord isn't running" : 'Connect Discord first',
          );
        }
        await executeVoice(this, operation.command);
    }
  }
}
