<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@supadashboard/kit';
  import { webCompanion } from './webcompanion.svelte';
  import ScrollPad from './ScrollPad.svelte';
  import MediaStrip from './MediaStrip.svelte';

  onMount(() => webCompanion.mount());
  const snapshot = $derived(webCompanion.snapshot);
</script>

{#if snapshot.kind === 'connected'}
  <div class="controls">
    <ul aria-label="Browser tabs">
      {#each snapshot.tabs as tab (tab.id)}
        {@const title = tab.title || 'Untitled tab'}
        <li>
          <Button
            size="sm"
            variant={snapshot.activeTab === tab.id ? 'secondary' : 'ghost'}
            aria-pressed={snapshot.activeTab === tab.id}
            {title}
            onclick={() => webCompanion.action({ kind: 'activate', tab: tab.id })}
          >
            {#if tab.favicon}
              <img
                src={tab.favicon}
                alt=""
                width="16"
                height="16"
                referrerpolicy="no-referrer"
              />
            {/if}
            <span>{title}</span>
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Close ${title}`}
            onclick={() => webCompanion.action({ kind: 'close', tab: tab.id })}>×</Button
          >
        </li>
      {:else}
        <li>No tabs</li>
      {/each}
    </ul>
    <ScrollPad />
    {#if snapshot.media}
      <MediaStrip media={snapshot.media} />
    {/if}
  </div>
{:else}
  <span>Browser offline</span>
{/if}

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    height: 100%;
    overflow: auto;
  }

  ul {
    display: flex;
    flex-shrink: 0;
    overflow-x: auto;
  }

  li {
    display: flex;
    align-items: center;
  }

  li span {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
