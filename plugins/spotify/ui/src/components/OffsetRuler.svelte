<script lang="ts">
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { SONG_OFFSET_LIMIT_MS } from '../lyrics';
  import { OffsetRuler, STEP_PX } from './offset-ruler';
  import type { SongOffset } from './song-offset.svelte';

  let { offset }: { offset: SongOffset } = $props();
  // The offset outlives this slider, which opens and closes over it.
  // svelte-ignore state_referenced_locally
  const ruler = new OffsetRuler(offset);
  const limit = SONG_OFFSET_LIMIT_MS / 1000;
  const seconds = Array.from({ length: 2 * limit + 1 }, (_, n) => n - limit);
  const text = $derived(`${offset.value > 0 ? '+' : ''}${(offset.value / 1000).toFixed(1)} s`);
</script>

<div
  use:offset.panel
  role="group"
  aria-label="Song sync offset"
  class="adjust"
  style:--step="{STEP_PX}px"
>
  <div class="dial">
    <span
      class="value"
      aria-hidden="true">{text}</span
    >
    <div
      use:ruler.attach
      role="slider"
      tabindex="0"
      aria-label="Song sync offset"
      aria-valuemin={-SONG_OFFSET_LIMIT_MS}
      aria-valuemax={SONG_OFFSET_LIMIT_MS}
      aria-valuenow={offset.value}
      aria-valuetext={text}
      class="ruler"
      onkeydown={ruler.key}
    >
      <div class="strip">
        <div
          class="scale"
          style:width="calc({2 * limit * 10} * var(--step))"
        >
          {#each seconds as second (second)}
            <span
              class="mark"
              class:zero={second === 0}
              style:left="calc({second + limit} * 10 * var(--step))">{second}</span
            >
          {/each}
        </div>
      </div>
      <span class="needle"></span>
    </div>
  </div>
  <button
    type="button"
    class="reset"
    aria-label="Reset song sync offset"
    disabled={offset.value === 0}
    onclick={ruler.reset}
  >
    <RotateCcw size={14} />
  </button>
</div>

<style>
  .adjust {
    position: absolute;
    inset-inline: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 6px 6px;
    border-radius: 22px;
    background: rgb(24 24 27 / 0.82);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.08),
      0 8px 24px rgb(0 0 0 / 0.4);
    backdrop-filter: blur(16px);
    animation: appear 160ms ease both;
  }
  .adjust:has(.ruler:focus-visible) {
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.4),
      0 8px 24px rgb(0 0 0 / 0.4);
  }
  .dial {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .value {
    color: rgb(255 255 255 / 0.92);
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  /* KineticScroll owns every drag; the scale fades out towards both ends instead of being cut. */
  .ruler {
    position: relative;
    align-self: stretch;
    height: 36px;
    overflow: hidden;
    outline: none;
    touch-action: none;
    user-select: none;
    mask-image: linear-gradient(to right, transparent, #000 24%, #000 76%, transparent);
  }
  /* Half a ruler of room at each end, so ±10 s can rest under the centred needle. */
  .strip {
    width: fit-content;
    height: 100%;
    padding-inline: 50%;
    will-change: transform;
  }
  /* Ticks drawn once as backgrounds: 0.1 s and 0.5 s here, whole seconds by their labels. */
  .scale {
    position: relative;
    height: 100%;
    background:
      repeating-linear-gradient(
          to right,
          rgb(255 255 255 / 0.34) 0 1px,
          transparent 1px calc(var(--step) * 5)
        )
        0 5px / 100% 12px no-repeat,
      repeating-linear-gradient(
          to right,
          rgb(255 255 255 / 0.18) 0 1px,
          transparent 1px var(--step)
        )
        0 7px / 100% 8px no-repeat;
  }
  .mark {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 1px;
    color: rgb(255 255 255 / 0.38);
    font-size: 9px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 11px;
  }
  .mark::before {
    content: '';
    flex: none;
    width: 1px;
    height: 18px;
    margin-top: 2px;
    background: rgb(255 255 255 / 0.55);
  }
  .zero {
    color: #fff;
  }
  .zero::before {
    background: #fff;
  }
  .needle {
    position: absolute;
    top: 0;
    left: calc(50% - 0.5px);
    width: 2px;
    height: 22px;
    border-radius: 1px;
    background: #fff;
    opacity: 0.8;
    box-shadow: 0 0 6px rgb(0 0 0 / 0.6);
  }
  .reset {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    color: rgb(255 255 255 / 0.75);
    transition:
      background-color 150ms ease,
      opacity 150ms ease;
  }
  .reset:hover {
    background: rgb(255 255 255 / 0.08);
  }
  .reset:disabled {
    opacity: 0.3;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
