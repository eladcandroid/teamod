import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';
import type { DomainState } from '../core/store.js';
import { alive } from '../daemon/files.js';
import type { Args, Method } from '../ipc/api.js';
import { SocketClient, type SocketLike } from '../ipc/socket-client.js';
import { mayCall } from './coverage.js';
import { ROUTES } from './views.js';

/** What the bridge tells the mod on stdout. Small lines only: a view is fetched, never pushed. */
export type BridgeLine =
  | { readonly t: 'ready'; readonly socket: string; readonly key: string }
  | { readonly t: 'dirty'; readonly routes: readonly string[] }
  | { readonly t: 'connected'; readonly connected: boolean }
  | { readonly t: 'error'; readonly text: string };

/** Biggest request a pane sends: a pasted image is the largest thing the API takes. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DIRTY_EVERY_MS = 100;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;

export interface BridgeOptions {
  /** Where the socket goes. */
  readonly runDir: string;
  /** Reach the daemon (started if need be). */
  readonly connect: () => Promise<SocketClient>;
  readonly out: (line: BridgeLine) => void;
  readonly log?: (line: string) => void;
}

/** Connect to a daemon as the mod's screen. */
export const connectAsMod = (port: number, token: string, version: string): Promise<SocketClient> =>
  SocketClient.connect({
    url: `ws://127.0.0.1:${port}`,
    token,
    kind: 'mod',
    version,
    connect: (url) => new WebSocket(url) as unknown as SocketLike,
  });

/** Remove sockets left by bridges that died. */
function pruneSockets(runDir: string): void {
  for (const name of readdirSync(runDir)) {
    const pid = Number(/^(\d+)\.sock$/.exec(name)?.[1]);
    if (pid && pid !== process.pid && !alive(pid)) rmSync(path.join(runDir, name), { force: true });
  }
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (part: Buffer) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Too large'));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One session's link to the daemon. Mod modules have no Node and no WebSocket, so this child holds
 * the daemon's state and answers the mod over a unix socket only the person can open.
 */
export class Bridge {
  readonly socketPath: string;
  readonly key = randomBytes(32).toString('hex');
  private client?: SocketClient;
  private state?: DomainState;
  private server?: Server;
  private readonly shown = new Map<string, string>();
  private dirtyTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retryMs = RETRY_MIN_MS;
  private stopped = false;

  constructor(private readonly opts: BridgeOptions) {
    this.socketPath = path.join(opts.runDir, `${process.pid}.sock`);
  }

  /** Attach to the daemon and open the socket; then tell the mod how to reach it. */
  async start(): Promise<void> {
    mkdirSync(this.opts.runDir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.runDir, 0o700);
    pruneSockets(this.opts.runDir);
    rmSync(this.socketPath, { force: true });
    await this.attach();
    const server = createServer((req, res) => void this.answer(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, resolve);
    });
    chmodSync(this.socketPath, 0o600);
    this.opts.out({ t: 'ready', socket: this.socketPath, key: this.key });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.dirtyTimer);
    clearTimeout(this.retryTimer);
    this.client?.close();
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
  }

  private async attach(): Promise<void> {
    const client = await this.opts.connect();
    this.client = client;
    this.retryMs = RETRY_MIN_MS;
    this.state = client.store.getState();
    client.store.subscribe(() => {
      this.state = client.store.getState();
      this.markDirty();
    });
    client.onClose((reason) => {
      if (this.client !== client) return;
      this.client = undefined;
      if (this.stopped) return;
      this.opts.log?.(`daemon link closed: ${reason}`);
      this.opts.out({ t: 'connected', connected: false });
      this.retryLater();
    });
    this.markDirty();
  }

  private retryLater(): void {
    this.retryTimer = setTimeout(() => {
      this.attach()
        .then(() => this.opts.out({ t: 'connected', connected: true }))
        .catch((err: unknown) => {
          this.opts.log?.(`daemon link retry: ${errorText(err)}`);
          this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
          if (!this.stopped) this.retryLater();
        });
    }, this.retryMs);
  }

  /** Say which shown routes changed, at most ten times a second. */
  private markDirty(): void {
    if (this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = undefined;
      const state = this.state;
      if (!state) return;
      const changed: string[] = [];
      for (const [route, before] of this.shown) {
        const now = JSON.stringify(ROUTES[route]?.(state) ?? null);
        if (now !== before) {
          this.shown.set(route, now);
          changed.push(route);
        }
      }
      if (changed.length) this.opts.out({ t: 'dirty', routes: changed });
    }, DIRTY_EVERY_MS);
  }

  private isAllowed(req: IncomingMessage): boolean {
    const given = Buffer.from(req.headers.authorization ?? '');
    const wanted = Buffer.from(`Bearer ${this.key}`);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (!this.isAllowed(req)) return send(401, { error: 'Not allowed' });
      const url = new URL(req.url ?? '/', 'http://bridge');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { connected: this.client !== undefined });
      if (req.method === 'GET' && url.pathname.startsWith('/view/')) {
        const route = url.pathname.slice('/view/'.length);
        const build = ROUTES[route];
        if (!build) return send(404, { error: 'No such view' });
        if (!this.state) return send(503, { error: 'Not connected' });
        const view = build(this.state);
        this.shown.set(route, JSON.stringify(view));
        return send(200, view);
      }
      if (req.method === 'POST' && url.pathname === '/call') {
        const body = JSON.parse(await readBody(req)) as { method?: unknown; args?: unknown };
        if (typeof body.method !== 'string' || !Array.isArray(body.args)) return send(400, { error: 'A method and args, please' });
        if (!mayCall(body.method)) return send(200, { ok: false, error: `teamod doesn't offer ${body.method}` });
        const client = this.client;
        if (!client) return send(200, { ok: false, error: 'Not connected to the engine' });
        try {
          const call = client.call as (method: Method, ...args: Args<Method>) => Promise<unknown>;
          const value = await call.call(client, body.method as Method, ...(body.args as Args<Method>));
          return send(200, { ok: true, value });
        } catch (err) {
          return send(200, { ok: false, error: errorText(err) });
        }
      }
      return send(404, { error: 'Nothing here' });
    } catch (err) {
      this.opts.log?.(`bridge request: ${errorText(err)}`);
      if (!res.headersSent) send(500, { error: 'Bridge failed' });
      else res.end();
    }
  }
}
