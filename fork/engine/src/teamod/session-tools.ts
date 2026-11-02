import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** A tool as the mod registers it: listed to the model as `mcp__teamod__<name>`. */
export interface SessionTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface SessionToolResult {
  readonly text: string;
  readonly isError: boolean;
}

interface Mounted {
  readonly url: string;
  readonly token: string;
  readonly suites: readonly string[];
}

/** The tool's name for the model: `teamod_board.task_create` is `board_task_create`, `teamod.who_can` is `team_who_can`. */
export function sessionToolName(suite: string, tool: string): string {
  const prefix = suite === 'teamod' ? 'team' : suite.replace(/^teamod_/, '');
  return tool.startsWith(`${prefix}_`) ? tool : `${prefix}_${tool}`;
}

/** Words in a tool's name that would decide for a person. None exists; this keeps it so through merges. */
const A_PERSONS_CHOICE = /(^|_)(approve|approval|decide|decision|trust|consent|allow)(_|$)/;

/**
 * The session's own tools: the bridge is an MCP client of the daemon's tool host. What a call may
 * do is the daemon's to judge (every call passes the run's gate there); this only finds it.
 */
export class SessionTools {
  private readonly clients = new Map<string, Client>();
  private readonly byName = new Map<string, { readonly suite: string; readonly tool: string }>();
  private mounted?: Mounted;

  constructor(
    private readonly call: (method: string, args: readonly unknown[]) => Promise<unknown>,
    private readonly cwd: string,
  ) {}

  private async client(suite: string): Promise<Client> {
    const found = this.clients.get(suite);
    if (found) return found;
    const mounted = this.mounted;
    if (!mounted) throw new Error('The tools are not mounted.');
    const client = new Client({ name: 'teamod-bridge', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp/${encodeURIComponent(suite)}`, mounted.url), { requestInit: { headers: { authorization: `Bearer ${mounted.token}` } } }));
    this.clients.set(suite, client);
    return client;
  }

  /** Mount them if need be, and say what there is. */
  async list(): Promise<SessionTool[]> {
    this.mounted ??= (await this.call('teamod.sessionTools', [this.cwd])) as Mounted;
    const tools: SessionTool[] = [];
    for (const suite of this.mounted.suites) {
      const client = await this.client(suite);
      for (const tool of (await client.listTools()).tools) {
        const name = sessionToolName(suite, tool.name);
        if (A_PERSONS_CHOICE.test(name)) continue;
        this.byName.set(name, { suite, tool: tool.name });
        tools.push({ name, description: tool.description ?? '', inputSchema: tool.inputSchema as Record<string, unknown> });
      }
    }
    return tools;
  }

  async run(name: string, args: Record<string, unknown>): Promise<SessionToolResult> {
    if (!this.byName.size) await this.list();
    const found = this.byName.get(name);
    if (!found) return { text: `There is no tool named ${name}.`, isError: true };
    const client = await this.client(found.suite);
    const result = await client.callTool({ name: found.tool, arguments: args });
    const content = Array.isArray(result.content) ? (result.content as ReadonlyArray<{ readonly type?: string; readonly text?: string }>) : [];
    return { text: content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type ?? 'content'}]`)).join('\n'), isError: result.isError === true };
  }

  async close(): Promise<void> {
    const token = this.mounted?.token;
    this.mounted = undefined;
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.byName.clear();
    if (token) await this.call('teamod.closeSessionTools', [token]).catch(() => undefined);
  }
}
