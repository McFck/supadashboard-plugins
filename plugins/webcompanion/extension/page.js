(() => {
  if (globalThis.webcompanionScrollInstalled) {
    return;
  }
  globalThis.webcompanionScrollInstalled = true;

  const EASE_MS = 22;
  const FRICTION_MS = 375;
  const STOP_PX_S = 12;
  const IDLE_MS = 300;
  const clamp = (value, limit) =>
    Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
  const axis = () => ({ remaining: 0, velocity: 0, carry: 0 });

  function step(axis, dt) {
    let eased = axis.remaining * -Math.expm1(-dt / EASE_MS);
    axis.remaining -= eased;
    if (Math.abs(axis.remaining) < 0.1) {
      eased += axis.remaining;
      axis.remaining = 0;
    }
    const decay = Math.exp(-dt / FRICTION_MS);
    const distance = eased + (axis.velocity * (1 - decay) * FRICTION_MS) / 1000 + axis.carry;
    axis.velocity *= decay;
    if (Math.abs(axis.velocity) < STOP_PX_S) {
      axis.velocity = 0;
    }
    // Pixel fractions accumulate until Chrome can apply an integer step.
    const pixels = axis.remaining || axis.velocity ? Math.trunc(distance) : Math.round(distance);
    axis.carry = distance - pixels;
    return pixels;
  }

  const pointer = globalThis.webcompanionPointer;

  function scrollTarget(anchor) {
    const [x, y] = anchor ?? [innerWidth / 2, innerHeight / 2];
    for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(node);
      if (
        (/^(auto|scroll)$/.test(overflowX) && node.scrollWidth > node.clientWidth) ||
        (/^(auto|scroll)$/.test(overflowY) && node.scrollHeight > node.clientHeight)
      ) {
        return node;
      }
    }
    return document.scrollingElement;
  }

  class Scroller {
    x = axis();
    y = axis();
    target = null;
    frame = 0;
    lastTick = 0;
    lastInput = -Infinity;
    // Frames count only after a touch's hold; a hidden page drops the rest of that touch.
    held = false;

    reset(anchor) {
      this.target = scrollTarget(anchor);
      this.x = axis();
      this.y = axis();
    }

    apply(frame) {
      if (frame?.kind !== 'scroll') {
        return;
      }
      const dx = clamp(frame.dx, 32768);
      const dy = clamp(frame.dy, 32768);
      const now = performance.now();
      if (frame.hold === true) {
        this.held = true;
      } else if (!this.held) {
        return;
      }
      if (
        frame.hold === true ||
        ((dx || dy) && (!this.target?.isConnected || now - this.lastInput > IDLE_MS))
      ) {
        this.reset(pointer.anchor());
      }
      if (frame.hold === true || dx || dy) {
        this.lastInput = now;
        this.x.remaining = clamp(this.x.remaining + dx, 32768);
        this.y.remaining = clamp(this.y.remaining + dy, 32768);
      }
      if (
        Array.isArray(frame.fling) &&
        frame.fling.length === 2 &&
        now - this.lastInput <= IDLE_MS
      ) {
        this.x.velocity = clamp(frame.fling[0], 10_000);
        this.y.velocity = clamp(frame.fling[1], 10_000);
        this.lastInput = -Infinity;
      }
      this.schedule();
    }

    jump(input) {
      this.reset(pointer.anchor());
      this.lastInput = -Infinity;
      if (!this.target) {
        return false;
      }
      switch (input.kind) {
        case 'page_up':
          this.y.remaining = -this.target.clientHeight;
          break;
        case 'page_down':
          this.y.remaining = this.target.clientHeight;
          break;
        case 'top':
          this.y.remaining = -this.target.scrollTop;
          break;
        case 'bottom':
          this.y.remaining =
            this.target.scrollHeight - this.target.clientHeight - this.target.scrollTop;
          break;
        default:
          return false;
      }
      this.schedule();
      return true;
    }

    schedule() {
      if (
        !this.frame &&
        (this.x.remaining || this.y.remaining || this.x.velocity || this.y.velocity)
      ) {
        this.lastTick = performance.now();
        this.frame = requestAnimationFrame(this.tick);
      }
    }

    tick = (now) => {
      this.frame = 0;
      if (!this.target?.isConnected) {
        return;
      }
      const dt = Math.max(0, now - this.lastTick);
      if (dt > 0) {
        const left = step(this.x, dt);
        const top = step(this.y, dt);
        if (left || top) {
          const { scrollLeft, scrollTop } = this.target;
          this.target.scrollBy({ left, top, behavior: 'instant' });
          if (left && this.target.scrollLeft === scrollLeft) {
            this.x = axis();
          }
          if (top && this.target.scrollTop === scrollTop) {
            this.y = axis();
          }
        }
      }
      if (this.x.remaining || this.y.remaining || this.x.velocity || this.y.velocity) {
        this.lastTick = Math.max(now, this.lastTick);
        this.frame = requestAnimationFrame(this.tick);
      }
    };
  }

  const scroller = new Scroller();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scroller.held) {
      scroller.reset();
      scroller.held = false;
      scroller.lastInput = -Infinity;
    }
  });
  let port;
  let reconnectDelay = 250;
  let moveFrame = 0;
  let pendingMove;

  function replyMove(frame, source, apply) {
    const ok = apply && pointer.input(frame.input);
    try {
      source.postMessage({ kind: 'pointer_done', id: frame.id, ok });
    } catch {
      // The worker cancels the gesture if the document port closes.
    }
  }

  function flushMove(apply) {
    if (pendingMove) {
      const { frame, source } = pendingMove;
      pendingMove = undefined;
      replyMove(frame, source, apply);
    }
  }

  function nextMove() {
    moveFrame = 0;
    if (pendingMove) {
      moveFrame = requestAnimationFrame(nextMove);
      flushMove(!document.hidden);
    }
  }

  function receiveMove(frame, source) {
    if (document.hidden) {
      replyMove(frame, source, false);
    } else if (moveFrame) {
      flushMove(false);
      pendingMove = { frame, source };
    } else {
      // The first move after idle can paint on the upcoming frame without waiting for its callback.
      moveFrame = requestAnimationFrame(nextMove);
      replyMove(frame, source, true);
    }
  }

  function connect() {
    // After an extension reload or update this copy is orphaned; the new one takes over.
    if (!chrome.runtime?.id) {
      observer.disconnect();
      for (const event of mediaEvents) {
        document.removeEventListener(event, changed, true);
      }
      return;
    }
    const source = chrome.runtime.connect(chrome.runtime.id, { name: 'webcompanion-page' });
    port = source;
    source.onMessage.addListener((frame) => {
      reconnectDelay = 250;
      if (frame?.kind === 'pointer_prepare') {
        globalThis.webcompanionHover.prepare();
      } else if (frame?.kind === 'pointer_input') {
        if (frame.input?.kind === 'move' && Number.isSafeInteger(frame.id)) {
          receiveMove(frame, source);
        } else {
          flushMove(frame.input?.kind !== 'cancel');
          pointer.input(frame.input);
        }
      } else {
        scroller.apply(frame);
      }
    });
    source.onDisconnect.addListener(() => {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pendingMove = undefined;
      pointer.input({ kind: 'cancel' });
      port = undefined;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 4000);
    });
    changed();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      flushMove(false);
    }
  });

  let selectedMedia;

  function player() {
    const elements = [...document.querySelectorAll('video, audio')];
    const playing = elements.find((item) => !item.paused && !item.ended);
    if (playing) {
      selectedMedia = playing;
    } else if (!selectedMedia?.isConnected) {
      selectedMedia = elements.find((item) => item.currentSrc) ?? elements[0];
    }
    return selectedMedia;
  }

  function status() {
    const element = player();
    return element ? { paused: element.paused || element.ended, rate: element.playbackRate } : null;
  }

  async function media(input) {
    const element = player();
    if (!element) {
      return false;
    }
    switch (input.kind) {
      case 'play':
        if (element.paused || element.ended) {
          await element.play();
        }
        break;
      case 'pause':
        element.pause();
        break;
      case 'toggle':
        if (element.paused || element.ended) {
          await element.play();
        } else {
          element.pause();
        }
        break;
      case 'seek':
        element.currentTime = Math.max(
          0,
          Math.min(element.duration || Infinity, element.currentTime + input.seconds),
        );
        break;
      case 'speed':
        element.playbackRate = input.rate;
        break;
      default:
        return false;
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    switch (message.kind) {
      case 'page':
        respond(scroller.jump(message.input));
        return false;
      case 'media':
        media(message.input).then(respond, () => respond(false));
        return true;
      default:
        return false;
    }
  });

  function changed() {
    try {
      port?.postMessage({ kind: 'media_changed', media: status() });
    } catch {
      // A disconnected port will reconnect and send the current status.
    }
  }
  const mediaEvents = ['play', 'pause', 'ended', 'ratechange', 'loadedmetadata'];
  for (const event of mediaEvents) {
    document.addEventListener(event, changed, true);
  }
  const observer = new MutationObserver((records) => {
    const hasPlayer = (node) =>
      node instanceof Element &&
      (node.matches('audio, video') || node.querySelector('audio, video'));
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(hasPlayer))) {
      changed();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  connect();
})();
