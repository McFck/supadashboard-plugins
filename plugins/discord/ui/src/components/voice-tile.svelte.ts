import { SvelteSet } from 'svelte/reactivity';
import { avatarUrl, subscribeVoice, type VoiceMember, type VoiceView } from '../discord';

/** Live voice view for one tile, plus the avatar URLs that failed to load in it. */
export class VoiceTileController {
  view = $state<VoiceView>({ state: 'absent' });
  #failed = new SvelteSet<string>();
  #stop = subscribeVoice((view) => (this.view = view));

  /** The custom avatar, then Discord's default one; undefined means draw the initial. */
  src(member: VoiceMember) {
    return [avatarUrl(member), avatarUrl({ ...member, avatar: null })].find(
      (url) => url !== undefined && !this.#failed.has(url),
    );
  }

  fail(url: string) {
    this.#failed.add(url);
  }

  destroy() {
    this.#stop();
  }
}
