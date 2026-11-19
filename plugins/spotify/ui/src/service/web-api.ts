import {
  pluginHttp,
  pluginOAuth,
  pluginSecrets,
  type PluginHttpResponse,
} from '@supadashboard/kit';
import * as api from './api';

type Method = 'GET' | 'PUT' | 'DELETE';
export type Session =
  { kind: 'signedOut' } | { kind: 'signedIn'; user: string } | { kind: 'storeFailed' };

const SECRET = 'spotify';
const BASE = 'https://api.spotify.com/v1';
const AUTHORIZATION = { Authorization: `Bearer {{secret:${SECRET}}}` };
const SIGNED_OUT = 'Connect Spotify first';
export const STORE_FAILED = 'Could not read Spotify store';

/** The host's refresh failing for good leaves the user signed out. */
function needsSignIn(error: unknown) {
  const text = error instanceof Error ? error.message : error;
  return text === 'Sign in again' || text === 'Not signed in';
}

export class WebApi {
  session: Session = { kind: 'signedOut' };
  private retryAt = 0;

  /** `signedOut` runs whenever the session ends, so the caller drops what it read for that user. */
  constructor(private readonly signedOut: () => void) {}

  async load() {
    try {
      const { fields, signedIn } = await pluginSecrets.read('spotify', SECRET);
      const { clientId, userName } = fields;
      const user = typeof userName === 'string' ? userName : '';
      if (
        (clientId !== undefined &&
          !(typeof clientId === 'string' && api.validClientId(clientId))) ||
        !api.validText(user, 512)
      ) {
        throw new Error('Invalid Spotify credentials');
      }
      this.session = signedIn ? { kind: 'signedIn', user } : { kind: 'signedOut' };
    } catch {
      this.session = { kind: 'storeFailed' };
      throw new Error(STORE_FAILED);
    }
  }

  async authorize(clientId: string) {
    await pluginOAuth.signIn('spotify', SECRET, clientId);
    try {
      const response = await this.send('GET', '/me');
      api.check(response);
      const user = api.user(response.body);
      await pluginSecrets.write('spotify', SECRET, { userName: user });
      this.session = { kind: 'signedIn', user };
    } catch (error) {
      await pluginOAuth.signOut('spotify', SECRET);
      throw error;
    }
    this.retryAt = 0;
  }

  async signOut() {
    this.session = { kind: 'signedOut' };
    this.signedOut();
    await pluginOAuth.signOut('spotify', SECRET);
    await pluginSecrets.write('spotify', SECRET, { userName: '' });
  }

  /** The host refreshes an expiring token before sending; a 401 refreshes once more and retries. */
  async request(method: Method, path: string) {
    if (Date.now() < this.retryAt) {
      throw new Error('Spotify rate limited');
    }
    if (this.session.kind !== 'signedIn') {
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
}
