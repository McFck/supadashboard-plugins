<script lang="ts">
  import { onDestroy } from 'svelte';
  import { AppletQuickActions, CanvasScene, getAppletHostContext, Slot } from '@supadashboard/kit';
  import { createSubwayScene } from '../rendering/scene';
  import { displayAspect, subwayComposition } from '../rendering/composition';
  import { SubwayFrame } from './subway-frame.svelte';

  // The applet contract passes `page`; this applet reads its host context instead.
  let { page: _page }: { page: unknown } = $props();
  const host = getAppletHostContext();
  const view = $derived(host?.viewId ?? 'display');
  const subway = new SubwayFrame({
    mode: () => host?.mode,
    active: () => host?.active ?? false,
    view: () => view,
    screen: () => (host?.config.screen === 'right' ? 'right' : 'left'),
    previewConfig: () => ({
      line: host?.config.line,
      direction: host?.config.direction,
      startStation: host?.config.startStation,
      displayLanguages: host?.config.displayLanguages,
      carNumber: host?.config.carNumber,
      fillScreen: host?.config.fillScreen,
    }),
  });
  onDestroy(() => subway.destroy());
  const frame = $derived(subway.frame);
  const composition = $derived(
    subwayComposition(
      host?.mode === 'runtime' ? host.viewport : undefined,
      displayAspect(frame?.line.id ?? host?.config.line),
    ),
  );
  $effect(() => {
    host?.setDesignHeight?.(composition.height);
  });
</script>

<div
  class="subway-panel absolute inset-0 flex flex-col"
  class:overflow-hidden={host?.mode === 'runtime'}
>
  <CanvasScene
    create={createSubwayScene}
    width={composition.display.w}
    height={composition.display.h}
    {view}
    data={frame}
    revision={frame?.revision}
    opaque
    class={frame ? 'subway-scene subway-scene-ready' : 'subway-scene'}
  />
  <div
    class="shrink-0"
    style:height="{composition.strip}px"
  >
    <Slot id="strip" />
  </div>
  <AppletQuickActions />
</div>

<style>
  .subway-panel {
    background: #10171b;
  }

  .subway-panel :global(.subway-scene) {
    opacity: 0;
    transition: opacity 220ms ease-out;
  }

  .subway-panel :global(.subway-scene-ready) {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .subway-panel :global(.subway-scene) {
      transition-duration: 0ms;
    }
  }
</style>
