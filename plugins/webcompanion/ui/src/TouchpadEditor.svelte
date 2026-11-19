<script lang="ts">
  import { ColorField, commit, type ControlConfig } from '@supadashboard/kit';
  import { padBackground } from './pad-background';

  let { control }: { control: ControlConfig } = $props();
  const background = $derived(padBackground(control.options));

  function change(color: string) {
    if (color !== background) {
      control.options = { ...control.options, padBackground: color };
      commit('Touchpad background');
    }
  }
</script>

<section
  class="grid gap-3"
  aria-labelledby="touchpad-background"
>
  <h3
    id="touchpad-background"
    class="section-label"
  >
    Background
  </h3>
  <ColorField
    value={background}
    onchange={change}
  />
</section>
