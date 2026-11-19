import { SvelteSet } from 'svelte/reactivity';
import { avatarUrl, subscribeVoice, type VoiceView } from '../discord';
import type { Member } from '../service/model';

export class VoiceTileController {
  view = $state<VoiceView>({ state: 'absent' });
  members = $derived(this.view.state === 'inVoice' ? this.view.members : []);
  status = $derived.by(() => {
    switch (this.view.state) {
      case 'absent':
        return 'Not running';
      case 'needsAuth':
        return 'Set up Discord in Plugins';
      case 'authorizing':
        return 'Waiting for Discord';
      case 'connecting':
        return 'Connecting';
      case 'idle':
        return 'Not in voice';
      case 'inVoice':
        return this.members.length ? '' : 'Empty channel';
    }
  });
  #failed = new SvelteSet<string>();
  #stop = subscribeVoice((view) => (this.view = view));

  /** The custom avatar, then Discord's default one; undefined means draw the initial. */
  src(member: Member) {
    return [avatarUrl(member), avatarUrl({ ...member, avatar: null })].find(
      (url) => url !== undefined && !this.#failed.has(url),
    );
  }

  describe(member: Member) {
    return [
      member.name,
      member.speaking && 'speaking',
      member.deafened ? 'deafened' : member.muted && 'muted',
    ]
      .filter(Boolean)
      .join(', ');
  }

  fail(url: string) {
    this.#failed.add(url);
  }

  destroy() {
    this.#stop();
  }
}
