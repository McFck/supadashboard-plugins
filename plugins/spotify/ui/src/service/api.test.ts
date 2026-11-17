import { expect, it } from 'vitest';
import { check, contains, player, shuffle, validUri } from './api';

it('rejects malformed device ids before targeting playback', () => {
  const body = (id: unknown) => JSON.stringify({ item: null, is_playing: false, device: { id } });
  expect(player(body('desktop')).deviceId).toBe('desktop');
  for (const id of ['', 'bad\nname', 42]) {
    expect(() => player(body(id))).toThrow();
  }
});

it('rejects unknown shuffle state and treats smart shuffle as enabled', () => {
  for (const [body, expected] of [
    ['{"shuffle_state":false}', false],
    ['{"shuffle_state":true}', true],
    ['{"shuffle_state":false,"smart_shuffle":true}', true],
  ] as const) {
    expect(shuffle(body)).toBe(expected);
  }
  for (const body of [
    '{}',
    '{"shuffle_state":"false"}',
    '{"shuffle_state":true,"smart_shuffle":1}',
  ]) {
    expect(() => shuffle(body)).toThrow();
  }
});

it('rejects bad track uris and malformed library results', () => {
  const body =
    '{"item":{"uri":"spotify:track:0123456789ABCDEFGHIJKL","type":"track"},"is_playing":true,"smart_shuffle":true,"unknown":"discard"}';
  const parsed = player(body);
  expect(parsed.playing && parsed.smartShuffle).toBe(true);
  expect(validUri(parsed.uri ?? '')).toBe(true);
  expect(() => player(body.replace('0123456789ABCDEFGHIJKL', 'bad'))).toThrow();
  expect(contains('[true]')).toBe(true);
  for (const bad of ['[]', '[true,false]', '[1]', '{}']) {
    expect(() => contains(bad)).toThrow();
  }
});

it('maps auth, device, premium and retry errors', () => {
  for (const [status, body, retryAfter, failure, seconds] of [
    [401, '', null, 'unauthorized', 0],
    [403, '{"error":{"reason":"PREMIUM_REQUIRED"}}', null, 'premium', 0],
    [404, '', null, 'noPlayer', 0],
    [429, '', '123', 'rateLimited', 123],
  ] as const) {
    expect(() => check({ status, body, retryAfter })).toThrow(
      expect.objectContaining({ failure, retryAfter: seconds }),
    );
  }
});
