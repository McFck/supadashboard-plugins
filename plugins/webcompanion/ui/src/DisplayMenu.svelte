<script lang="ts">
  import { Button, Icon } from '@supadashboard/kit';

  let {
    title,
    anchor,
    displays,
    onchoose,
    onclose,
  }: {
    title: string;
    anchor: DOMRect;
    displays: { id: string; label: string }[];
    onchoose: (display: string) => void;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let panel = $state<HTMLElement>();
  const margin = 8;
  // The finger that opened the menu lifts over the backdrop; only a tap that also began there dismisses it.
  let outside = false;

  // Modal, so a tap outside only closes it and Escape and focus work natively; top layer, so the tile's clip
  // cannot cut it. Placed below the icon, or above it when the screen ends first.
  $effect(() => {
    if (!dialog || !panel || displays.length === 0) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    const { width, height } = panel.getBoundingClientRect();
    const below = anchor.bottom + margin;
    const top =
      below + height <= innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - margin - height);
    const left = Math.min(Math.max(margin, anchor.left), innerWidth - width - margin);
    panel.style.top = `${top}px`;
    panel.style.left = `${Math.max(margin, left)}px`;
  });

  function choose(display: string) {
    onchoose(display);
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="display-menu"
  aria-label={`Move ${title || 'tab'} to display`}
  {onclose}
  onpointerdown={(event) => {
    event.stopPropagation();
    outside = event.target === dialog;
  }}
  onclick={(event) => {
    if (outside && event.target === dialog) {
      dialog.close();
    }
  }}
>
  <div
    bind:this={panel}
    class="panel"
  >
    {#each displays as display (display.id)}
      <Button
        variant="ghost"
        class="h-12 w-full justify-start gap-3 rounded-[10px] px-3 text-[15px]"
        onclick={() => choose(display.id)}
      >
        <Icon
          name="Monitor"
          size={18}
        />
        <span class="truncate">{display.label}</span>
      </Button>
    {/each}
  </div>
</dialog>

<style>
  .display-menu {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    outline: none;
  }
  .display-menu::backdrop {
    background: transparent;
  }
  .panel {
    position: absolute;
    display: grid;
    gap: 2px;
    min-width: 220px;
    max-width: min(320px, calc(100vw - 16px));
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--popover);
    color: var(--popover-foreground);
    box-shadow:
      0 2px 4px rgb(0 0 0 / 0.3),
      0 12px 32px rgb(0 0 0 / 0.45);
  }
</style>
