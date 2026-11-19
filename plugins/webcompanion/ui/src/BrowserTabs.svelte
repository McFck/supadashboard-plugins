<script lang="ts">
  import { onMount } from 'svelte';
  import { Icon, type ControlConfig, type PluginBrowserAction } from '@supadashboard/kit';
  import { tabOrientation, tabWindows, type BrowserTab } from './tabs';
  import { TabGestures } from './tab-gestures.svelte';
  import { webCompanion } from './webcompanion.svelte';

  const colors = {
    grey: '#a2a9b5',
    blue: '#78a8f8',
    red: '#f37f87',
    yellow: '#efc563',
    green: '#75c99e',
    pink: '#e290bf',
    purple: '#b4a2fb',
    cyan: '#71cad8',
    orange: '#f4a26d',
  };
  const browser = $derived(
    webCompanion.snapshot.kind === 'connected' ? webCompanion.snapshot : null,
  );
  const windows = $derived(tabWindows(browser));
  let { control }: { control?: ControlConfig } = $props();
  const horizontal = $derived(tabOrientation(control?.options) === 'horizontal');
  let viewport = $state<HTMLElement>();
  let track = $state<HTMLElement>();
  let gestures = $state<TabGestures>();
  let pending = $state<number | null>(null);
  const active = $derived(pending ?? browser?.activeTab);
  onMount(() => webCompanion.mount());
  $effect(() => {
    if (viewport && track) {
      const actions = new TabGestures(viewport, track, horizontal, send);
      gestures = actions;
      return () => actions.destroy();
    }
  });

  async function select(tab: number) {
    pending = tab;
    await webCompanion.action({ kind: 'select_tab', tab });
    if (pending === tab) {
      pending = null;
    }
  }

  function send(action: PluginBrowserAction) {
    void webCompanion.action(action);
  }
</script>

{#snippet favicon(tab: BrowserTab)}
  <span
    class="favicon"
    aria-hidden="true"
  >
    {tab.title.trim().charAt(0).toUpperCase() || '·'}
    {#key tab.favicon}
      {#if tab.favicon}
        <img
          src={tab.favicon}
          alt=""
          width="20"
          height="20"
          draggable={false}
          onerror={(event) => {
            event.currentTarget.setAttribute('hidden', '');
          }}
        />
      {/if}
    {/key}
  </span>
{/snippet}

{#snippet tabRow(tab: BrowserTab)}
  <div
    class="tab"
    class:pinned={tab.pinned}
    class:current={tab.id === active}
    class:dragging={tab.id === gestures?.dragging}
    data-drop={tab.id === gestures?.drop?.anchor ? gestures.drop.side : undefined}
    data-drop-axis={tab.id === gestures?.drop?.anchor ? gestures.drop.axis : undefined}
    data-tab-id={tab.id}
    data-tab-lane={`${tab.window}:${tab.group ?? (tab.pinned ? 'pinned' : 'ungrouped')}`}
  >
    <button
      type="button"
      class="select"
      data-tab-select
      aria-label={tab.pinned ? tab.title || 'New tab' : undefined}
      title={tab.title}
      aria-pressed={tab.id === active}
      aria-keyshortcuts={horizontal ? 'Alt+ArrowLeft Alt+ArrowRight' : 'Alt+ArrowUp Alt+ArrowDown'}
      onkeydown={(event) => gestures?.key(event)}
      onclick={() => select(tab.id)}
    >
      {@render favicon(tab)}
      {#if !tab.pinned}
        <span class="title">{tab.title || 'New tab'}</span>
      {/if}
    </button>
    {#if !tab.pinned}
      <button
        type="button"
        class="close"
        aria-label={`Close ${tab.title || 'tab'}`}
        onclick={() => send({ kind: 'close_tab', tab: tab.id })}
      >
        <Icon
          name="X"
          size={16}
        />
      </button>
    {/if}
  </div>
{/snippet}

<div
  bind:this={viewport}
  class="tile-content browser-tabs"
  class:horizontal
  role="region"
  aria-label="Browser tabs"
>
  {#if !browser || windows.length === 0}
    <div
      class="empty"
      role="status"
    >
      <Icon
        name={browser ? 'AppWindow' : 'Unplug'}
        size={20}
      />
      <span class="text-center">{browser ? 'No tabs' : 'WebCompanion not connected'}</span>
    </div>
  {/if}
  <div
    bind:this={track}
    class="track"
  >
    {#each windows as window, index (window.id)}
      <section
        class="window"
        aria-label={`Window ${index + 1}`}
      >
        {#if window.pinned.length}
          <div
            class="pinned-strip"
            role="group"
            aria-label="Pinned tabs"
          >
            {#each window.pinned as tab (tab.id)}
              {@render tabRow(tab)}
            {/each}
          </div>
        {/if}
        {#each window.rows as row (row.kind === 'tab' ? `tab-${row.tab.id}` : `group-${row.group.id}`)}
          {#if row.kind === 'tab'}
            {@render tabRow(row.tab)}
          {:else}
            <div
              class="group"
              class:folded={row.tabs.length === 0}
              role="group"
              aria-label={row.group.title || 'Tab group'}
              style:--group={colors[row.group.color]}
            >
              <button
                type="button"
                class="group-header"
                aria-expanded={!row.group.collapsed}
                onclick={() =>
                  send({ kind: 'group', group: row.group.id, collapsed: !row.group.collapsed })}
              >
                <span class="title">{row.group.title || 'Tab group'}</span>
                <Icon
                  name={row.group.collapsed ? 'ChevronRight' : 'ChevronDown'}
                  size={16}
                />
              </button>
              {#each row.tabs as tab (tab.id)}
                {@render tabRow(tab)}
              {/each}
            </div>
          {/if}
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .browser-tabs {
    --pad: 6px;
    --row: 52px;
    --gap: 4px;
    --inner: max(8px, calc(var(--tile-radius, 22px) - var(--pad)));
    width: 100%;
    height: 100%;
    container-type: size;
    touch-action: none;
    user-select: none;
  }
  .track {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: var(--pad);
  }
  .window {
    display: grid;
    gap: var(--gap);
    min-width: 0;
  }
  .window + .window {
    padding-top: calc(var(--pad) + var(--gap));
    border-top: 1px solid var(--border);
  }
  .tab {
    position: relative;
    display: flex;
    align-items: stretch;
    min-width: 0;
    height: var(--row);
    border-radius: var(--inner);
    color: var(--muted-foreground);
    transition:
      background-color 120ms,
      box-shadow 120ms,
      transform 120ms;
  }
  .select,
  .close,
  .group-header {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .select {
    flex: 1;
    min-width: 0;
    gap: 10px;
    padding-inline: 12px 4px;
    border-radius: inherit;
  }
  .close {
    flex: none;
    justify-content: center;
    width: 48px;
    border-radius: inherit;
    opacity: 0.55;
  }
  .close:active {
    opacity: 1;
    background: color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .tab:not(.dragging) .select:active {
    background: color-mix(in oklab, var(--foreground) 5%, transparent);
  }
  .select:focus-visible,
  .close:focus-visible,
  .group-header:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font: 500 15px/20px var(--font-sans);
  }
  .favicon {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: color-mix(in oklab, var(--foreground) 8%, transparent);
    font: 600 13px/1 var(--font-display);
    color: var(--foreground);
  }
  .favicon img {
    position: absolute;
    inset: 4px;
    width: 20px;
    height: 20px;
    object-fit: contain;
    background: var(--tile-surface);
  }
  .tab.current {
    color: var(--foreground);
    background: color-mix(in oklab, var(--foreground) 9%, var(--tile-surface));
    box-shadow:
      inset 3px 0 0 var(--primary),
      0 1px 3px rgb(0 0 0 / 0.3);
  }
  .tab.current .title {
    font-weight: 600;
  }
  .tab.current .close {
    opacity: 0.9;
  }
  .pinned-strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap);
  }
  .tab.pinned {
    width: var(--row);
    background: color-mix(in oklab, var(--foreground) 5%, transparent);
  }
  .tab.pinned .select {
    justify-content: center;
    padding: 0;
  }
  .tab.pinned.current {
    box-shadow:
      inset 0 -3px 0 var(--primary),
      0 1px 3px rgb(0 0 0 / 0.3);
  }
  .group {
    display: grid;
    gap: var(--gap);
    padding: var(--gap);
    border-radius: calc(var(--inner) + var(--gap));
    background: color-mix(in oklab, var(--group) 9%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--group) 22%, transparent);
  }
  .group-header {
    justify-content: space-between;
    gap: 8px;
    min-height: 48px;
    padding-inline: 12px 14px;
    border-radius: var(--inner);
    color: var(--group);
    font: 600 13px/16px var(--font-display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .group-header .title {
    font: inherit;
  }
  .group-header:active {
    background: color-mix(in oklab, var(--group) 12%, transparent);
  }
  .group .tab.current {
    box-shadow:
      inset 3px 0 0 var(--group),
      0 1px 3px rgb(0 0 0 / 0.3);
  }
  .tab.dragging {
    z-index: 2;
    transform: scale(1.03);
    color: var(--foreground);
    background: color-mix(in oklab, var(--foreground) 14%, var(--tile-surface));
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent),
      0 12px 28px rgb(0 0 0 / 0.5);
  }
  .tab[data-drop]::after {
    content: '';
    position: absolute;
    z-index: 3;
    inset: calc(var(--gap) / -2 - 1.5px) 6px auto;
    height: 3px;
    border-radius: 2px;
    background: var(--ring);
    box-shadow: 0 0 8px color-mix(in oklab, var(--ring) 70%, transparent);
    pointer-events: none;
  }
  .tab[data-drop='after']::after {
    inset: auto 6px calc(var(--gap) / -2 - 1.5px);
  }
  .tab[data-drop-axis='x']::after {
    inset: 6px auto 6px calc(var(--gap) / -2 - 1.5px);
    width: 3px;
    height: auto;
  }
  .tab[data-drop-axis='x'][data-drop='after']::after {
    inset: 6px calc(var(--gap) / -2 - 1.5px) 6px auto;
  }
  .horizontal .track {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(auto-fill, var(--row));
    align-content: center;
    width: max-content;
    height: 100%;
    box-sizing: border-box;
  }
  .horizontal .window,
  .horizontal .pinned-strip,
  .horizontal .group {
    display: grid;
    grid-row: 1 / -1;
    grid-template-rows: subgrid;
    grid-auto-flow: column;
  }
  .horizontal .window + .window {
    padding: 0 0 0 calc(var(--pad) + var(--gap));
    border-top: 0;
    border-left: 1px solid var(--border);
  }
  .horizontal .tab:not(.pinned) {
    width: clamp(176px, 44cqw, 280px);
  }
  .horizontal .group {
    padding: 0 var(--gap);
  }
  /* A collapsed group is one cell; spanning every row would leave an empty tray. */
  .horizontal .group.folded {
    grid-row: auto;
    grid-template-rows: none;
  }
  .horizontal .group-header {
    min-height: 0;
    height: var(--row);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding-inline: 16px;
    color: var(--muted-foreground);
    font-size: 14px;
    pointer-events: none;
  }
  .empty > :global(svg) {
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .tab {
      transition: none;
    }
    .tab.dragging {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .tab.current,
    .tab.dragging {
      outline: 2px solid Highlight;
    }
  }
</style>
