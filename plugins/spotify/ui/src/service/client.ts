import { invoke } from '@tauri-apps/api/core';
import {
  emitPluginEvent,
  pluginHttp,
  pluginOAuth,
  pluginSecrets,
  type PluginHttpResponse,
} from '@supadashboard/kit';
import * as api from './api';
import { query, sleep } from './query';

export type ShuffleMode = 'on' | 'off' | 'toggle';
export type LikeOp = 'like' | 'unlike' | 'dislike';
type Operation =
  | { kind: 'authorize'; clientId: string }
  | { kind: 'logout' }
  | { kind: 'command'; op: LikeOp }
  | { kind: 'shuffle'; mode: ShuffleMode };
type Method = 'GET' | 'PUT' | 'DELETE';

const SECRET = 'spotify';
const BASE = 'https://api.spotify.com/v1';
const AUTHORIZATION = { Authorization: `Bearer {{secret:${SECRET}}}` };
/** Seconds between reads of the player while a song plays and while it does not. */
const PLAYING_POLL = 5;
const IDLE_POLL = 30;
const SIGNED_OUT = 'Connect Spotify first';

function messageOf(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Spotify request failed';
}

/** The host's refresh failing for good leaves the user signed out. */
const needsSignIn = (error: unknown) =>
  ['Sign in again', 'Not signed in'].includes(messageOf(error));

const mediaCommand = (command: string) =>
  invoke<boolean>('media_command', { target: 'spotify', command });

/** Mirrors the Web API: signed-in state, liked and shuffle, published as `plugin://spotify/state` until stopped. */
export class SpotifyClient {
  private signedIn = false;
  private userName = '';
  private player = api.NO_PLAYER;
  private liked: boolean | null = null;
  private retryAt = 0;
  private latest = JSON.stringify({ state: 'connecting' });
  private storeError: string | undefined;
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
        await this.load();
      } catch {
        this.storeError = 'Could not read Spotify store';
        this.publish(this.storeError);
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

  private async load() {
    const { fields, signedIn } = await pluginSecrets.read('spotify', SECRET);
    const { clientId, userName } = fields;
    const name = typeof userName === 'string' ? userName : '';
    if (
      (clientId !== undefined && !(typeof clientId === 'string' && api.validClientId(clientId))) ||
      !api.validText(name, 512)
    ) {
      throw new Error('Invalid Spotify credentials');
    }
    this.signedIn = signedIn;
    this.userName = name;
  }

  private publish(error?: string) {
    if (this.stopped) {
      return;
    }
    const view = this.signedIn
      ? {
          state: 'ready',
          user: this.userName,
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
        error = messageOf(failure);
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
    if (!this.signedIn) {
      return;
    }
    await this.readPlayer();
    this.liked = null;
    if (this.player.uri) {
      const response = await this.request(
        'GET',
        `/me/library/contains?${query([['uris', this.player.uri]])}`,
      );
      this.liked = api.contains(response.body);
    }
  }

  /** Runs a user operation between polls, then reads the player again. */
  operation(operation: Operation): Promise<void> {
    if (this.storeError) {
      return Promise.reject(new Error(this.storeError));
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

  private async signOut() {
    this.signedIn = false;
    this.userName = '';
    this.player = api.NO_PLAYER;
    this.liked = null;
    await pluginOAuth.signOut('spotify', SECRET);
    await pluginSecrets.write('spotify', SECRET, { userName: '' });
  }

  private async send(method: Method, path: string): Promise<PluginHttpResponse> {
    try {
      return await pluginHttp('spotify', { method, url: `${BASE}${path}`, headers: AUTHORIZATION });
    } catch (error) {
      if (needsSignIn(error)) {
        await this.signOut();
        throw new Error(SIGNED_OUT);
      }
      throw error;
    }
  }

  /** The host refreshes an expiring token before sending; a 401 refreshes once more and retries. */
  private async request(method: Method, path: string) {
    if (Date.now() < this.retryAt) {
      throw new Error('Spotify rate limited');
    }
    if (!this.signedIn) {
      throw new Error(SIGNED_OUT);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.send(method, path);
      try {
        api.check(response);
        return response;
      } catch (error) {
        if (!(error instanceof api.ApiError)) {
          throw error;
        }
        if (error.failure === 'unauthorized' && attempt === 0) {
          await this.refresh();
          continue;
        }
        if (error.failure === 'unauthorized') {
          await this.signOut();
        } else if (error.failure === 'rateLimited') {
          this.retryAt = Date.now() + error.retryAfter * 1000;
        }
        throw error;
      }
    }
    throw new Error(SIGNED_OUT);
  }

  private async refresh() {
    try {
      await pluginOAuth.refresh('spotify', SECRET);
    } catch (error) {
      if (needsSignIn(error)) {
        await this.signOut();
        throw new Error(SIGNED_OUT);
      }
      throw error;
    }
  }

  /** Reads the player; resolves with its shuffle state, or `null` when nothing is active. */
  private async readPlayer(): Promise<boolean | null> {
    const response = await this.request('GET', '/me/player');
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
        return this.authorize(operation.clientId);
      case 'logout':
        return this.signOut();
      case 'command':
        return this.like(operation.op);
      case 'shuffle':
        try {
          return await this.shuffle(operation.mode);
        } catch (error) {
          console.warn(`Spotify shuffle failed: ${messageOf(error)}`);
          throw error;
        }
    }
  }

  private async authorize(clientId: string) {
    this.emit({ state: 'connecting' });
    await pluginOAuth.signIn('spotify', SECRET, clientId);
    try {
      const response = await this.send('GET', '/me');
      api.check(response);
      const userName = api.user(response.body);
      await pluginSecrets.write('spotify', SECRET, { userName });
      this.userName = userName;
    } catch (error) {
      await pluginOAuth.signOut('spotify', SECRET);
      throw error;
    }
    this.signedIn = true;
    this.retryAt = 0;
  }

  private async shuffle(mode: ShuffleMode) {
    if (!this.signedIn) {
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

  private async setShuffle(enabled: boolean) {
    const deviceId = this.player.deviceId;
    try {
      await this.playerCommand(enabled ? 'shuffle:on' : 'shuffle:off');
      await this.confirmShuffle(enabled);
      return;
    } catch (error) {
      console.warn(`${messageOf(error)}; using Spotify Web API shuffle`);
    }
    // An HTTP success only acknowledges the command; publish observations, never its target.
    const fields: [string, string][] = [['state', String(enabled)]];
    if (deviceId) {
      fields.push(['device_id', deviceId]);
    }
    let writeFailure: unknown;
    try {
      await this.request('PUT', `/me/player/shuffle?${query(fields)}`);
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
    const response = await this.request('GET', '/me/player/currently-playing');
    if (response.status === 204) {
      throw new Error("Spotify isn't playing");
    }
    const uri = api.player(response.body).uri;
    if (!uri) {
      throw new Error("Spotify isn't playing");
    }
    await this.request(op === 'like' ? 'PUT' : 'DELETE', `/me/library?${query([['uris', uri]])}`);
    this.player = { ...this.player, uri };
    this.liked = op === 'like';
    if (op === 'dislike') {
      await this.playerCommand('next');
    }
  }
}
