<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, type PluginBrowserOutline } from '@supadashboard/kit';
  import { PagePadController } from './page-pad.svelte';
  import { ViewTouchController } from './view-touch.svelte';
  import { webCompanion } from './webcompanion.svelte';

  let surface = $state<HTMLDivElement>();
  let scrollStrip = $state<HTMLButtonElement | null>(null);
  let touch = $state<ViewTouchController>();
  const view = $derived(
    webCompanion.snapshot.kind === 'connected'
      ? (webCompanion.snapshot.outline ?? undefined)
      : undefined,
  );
  const projection = $derived(touch?.projection ?? { x: 0, y: 0, scale: 1 });

  function position({ x, y, w, h }: PluginBrowserOutline['shapes'][number]['rect']) {
    return `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  }

  onMount(() => {
    if (!surface || !scrollStrip) {
      return;
    }
    const unwatch = webCompanion.mountOutline();
    const controller = new ViewTouchController(surface, {
      command: (input) => webCompanion.action({ kind: 'page', input }, input.kind === 'press'),
      stopScroll: () => webCompanion.scroll({ phase: 'hold', outline: true }),
    });
    const pad = new PagePadController(scrollStrip, (frame) => {
      if (frame.phase === 'hold') {
        controller.cancelSelection();
        return webCompanion.scroll({ ...frame, outline: true });
      }
      return webCompanion.scroll(frame);
    });
    touch = controller;
    return () => {
      controller.destroy();
      pad.destroy();
      unwatch();
    };
  });

  $effect(() => {
    const controller = touch;
    const snapshot = view;
    untrack(() => controller?.setView(snapshot));
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      touch?.cancelSelection();
    }
  }

  function scrollKey(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      touch?.cancelSelection();
      webCompanion.scroll({ phase: 'hold', outline: true });
      webCompanion.scroll({ phase: 'move', dx: 0, dy: event.key === 'ArrowUp' ? -80 : 80 });
    }
  }
</script>

<div
  class="outline-widget"
  role="group"
  aria-label="Page Outline"
>
  <div
    class="outline-surface"
    bind:this={surface}
  >
    {#if view}
      <div
        class="page"
        style:width="{view.width}px"
        style:height="{view.height}px"
        style:transform="translate({projection.x}px, {projection.y}px) scale({projection.scale})"
        style:--stroke="{1 / projection.scale}px"
        style:--label-size="{11 / projection.scale}px"
      >
        {#each view.shapes as shape}
          <div
            class="shape {shape.kind}"
            style={position(shape.rect)}
            aria-hidden="true"
          ></div>
        {/each}
        {#each view.targets as target (view.doc + ':' + target.id)}
          <button
            type="button"
            class="target"
            class:link={target.kind === 'link'}
            class:selected={touch?.selected === target.id}
            style={position(target.rect)}
            aria-label={target.label}
            disabled={view.moving}
            onfocus={() => touch?.focus(target)}
            onblur={() => touch?.cancelSelection()}
            onkeydown={keydown}
            onclick={(event) => {
              if (event.detail === 0) {
                touch?.activate(target);
              }
            }}
          >
            {#if (touch?.zoom ?? 1) > 1.4 && target.rect.w * projection.scale >= 26 && target.rect.h * projection.scale >= 14}
              <span aria-hidden="true">{target.label}</span>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <span class="empty">No page view</span>
    {/if}
  </div>
  {#if (touch?.zoom ?? 1) > 1.01}
    <div class="reset">
      <Button
        size="xs"
        variant="secondary"
        onclick={touch?.resetZoom}>Reset zoom</Button
      >
    </div>
  {/if}
  <Button
    class="outline-scroll"
    variant="outline"
    bind:ref={scrollStrip}
    style="touch-action:none;height:100%;width:2.25rem;padding:0"
    aria-label="Scroll browser page"
    aria-keyshortcuts="ArrowUp ArrowDown"
    onkeydown={scrollKey}
  >
    <span aria-hidden="true">↕</span>
  </Button>
</div>

<style>
  .outline-widget {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    gap: 0.25rem;
  }
  .outline-surface {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: clip;
    border-radius: 0.375rem;
    background: var(--muted);
    touch-action: none;
  }
  .page {
    position: absolute;
    transform-origin: top left;
    background: var(--background);
  }
  .shape,
  .target {
    position: absolute;
    box-sizing: border-box;
  }
  .shape {
    pointer-events: none;
    color: var(--muted-foreground);
    opacity: 0.3;
    background: repeating-linear-gradient(to bottom, currentColor 0 2px, transparent 2px 10px);
  }
  .shape.heading {
    opacity: 0.55;
    background: currentColor;
  }
  .shape.image {
    background: var(--muted-foreground);
  }
  .target {
    overflow: hidden;
    padding: 0;
    border: var(--stroke) solid var(--muted-foreground);
    border-radius: calc(var(--stroke) * 2);
    background: var(--secondary);
    color: var(--secondary-foreground);
    font-size: var(--label-size);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .target.link {
    border-style: dashed;
  }
  .target.selected,
  .target:focus-visible {
    z-index: 1;
    outline: calc(var(--stroke) * 2) solid var(--primary);
    outline-offset: 0;
  }
  .target:disabled {
    opacity: 0.65;
  }
  .empty {
    display: grid;
    height: 100%;
    place-items: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .reset {
    position: absolute;
    z-index: 2;
    inset: auto 2.75rem 0.25rem auto;
  }
</style>
