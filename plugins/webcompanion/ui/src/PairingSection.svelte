<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Input, Row, Section } from '@supadashboard/kit';
  import { webCompanion } from './webcompanion.svelte';

  onMount(() => webCompanion.mount());
  const connected = $derived(webCompanion.snapshot.kind === 'connected');
  const status = $derived.by(() => {
    if (webCompanion.snapshot.kind === 'repair') {
      return 'Pair the browser again';
    }
    return connected ? 'Paired' : 'Offline';
  });
</script>

<Section title="Connection">
  <Row label="Status">
    <span
      class="flex items-center gap-2"
      role="status"
    >
      <span
        class="status-dot"
        class:connected
        aria-hidden="true"
      ></span>
      {status}
    </span>
  </Row>
  {#if !connected}
    <Row
      label="Pairing"
      for="browser-pair"
    >
      <Button
        id="browser-pair"
        disabled={!webCompanion.ready || webCompanion.pairingPending}
        onclick={() => webCompanion.pair()}
      >
        Generate code
      </Button>
    </Row>
    {#if webCompanion.pairing}
      <Row
        label="Pairing code"
        for="browser-code"
      >
        {#key webCompanion.pairing}
          <div class="code">
            <Input
              id="browser-code"
              readonly
              class="font-mono text-center text-xl tabular-nums"
              value={webCompanion.pairing.code.replace(/(.{3})/, '$1 ')}
            />
            <div
              class="expiry"
              style:animation-duration={`${webCompanion.pairing.expiresInMs}ms`}
              aria-hidden="true"
            ></div>
          </div>
        {/key}
      </Row>
    {/if}
  {/if}
</Section>

<style>
  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.35;
  }
  .status-dot.connected {
    opacity: 1;
  }
  .code {
    overflow: hidden;
    border-radius: 0.375rem;
  }
  .expiry {
    height: 2px;
    background: currentColor;
    transform-origin: left;
    animation: expire linear forwards;
  }
  @keyframes expire {
    to {
      transform: scaleX(0);
    }
  }
</style>
