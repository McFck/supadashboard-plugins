// Discord's local RPC over the host's framed pipe: handshake, request/reply by nonce, ping, and a bounded queue of
// dispatches that arrive between a request and its reply.
import { isRecord, pluginPipe, type PluginPipeEvent } from '@supadashboard/kit';

const PLUGIN = 'discord';
const EVENT_QUEUE = 512;
const closedError = 'Discord connection closed';

export type Frame = Record<string, unknown>;

type Pending = {
  nonce: string | null;
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
};

export class Rpc {
  /** Dispatches received while a request waited; the client reduces them in order. */
  readonly events: Frame[] = [];
  private nonce = 0;
  private pending?: Pending;
  private closed = false;
  private handle = -1;

  private constructor(
    private readonly onEvents: () => void,
    private readonly onClosed: () => void,
  ) {}

  /** Opens the first of `discord-ipc-0..9` that accepts, and waits for READY. */
  static async connect(clientId: string, onEvents: () => void, onClosed: () => void) {
    const rpc = new Rpc(onEvents, onClosed);
    for (let index = 0; index < 10 && rpc.handle < 0; index++) {
      try {
        rpc.handle = await pluginPipe.open(PLUGIN, `discord-ipc-${index}`, (event) =>
          rpc.receive(event),
        );
      } catch {
        // This pipe is not Discord's; try the next one.
      }
    }
    if (rpc.handle < 0) {
      throw new Error("Discord isn't running");
    }
    try {
      const ready = await rpc.exchange(null, 0, { v: 1, client_id: clientId }, 10_000, 'handshake');
      if (ready.cmd !== 'DISPATCH' || ready.evt !== 'READY') {
        throw new Error('Invalid Discord handshake');
      }
    } catch (error) {
      rpc.close();
      throw error;
    }
    return rpc;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const handle = this.handle;
    this.pending?.reject(new Error(closedError));
    this.pending = undefined;
    // The pipe may already be gone; closing is then a no-op.
    void pluginPipe.close(PLUGIN, handle).catch(() => {});
    this.onClosed();
  }

  private receive(event: PluginPipeEvent) {
    if (event.kind === 'closed') {
      this.close();
      return;
    }
    const { op, data } = event;
    if (op === 3) {
      void pluginPipe.send(PLUGIN, this.handle, 4, data).catch(() => this.close());
    } else if (op === 2 || op === 0) {
      this.close();
    } else if (op === 1 && isRecord(data)) {
      this.frame(data);
    }
  }

  private frame(frame: Frame) {
    const pending = this.pending;
    if (pending && (pending.nonce === null || frame.nonce === pending.nonce)) {
      this.pending = undefined;
      pending.resolve(frame);
    } else if (frame.cmd === 'DISPATCH') {
      if (this.events.length >= EVENT_QUEUE) {
        this.close();
        return;
      }
      this.events.push(frame);
      this.onEvents();
    }
  }

  private exchange(nonce: string | null, op: number, body: unknown, ms: number, what: string) {
    return new Promise<Frame>((resolve, reject) => {
      if (this.closed) {
        reject(new Error(closedError));
        return;
      }
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`Discord ${what} timed out`));
      }, ms);
      this.pending = {
        nonce,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      pluginPipe.send(PLUGIN, this.handle, op, body).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
        this.close();
      });
    });
  }

  /** One request at a time. Errors that do not start with "Discord rejected " mean the connection is unusable. */
  async request(cmd: string, args: unknown, event?: string): Promise<unknown> {
    const nonce = String(++this.nonce);
    const body = { cmd, args, nonce, ...(event ? { evt: event } : {}) };
    const reply = await this.exchange(
      nonce,
      1,
      body,
      cmd === 'AUTHORIZE' ? 120_000 : 15_000,
      'request',
    );
    if (reply.evt === 'ERROR') {
      throw new Error(`Discord rejected ${cmd}`);
    }
    if (reply.cmd !== cmd || !('data' in reply)) {
      throw new Error('Invalid Discord reply');
    }
    return reply.data;
  }
}
