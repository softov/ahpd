import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionToolName, actionTools } from '../src/connectors/actions.js';
import { connectorsChannel } from '../src/connectors/channel.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memoryRecords } from '../src/resources/records.js';
import { idOf } from '../src/sessions/catalog.js';
import { fileSessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { claude, createHost, hello, machine, peer, resetSdk, sessionQueries, settle } from './support/host.js';
import { directory, signIn } from './users-gate-helpers.js';
import type { Connector, ServedAdapter } from '../src/types/connectors.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { Contribution, LoaderContext } from '../src/types/plugin.js';
import type { Vault } from '../src/types/vault.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const HERE = dirname(fileURLToPath(import.meta.url));

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: HERE, paths: [HERE], version: sdkVersion(), hostName: 'test', configDir: HERE, log: () => {}, say: () => {},
});

/** One tool as the backend was handed it, which is how a model calls it. */
interface Tool {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  handler: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

/** One call the adapter ran, and what it was handed. */
interface Ran {
  id: string;
  action: string;
  input: Record<string, unknown>;
  config: Record<string, unknown>;
  /** The session's attachments folder, when the call carried one. */
  files?: string;
}

/** A vault that is a map, enough for one secret. */
const made = (): Vault => {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => { held.set(name, value); },
    delete: async (name) => held.delete(name),
    list: async () => [...held.keys()].sort(),
  };
};

/** The adapter every test serves: one action, and one write-only secret. */
const adapterOf = (ran: Ran[]): ServedAdapter => ({
  name: 'ap-resend',
  title: 'Resend',
  description: 'Sends email through one account.',
  by: 'test',
  schema: { type: 'object', properties: { apiKey: { type: 'string', writeOnly: true } } },
  capabilities: [
    {
      type: 'action',
      name: 'send_email',
      title: 'Send an email',
      description: 'Sends one email from the bound account.',
      input: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] },
    },
  ],
  open: () => undefined,
  run: async (connector: Connector, action: string, input: Record<string, unknown>, call?: { files?: string }) => {
    ran.push({
      id: connector.id,
      action,
      input,
      config: connector.config,
      ...(call?.files === undefined ? {} : { files: call.files }),
    });
    return { id: 'msg-1', to: input.to };
  },
});

/**
 * A host serving one adapter, and the connectors channel over a store in
 * memory.
 *
 * The channel is the real one, so a call the tool makes is checked the way a
 * daemon checks it: open, declared, and the owner's to read. A `contribution`
 * is folded in where the case is about a plugin's own road into a session - a
 * bot's reader and its start.
 */
async function world(over: Partial<HostOptions> = {}, contribution?: Contribution) {
  const collection = await memoryRecords().collection('connectors', { format: 'json' });
  const ran: Ran[] = [];
  const adapter = adapterOf(ran);
  const vault = made();
  const connectors = connectorsChannel({
    collection,
    adapters: () => ({ [adapter.name]: adapter }),
    vault: () => vault,
    check: () => undefined,
    onProblem: () => undefined,
  });
  const base: HostOptions = {
    path: HERE,
    agents: [claude({ paths: [HERE] })],
    ...machine(),
    adapters: { [adapter.name]: adapter },
    connectors: { refs: () => connectors.refs(), run: connectors.run },
    ...over,
  };
  const host = createHost(contribution === undefined ? base : foldHostOptions(base, [contribution]).options);
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));

  const method = (name: string) => {
    const one = connectors.methods[name];
    if (one === undefined) throw new Error(`the channel serves no ${name}`);
    return one;
  };
  // The daemon's own reader: a connector is made and removed here as the
  // daemon makes one on start, not as a client would through the gate.
  const put = async (id: string, owner = 'host') => await method('x-ahpd/connectors/put').handle({
    id, adapter: adapter.name, owner, config: { apiKey: 'sk-very-secret' },
  }, undefined, 'daemon');
  const remove = async (id: string) => await method('x-ahpd/connectors/remove').handle({ id }, undefined, 'daemon');

  /** A session started with a binding map, and the tools it was offered. */
  const start = async (uri: string, map?: Record<string, string>): Promise<Tool[]> => {
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'claude', config: map === undefined ? {} : { connectors: map } },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { serverTools?: Tool[] } };
    }).snapshot.state;
    return state.serverTools ?? [];
  };

  return { host, client, put, remove, start, ran, adapter };
}

/** The tools the last started session was handed, by name. */
const toolsOf = (): Record<string, Tool> => {
  const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
  return Object.fromEntries((servers?.ahp?.tools ?? []).map((one) => [one.name, one]));
};

/** Call one tool the way the model does, and answer what it said. */
const call = async (name: string, input: Record<string, unknown>) => {
  const tool = toolsOf()[name];
  if (tool === undefined) throw new Error(`the session was not handed ${name}`);
  return await tool.handler(input);
};

const said = (answer: { content: { text: string }[] }): string => answer.content[0]?.text ?? '';

describe('an action offered as a tool', () => {
  it('offers one binding with no connector argument, and runs on it', async () => {
    const { put, start, ran } = await world();
    await put('account-123');
    const tools = await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });
    const tool = tools.find((one) => one.name === 'ap_resend_send_email');
    // The name is the adapter and the action, and the schema is the
    // capability's own with no way to name a connector: this session has one.
    expect(tool?.inputSchema.properties).toEqual({ to: { type: 'string' } });
    expect(tool?.inputSchema.required).toEqual(['to']);
    expect(tool?.description).toBe('Sends one email from the bound account.');

    const answer = await call('ap_resend_send_email', { to: 'ana@example.com' });
    expect(answer.isError).toBeUndefined();
    expect(JSON.parse(said(answer))).toEqual({ id: 'msg-1', to: 'ana@example.com' });
    // The adapter ran on the bound connector, with the session's input and the
    // secret read back - and without a `connector` key of its own.
    expect(ran).toEqual([{
      id: 'account-123',
      action: 'send_email',
      input: { to: 'ana@example.com' },
      config: { apiKey: 'sk-very-secret' },
    }]);
  });

  it('offers the action in the first tool list of a session a plugin starts', async () => {
    /*
     * A bot's two halves: a reader that answers for the sessions its starts
     * made, and the door its start tells. The host names the URI before the
     * backend spawns, so the list the backend is started with already has the
     * bot's action - which is the difference from learning the URI only after
     * the start answers.
     */
    const { host: plugin, contribution } = pluginHost('bot', context());
    const known = new Set<string>();
    plugin.registerBindings((uri) => (known.has(uri) ? { work: 'connectors://ap-resend/account-123' } : undefined));
    const { put, client } = await world({ users: directory({ soft: ['session:create'] }) }, contribution);
    await signIn(client, 'soft');
    await put('account-123');

    const uri = await plugin.startSession({ owner: 'user:soft', prompt: 'Say hello' }, (one) => { known.add(one); });

    expect(known.has(uri)).toBe(true);
    expect(toolsOf()['ap_resend_send_email']).toBeDefined();
  });

  it('offers two bindings as one tool with a required choice', async () => {
    const { put, start, ran } = await world();
    await put('account-123');
    await put('account-456');
    const tools = await start('ahp-session:/two', {
      work: 'connectors://ap-resend/account-123',
      personal: 'connectors://ap-resend/account-456',
    });
    // One tool, not one for each binding: the adapter is the tool, and the
    // binding picks the account.
    expect(tools.filter((one) => one.name.startsWith('ap_resend_')).map((one) => one.name)).toEqual(['ap_resend_send_email']);
    const tool = tools.find((one) => one.name === 'ap_resend_send_email');
    expect(tool?.inputSchema.properties?.connector).toMatchObject({ type: 'string', enum: ['work', 'personal'] });
    expect(tool?.inputSchema.required).toEqual(['to', 'connector']);

    await call('ap_resend_send_email', { connector: 'personal', to: 'bo@example.com' });
    expect(ran.map((one) => one.id)).toEqual(['account-456']);
    expect(ran[0]?.input).toEqual({ to: 'bo@example.com' });
  });

  it('offers nothing to a session that binds no connector of the adapter', async () => {
    const { put, start } = await world();
    await put('account-123');
    const tools = await start('ahp-session:/unbound');
    expect(tools.map((one) => one.name)).not.toContain('ap_resend_send_email');
    expect(toolsOf()['ap_resend_send_email']).toBeUndefined();
  });

  it('refuses an alias the session does not bind, and runs nothing', async () => {
    const { put, start, ran } = await world();
    await put('account-123');
    await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });
    const answer = await call('ap_resend_send_email', { connector: 'personal', to: 'ana@example.com' });
    expect(answer.isError).toBe(true);
    expect(said(answer)).toContain('personal is not a ap-resend connector this session binds');
    expect(ran).toEqual([]);
  });

  it('refuses a call after the connector is removed, naming the alias and never the id', async () => {
    const { put, remove, start, ran } = await world();
    await put('account-123');
    await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });
    await remove('account-123');
    const answer = await call('ap_resend_send_email', { to: 'ana@example.com' });
    expect(answer.isError).toBe(true);
    expect(said(answer)).toContain('work');
    // The model's own name for it, and not the id the host resolved it to.
    expect(said(answer)).not.toContain('account-123');
    expect(ran).toEqual([]);
  });

  it('keeps the action tools when a client sets its own', async () => {
    const { host, client, put, start } = await world();
    await put('account-123');
    await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });
    const own: HostTool = {
      definition: { name: 'mine', description: 'mine', inputSchema: { type: 'object', properties: {} } },
      run: () => 'mine',
    };
    host.setTools([own]);
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: { serverTools?: { name: string }[] } };
    }).snapshot.state;
    const names = (state.serverTools ?? []).map((one) => one.name);
    expect(names).toContain('mine');
    expect(names).toContain('ap_resend_send_email');
  });

  it('keeps the secret out of what the model is told', async () => {
    const { put, start, ran } = await world();
    await put('account-123');
    const tools = await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });
    // The adapter gets the secret, because the connector is what carries it.
    const answer = await call('ap_resend_send_email', { to: 'ana@example.com' });
    expect(ran[0]?.config).toEqual({ apiKey: 'sk-very-secret' });
    // And nothing the model reads does: not the tool, not its answer.
    expect(JSON.stringify(tools)).not.toContain('sk-very-secret');
    expect(said(answer)).not.toContain('sk-very-secret');
  });

  it("hands the adapter the calling session's attachments folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-action-files-'));
    try {
      const store = fileSessions({ dir });
      const { put, start, ran } = await world({ sessions: store });
      await put('account-123');
      await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });

      await call('ap_resend_send_email', { to: 'ana@example.com' });

      expect(ran[0]?.files).toBe(store.attachmentsDir?.(idOf('ahp-session:/one')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hands the adapter no folder when the session store keeps none', async () => {
    const { put, start, ran } = await world();
    await put('account-123');
    await start('ahp-session:/one', { work: 'connectors://ap-resend/account-123' });

    await call('ap_resend_send_email', { to: 'ana@example.com' });

    expect(ran[0]).not.toHaveProperty('files');
  });
});

describe('building the action tools', () => {
  it('names a tool after the adapter and the action, with unsafe characters written as _', () => {
    expect(actionToolName('ap-resend', 'send_email')).toBe('ap_resend_send_email');
    expect(actionToolName('send email', 'go!')).toBe('send_email_go_');
  });

  it('keeps the first of two actions that meet on one name, and reports the second', () => {
    const problems: string[] = [];
    const ran: Ran[] = [];
    const one = { ...adapterOf(ran), name: 'ap-resend' };
    const two = { ...adapterOf(ran), name: 'ap_resend' };
    const tools = actionTools({ 'ap_resend': two, 'ap-resend': one }, async () => undefined, {
      bindings: () => ({}),
      attachmentsDir: () => undefined,
      principalOf: () => undefined,
      onProblem: (message) => { problems.push(message); },
    });
    // `-` sorts before `_`, so `ap-resend` is the one that got there first.
    expect(tools.map((tool) => tool.definition.name)).toEqual(['ap_resend_send_email']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ap_resend_send_email');
  });

  it('hands the adapter the tool call\'s partial content, and a call with nothing beside its input no call', async () => {
    const ran: Ran[] = [];
    const calls: unknown[] = [];
    const [tool] = actionTools({ 'ap-resend': { ...adapterOf(ran), name: 'ap-resend' } }, async (_id, _reader, _action, _input, call) => {
      calls.push(call);
      call?.setContent?.([{ type: 'text', text: 'half way' }]);
      return 'done';
    }, {
      bindings: () => ({ work: 'connectors://ap-resend/account-123' }),
      attachmentsDir: () => undefined,
      principalOf: () => undefined,
      onProblem: () => undefined,
    });
    const said: unknown[] = [];
    await tool!.run({ to: 'ana@example.com' }, { session: 'ahp-session:/one', setContent: (content: unknown) => { said.push(content); } } as never);
    expect(said).toEqual([[{ type: 'text', text: 'half way' }]]);
    await tool!.run({ to: 'ana@example.com' }, { session: 'ahp-session:/one' } as never);
    expect(calls[1]).toBeUndefined();
  });

  it('refuses a call for an owner who has not signed in, and runs nothing', async () => {
    const ran: Ran[] = [];
    const runs: string[] = [];
    const [tool] = actionTools({ 'ap-resend': { ...adapterOf(ran), name: 'ap-resend' } }, async (id) => { runs.push(id); }, {
      bindings: () => ({ work: 'connectors://ap-resend/account-123' }),
      attachmentsDir: () => undefined,
      principalOf: () => 'nobody',
      onProblem: () => undefined,
    });
    await expect(tool!.run({ to: 'ana@example.com' }, { session: 'ahp-session:/one' } as never))
      .rejects.toThrow('work: this session\'s owner has to sign in once');
    expect(runs).toEqual([]);
  });

  it('offers no tool for an adapter that runs nothing', () => {
    const ran: Ran[] = [];
    const { run: _run, ...quiet } = adapterOf(ran);
    const tools = actionTools({ quiet }, async () => undefined, {
      bindings: () => ({}),
      attachmentsDir: () => undefined,
      principalOf: () => undefined,
      onProblem: () => undefined,
    });
    expect(tools).toEqual([]);
  });
});
