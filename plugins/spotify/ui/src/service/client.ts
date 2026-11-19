import { invoke } from '@tauri-apps/api/core';
import { emitPluginEvent } from '@supadashboard/kit';
import * as api from './api';
import { query, sleep } from './query';
import { STORE_FAILED, WebApi } from './web-api';

export type ShuffleMode = 'on' | 'off' | 'toggle';
export type LikeOp = 'like' | 'unlike' | 'dislike';
type Operation =
  | { kind: 'authorize'; clientId: string }
  | { kind: 'logout' }
  | { kind: 'command'; op: LikeOp }
  | { kind: 'shuffle'; mode: ShuffleMode };

/** Seconds between reads of the player while a song plays and while it does not. */
const PLAYING_POLL = 5;
const IDLE_POLL = 30;

const mediaCommand = (command: string) =>
  invoke<boolean>('media_command', { target: 'spotify', command });

/** Mirrors the Web API: signed-in state, liked and shuffle, published as `plugin://spotify/state` until stopped. */
export class SpotifyClient {
  private readonly web = new WebApi(() => {
    this.player = api.NO_PLAYER;
    this.liked = null;
  });
  private player = api.NO_PLAYER;
  private liked: boolean | null = null;
  private latest = JSON.stringify({ state: 'connecting' });
  private stopped = false;
  private round = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  /** The last published view, for a window that subscribes late. */
  snapshot(): unknown {
    return JSON.parse(this.latest);
  }

  start() {
    void this.enqueue(async () => {
      try {
        await this.web.load();
      } catch (error) {
        this.publish(api.errorTitle(error));
      }
    }).then(() => this.poll());
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** One at a time, in order: polls and operations never overlap. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  /** `error` must already be a short title: the view's reader rejects control characters and long text. */
  private publish(error?: string) {
    if (this.stopped) {
      return;
    }
    const session = this.web.session;
    const view =
      session.kind === 'signedIn'
        ? {
            state: 'ready',
            user: session.user,
            trackUri: this.player.uri,
            liked: this.liked,
            smartShuffle: this.player.smartShuffle,
            shuffle: this.player.shuffle,
            error,
          }
        : { state: 'needsAuth', error };
    this.emit(view);
  }

  private emit(view: object) {
    const text = JSON.stringify(view);
    if (text !== this.latest) {
      this.latest = text;
      void emitPluginEvent('spotify', 'state', view);
    }
  }

  /** Reads the player now, then again after the poll interval; a newer call replaces the pending one. */
  private poll() {
    clearTimeout(this.timer);
    const round = ++this.round;
    void this.enqueue(async () => {
      let error: string | undefined;
      try {
        await this.read();
      } catch (failure) {
        error = api.errorTitle(failure);
      }
      this.publish(error);
    }).then(() => {
      if (!this.stopped && round === this.round) {
        const seconds = this.player.playing ? PLAYING_POLL : IDLE_POLL;
        this.timer = setTimeout(() => this.poll(), seconds * 1000);
      }
    });
  }

  private async read() {
    if (this.web.session.kind !== 'signedIn') {
      return;
    }
    await this.readPlayer();
    this.liked = null;
    if (this.player.uri) {
      const response = await this.web.request(
        'GET',
        `/me/library/contains?${query([['uris', this.player.uri]])}`,
      );
      this.liked = api.contains(response.body);
    }
  }

  /** Runs a user operation between polls, then reads the player again. */
  operation(operation: Operation): Promise<void> {
    if (this.web.session.kind === 'storeFailed') {
      return Promise.reject(new Error(STORE_FAILED));
    }
    const result = this.enqueue(async () => {
      try {
        await this.perform(operation);
      } finally {
        this.publish();
      }
    });
    const again = () => this.poll();
    result.then(again, again);
    return result;
  }

  /** Reads the player; resolves with its shuffle state, or `null` when nothing is active. */
  private async readPlayer(): Promise<boolean | null> {
    const response = await this.web.request('GET', '/me/player');
    const active = response.status === 204 ? null : api.shuffle(response.body);
    const next = response.status === 204 ? api.NO_PLAYER : api.player(response.body);
    if (next.uri !== this.player.uri) {
      this.liked = null;
    }
    this.player = next;
    return active;
  }

  private async confirmShuffle(enabled: boolean) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(200);
      const actual = await this.readPlayer();
      if (actual === null) {
        throw new Error("Spotify isn't playing");
      }
      if (!this.player.smartShuffle && actual === enabled) {
        return;
      }
    }
    throw new Error(
      this.player.smartShuffle ? 'Turn off smart shuffle in Spotify' : 'Spotify ignored shuffle',
    );
  }

  private async perform(operation: Operation) {
    switch (operation.kind) {
      case 'authorize':
        this.emit({ state: 'connecting' });
        return this.web.authorize(operation.clientId);
      case 'logout':
        return this.web.signOut();
      case 'command':
        return this.like(operation.op);
      case 'shuffle':
        try {
          return await this.shuffle(operation.mode);
        } catch (error) {
          console.warn('Spotify shuffle failed', error);
          throw error;
        }
    }
  }

  private async shuffle(mode: ShuffleMode) {
    if (this.web.session.kind !== 'signedIn') {
      return this.playerCommand(`shuffle:${mode}`);
    }
    const current = await this.readPlayer();
    if (current === null) {
      throw new Error("Spotify isn't playing");
    }
    const enabled = mode === 'toggle' ? !current : mode === 'on';
    if (this.player.smartShuffle) {
      // Spotify ignores Off while Smart is active; a confirmed On first exits Smart.
      await this.setShuffle(true);
    }
    if (this.player.shuffle !== enabled) {
      await this.setShuffle(enabled);
    }
  }

  /** The media session first; when it fails or is ignored, the Web API. */
  private async setShuffle(enabled: boolean) {
    const deviceId = this.player.deviceId;
    try {
      await this.playerCommand(enabled ? 'shuffle:on' : 'shuffle:off');
      await this.confirmShuffle(enabled);
      return;
    } catch {
      // The Web API below is the fallback; its own failure is what the user sees.
    }
    // An HTTP success only acknowledges the command; publish observations, never its target.
    const fields: [string, string][] = [['state', String(enabled)]];
    if (deviceId) {
      fields.push(['device_id', deviceId]);
    }
    let writeFailure: unknown;
    try {
      await this.web.request('PUT', `/me/player/shuffle?${query(fields)}`);
    } catch (error) {
      writeFailure = error;
    }
    try {
      await this.confirmShuffle(enabled);
    } catch (confirmation) {
      throw writeFailure ?? confirmation;
    }
  }

  /** A transport command for the Spotify session through the app, which owns the Windows media sessions. */
  private async playerCommand(command: string) {
    if ((await mediaCommand(command)) !== true) {
      throw new Error("Spotify isn't playing");
    }
  }

  private async like(op: LikeOp) {
    const response = await this.web.request('GET', '/me/player/currently-playing');
    if (response.status === 204) {
      throw new Error("Spotify isn't playing");
    }
    const uri = api.player(response.body).uri;
    if (!uri) {
      throw new Error("Spotify isn't playing");
    }
    await this.web.request(
      op === 'like' ? 'PUT' : 'DELETE',
      `/me/library?${query([['uris', uri]])}`,
    );
    this.player = { ...this.player, uri };
    this.liked = op === 'like';
    if (op === 'dislike') {
      await this.playerCommand('next');
    }
  }
}
