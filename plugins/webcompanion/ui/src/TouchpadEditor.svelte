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

<fieldset class="grid gap-2">
  <legend>Background</legend>
  <ColorField
    value={background}
    onchange={change}
  />
</fieldset>
