<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Icon, type ControlConfig, type PluginBrowserAction } from '@supadashboard/kit';
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
    class="tab-initial"
    aria-hidden="true"
  >
    {tab.title.trim().charAt(0).toUpperCase() || '·'}
    {#key tab.favicon}
      {#if tab.favicon}
        <img
          src={tab.favicon}
          alt=""
          width="18"
          height="18"
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
    class="tab-row"
    class:current={tab.id === active}
    class:dragging={tab.id === gestures?.dragging}
    data-drop={tab.id === gestures?.drop?.anchor ? gestures.drop.side : undefined}
    data-tab-id={tab.id}
    data-tab-lane={`${tab.window}:${tab.group ?? (tab.pinned ? 'pinned' : 'ungrouped')}`}
  >
    <Button
      variant="ghost"
      size="lg"
      class="min-w-0 flex-1 justify-start gap-2"
      data-tab-select
      title={tab.title}
      aria-pressed={tab.id === active}
      aria-keyshortcuts={horizontal ? 'Alt+ArrowLeft Alt+ArrowRight' : 'Alt+ArrowUp Alt+ArrowDown'}
      onkeydown={(event) => gestures?.key(event)}
      onclick={() => select(tab.id)}
    >
      {@render favicon(tab)}
      <span class="truncate">{tab.title || 'New tab'}</span>
    </Button>
    {#if !tab.pinned}
      <Button
        variant="ghost"
        size="icon"
        class="min-w-12"
        aria-label={`Close ${tab.title || 'tab'}`}
        onclick={() => send({ kind: 'close_tab', tab: tab.id })}
      >
        <Icon
          name="X"
          size={15}
        />
      </Button>
    {/if}
  </div>
{/snippet}

<div
  bind:this={viewport}
  class="browser-tabs"
  class:horizontal
  role="region"
  aria-label="Browser tabs"
>
  <div
    bind:this={track}
    class="track"
  >
    {#if !browser}
      <span class="tab-empty">Offline</span>
    {:else if windows.length === 0}
      <span class="tab-empty">No tabs</span>
    {/if}
    {#each windows as window, index (window.id)}
      <section aria-label={`Window ${index + 1}`}>
        {#if windows.length > 1}
          <h3>Window {index + 1}</h3>
        {/if}
        {#if window.pinned.length}
          <div
            class="pinned"
            aria-label="Pinned tabs"
            role="group"
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
              style:border-inline-start-color={colors[row.group.color]}
            >
              <Button
                variant="ghost"
                size="lg"
                class="group-header min-h-12 justify-between"
                aria-expanded={!row.group.collapsed}
                onclick={() =>
                  send({ kind: 'group', group: row.group.id, collapsed: !row.group.collapsed })}
              >
                <span class="truncate">{row.group.title || 'Tab group'}</span>
                <Icon
                  name={row.group.collapsed ? 'ChevronRight' : 'ChevronDown'}
                  size={15}
                />
              </Button>
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
    width: 100%;
    height: 100%;
    overflow: clip;
    touch-action: none;
    user-select: none;
  }
  .track {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
  }
  .horizontal .track {
    width: max-content;
    min-height: 100%;
    flex-direction: row;
    align-items: center;
  }
  section {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  h3,
  .tab-empty {
    padding: 0.25rem 0.5rem;
    font-size: 0.78rem;
  }
  .pinned {
    display: grid;
    gap: 0.25rem;
  }
  .horizontal section,
  .horizontal .group,
  .horizontal .pinned {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .tab-row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 0.4rem;
    min-width: 0;
    border-inline-start: 2px solid transparent;
  }
  .tab-row > :global(button) {
    min-height: 48px;
  }
  .horizontal .tab-row {
    width: clamp(9rem, 26vw, 12rem);
    flex-shrink: 0;
  }
  .tab-row.dragging {
    opacity: 0.55;
  }
  .tab-row[data-drop]::after {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    border-radius: 2px;
    background: currentColor;
    pointer-events: none;
  }
  .tab-row[data-drop='after']::after {
    inset: auto 0 0;
  }
  .horizontal .tab-row[data-drop]::after {
    inset: 0 auto 0 0;
    width: 3px;
    height: auto;
  }
  .horizontal .tab-row[data-drop='after']::after {
    inset: 0 0 0 auto;
  }
  .tab-row.current {
    border-inline-start-color: currentColor;
    background: color-mix(in srgb, currentColor 13%, transparent);
  }
  .group {
    min-width: 0;
    padding-inline-start: 0.2rem;
    border-inline-start: 2px solid;
  }
  .group > :global(.group-header) {
    width: 100%;
  }
  .horizontal .group > :global(.group-header) {
    width: auto;
  }
  .tab-initial {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 0.25rem;
    background: color-mix(in srgb, currentColor 14%, transparent);
    font-size: 0.7rem;
  }
  img {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--background);
    object-fit: contain;
  }
</style>
