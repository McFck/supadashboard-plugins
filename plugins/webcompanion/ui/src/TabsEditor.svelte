<script lang="ts">
  import { Choice, Label, commit, type ControlConfig } from '@supadashboard/kit';
  import { tabOrientation } from './tabs';

  let { control }: { control: ControlConfig } = $props();
  const orientation = $derived(tabOrientation(control.options));

  function change(value: string) {
    if ((value === 'vertical' || value === 'horizontal') && value !== orientation) {
      control.options = { ...control.options, tabOrientation: value };
      commit('Browser tabs orientation');
    }
  }
</script>

<div class="grid gap-1.5">
  <Label for="browser-tabs-orientation">Orientation</Label>
  <Choice
    id="browser-tabs-orientation"
    value={orientation}
    options={[
      { value: 'vertical', label: 'Vertical' },
      { value: 'horizontal', label: 'Horizontal' },
    ]}
    onchange={change}
  />
</div>
