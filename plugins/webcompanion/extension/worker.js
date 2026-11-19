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
// Retrying these fast cannot help; the one-minute alarm still retries in case the other side changes.
const lasting = new Set(['auth', 'update', 'dashboard_update']);

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

async function saveCredential(credential) {
  await chrome.alarms.create(wake, { periodInMinutes: 1 });
  await chrome.storage.local.set({ [credentialKey]: credential }).catch(() => {
    throw new Error('storage');
  });
}

function serve(message, session, send, fail) {
  if (message?.kind === 'scroll') {
    scroll(message);
  } else if (!isCommand(message)) {
    throw new Error('Invalid browser request');
  } else if (session.pending >= MAX_PENDING) {
    send({ kind: 'done', id: message.id, ok: false });
  } else {
    session.pending++;
    void reply(message, session.pointer)
      .then((result) => {
        if (send(result) && message.action?.kind !== 'pointer') {
          session.observer.refresh();
        }
      })
      .catch(fail)
      .finally(() => {
        session.pending--;
      });
  }
}

function connect(mode, secret) {
  return new Promise((resolve, reject) => {
    const current = new WebSocket(endpoint);
    socket = current;
    const greeting = hello(mode);
    let phase = { kind: 'challenge' };
    const deadline = setTimeout(() => current.close(), 4000);
    const isOpen = () => socket === current && current.readyState === WebSocket.OPEN;
    function send(value) {
      if (!isOpen()) {
        return false;
      }
      current.send(JSON.stringify(value));
      return true;
    }

    current.onopen = async () => {
      try {
        send(mode === 'auth' ? { ...greeting, keyId: await credentialId(secret) } : greeting);
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
        if (!lasting.has(status)) {
          schedule();
        }
      }
    };
    function fail(error) {
      if (errors.has(error.message)) {
        status = error.message;
      }
      reject(error);
      current.close();
    }
    async function login(message, step) {
      if (fields(message, 'kind', 'code') && message.kind === 'error' && errors.has(message.code)) {
        throw new Error(message.code);
      }
      if (step.kind === 'challenge') {
        const { proof, confirm } = await answer(greeting, message, secret);
        phase = { kind: 'ready', confirm };
        send({ proof });
        return;
      }
      const credential = await step.confirm(message);
      if (!isOpen()) {
        return;
      }
      clearTimeout(deadline);
      if (mode === 'pair') {
        await saveCredential(credential);
        if (isOpen()) {
          current.onclose = null;
          current.close();
          resolve(await connect('auth', credential));
        }
        return;
      }
      phase = {
        kind: 'connected',
        pending: 0,
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
        if (phase.kind === 'connected') {
          serve(message, phase, send, fail);
        } else if (phase.kind === 'verifying') {
          throw new Error('Unexpected authentication frame');
        } else {
          const step = phase;
          phase = { kind: 'verifying' };
          void login(message, step).catch(fail);
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
