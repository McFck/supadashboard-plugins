<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, Icon, type ControlConfig } from '@supadashboard/kit';
  import { TouchpadController } from './touchpad.svelte';
  import { webCompanion } from './webcompanion.svelte';
  import { padBackground } from './pad-background';

  let { control }: { control?: ControlConfig } = $props();
  const background = $derived(padBackground(control?.options));
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
    const controller = new TouchpadController(
      pad,
      (action) =>
        webCompanion.action(action, action.input.kind === 'click' || action.input.kind === 'down'),
      webCompanion.scroll,
      (input) => void webCompanion.action({ kind: 'tab', input }),
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
  variant="ghost"
  class="browser-touchpad"
  style={`--touchpad-background: ${background}`}
  aria-label="Browser touchpad"
  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Enter Space Escape"
  disabled={tab === null}
  onkeydown={(event) => touch?.key(event)}
  onclick={click}
>
  <span class="pad-face">
    <Icon
      name="webcompanion-touchpad"
      size={26}
    />
    Touchpad
  </span>
</Button>

<style>
  :global(button.browser-touchpad) {
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    background-color: var(--touchpad-background);
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, currentColor 22%, transparent) 1px,
      transparent 1.3px
    );
    background-size: 12px 12px;
  }
  .pad-face {
    display: grid;
    gap: 0.25rem;
    justify-items: center;
    pointer-events: none;
  }
</style>
