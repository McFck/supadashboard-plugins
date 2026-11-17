// Shared pack.json door-sequence planner for the check page, station demo and verification.
(() => {
  function plan(line, action) {
    const steps = line.sequence[action], cues = line.cues, anchors = {};
    if (!Array.isArray(steps)) throw Error('Missing door sequence: ' + action);
    const time = value => {
      if (Number.isFinite(value)) return value;
      const match = /^(open_end|close_end|departure_melody_end)([+-]\d+(?:\.\d+)?)?$/.exec(value);
      if (!match || !Number.isFinite(anchors[match[1]])) throw Error('Invalid door time: ' + value);
      return anchors[match[1]] + Number(match[2] || 0);
    };
    const melody = steps.find(s => s.part === 'departure_melody');
    if (melody) anchors.departure_melody_end = time(melody.at) + cues.departure_melody.duration;
    for (const part of ['open', 'close']) {
      const step = steps.find(s => s.part === part);
      if (step) anchors[part + '_end'] = time(step.at) + cues[part].audible_end;
    }
    const seen = new Set(), events = [];
    for (const step of steps) {
      const cue = cues[step.part];
      if (!cue) throw Error('Missing door part: ' + step.part);
      if (seen.has(cue.file)) continue;
      seen.add(cue.file);
      const at = time(step.at);
      const duration = Math.min(cue.duration, step.until === undefined ? cue.duration : time(step.until) - at);
      if (!(at >= 0 && duration > 0)) throw Error('Invalid door duration: ' + step.part);
      events.push({part: step.part, at, cue: {...cue, duration, ...(step.fade_out === undefined ? {} : {fadeOut: step.fade_out})}});
    }
    return {events, end: Math.max(0, ...events.map(e => e.at + e.cue.duration)), ...anchors};
  }
  const api = {plan};
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.DoorSequence = api;
})();
