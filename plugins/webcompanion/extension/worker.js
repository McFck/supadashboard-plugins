import { answer, credentialId, fields, hello, isCode, isHex } from './protocol.js';
import { observe, scroll } from './browser.js';
import { BrowserPointer } from './pointer-worker.js';
import { isCommand, reply } from './commands.js';

const endpoint = 'ws://127.0.0.1:43822/browser';
const wake = 'webcompanion-reconnect';
const credentialKey = 'webcompanionCredential';
const MAX_PENDING = 32;
const encoder = new TextEncoder();
let socket;
let retry;
let backoff = 500;
let status = 'offline';
const errors = new Set(['code', 'expired', 'auth', 'update', 'dashboard_update', 'storage']);

function report(error) {
  console.error('WebCompanion:', error);
}

function schedule() {
  retry = setTimeout(() => {
    retry = undefined;
    reconnect().catch(report);
  }, backoff);
  backoff = Math.min(backoff * 2, 30_000);
}

function connect(mode, secret) {
  return new Promise((resolve, reject) => {
    const current = new WebSocket(endpoint);
    socket = current;
    const greeting = hello(mode);
    let phase = { kind: 'challenge' };
    let authenticating = false;
    let pending = 0;
    const deadline = setTimeout(() => current.close(), 4000);
    const send = (value) => current.send(JSON.stringify(value));

    current.onopen = async () => {
      try {
        if (mode === 'auth') {
          send({ ...greeting, keyId: await credentialId(secret) });
        } else {
          send(greeting);
        }
      } catch (error) {
        reject(error);
        current.close();
      }
    };
    current.onclose = () => {
      clearTimeout(deadline);
      if (phase.kind === 'connected') {
        phase.observer.stop();
        phase.pointer.stop();
      }
      reject(new Error('WebCompanion connection closed'));
      if (socket === current) {
        if (status === 'paired') {
          status = 'offline';
        }
        socket = undefined;
        schedule();
      }
    };
    const isOpen = () => socket === current && current.readyState === WebSocket.OPEN;
    function fail(error) {
      if (errors.has(error.message)) {
        status = error.message;
      }
      reject(error);
      current.close();
    }
    async function login(message) {
      if (fields(message, 'kind', 'code') && message.kind === 'error' && errors.has(message.code)) {
        throw new Error(message.code);
      }
      if (phase.kind === 'challenge') {
        const { proof, confirm } = await answer(greeting, message, secret);
        if (isOpen()) {
          phase = { kind: 'ready', confirm };
          send({ proof });
        }
        return;
      }
      const credential = await phase.confirm(message);
      if (!isOpen()) {
        return;
      }
      clearTimeout(deadline);
      if (mode === 'pair') {
        await chrome.alarms.create(wake, { periodInMinutes: 1 });
        await chrome.storage.local.set({ [credentialKey]: credential });
        if (isOpen()) {
          current.onclose = null;
          current.close();
          resolve(await connect('auth', credential));
        }
        return;
      }
      phase = {
        kind: 'connected',
        pointer: new BrowserPointer(),
        observer: observe(
          (state) => current.send(state),
          (error) => {
            report(error);
            current.close();
          },
        ),
      };
      backoff = 500;
      status = 'paired';
      resolve();
    }
    current.onmessage = ({ data }) => {
      const limit = phase.kind === 'connected' ? 16 * 1024 : 1024;
      if (typeof data !== 'string' || data.length > limit || encoder.encode(data).length > limit) {
        current.close();
        return;
      }
      if (!isOpen()) {
        return;
      }
      try {
        const message = JSON.parse(data);
        if (phase.kind !== 'connected') {
          if (authenticating) {
            throw new Error('Unexpected authentication frame');
          }
          authenticating = true;
          void login(message)
            .catch(fail)
            .finally(() => {
              authenticating = false;
            });
        } else if (message?.kind === 'scroll') {
          scroll(message);
        } else if (!isCommand(message)) {
          throw new Error('Invalid browser request');
        } else if (pending >= MAX_PENDING) {
          send({ kind: 'done', id: message.id, ok: false });
        } else {
          const { observer, pointer } = phase;
          pending++;
          void reply(message, pointer)
            .then((result) => {
              if (isOpen()) {
                send(result);
                if (message.action?.kind !== 'pointer') {
                  observer.refresh();
                }
              }
            })
            .catch(fail)
            .finally(() => {
              pending--;
            });
        }
      } catch (error) {
        fail(error);
      }
    };
  });
}

async function reconnect() {
  if (socket || retry !== undefined) {
    return;
  }
  const { [credentialKey]: credential } = await chrome.storage.local.get(credentialKey);
  if (isHex(credential, 64) && !socket && retry === undefined) {
    // Alarms wake a worker that Chromium suspended during backoff.
    if (!(await chrome.alarms.get(wake))) {
      await chrome.alarms.create(wake, { periodInMinutes: 1 });
    }
    if (!socket && retry === undefined) {
      await connect('auth', credential).catch(() => {
        // The dashboard can close while the browser stays open.
      });
    }
  }
}

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === wake) {
    reconnect().catch(report);
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) {
    return false;
  }
  if (fields(message, 'status') && message.status === true) {
    respond({ status });
    return false;
  }
  if (!fields(message, 'code') || !isCode(message.code)) {
    return false;
  }
  clearTimeout(retry);
  retry = undefined;
  const previous = socket;
  socket = undefined;
  previous?.close();
  status = 'offline';
  connect('pair', message.code).then(
    () => respond({ status: 'paired' }),
    () => respond({ status }),
  );
  return true;
});

reconnect().catch(report);
