<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, type PluginBrowserAction } from '@supadashboard/kit';
  import { PagePadController } from './page-pad.svelte';
  import { webCompanion } from './webcompanion.svelte';

  let pad = $state<HTMLButtonElement | null>(null);
  const buttons = [
    { key: 'Home', label: 'Top', input: { kind: 'top' } },
    { key: 'PageUp', label: 'Page up', input: { kind: 'page_up' } },
    { key: 'PageDown', label: 'Page down', input: { kind: 'page_down' } },
    { key: 'End', label: 'Bottom', input: { kind: 'bottom' } },
  ] satisfies {
    key: string;
    label: string;
    input: Extract<PluginBrowserAction, { kind: 'page' }>['input'];
  }[];

  function send(input: (typeof buttons)[number]['input']) {
    return webCompanion.action({ kind: 'page', input });
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
      const controller = new PagePadController(pad, webCompanion.scroll);
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
