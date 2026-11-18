<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Input, Row, Section } from '@supadashboard/kit';
  import { browserRemote } from './browser-remote.svelte';

  onMount(() => browserRemote.mount());
</script>

<Section title="Connection">
  <Row label="Status">
    {#if browserRemote.snapshot.kind === 'repair'}
      <span>Pair the browser again</span>
    {:else}
      <span>{browserRemote.snapshot.kind === 'connected' ? 'Connected' : 'Offline'}</span>
    {/if}
  </Row>
  {#if browserRemote.snapshot.kind !== 'connected'}
    <Row
      label="Pair"
      for="browser-pair"
    >
      <Button
        id="browser-pair"
        disabled={!browserRemote.ready}
        onclick={() => browserRemote.pair()}
      >
        Generate pairing code
      </Button>
    </Row>
    {#if browserRemote.code}
      <Row
        label="Pairing code"
        for="browser-code"
      >
        <Input
          id="browser-code"
          readonly
          value={browserRemote.code}
        />
      </Row>
    {/if}
  {/if}
</Section>
