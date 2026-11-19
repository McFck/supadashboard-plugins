<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Icon, Row, Section, toast } from '@supadashboard/kit';
  import { webCompanion } from './webcompanion.svelte';

  onMount(() => webCompanion.mount());

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copied');
    } catch {
      toast.error('Could not copy code');
    }
  }
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
      class="flex items-center gap-2 text-sm"
      role="status"
    >
      <span
        class="dot"
        data-state={webCompanion.snapshot.kind}
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
        wide
      >
        {@const code = webCompanion.pairing.code}
        <div class="flex items-center gap-2">
          {#key webCompanion.pairing}
            <output
              class="otp"
              aria-label={code.replace(/(.{3})/, '$1 ')}
            >
              {#each [code.slice(0, 3), code.slice(3)] as group, index (index)}
                {#if index}
                  <span
                    class="separator"
                    aria-hidden="true"
                  >
                    <Icon
                      name="Minus"
                      size={16}
                    />
                  </span>
                {/if}
                <span
                  class="group"
                  aria-hidden="true"
                >
                  {#each group as digit, slot (slot)}
                    <span class="slot">{digit}</span>
                  {/each}
                </span>
              {/each}
              <i
                class="expiry"
                style:animation-duration={`${webCompanion.pairing.expiresInMs}ms`}
                aria-hidden="true"
              ></i>
            </output>
          {/key}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy pairing code"
            onclick={() => copy(code)}
          >
            <Icon
              name="Copy"
              size={16}
            />
          </Button>
        </div>
      </Row>
    {/if}
  {/if}
</Section>

<style>
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted-foreground);
    opacity: 0.5;
  }
  .dot[data-state='connected'] {
    background: var(--info);
    opacity: 1;
    box-shadow: 0 0 6px var(--info);
  }
  .dot[data-state='repair'] {
    background: var(--destructive);
    opacity: 1;
  }
  /* The slot look of shadcn's InputOTP: joined slots, outer corners rounded, a separator between groups. */
  .otp {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    user-select: all;
  }
  .group {
    display: flex;
  }
  .slot {
    display: grid;
    place-items: center;
    width: 44px;
    height: 48px;
    border: 1px solid var(--input);
    border-left-width: 0;
    background: color-mix(in oklab, var(--input) 30%, transparent);
    font: 500 20px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--foreground);
  }
  .slot:first-child {
    border-left-width: 1px;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  .slot:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }
  .separator {
    display: grid;
    color: var(--muted-foreground);
  }
  .expiry {
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    border-radius: 1px;
    background: var(--primary);
    transform-origin: left;
    animation: expire linear forwards;
  }
  @keyframes expire {
    to {
      transform: scaleX(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .expiry {
      animation: none;
    }
  }
</style>
