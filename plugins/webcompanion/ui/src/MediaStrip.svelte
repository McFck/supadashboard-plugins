<script lang="ts">
  import { Button, type PluginBrowserAction, type PluginBrowserSnapshot } from '@supadashboard/kit';
  import { webCompanion } from './webcompanion.svelte';

  type Media = NonNullable<Extract<PluginBrowserSnapshot, { kind: 'connected' }>['media']>;
  let { media }: { media: Media } = $props();
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function send(input: Extract<PluginBrowserAction, { kind: 'media' }>['input']) {
    return webCompanion.action({ kind: 'media', input });
  }

  function changeSpeed(event: Event) {
    if (event.currentTarget instanceof HTMLSelectElement) {
      void send({ kind: 'speed', rate: Number(event.currentTarget.value) });
    }
  }
</script>

<div
  role="group"
  aria-label="Browser media"
>
  <Button
    size="xs"
    variant="outline"
    onclick={() => send({ kind: 'toggle' })}
  >
    {media.paused ? 'Play' : 'Pause'}
  </Button>
  <Button
    size="xs"
    variant="outline"
    aria-label="Back 10 seconds"
    onclick={() => send({ kind: 'seek', seconds: -10 })}>−10 s</Button
  >
  <Button
    size="xs"
    variant="outline"
    aria-label="Forward 10 seconds"
    onclick={() => send({ kind: 'seek', seconds: 10 })}>+10 s</Button
  >
  <select
    aria-label="Playback speed"
    value={media.rate}
    onchange={changeSpeed}
  >
    {#if !rates.includes(media.rate)}
      <option value={media.rate}>{media.rate}×</option>
    {/if}
    {#each rates as rate (rate)}
      <option value={rate}>{rate}×</option>
    {/each}
  </select>
  <Button
    size="xs"
    variant="outline"
    aria-pressed={media.fullscreen}
    onclick={() => send({ kind: 'fullscreen' })}
  >
    Fullscreen
  </Button>
</div>

<style>
  div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }
</style>
