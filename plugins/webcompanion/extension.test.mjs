// Guards the extension's trust boundaries: the pairing proof the Rust bridge checks, page media reports and website URLs.
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { answer, isMedia, website } from './extension/protocol.js';

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
