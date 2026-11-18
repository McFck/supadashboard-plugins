<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, type PluginBrowserScroll } from '@supadashboard/kit';
  import { ScrollPadController } from './scroll-pad.svelte';
  import { webCompanion } from './webcompanion.svelte';

  let { tab }: { tab: number } = $props();
  let pad = $state<HTMLButtonElement | null>(null);
  const buttons = [
    { key: 'Home', label: 'Top', input: { kind: 'top' } },
    { key: 'PageUp', label: 'Page up', input: { kind: 'page_up' } },
    { key: 'PageDown', label: 'Page down', input: { kind: 'page_down' } },
    { key: 'End', label: 'Bottom', input: { kind: 'bottom' } },
  ] satisfies { key: string; label: string; input: PluginBrowserScroll }[];

  function send(input: PluginBrowserScroll, signal?: AbortSignal) {
    return webCompanion.action({ kind: 'scroll', tab, input }, signal);
  }

  function keydown(event: KeyboardEvent) {
    const command = buttons.find((button) => button.key === event.key);
    if (command) {
      event.preventDefault();
      void send(command.input);
    }
  }

  onMount(() => {
    if (pad) {
      const controller = new ScrollPadController(pad, send);
      return () => controller.destroy();
    }
  });
</script>

<div class="scroll-buttons">
  {#each buttons as button (button.key)}
    <Button
      size="xs"
      variant="outline"
      onclick={() => send(button.input)}>{button.label}</Button
    >
  {/each}
</div>
<Button
  class="scroll-pad"
  bind:ref={pad}
  variant="outline"
  style="touch-action: none; min-height: 3rem; width: 100%; flex: 1 0 auto;"
  aria-keyshortcuts="Home PageUp PageDown End"
  onkeydown={keydown}
>
  Scroll pad
</Button>

<style>
  .scroll-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
</style>
