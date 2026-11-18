<script lang="ts">
  import { onMount } from 'svelte';
  import { toast, Button, Input, Row, Section } from '@supadashboard/kit';
  import { authorize, logout, subscribeVoice, type VoiceView } from '../discord';

  let view = $state<VoiceView>({ state: 'absent' });
  let clientId = $state('');
  let busy = $state(false);
  const connected = $derived(view.state === 'idle' || view.state === 'inVoice');
  const status = $derived.by(() => {
    switch (view.state) {
      case 'absent':
        return 'Not running';
      case 'needsAuth':
        return 'Plugin not set up';
      case 'authorizing':
        return 'Waiting for Discord';
      case 'connecting':
        return 'Connecting';
      default:
        return `Connected as ${view.user.name}`;
    }
  });
  const trimmed = $derived(clientId.trim());

  onMount(() => subscribeVoice((next) => (view = next)));

  async function run(job: () => Promise<void>, failure: string) {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await job();
    } catch (error) {
      console.error(error);
      toast.error(failure);
    } finally {
      busy = false;
    }
  }
</script>

<Section title="Connection">
  <Row
    label="Client ID"
    for="discord-client-id"
  >
    <Input
      id="discord-client-id"
      bind:value={clientId}
      inputmode="numeric"
      autocomplete="off"
      disabled={connected}
    />
  </Row>
  <Row label="Status"><span class="text-sm">{status}</span></Row>
  <Row label={connected ? 'Disconnect' : 'Connect'}>
    {#if connected}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => run(logout, 'Could not disconnect')}>Disconnect</Button
      >
    {:else}
      <Button
        size="sm"
        disabled={busy || !trimmed || view.state === 'authorizing'}
        onclick={() => run(() => authorize(trimmed), 'Could not connect')}>Connect</Button
      >
    {/if}
  </Row>
</Section>
