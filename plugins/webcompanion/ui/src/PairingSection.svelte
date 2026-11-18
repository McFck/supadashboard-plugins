<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Input, Row, Section } from '@supadashboard/kit';
  import { webCompanion } from './webcompanion.svelte';

  onMount(() => webCompanion.mount());
</script>

<Section title="Connection">
  <Row label="Status">
    {#if webCompanion.snapshot.kind === 'repair'}
      <span>Pair the browser again</span>
    {:else}
      <span>{webCompanion.snapshot.kind === 'connected' ? 'Connected' : 'Offline'}</span>
    {/if}
  </Row>
  {#if webCompanion.snapshot.kind !== 'connected'}
    <Row
      label="Pair"
      for="browser-pair"
    >
      <Button
        id="browser-pair"
        disabled={!webCompanion.ready}
        onclick={() => webCompanion.pair()}
      >
        Generate pairing code
      </Button>
    </Row>
    {#if webCompanion.code}
      <Row
        label="Pairing code"
        for="browser-code"
      >
        <Input
          id="browser-code"
          readonly
          value={webCompanion.code}
        />
      </Row>
    {/if}
  {/if}
</Section>
