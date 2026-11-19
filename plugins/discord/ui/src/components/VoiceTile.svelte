<script lang="ts">
  import HeadphoneOff from '@lucide/svelte/icons/headphone-off';
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import { onDestroy } from 'svelte';
  import { ContentTile, Icon, type ControlConfig } from '@supadashboard/kit';
  import { pack } from '../pack';
  import { VoiceTileController } from './voice-tile.svelte';

  let {
    control,
    pageId,
    pageVisible = true,
    itemId,
    pressFeedbackDisabled = false,
    pixelWidth = 0,
    pixelHeight = 0,
  }: {
    control: ControlConfig;
    pageId?: string;
    pageVisible?: boolean;
    itemId?: string;
    pressFeedbackDisabled?: boolean;
    pixelWidth?: number;
    pixelHeight?: number;
  } = $props();
  const voice = new VoiceTileController();
  onDestroy(() => voice.destroy());

  const short = $derived(Math.min(pixelWidth, pixelHeight));
  const pad = $derived(Math.round(Math.min(14, Math.max(8, short * 0.09))));
  const gap = $derived(Math.round(Math.min(8, Math.max(4, short * 0.035))));
  const channel = $derived(voice.view.state === 'inVoice' ? voice.view.channel : undefined);
  const HEADER_HEIGHT = 16;
  const grid = $derived(
    pack(
      voice.members.length,
      pixelWidth - 2 * pad,
      pixelHeight - 2 * pad - (channel ? HEADER_HEIGHT + gap : 0),
      gap,
    ),
  );
  const shown = $derived(
    grid.overflow ? voice.members.slice(0, grid.cols * grid.rows - 1) : voice.members,
  );
  // Avatars smaller than this (px) get no status badge: it would be an unreadable dot. The name still says it.
  const BADGE_MIN = 34;
</script>

<ContentTile
  {control}
  {pageId}
  {pageVisible}
  {itemId}
  {pressFeedbackDisabled}
>
  {#snippet children()}
    <div
      data-voice-tile
      class="box-border grid h-full w-full min-w-0"
      style:padding="{pad}px"
      style:row-gap="{gap}px"
      style:grid-template-rows={channel ? `${HEADER_HEIGHT}px minmax(0, 1fr)` : 'minmax(0, 1fr)'}
    >
      {#if channel}
        <div
          class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground"
          title={channel.name}
        >
          <span
            class="relative shrink-0 text-muted-foreground"
            role="img"
            aria-label={channel.access === 'restricted'
              ? 'Restricted voice channel'
              : channel.access === 'open'
                ? 'Open voice channel'
                : 'Voice channel'}
          >
            <Volume2
              size={15}
              aria-hidden="true"
            />
            {#if channel.access === 'restricted'}
              <span class="absolute -top-0.5 -right-0.5 rounded-sm bg-background">
                <LockKeyhole
                  size={9}
                  aria-hidden="true"
                />
              </span>
            {/if}
          </span>
          <span class="truncate">{channel.name}</span>
        </div>
      {/if}
      <div class="grid min-h-0 min-w-0 place-items-center">
        {#if voice.status}
          <div class="flex flex-col items-center gap-1.5 text-muted-foreground">
            <span class="opacity-60">
              <Icon
                name="discord-voice"
                size={Math.round(Math.min(36, Math.max(22, short * 0.22)))}
              />
            </span>
            <span class="text-center text-xs text-balance">{voice.status}</span>
          </div>
        {:else}
          <div
            role="group"
            aria-label={channel?.name}
            class="flex flex-wrap content-center justify-center"
            style:width="{grid.cols * grid.size + (grid.cols - 1) * gap}px"
            style:gap="{gap}px"
            style:--size="{grid.size}px"
          >
            {#each shown as member (member.id)}
              {@const src = voice.src(member)}
              <div
                role="img"
                aria-label={voice.describe(member)}
                data-member={member.id}
                class="avatar"
                class:speaking={member.speaking}
              >
                <span
                  class="ring"
                  aria-hidden="true"
                ></span>
                {#if src}
                  <img
                    {src}
                    alt=""
                    draggable="false"
                    onerror={() => voice.fail(src)}
                  />
                {:else}
                  <span class="face initial">{[...member.name][0]?.toUpperCase()}</span>
                {/if}
                {#if (member.muted || member.deafened) && grid.size >= BADGE_MIN}
                  <span
                    class="badge"
                    aria-hidden="true"
                  >
                    {#if member.deafened}
                      <HeadphoneOff />
                    {:else}
                      <MicOff />
                    {/if}
                  </span>
                {/if}
              </div>
            {/each}
            {#if grid.overflow}
              <div
                role="img"
                aria-label="{grid.overflow} more"
                class="avatar"
              >
                <span class="face more">+{grid.overflow}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</ContentTile>

<style>
  .avatar {
    --ring: clamp(2px, calc(var(--size) * 0.032), 3.5px);
    --inset: calc(var(--ring) + max(1.5px, calc(var(--size) * 0.03)));
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
  }
  /* The ring sits inside the cell's reserved inset, so speaking never moves or resizes anything. */
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    box-shadow:
      inset 0 0 0 var(--ring) #2dc770,
      0 0 calc(var(--size) * 0.12) rgb(45 199 112 / 0.3);
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .speaking .ring {
    opacity: 1;
  }
  img,
  .face {
    position: absolute;
    inset: var(--inset);
    border-radius: 9999px;
    background: #2b2d33;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.06),
      0 1px 3px rgb(0 0 0 / 0.35);
  }
  img {
    width: calc(100% - 2 * var(--inset));
    height: calc(100% - 2 * var(--inset));
    object-fit: cover;
    user-select: none;
  }
  .face {
    display: grid;
    place-items: center;
    color: #d4d6dc;
    font-size: calc(var(--size) * 0.36);
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .more {
    background: rgb(255 255 255 / 0.07);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
    color: #a1a4ad;
    font-size: calc(var(--size) * 0.3);
  }
  /* Discord's muted/deafened mark: red on a dark disc cut out of the avatar's corner, above the ring. */
  .badge {
    position: absolute;
    right: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    width: calc(var(--size) * 0.36);
    height: calc(var(--size) * 0.36);
    border-radius: 9999px;
    background: #232428;
    box-shadow: 0 0 0 max(1.5px, calc(var(--size) * 0.03)) var(--tile-surface, #14161b);
    color: #f23f43;
  }
  .badge :global(svg) {
    width: 64%;
    height: 64%;
    stroke-width: 2.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .ring {
      transition: none;
    }
  }
</style>
