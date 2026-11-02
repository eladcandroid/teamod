import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';
import type { AppState } from '../core/store.js';
import type { DesktopNote } from '../core/notify.js';
import { alive } from '../daemon/files.js';
import type { Args, Method } from '../ipc/api.js';
import { SocketClient, type SocketLike } from '../ipc/socket-client.js';
import { brandWords } from './brand.js';
import { mayCall } from './coverage.js';
import { notifyNatively } from './notify.js';
import { hasRich, richNodes } from './rich/rich.js';
import { SessionTools } from './session-tools.js';
import { TermHub, type TermKey } from './term-hub.js';
import { bandActive, statusLine } from './panes/band.js';
import { SCREENS } from './panes/index.js';
import { PANE_TITLES, Screens, type SiteId, type Viewport, isPane, isSite } from './screens.js';
import { type Node, type Surface, col } from './tree.js';

/** What the bridge tells the mod on stdout. Small lines only: a view is fetched, never pushed. */
export type BridgeLine =
  | { readonly t: 'ready'; readonly socket: string; readonly key: string }
  | { readonly t: 'dirty'; readonly routes: readonly string[] }
  | { readonly t: 'connected'; readonly connected: boolean }
  | { readonly t: 'status'; readonly text?: string }
  | { readonly t: 'toast'; readonly text: string }
  | { readonly t: 'open'; readonly pane: string }
  | { readonly t: 'error'; readonly text: string };

/** Biggest request a pane sends: a pasted image is the largest thing the API takes. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DIRTY_EVERY_MS = 100;
const MAX_SHOWN = 40;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;

export interface BridgeOptions {
  /** Where the socket goes. */
  readonly runDir: string;
  /** Reach the daemon (started if need be). */
  readonly connect: (caps: { readonly notify: (note: DesktopNote) => void }) => Promise<SocketClient>;
  readonly out: (line: BridgeLine) => void;
  /** The folder the session works in (its tools' folder). */
  readonly cwd?: string;
  readonly log?: (line: string) => void;
}

/** Connect to a daemon as the mod's screen. */
export const connectAsMod = (port: number, token: string, version: string, caps?: { readonly notify?: (note: DesktopNote) => void }): Promise<SocketClient> =>
  SocketClient.connect({
    url: `ws://127.0.0.1:${port}`,
    token,
    kind: 'mod',
    version,
    connect: (url) => new WebSocket(url) as unknown as SocketLike,
    caps: { notify: (note: DesktopNote) => caps?.notify?.(note) },
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

const SURFACES: readonly string[] = ['terminal', 'desktop', 'vscode', 'mobile'];
const asSize = (raw: string | null, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : fallback;
};

const viewportOf = (params: URLSearchParams): Viewport => {
  const surface = params.get('surface') ?? 'terminal';
  return { surface: (SURFACES.includes(surface) ? surface : 'terminal') as Surface, columns: asSize(params.get('columns'), 80), rows: asSize(params.get('rows'), 40) };
};

/**
 * One session's link to the daemon. Mod modules have no Node and no WebSocket, so this child holds
 * the daemon's state and answers the mod over a unix socket only the person can open.
 */
export class Bridge {
  readonly socketPath: string;
  readonly key = randomBytes(32).toString('hex');
  private client?: SocketClient;
  private state?: AppState;
  private server?: Server;
  /** The views the mod drew last, by site and viewport, to tell when one changed. */
  private readonly shown = new Map<string, { readonly site: SiteId; readonly viewport: Viewport; json: string }>();
  private readonly screens: Screens;
  private dirtyTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retryMs = RETRY_MIN_MS;
  private stopped = false;
  private lastStatus?: string;
  private readonly tools: SessionTools;
  private readonly terminals: TermHub;

  constructor(private readonly opts: BridgeOptions) {
    this.socketPath = path.join(opts.runDir, `${process.pid}.sock`);
    this.tools = new SessionTools((method, args) => this.callEngine(method, args), opts.cwd ?? process.cwd());
    this.terminals = new TermHub((key) => {
      if (!this.client) throw new Error('Not connected to the engine');
      return this.client.attachTerminal(key);
    });
    this.screens = new Screens(
      {
        terminals: this.terminals,
        getState: () => this.state,
        call: (method, args) => this.callEngine(method, args),
        markDirty: () => this.markDirty(),
        look: (channel) => {
          this.client?.store.dispatch({ type: 'view', view: channel?.startsWith('ws:') ? { kind: 'workspace', id: channel.slice(3), tab: 'chat' } : channel && /^(dm|group):/.test(channel) ? { kind: 'conversation', id: channel } : { kind: 'overview' } });
        },
      },
      SCREENS,
      (ctx, answer) => col(richNodes(ctx, answer), { gap: 1 }),
    );
  }

  /** One API method, for a press of the person's. */
  private async callEngine(method: string, args: readonly unknown[]): Promise<unknown> {
    if (!mayCall(method)) throw new Error(`teamod doesn't offer ${method}`);
    const client = this.client;
    if (!client) throw new Error('Not connected to the engine');
    const call = client.call as (m: Method, ...a: Args<Method>) => Promise<unknown>;
    return call.call(client, method, ...(args as Args<Method>));
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
    await this.tools.close().catch(() => undefined);
    this.terminals.closeAll();
    this.client?.close();
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
  }

  private async attach(): Promise<void> {
    const client = await this.opts.connect({
      notify: (note) => {
        notifyNatively(note);
        this.opts.out({ t: 'toast', text: `${brandWords(note.title)}: ${brandWords(note.body)}` });
      },
    });
    this.client = client;
    this.retryMs = RETRY_MIN_MS;
    this.state = client.store.getState();
    client.store.subscribe(() => {
      this.state = client.store.getState();
      this.markDirty();
    });
    client.onIntent((intent) => {
      if (intent.type === 'toast') this.opts.out({ t: 'toast', text: brandWords(intent.text) });
      if (intent.type === 'navigate') this.screens.follow(intent.view);
    });
    client.onClose((reason) => {
      if (this.client !== client) return;
      this.client = undefined;
      this.terminals.closeAll();
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

  /** Say which shown views changed, at most ten times a second. */
  private markDirty(): void {
    if (this.dirtyTimer) return;
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = undefined;
      const changed = new Set<string>();
      for (const view of this.shown.values()) {
        const now = JSON.stringify(this.screens.view(view.site, view.viewport));
        if (now !== view.json) {
          view.json = now;
          changed.add(view.site);
        }
      }
      if (changed.size) this.opts.out({ t: 'dirty', routes: [...changed] });
      const status = this.state ? statusLine(this.state) : undefined;
      if (status !== this.lastStatus) {
        this.lastStatus = status;
        this.opts.out({ t: 'status', ...(status ? { text: status } : {}) });
      }
    }, DIRTY_EVERY_MS);
  }

  /** Draw a site for the mod, and remember it was drawn so a change is told. */
  private draw(site: SiteId, viewport: Viewport): Node {
    const tree = this.screens.view(site, viewport);
    const key = `${site}|${viewport.surface}|${viewport.columns}|${viewport.rows}`;
    // Answers in the transcript come and go with scrolling: only the latest are watched.
    this.shown.delete(key);
    this.shown.set(key, { site, viewport, json: JSON.stringify(tree) });
    if (this.shown.size > MAX_SHOWN) this.shown.delete(this.shown.keys().next().value!);
    return tree;
  }

  /** `/teamod <words>`: a pane's name opens it; anything else is the engine's own command. */
  private async command(words: string): Promise<{ readonly open?: string; readonly title?: string; readonly text?: string }> {
    const first = words.split(/\s+/)[0] ?? '';
    if (!words) return { open: 'work', title: PANE_TITLES.work };
    if (isPane(first)) return { open: first, title: PANE_TITLES[first] };
    await this.callEngine('session.submit', [`/${words}`]);
    return { text: `/${words}` };
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
        const site = url.pathname.slice('/view/'.length);
        if (!isSite(site)) return send(404, { error: 'No such view' });
        const viewport = viewportOf(url.searchParams);
        const tree = this.draw(site, viewport);
        return send(200, { tree, ...(site === 'band' ? { active: this.state ? bandActive(this.state) : false } : {}) });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/view/')) {
        const site = url.pathname.slice('/view/'.length);
        for (const [key, view] of this.shown) if (view.site === site) this.shown.delete(key);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/rich') {
        const body = JSON.parse(await readBody(req)) as { text?: unknown; viewport?: Record<string, unknown> };
        if (typeof body.text !== 'string' || !hasRich(body.text)) return send(200, { plain: true });
        const site = `rich:${createHash('sha256').update(body.text).digest('hex').slice(0, 24)}` as const;
        this.screens.remember(body.text, site);
        const params = new URLSearchParams(Object.entries(body.viewport ?? {}).map(([k, v]) => [k, String(v)]));
        return send(200, { site, tree: this.draw(site, viewportOf(params)) });
      }
      if (req.method === 'POST' && url.pathname === '/term') {
        const body = JSON.parse(await readBody(req)) as { term?: unknown; rev?: unknown; seq?: unknown; keys?: unknown; cols?: unknown; rows?: unknown };
        if (typeof body.term !== 'string' || !this.client) return send(200, { rev: 0, acked: 0 });
        const cols = typeof body.cols === 'number' && body.cols > 0 ? body.cols : 80;
        const rows = typeof body.rows === 'number' && body.rows > 0 ? body.rows : 24;
        if (Array.isArray(body.keys) && typeof body.seq === 'number') this.terminals.keys(body.term, body.seq, body.keys as TermKey[], cols, rows);
        return send(200, this.terminals.frame(body.term, cols, rows, typeof body.rev === 'number' ? body.rev : 0));
      }
      if (req.method === 'GET' && url.pathname === '/tools') {
        return send(200, { tools: await this.tools.list() });
      }
      if (req.method === 'POST' && url.pathname === '/tool') {
        const body = JSON.parse(await readBody(req)) as { name?: unknown; args?: unknown };
        if (typeof body.name !== 'string') return send(400, { error: 'Which tool?' });
        return send(200, await this.tools.run(body.name, (body.args ?? {}) as Record<string, unknown>));
      }
      if (req.method === 'POST' && url.pathname === '/press') {
        const body = JSON.parse(await readBody(req)) as { site?: unknown; key?: unknown; value?: unknown; viewport?: Record<string, unknown> };
        if (typeof body.site !== 'string' || !isSite(body.site) || typeof body.key !== 'string') return send(400, { error: 'A site and a key, please' });
        const params = new URLSearchParams(Object.entries(body.viewport ?? {}).map(([k, v]) => [k, String(v)]));
        return send(200, await this.screens.press(body.site, body.key, typeof body.value === 'string' ? body.value : undefined, viewportOf(params)));
      }
      if (req.method === 'POST' && url.pathname === '/command') {
        const body = JSON.parse(await readBody(req)) as { text?: unknown };
        return send(200, await this.command(typeof body.text === 'string' ? body.text.trim() : ''));
      }
      if (req.method === 'POST' && url.pathname === '/call') {
        const body = JSON.parse(await readBody(req)) as { method?: unknown; args?: unknown };
        if (typeof body.method !== 'string' || !Array.isArray(body.args)) return send(400, { error: 'A method and args, please' });
        try {
          return send(200, { ok: true, value: await this.callEngine(body.method, body.args) });
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
