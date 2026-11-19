<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Icon, type ControlConfig } from '@supadashboard/kit';
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

<button
  bind:this={pad}
  type="button"
  class="tile-content browser-touchpad"
  style:--touchpad-background={background}
  aria-label="Browser touchpad"
  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Enter Space Escape"
  disabled={tab === null}
  onkeydown={(event) => touch?.key(event)}
  onclick={click}
>
  {#if tab === null}
    <span class="offline">
      <Icon
        name="Unplug"
        size={20}
      />
      <span class="text-center">WebCompanion not connected</span>
    </span>
  {:else}
    <Icon
      name="webcompanion-touchpad"
      size={32}
    />
  {/if}
</button>

<style>
  .browser-touchpad {
    all: unset;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: var(--tile-radius, 22px);
    touch-action: none;
    user-select: none;
    color: var(--muted-foreground);
    background:
      radial-gradient(
          circle,
          color-mix(in oklab, var(--foreground) 10%, transparent) 1px,
          transparent 1.4px
        )
        0 0 / 16px 16px,
      linear-gradient(var(--touchpad-background), var(--touchpad-background)),
      var(--tile-surface);
  }
  .browser-touchpad > :global(svg) {
    opacity: 0.3;
    pointer-events: none;
  }
  .offline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    padding-inline: 16px;
    box-sizing: border-box;
    font-size: 14px;
  }
  .offline > :global(svg) {
    flex: none;
  }
  .browser-touchpad:active:not(:disabled) {
    box-shadow: inset 0 0 0 999px color-mix(in oklab, var(--foreground) 3%, transparent);
  }
  .browser-touchpad:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
  .browser-touchpad:disabled {
    background: var(--tile-surface);
  }
</style>
