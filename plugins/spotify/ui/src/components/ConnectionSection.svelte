<script lang="ts">
  import { onMount } from 'svelte';
  import { toast, Button, Input, Row, Section } from '@supadashboard/kit';
  import { spotifyAuthorize, spotifyLogout, subscribeSpotify, type SpotifyView } from '../spotify';

  let view = $state<SpotifyView>({ state: 'needsAuth' });
  let clientId = $state('');
  let busy = $state(false);
  const connected = $derived(view.state === 'ready');
  const status = $derived(
    view.state === 'ready'
      ? `Connected as ${view.user}`
      : view.state === 'connecting'
        ? 'Connecting'
        : 'Not connected',
  );
  const trimmed = $derived(clientId.trim());

  onMount(() => {
    let lastError: string | undefined;
    return subscribeSpotify((next) => {
      view = next;
      if (next.error && next.error !== lastError) {
        toast.error(next.error);
      }
      lastError = next.error;
    });
  });

  async function run(job: () => Promise<void>, failure: string) {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await job();
    } catch (error) {
      toast.error(
        typeof error === 'string' ? error : error instanceof Error ? error.message : failure,
      );
    } finally {
      busy = false;
    }
  }
</script>

<Section title="Connection">
  <Row
    label="Client ID"
    for="spotify-client-id"
  >
    <Input
      id="spotify-client-id"
      bind:value={clientId}
      autocomplete="off"
      spellcheck={false}
      disabled={connected || busy}
    />
  </Row>
  <Row label="Status"><span class="text-sm">{status}</span></Row>
  <Row label={connected ? 'Disconnect' : 'Connect'}>
    {#if connected}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => run(spotifyLogout, 'Could not disconnect')}>Disconnect</Button
      >
    {:else}
      <Button
        size="sm"
        disabled={busy || !trimmed || view.state === 'connecting'}
        onclick={() => run(() => spotifyAuthorize(trimmed), 'Could not connect')}>Connect</Button
      >
    {/if}
  </Row>
</Section>
