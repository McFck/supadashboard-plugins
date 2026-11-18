<script lang="ts">
  import { onMount } from 'svelte';
  import { webCompanion } from './webcompanion.svelte';

  onMount(() => webCompanion.mount());
</script>

{#if webCompanion.snapshot.kind === 'connected'}
  <ul
    style="max-height: 100%; overflow: auto"
    aria-label="Browser tabs"
  >
    {#each webCompanion.snapshot.tabs as tab (tab.id)}
      <li>
        <button
          type="button"
          aria-pressed={tab.active}
          onclick={() => webCompanion.activate(tab.id)}
        >
          {tab.title || 'Untitled tab'}
        </button>
      </li>
    {:else}
      <li>No tabs</li>
    {/each}
  </ul>
{:else}
  <span>Browser offline</span>
{/if}
