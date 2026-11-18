<script lang="ts">
  import { onMount } from 'svelte';
  import {
    toast,
    Button,
    Input,
    Switch,
    Choice,
    Row,
    Section,
    onPluginEvent,
  } from '@supadashboard/kit';
  import { configureHaptics, launchArtemis, STRENGTHS, tabletReady } from '../haptics';
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
  let connected = $state(false);
  let saving = $state(false);
  let launching = $state(false);
  const artemisUnavailable = $derived(!loaded || !settings.enabled || !connected || saving);
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
    let active = true;
    async function refreshTablet() {
      const ready = await tabletReady();
      if (active) {
        connected = ready;
      }
    }
    const listeners = [
      onPluginEvent('haptics', 'tablet-ready', (ready) => {
        if (active) {
          connected = ready === true;
        }
      }),
      onPluginEvent('haptics', 'ready', () => void refreshTablet().catch(console.warn)),
      onPluginEvent('haptics', 'connection-error', (failure) => {
        if (active && typeof failure === 'string') {
          toast.error(failure);
        }
      }),
    ];
    void Promise.all(listeners).then(refreshTablet).catch(console.warn);
    loadSettings()
      .then((saved) => {
        if (!active) {
          return;
        }
        settings = saved;
        loaded = true;
      })
      .catch(() => toast.error('Android settings unavailable'));
    return () => {
      active = false;
      for (const listener of listeners) {
        void listener.then((stop) => stop()).catch(console.warn);
      }
    };
  });

  async function apply(change: Partial<HapticsSettings>) {
    if (saving) {
      return;
    }
    saving = true;
    const next = normalizeSettings({ ...settings, ...change });
    try {
      await saveSettings(next);
      settings = next;
    } catch (error) {
      console.error(error);
      toast.error('Could not save Android settings');
      saving = false;
      return;
    }
    try {
      connected = await configureHaptics(toConfig(next));
      if (next.enabled && !connected) {
        toast.error('No tablet found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not apply Android settings');
    } finally {
      saving = false;
    }
  }

  async function launch() {
    launching = true;
    try {
      await launchArtemis();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not launch Artemis');
    } finally {
      launching = false;
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

<Section title="Apollo + Artemis">
  <Row
    label="Launch Artemis on connect"
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
      disabled={artemisUnavailable || !settings.artemis || launching}
      onclick={launch}
    >
      Launch Artemis
    </Button>
  </Row>
</Section>
