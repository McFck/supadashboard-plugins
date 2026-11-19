// Guards the extension's trust boundaries: the pairing proof the Rust bridge checks, page media reports and website URLs.
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { answer, isMedia, isPointerDone, isUnpairFrame, website } from './extension/protocol.js';

const extension = 'cnojhdmglpjodgblffallbibdifemkop';
globalThis.chrome = { runtime: { id: extension } };

it('signs the same transcript as pairing.rs and accepts only the bridge proof', async () => {
  const greeting = { v: 3, mode: 'pair', nonce: 'a'.repeat(32) };
  const challenge = { nonce: 'b'.repeat(32) };
  const transcript = `supadashboard-browser-v3:pair:${extension}:${greeting.nonce}:${challenge.nonce}`;
  const sign = (role) =>
    createHmac('sha256', '123456').update(`${role}:${transcript}`).digest('hex');
  const { proof, confirm } = await answer(greeting, challenge, '123456');
  expect(proof).toBe(sign('client'));
  await expect(confirm({ kind: 'ready', proof: sign('client') })).rejects.toThrow();
  expect(await confirm({ kind: 'ready', proof: sign('server') })).toBe(sign('credential'));
});

it('accepts only bounded media reports from pages', () => {
  expect([null, { paused: true, rate: 0 }, { paused: false, rate: 16 }].every(isMedia)).toBe(true);
  for (const media of [
    undefined,
    { paused: 'no', rate: 1 },
    { paused: false, rate: 0.01 },
    { paused: false, rate: 17 },
    { paused: false, rate: 1, extra: true },
  ]) {
    expect(isMedia(media)).toBe(false);
  }
});

it('forgets a disconnected credential only for a signed revocation of this login', async () => {
  const secret = 'd'.repeat(64);
  const greeting = { v: 3, mode: 'auth', nonce: 'a'.repeat(32) };
  const challenge = { nonce: 'b'.repeat(32) };
  const transcript = `supadashboard-browser-v3:auth:${extension}:${greeting.nonce}:${challenge.nonce}`;
  const key = createHmac('sha256', secret).update('revocation').digest('hex');
  const proof = createHmac('sha256', key).update(`revoked:${transcript}`).digest('hex');
  const revoked = { kind: 'revoked', proof };
  const { confirm } = await answer(greeting, challenge, secret);
  await expect(confirm(revoked)).resolves.toBeNull();
  await expect(confirm({ ...revoked, proof: '0'.repeat(64) })).rejects.toThrow();
  await expect(confirm({ ...revoked, extra: true })).rejects.toThrow();
  const next = await answer(greeting, { nonce: 'c'.repeat(32) }, secret);
  await expect(next.confirm(revoked)).rejects.toThrow();
  expect(isUnpairFrame({ kind: 'unpaired' }, 'unpaired')).toBe(true);
  expect(isUnpairFrame({ kind: 'unpaired', extra: true }, 'unpaired')).toBe(false);
});

it('passes only plain http and https websites', () => {
  expect(website('https://example.org/a')).toBe('https://example.org/a');
  for (const url of [
    'javascript:alert(1)',
    'chrome://settings',
    'https://user:pw@example.org',
    'nope',
  ]) {
    expect(website(url)).toBeNull();
  }
});

it('a malformed or stale page acknowledgement cannot complete pointer motion', () => {
  const done = { kind: 'pointer_done', id: 4, ok: true };
  expect(isPointerDone(done, 4)).toBe(true);
  expect(isPointerDone(done, 5)).toBe(false);
  expect(isPointerDone({ ...done, ok: 'true' }, 4)).toBe(false);
  expect(isPointerDone({ ...done, extra: true }, 4)).toBe(false);
});
