<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Icon, type ControlConfig } from '@supadashboard/kit';
  import { offsetOf } from '../lyric-clock';
  import { LyricsTileController } from './lyrics-tile.svelte';
  import OffsetRuler from './OffsetRuler.svelte';

  let {
    control,
    pageVisible = true,
    pixelWidth = 0,
    pixelHeight = 0,
  }: {
    control: ControlConfig;
    pageVisible?: boolean;
    pixelWidth?: number;
    pixelHeight?: number;
  } = $props();
  const lyrics = new LyricsTileController({
    visible: () => pageVisible,
    offsetMs: () => offsetOf(control.options),
  });
  onDestroy(() => lyrics.destroy());

  const size = $derived(
    Math.round(Math.min(30, Math.max(14, Math.min(pixelWidth * 0.07, pixelHeight * 0.16)))),
  );
  const status = $derived.by(() => {
    switch (lyrics.view.kind) {
      case 'idle':
        return 'Nothing playing';
      case 'none':
        return 'No lyrics';
      case 'instrumental':
        return 'Instrumental';
      default:
        return '';
    }
  });

  $effect(() => {
    void [pixelWidth, pixelHeight];
    lyrics.recenter();
  });
</script>

<div
  data-dashboard-tile
  data-lyrics-tile={lyrics.view.kind}
  style="-webkit-app-region: no-drag"
  style:--size="{size}px"
  style:--height="{pixelHeight}px"
  class="tile-content h-full w-full"
>
  {#if lyrics.view.kind === 'synced' || lyrics.view.kind === 'plain'}
    <div
      use:lyrics.scroller
      role="region"
      aria-label="Lyrics"
      class="scroller"
    >
      <div
        class="content"
        class:synced={lyrics.view.kind === 'synced'}
      >
        {#if lyrics.view.kind === 'synced'}
          {#each lyrics.view.lines as line, index (index)}
            <p
              class="line"
              class:past={index < lyrics.active}
              class:active={index === lyrics.active}
              aria-current={index === lyrics.active ? 'true' : undefined}
            >
              {line.text.trim() || '♪'}
            </p>
          {/each}
        {:else}
          <p class="plain">
            {lyrics.view.text}
          </p>
        {/if}
      </div>
    </div>
    {#if lyrics.offset.open && lyrics.view.kind === 'synced'}
      <OffsetRuler offset={lyrics.offset} />
    {/if}
  {:else if lyrics.view.kind === 'loading'}
    <div
      class="loading"
      role="img"
      aria-label="Loading lyrics"
    >
      <span style:width="78%"></span>
      <span style:width="92%"></span>
      <span style:width="58%"></span>
    </div>
  {:else}
    <div class="grid h-full w-full place-items-center">
      <div class="flex flex-col items-center gap-1.5 text-zinc-500">
        <span class="opacity-60">
          <Icon
            name="spotify"
            size={Math.round(Math.min(36, Math.max(22, Math.min(pixelWidth, pixelHeight) * 0.22)))}
          />
        </span>
        <span class="text-xs whitespace-nowrap">{status}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .scroller {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* KineticScroll owns every drag, so neither the browser nor the page pager pans. */
    touch-action: none;
    user-select: none;
    padding-inline: max(14px, calc(var(--size) * 0.85));
    /* Lines fade in and out at the edges instead of being cut. */
    mask-image: linear-gradient(
      to bottom,
      transparent,
      #000 calc(var(--size) * 1.8),
      #000 calc(100% - var(--size) * 1.8),
      transparent
    );
  }
  /* Room above the first and below the last line, so both can rest at the sung line's height. */
  .synced::before,
  .synced::after {
    content: '';
    display: block;
  }
  .synced::before {
    height: calc(var(--height) * 0.4);
  }
  .synced::after {
    height: calc(var(--height) * 0.6);
  }
  .content {
    position: relative;
    will-change: transform;
  }
  /* Opacity and transform, not colour: both animate on the compositor, while a colour change repaints all lines. */
  .line {
    margin: 0 0 calc(var(--size) * 0.5);
    color: #fff;
    opacity: 0.26;
    font-size: var(--size);
    font-weight: 700;
    line-height: 1.22;
    letter-spacing: -0.012em;
    overflow-wrap: anywhere;
    transform: scale(0.965);
    transform-origin: left center;
    transition:
      opacity 360ms ease,
      transform 480ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .past {
    opacity: 0.4;
  }
  .active {
    opacity: 1;
    transform: none;
  }
  .plain {
    margin: 0;
    padding-block: calc(var(--size) * 1.9);
    color: rgb(255 255 255 / 0.78);
    font-size: calc(var(--size) * 0.82);
    font-weight: 600;
    line-height: 1.45;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .loading {
    display: grid;
    align-content: center;
    gap: calc(var(--size) * 0.55);
    height: 100%;
    padding-inline: max(14px, calc(var(--size) * 0.85));
    animation: appear 300ms ease 250ms both;
  }
  .loading span {
    height: calc(var(--size) * 0.62);
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.07);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .loading span:nth-child(2) {
    animation-delay: 160ms;
  }
  .loading span:nth-child(3) {
    animation-delay: 320ms;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line {
      transition: none;
    }
    .loading,
    .loading span {
      animation: none;
    }
  }
</style>
