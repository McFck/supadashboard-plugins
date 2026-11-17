// The voice controls. They run inside the client's serialized actor.
import type { Client } from './client';
import { validChannel } from './model';
import { applyEvent } from './voice';

export type VoiceCommand = 'toggleMute' | 'toggleDeaf' | 'leave' | 'rejoin';

async function refreshSettings(client: Client) {
  const settings = await client.request('GET_VOICE_SETTINGS', {});
  client.voice = applyEvent(client.voice, 'VOICE_SETTINGS_UPDATE', settings);
}

async function toggle(client: Client, command: 'toggleMute' | 'toggleDeaf') {
  if (!client.voice.settings) {
    await refreshSettings(client);
  }
  if (!client.voice.settings) {
    throw new Error('Invalid Discord voice settings');
  }
  const [muted, deafened] = client.voice.settings;
  let args: Record<string, boolean>;
  if (command === 'toggleMute') {
    args = { mute: !muted };
  } else if (deafened) {
    // Like Discord: restore the mute from before deafening. While deafened Discord reports muted too, so an
    // unknown earlier state (deafened before we connected) means unmuted.
    args = { deaf: false, mute: client.muteBeforeDeaf ?? false };
  } else {
    args = { deaf: true };
  }
  await client.request('SET_VOICE_SETTINGS', args);
  if (command === 'toggleDeaf') {
    client.muteBeforeDeaf = deafened ? undefined : muted;
  }
  await refreshSettings(client);
}

export async function executeVoice(client: Client, command: VoiceCommand) {
  if (command === 'toggleMute' || command === 'toggleDeaf') {
    await toggle(client, command);
    return;
  }
  if (command === 'leave') {
    // Already out of voice: the action's goal is met, so it is not an error.
    if (!client.voice.channel) {
      return;
    }
    await client.request('SELECT_VOICE_CHANNEL', { channel_id: null });
  } else {
    const channel = client.voice.lastChannel;
    if (!channel || channel.kind !== 'guild' || !validChannel(channel)) {
      throw new Error('No channel to rejoin');
    }
    if (client.voice.channel?.id === channel.id) {
      return;
    }
    await client.request('SELECT_VOICE_CHANNEL', {
      channel_id: channel.id,
      force: true,
      timeout: 5,
    });
  }
  await client.selected();
}
