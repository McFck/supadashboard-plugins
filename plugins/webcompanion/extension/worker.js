import { answer, credentialId, fields, hello, isHex } from './protocol.js';
import { observe, reply } from './browser.js';

const endpoint = 'ws://127.0.0.1:43822/browser';
const wake = 'webcompanion-reconnect';
const credentialKey = 'webcompanionCredential';
let socket;
let retry;
let backoff = 500;

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
    let queue = Promise.resolve();
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
      }
      reject(new Error('WebCompanion connection closed'));
      if (socket === current) {
        socket = undefined;
        schedule();
      }
    };
    current.onmessage = ({ data }) => {
      const limit = phase.kind === 'connected' ? 8192 : 1024;
      if (
        typeof data !== 'string' ||
        new TextEncoder().encode(data).length > limit ||
        pending === 2
      ) {
        current.close();
        return;
      }
      pending++;
      queue = queue
        .then(async () => {
          if (socket !== current || current.readyState !== WebSocket.OPEN) {
            return;
          }
          const message = JSON.parse(data);
          switch (phase.kind) {
            case 'challenge': {
              const { proof, credential } = await answer(greeting, message, secret);
              phase = { kind: 'ready', credential };
              send({ proof });
              break;
            }
            case 'ready': {
              if (!fields(message, 'kind') || message.kind !== 'ready') {
                throw new Error('Bridge refused authentication');
              }
              clearTimeout(deadline);
              if (mode === 'pair') {
                const credential = phase.credential;
                await chrome.alarms.create(wake, { periodInMinutes: 1 });
                await chrome.storage.local.set({ [credentialKey]: credential });
                if (socket === current) {
                  current.onclose = null;
                  current.close();
                  resolve(await connect('auth', credential));
                }
                break;
              }
              phase = {
                kind: 'connected',
                observer: observe(send, (error) => {
                  report(error);
                  current.close();
                }),
              };
              backoff = 500;
              resolve();
              break;
            }
            case 'connected':
              send(await reply(message));
              if (message.action.kind !== 'scroll') {
                phase.observer.refresh();
              }
              break;
          }
        })
        .catch((error) => {
          reject(error);
          current.close();
        })
        .finally(() => {
          pending--;
        });
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
  if (
    sender.url !== chrome.runtime.getURL('popup.html') ||
    !fields(message, 'code') ||
    !isHex(message.code, 32)
  ) {
    return false;
  }
  clearTimeout(retry);
  retry = undefined;
  const previous = socket;
  socket = undefined;
  previous?.close();
  connect('pair', message.code).then(
    () => respond({ paired: true }),
    () => respond({ paired: false }),
  );
  return true;
});

reconnect().catch(report);
