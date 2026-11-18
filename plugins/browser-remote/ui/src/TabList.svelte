<script lang="ts">
  import { onMount } from 'svelte';
  import { browserRemote } from './browser-remote.svelte';

  onMount(() => browserRemote.mount());
</script>

{#if browserRemote.snapshot.kind === 'connected'}
  <ul
    style="max-height: 100%; overflow: auto"
    aria-label="Browser tabs"
  >
    {#each browserRemote.snapshot.tabs as tab (tab.id)}
      <li>
        <button
          type="button"
          aria-pressed={tab.active}
          onclick={() => browserRemote.activate(tab.id)}
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
