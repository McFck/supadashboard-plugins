<script lang="ts">
  import { onMount } from 'svelte';
  import { toast, Input, Switch, Choice, Row, Section } from '@supadashboard/kit';
  import { configureHaptics, STRENGTHS } from '../haptics';
  import {
    DEFAULTS,
    loadSettings,
    normalizeSettings,
    saveSettings,
    toConfig,
    type HapticsSettings,
  } from '../settings';

  let settings = $state<HapticsSettings>({ ...DEFAULTS });
  let loaded = $state(false);
  const strengthOptions = STRENGTHS.map((value) => ({
    value,
    label: value[0].toUpperCase() + value.slice(1),
  }));

  function chooseStrength(value: string) {
    const strength = STRENGTHS.find((option) => option === value);
    // Choice has no disabled state; saving before the file was read would overwrite it with defaults.
    if (loaded && strength) {
      void apply({ strength });
    }
  }

  onMount(() => {
    loadSettings()
      .then((saved) => {
        settings = saved;
        loaded = true;
      })
      .catch(() => toast.error('Android settings unavailable'));
  });

  async function apply(change: Partial<HapticsSettings>) {
    const next = normalizeSettings({ ...settings, ...change });
    try {
      await saveSettings(next);
      settings = next;
      const connected = await configureHaptics(toConfig(next));
      if (next.enabled && !connected) {
        toast.error('No tablet found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not save Android settings');
    }
  }
</script>

<Section title="Android">
  <Row
    label="Tablet"
    for="haptics-enabled"
    ><Switch
      id="haptics-enabled"
      disabled={!loaded}
      checked={settings.enabled}
      onCheckedChange={(enabled) => apply({ enabled })}
    /></Row
  >
  <Row
    label="Lock with PC"
    for="android-lock"
    ><Switch
      id="android-lock"
      disabled={!loaded}
      checked={settings.lockWithPc}
      onCheckedChange={(lockWithPc) => apply({ lockWithPc })}
    /></Row
  >
  <Row
    label="Vibration strength"
    for="haptics-strength"
    ><Choice
      id="haptics-strength"
      class="w-40"
      value={settings.strength}
      options={strengthOptions}
      onchange={chooseStrength}
      showPluginMark={false}
    /></Row
  >
  <Row
    label="Vibrate on press"
    for="haptics-press"
    ><Switch
      id="haptics-press"
      disabled={!loaded}
      checked={settings.pressPulse}
      onCheckedChange={(pressPulse) => apply({ pressPulse })}
    /></Row
  >
  <Row
    label="ADB path"
    for="haptics-adb"
    ><Input
      id="haptics-adb"
      disabled={!loaded}
      value={settings.adbPath}
      autocomplete="off"
      onchange={(event) => apply({ adbPath: event.currentTarget.value })}
    /></Row
  >
  <Row
    label="Device serial"
    for="haptics-serial"
    ><Input
      id="haptics-serial"
      disabled={!loaded}
      value={settings.serial}
      autocomplete="off"
      onchange={(event) => apply({ serial: event.currentTarget.value })}
    /></Row
  >
</Section>
