const utf8 = new TextEncoder();
export const MAX_TAB_ID = 0x7fffffff;
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
  return { v: 3, mode, nonce: encodeHex(crypto.getRandomValues(new Uint8Array(16))) };
}

export function isCode(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

export async function credentialId(secret) {
  return encodeHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(secret))));
}

export async function answer(greeting, challenge, secret) {
  if (fields(challenge, 'nonce', 'proof') && isHex(challenge.nonce, 32)) {
    throw new Error('dashboard_update');
  }
  if (!fields(challenge, 'nonce') || !isHex(challenge.nonce, 32)) {
    throw new Error('Invalid bridge challenge');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    utf8.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const transcript = `supadashboard-browser-v${greeting.v}:${greeting.mode}:${chrome.runtime.id}:${greeting.nonce}:${challenge.nonce}`;
  const sign = async (text) =>
    encodeHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(text))));
  return {
    proof: await sign(`client:${transcript}`),
    async confirm(ready) {
      if (!fields(ready, 'kind', 'proof') || !isHex(ready.proof, 64)) {
        throw new Error('Invalid bridge confirmation');
      }
      const proof = Uint8Array.from(ready.proof.match(/../g), (byte) => Number.parseInt(byte, 16));
      if (greeting.mode === 'auth' && ready.kind === 'revoked') {
        const revokeKey = await crypto.subtle.importKey(
          'raw',
          utf8.encode(await sign('revocation')),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        if (
          await crypto.subtle.verify('HMAC', revokeKey, proof, utf8.encode(`revoked:${transcript}`))
        ) {
          return null;
        }
        throw new Error('Invalid bridge revocation');
      }
      if (ready.kind !== 'ready') {
        throw new Error('Invalid bridge confirmation');
      }
      if (!(await crypto.subtle.verify('HMAC', key, proof, utf8.encode(`server:${transcript}`)))) {
        throw new Error('Bridge authentication failed');
      }
      return greeting.mode === 'pair' ? sign(`credential:${transcript}`) : secret;
    },
  };
}

export function isUnpairFrame(value, kind) {
  return fields(value, 'kind') && value.kind === kind;
}

export function isPointerDone(value, id) {
  return (
    fields(value, 'kind', 'id', 'ok') &&
    value.kind === 'pointer_done' &&
    value.id === id &&
    typeof value.ok === 'boolean'
  );
}

export function title(value) {
  let bytes = 0;
  let result = '';
  for (const character of (value ?? '').toWellFormed()) {
    // JSON escapes can cost more bytes than the characters they represent.
    bytes += utf8.encode(JSON.stringify(character)).length - 2;
    if (bytes > 256) {
      break;
    }
    result += character;
  }
  return result;
}

export function idInRange(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/** A page's media status: null, or paused plus a rate the bridge accepts (0 or 1/16 to 16). */
export function isMedia(value) {
  return (
    value === null ||
    (fields(value, 'paused', 'rate') &&
      typeof value.paused === 'boolean' &&
      typeof value.rate === 'number' &&
      (value.rate === 0 || (value.rate >= 0.0625 && value.rate <= 16)))
  );
}

export function website(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Browser-internal URLs and missing icons may not parse as a website.
  }
  return null;
}
