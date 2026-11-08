<script lang="ts">
  import { Input, Label, type ControlConfig, commit } from '@supadashboard/kit';
  import { OFFSET_LIMIT_MS, OFFSET_STEP_MS, offsetOf } from '../lyric-clock';

  let { control }: { control: ControlConfig } = $props();
  const offset = $derived(offsetOf(control.options));

  /** Out-of-range or unaligned input snaps to the nearest allowed step; an empty field means 0. */
  function save(input: HTMLInputElement) {
    const typed = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
    const next = offsetOf({ offsetMs: Math.round(typed / OFFSET_STEP_MS) * OFFSET_STEP_MS });
    input.value = String(next);
    if (next !== offset) {
      commit('Lyrics sync offset');
      control.options = { ...control.options, offsetMs: next };
    }
  }
</script>

<div class="grid gap-1.5">
  <Label for="lyrics-offset">Sync offset (ms)</Label>
  <Input
    id="lyrics-offset"
    type="number"
    min={-OFFSET_LIMIT_MS}
    max={OFFSET_LIMIT_MS}
    step={OFFSET_STEP_MS}
    value={offset}
    onchange={(event) => save(event.currentTarget)}
  />
</div>
