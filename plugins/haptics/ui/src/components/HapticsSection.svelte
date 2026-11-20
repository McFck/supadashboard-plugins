<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button, Input, Switch, Choice, Row, Section } from '@supadashboard/kit';
  import { STRENGTHS } from '../haptics';
  import { HapticsSectionController } from './haptics-section.svelte';

  const section = new HapticsSectionController();
  onDestroy(() => section.destroy());
  const settings = $derived(section.settings);
  const loaded = $derived(section.loaded);
  const saving = $derived(section.saving);
  const artemisUnavailable = $derived(!loaded || !settings.enabled || !section.connected || saving);
  const strengthOptions = STRENGTHS.map((value) => ({
    value,
    label: value[0].toUpperCase() + value.slice(1),
  }));
  const { apply } = section;

  function chooseStrength(value: string) {
    const strength = STRENGTHS.find((option) => option === value);
    if (strength) {
      void apply({ strength });
    }
  }
</script>

<Section title="Android">
  <Row
    label="Connect"
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

<Section title="Apollo + Artemis">
  <Row
    label="Launch Artemis on wake or connect"
    for="android-artemis"
  >
    <Switch
      id="android-artemis"
      disabled={artemisUnavailable}
      checked={settings.artemis}
      onCheckedChange={(artemis) => apply({ artemis })}
    />
  </Row>
  <Row
    label="Artemis host"
    for="artemis-host"
  >
    <Input
      id="artemis-host"
      disabled={!loaded || saving}
      value={settings.artemisHost}
      autocomplete="off"
      onchange={(event) => apply({ artemisHost: event.currentTarget.value })}
    />
  </Row>
  <Row
    label="Artemis app"
    for="artemis-app"
  >
    <Input
      id="artemis-app"
      disabled={!loaded || saving}
      value={settings.artemisApp}
      autocomplete="off"
      onchange={(event) => apply({ artemisApp: event.currentTarget.value })}
    />
  </Row>
  <Row
    label="USB tethering"
    for="android-tethering"
  >
    <Switch
      id="android-tethering"
      disabled={artemisUnavailable || !settings.artemis}
      checked={settings.usbTethering}
      onCheckedChange={(usbTethering) => apply({ usbTethering })}
    />
  </Row>
  <Row label="Artemis">
    <Button
      size="sm"
      variant="outline"
      disabled={artemisUnavailable || !settings.artemis || section.launching}
      onclick={() => section.launch()}
    >
      Launch Artemis
    </Button>
  </Row>
</Section>
