<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '@supadashboard/kit';
  import { TouchpadController } from './touchpad.svelte';
  import { webCompanion } from './webcompanion.svelte';

  let pad = $state<HTMLButtonElement | null>(null);
  let touch = $state<TouchpadController>();
  const tab = $derived(
    webCompanion.snapshot.kind === 'connected' ? webCompanion.snapshot.activeTab : null,
  );

  onMount(() => {
    if (!pad) {
      return;
    }
    const unmount = webCompanion.mount();
    const controller = new TouchpadController(pad, (action) =>
      webCompanion.action(action, action.input.kind === 'click' || action.input.kind === 'down'),
    );
    touch = controller;
    return () => {
      controller.destroy();
      unmount();
    };
  });

  $effect(() => {
    const controller = touch;
    const active = tab;
    untrack(() => controller?.setTab(active));
  });

  function click(event: MouseEvent) {
    if (event.detail === 0) {
      touch?.click();
    }
  }
</script>

<Button
  bind:ref={pad}
  variant="outline"
  class="browser-touchpad"
  style="width:100%;height:100%;touch-action:none;user-select:none;"
  aria-label="Browser touchpad"
  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape"
  disabled={tab === null}
  onkeydown={(event) => touch?.key(event)}
  onclick={click}
>
  <span class="pad-face">
    <span
      class="pointer"
      aria-hidden="true">↖</span
    >
    Browser touchpad
  </span>
</Button>

<style>
  .pad-face {
    display: grid;
    gap: 0.25rem;
    justify-items: center;
    pointer-events: none;
  }
  .pointer {
    font-size: 1.65rem;
    line-height: 1;
  }
</style>
