const utf8 = new TextEncoder();
const hex = /^[0-9a-f]+$/;

export function isHex(value, length) {
  return typeof value === 'string' && value.length === length && hex.test(value);
}

export function fields(value, ...keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

const encodeHex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function hello(mode) {
  return { mode, nonce: encodeHex(crypto.getRandomValues(new Uint8Array(16))) };
}

export async function answer(greeting, challenge, secret) {
  if (
    !fields(challenge, 'nonce', 'proof') ||
    !isHex(challenge.nonce, 32) ||
    !isHex(challenge.proof, 64)
  ) {
    throw new Error('Invalid bridge challenge');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    utf8.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const transcript = `browser-remote-v1:${greeting.mode}:${chrome.runtime.id}:${greeting.nonce}:${challenge.nonce}`;
  const proof = Uint8Array.from(challenge.proof.match(/../g), (byte) => Number.parseInt(byte, 16));
  if (!(await crypto.subtle.verify('HMAC', key, proof, utf8.encode(`server:${transcript}`)))) {
    throw new Error('Bridge authentication failed');
  }
  const sign = async (role) =>
    encodeHex(
      new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(`${role}:${transcript}`))),
    );
  return {
    proof: await sign('client'),
    credential: greeting.mode === 'pair' ? await sign('credential') : secret,
  };
}

function title(value) {
  let bytes = 0;
  let result = '';
  for (const character of (value ?? '').toWellFormed()) {
    bytes += utf8.encode(character).length;
    if (bytes > 256) {
      break;
    }
    result += character;
  }
  return result;
}

function idInRange(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

export async function reply(message) {
  const { kind, id, tab } = message ?? {};
  const list = kind === 'tabs.list' && fields(message, 'kind', 'id');
  const activate =
    kind === 'tabs.activate' && fields(message, 'kind', 'id', 'tab') && idInRange(tab, 0x7fffffff);
  if ((!list && !activate) || !idInRange(id, 0xffffffff)) {
    throw new Error('Invalid tab request');
  }
  try {
    if (list) {
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      return {
        kind,
        id,
        tabs: tabs
          .filter((item) => idInRange(item.id, 0x7fffffff))
          .slice(0, 256)
          .map((item) => ({ id: item.id, title: title(item.title), active: item.active })),
      };
    }
    // Changing the selected tab preserves the foreground application's focus.
    await chrome.tabs.update(tab, { active: true });
    return { kind, id };
  } catch {
    return { kind: 'failed', id };
  }
}
