import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memoryAutomations } from '../src/automations.js';
import { memorySessions } from '../src/sessions.js';
import { clientPluginsIn } from '../src/clientplugins.js';
import { idOf } from '../src/catalog.js';
import { localPath } from '../src/fileuri.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { AutomationRun, AutomationStore, StartSession } from '../src/types/automations.js';
import type { Principal, Users } from '../src/types/users.js';
import type { Chosen, MessageFrom, Session } from '../src/types/session.js';

/*
 * Automations, on a host that holds no clock.
 *
 * `memoryAutomations` is half a store on purpose, and this is the half it has:
 * definitions written, patched and run by somebody pressing Run. What it will
 * not do it says by leaving `nextRunAt` off rather than by refusing the
 * definition - a client reads that as "this host will not fire that".
 *
 * The other half is `scheduledAutomations`, and it has its own file.
 */

const DIR = '/tmp/autos';
const AUTOMATIONS = 'ahp-automations://';

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean | Promise<boolean>, tries = 200): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

async function connected(withStore = true, pace = 0, held = memoryAutomations()) {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace })],
    ...(withStore ? { automations: held } : {}),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { host, client, peer: p, store: held };
}

/** The value as a keyed object, for reading into a definition. */
const keyed = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

/** What the host refused on a channel, as the sentences it refused with. */
const refusals = (p: ReturnType<typeof peer>, channel: string): string[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; rejectionReason?: string })
  .filter((n) => n.channel === channel && n.rejectionReason !== undefined)
  .map((n) => n.rejectionReason as string);

const ONE = 'ahp-automation:/nightly';
const PLAIN = 'ahp-automation:/plain';

/** Write one, the way a client does: a request, and the host says what it holds. */
const write = async (
  client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
  definition: Record<string, unknown>,
  resource = ONE,
) => {
  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/createRequested', resource, definition } },
  });
};

const entries = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }) => {
  const opened = await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } }) as {
    snapshot: { state: { entries: Record<string, unknown>[] } };
  };
  return opened.snapshot.state.entries;
};

/** The run channel's state, read the way a client watching it would. */
const runState = async (
  client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
  resource: string,
) => (await client.handle({ method: 'subscribe', params: { channel: resource } }) as {
  snapshot: {
    state: {
      automation: string;
      lifecycle: { status: string; startedAt?: string; completedAt?: string; error?: { message?: string } };
      sessions: string[];
      primarySession?: string;
      _meta?: Record<string, unknown>;
    };
  };
}).snapshot.state;

const DEFINITION = {
  title: 'Nightly review',
  enabled: true,
  message: { text: 'review what changed today' },
  session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
  triggers: [],
};

it('answers the trigger list on the root channel, and refuses another', async () => {
  const { client } = await connected();
  /*
   * `ListAutomationTriggerDefinitionsParams` declares `channel: 'ahp-root://'`
   * - the triggers a host understands are the *host's*, not a property of the
   * automations it happens to be holding, so the question is asked of the root.
   *
   * The automations channel is the obvious wrong guess and the one a client
   * actually makes. Refused rather than answered: a host that took it would
   * make that client look correct until the first conformant host refused it
   * with nothing on screen saying why.
   */
  await expect(client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: AUTOMATIONS },
  })).rejects.toMatchObject({ code: -32602 });
  await expect(client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: 'ahp-root://' },
  })).resolves.toBeTruthy();
  // And a client that named no channel at all has named nothing wrong.
  await expect(client.handle({
    method: 'listAutomationTriggerDefinitions', params: {},
  })).resolves.toBeTruthy();
});

it('answers a run on the automations channel, which is the one it declares', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  // The two automation commands are the exception: they declare
  // `ahp-automations://`, because a run is of an automation this store holds.
  await expect(client.handle({
    method: 'runAutomation', params: { channel: 'ahp-root://', automation: ONE, requestId: 'r' },
  })).rejects.toMatchObject({ code: -32602 });
});

/*
 * The catalogue under the spelling the reference host used for two weeks.
 *
 * `ahp-automations://catalog` was an authority added so the URI survived a
 * round trip through VS Code's own URI class; the protocol never carried it,
 * and Insiders builds from that window still subscribe under it. It was
 * refused here with `-32001` about a session nobody had named.
 */
describe('the catalogue under its old spelling', () => {
  const OLD = 'ahp-automations://catalog';

  it('is subscribed, and answered under the name the client used', async () => {
    const { client, peer: p } = await connected();
    const opened = await client.handle({ method: 'subscribe', params: { channel: OLD } }) as {
      snapshot: { resource: string; state: { entries: unknown[] } };
    };
    expect(opened.snapshot.resource).toBe(OLD);
    expect(opened.snapshot.state.entries).toEqual([]);
    // Written under the old spelling too, and the action comes back under it:
    // a client that asked about one URI is watching that URI, not another.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: OLD, action: { type: 'automation/createRequested', resource: ONE, definition: DEFINITION } },
    });
    await settle();
    expect(actions(p, OLD).map((one) => one.type)).toContain('automation/set');
    expect(actions(p, AUTOMATIONS)).toEqual([]);
  });

  it('is what the two automation commands may name', async () => {
    const { client } = await connected();
    await write(client, DEFINITION);
    await expect(client.handle({
      method: 'fetchAutomationRuns', params: { channel: OLD, automation: ONE },
    })).resolves.toBeTruthy();
  });

  it('is resumed under it on reconnect, and replayed', async () => {
    const { host, client } = await connected();
    await client.handle({ method: 'subscribe', params: { channel: OLD } });
    // Dropped and back, having seen nothing since it connected. The one
    // action in the gap is the catalogue's, dispatched under the name this
    // host holds it by - which is what the replay is keyed on.
    await write(client, DEFINITION);
    await settle();
    const back = peer();
    const again = host.accept(back);
    const answer = await again.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'a', lastSeenServerSeq: 0, subscriptions: [OLD] },
    }) as { type: string; actions?: { channel: string }[]; missing?: string[] };
    expect(answer.type).toBe('replay');
    expect(answer.missing).toEqual([]);
    expect(answer.actions?.map((one) => one.channel)).toContain(AUTOMATIONS);
  });
});

it('advertises the event triggers it fires, and manual is not one', async () => {
  const { client } = await connected();
  const found = await client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: 'ahp-root://' },
  }) as { items: { type: string }[] };
  // This command answers with *event* triggers only. A schedule is
  // protocol-defined and never listed here, and manual is not a trigger at
  // all - an empty trigger list on a definition is what manual-only means. A
  // store that put `manual` here would be offering a type a client would then
  // save as an event trigger nothing ever fires.
  expect(found.items.map((one) => one.type)).toEqual(['session', 'watch']);
});

it('answers -32601 for the whole channel when the host was given no store', async () => {
  const { client } = await connected(false);
  // A daemon that runs the sessions somebody asks for and schedules nothing
  // says so this way, rather than by advertising an empty catalogue.
  await expect(client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } })).rejects.toThrow();
  await expect(client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: 'ahp-root://' },
  })).rejects.toMatchObject({ code: -32601 });
  await expect(client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
  })).rejects.toMatchObject({ code: -32601 });
});

it('takes a definition as a request and answers with what it actually holds', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, DEFINITION);

  // `createRequested` is a request. What goes out is `automation/set`, which
  // is the host saying what it has - not an echo of what was asked for.
  const said = actions(p, AUTOMATIONS).filter((one) => one.type === 'automation/set');
  expect(said).toHaveLength(1);
  const held = said[0]?.automation as { resource: string; operations: string[]; runs: unknown[] };
  expect(held.resource).toBe(ONE);
  expect(held.runs).toEqual([]);
  expect(held.operations).toEqual(['update', 'remove', 'run']);
  // And no `nextRunAt`, because nothing will fire it.
  expect('nextRunAt' in held).toBe(false);
});

it('patches rather than overwrites, so one client does not revert another', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/updateRequested', resource: ONE, changes: { title: 'Renamed' } } },
  });
  const found = (await entries(client))[0] as { definition: Record<string, unknown> };
  expect(found.definition.title).toBe('Renamed');
  // The keys the patch did not mention are still there.
  expect(found.definition.message).toEqual({ text: 'review what changed today' });
});

/*
 * A definition that disables itself.
 *
 * The protocol's `disableConditions` is a list where each kind may appear at
 * most once, and a condition a host cannot read is one it cannot honour. So both
 * are refused at the write, naming the kind repeated or the field wrong - a
 * definition kept and never acted on would be an automation somebody asked to
 * stop and which never stops.
 */
describe('a definition that disables itself', () => {
  const RULES = [
    { kind: 'afterRuns', max: 2 },
    { kind: 'afterDate', date: '2030-01-01T00:00:00Z' },
  ];

  it('takes one of each kind, and echoes them on the entry', async () => {
    const { client } = await connected();
    await write(client, { ...DEFINITION, disableConditions: RULES });
    const found = (await entries(client))[0] as { definition: Record<string, unknown> };
    expect(found.definition.disableConditions).toEqual(RULES);
  });

  it('refuses a kind named twice, and keeps nothing', async () => {
    const { client, peer: p } = await connected();
    await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
    await write(client, {
      ...DEFINITION,
      disableConditions: [{ kind: 'afterRuns', max: 2 }, { kind: 'afterRuns', max: 5 }],
    });
    await settle();
    expect(refusals(p, AUTOMATIONS).at(-1)).toContain('afterRuns is named twice');
    // Refused before the store, so nothing was made and nothing announced.
    expect(actions(p, AUTOMATIONS).filter((one) => one.type === 'automation/set')).toEqual([]);
    expect(await entries(client)).toEqual([]);
  });

  it('refuses a cap that is not a whole number of one or more', async () => {
    for (const max of [0, 1.5]) {
      const { client, peer: p } = await connected();
      await write(client, { ...DEFINITION, disableConditions: [{ kind: 'afterRuns', max }] });
      await settle();
      expect(refusals(p, AUTOMATIONS).at(-1)).toContain('afterRuns has to carry a max');
    }
  });

  it('refuses a date that is not a timestamp, and a kind it does not know', async () => {
    const dated = await connected();
    await write(dated.client, { ...DEFINITION, disableConditions: [{ kind: 'afterDate', date: 'soon' }] });
    await settle();
    expect(refusals(dated.peer, AUTOMATIONS).at(-1)).toContain('afterDate has to carry a date');

    const strange = await connected();
    await write(strange.client, { ...DEFINITION, disableConditions: [{ kind: 'afterTurns', n: 2 }] });
    await settle();
    expect(refusals(strange.peer, AUTOMATIONS).at(-1)).toContain('afterTurns is not a kind');
  });

  it('refuses a patch whose conditions do not read, and leaves a patch about something else alone', async () => {
    const { client, peer: p } = await connected();
    await write(client, { ...DEFINITION, disableConditions: RULES });
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: AUTOMATIONS,
        action: {
          type: 'automation/updateRequested',
          resource: ONE,
          changes: { disableConditions: [{ kind: 'afterDate', date: 7 }] },
        },
      },
    });
    await settle();
    expect(refusals(p, AUTOMATIONS).at(-1)).toContain('afterDate has to carry a date');
    // And it still holds what it held: a refused patch changes nothing.
    const kept = (await entries(client))[0] as { definition: { disableConditions: unknown } };
    expect(kept.definition.disableConditions).toEqual(RULES);

    // A patch that names no conditions is a patch about something else.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: AUTOMATIONS, action: { type: 'automation/updateRequested', resource: ONE, changes: { title: 'Renamed' } } },
    });
    await settle();
    const renamed = (await entries(client))[0] as { definition: { title: string; disableConditions: unknown } };
    expect(renamed.definition.title).toBe('Renamed');
    expect(renamed.definition.disableConditions).toEqual(RULES);
  });
});

/*
 * Client plugins on a template.
 *
 * The protocol asks a client not to set `customizations` until the host
 * advertises the capability, and this host advertises none - it has nowhere to
 * load them. So a create or a patch carrying a non-empty list is refused
 * before the store, rather than kept as a definition whose runs load nothing.
 */
describe('a template that names client plugins', () => {
  const PLUGINS = [{ id: 'p1', type: 'plugin', uri: 'vscode-file:///plugin', nonce: 'n1' }];
  const TEMPLATE = { ...DEFINITION.session, customizations: PLUGINS };

  it('refuses a create whose template carries one, and keeps nothing', async () => {
    const { client, peer: p } = await connected();
    await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
    await write(client, { ...DEFINITION, session: TEMPLATE });
    await settle();
    expect(refusals(p, AUTOMATIONS).at(-1)).toContain('does not load client plugins');
    // Refused before the store, so nothing was made and nothing announced.
    expect(actions(p, AUTOMATIONS).filter((one) => one.type === 'automation/set')).toEqual([]);
    expect(await entries(client)).toEqual([]);
  });

  it('refuses a patch that adds one, and leaves the entry as it held it', async () => {
    const { client, peer: p } = await connected();
    await write(client, DEFINITION);
    await client.handle({
      method: 'dispatchAction',
      params: { channel: AUTOMATIONS, action: { type: 'automation/updateRequested', resource: ONE, changes: { session: TEMPLATE } } },
    });
    await settle();
    expect(refusals(p, AUTOMATIONS).at(-1)).toContain('does not load client plugins');
    const kept = (await entries(client))[0] as { definition: { session: Record<string, unknown> } };
    expect('customizations' in kept.definition.session).toBe(false);
  });

  it('takes an empty list, and takes no list at all', async () => {
    const empty = await connected();
    await write(empty.client, { ...DEFINITION, session: { ...DEFINITION.session, customizations: [] } });
    expect(await entries(empty.client)).toHaveLength(1);

    const none = await connected();
    await write(none.client, DEFINITION);
    expect(await entries(none.client)).toHaveLength(1);
  });

  it('advertises no customizations capability, so a client is not offered one', async () => {
    const host = createHost({ path: DIR, agents: [echo({ path: DIR })], automations: memoryAutomations() });
    const answer = await host.accept(peer()).handle({
      method: 'initialize',
      params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: [] },
    }) as { automations?: Record<string, unknown> };
    expect(answer.automations).toEqual({ create: {}, schedules: {} });
    expect('customizations' in (answer.automations ?? {})).toBe(false);
  });
});

/*
 * The same template, on a host that keeps client plugins.
 *
 * A plugin a template names lives on the machine of the client that wrote it,
 * and the run happens with nobody connected - so the host copies each one
 * while that client is still here, and a run loads a path of this host's.
 *
 * The client side is a fake answering the two `resource*` methods a copy is
 * made of, over a tree held in memory, and what is counted is what it was
 * asked for: a template saved twice with the same revision is a plugin this
 * host already has and reads nothing for.
 */
describe('a host that keeps client plugins', () => {
  const PLUGIN = 'virtual://plugin/one';
  const TREE: Record<string, string> = {
    [`${PLUGIN}/plugin.json`]: '{"name":"one"}',
    [`${PLUGIN}/agents/one.md`]: 'agent one',
  };
  const ONE_PLUGIN = [{ id: 'p1', type: 'plugin', uri: PLUGIN, nonce: 'n1', name: 'one' }];

  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** What a client would list for one URI, worked out from the tree it holds. */
  const listing = (uri: string, tree: Record<string, string>): unknown => {
    const prefix = uri.endsWith('/') ? uri : `${uri}/`;
    const entries: { name: string; type: string }[] = [];
    for (const path of Object.keys(tree)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (entries.some((one) => one.name === name)) continue;
      entries.push({ name, type: slash === -1 ? 'file' : 'directory' });
    }
    return { entries };
  };

  /** A client that serves one tree, says what it was asked to read, and may be held open. */
  const reading = (
    tree: Record<string, string>,
    asked: string[],
    gone: Set<string> = new Set(),
    before?: (method: string, uri: string) => Promise<void> | undefined,
  ): Peer & { notes: { method: string; params: unknown }[] } => {
    const notes: { method: string; params: unknown }[] = [];
    return {
      notes,
      send: () => {},
      notify: (method, params) => notes.push({ method, params }),
      request: async (method: string, params: unknown) => {
        const uri = String((params as { uri?: unknown }).uri ?? '');
        if (gone.has(uri)) throw new Error(`${uri} is not there`);
        // A call a test holds open, so what a capture is doing while it is
        // still doing it can be looked at.
        const waiting = before?.(method, uri);
        if (waiting !== undefined) await waiting;
        if (method === 'resourceList') { asked.push(uri); return listing(uri, tree); }
        if (method === 'resourceRead') {
          asked.push(uri);
          const data = tree[uri];
          if (data === undefined) throw new Error(`${uri} is not there`);
          return { data, encoding: 'utf-8' };
        }
        return {};
      },
      answered: () => {},
      close: () => {},
    };
  };

  /** A host with a directory for its copies, and the calls its backend was started with. */
  async function serving(
    tree: Record<string, string> = TREE,
    gone?: Set<string>,
    before?: (method: string, uri: string) => Promise<void> | undefined,
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-automation-plugins-'));
    dirs.push(dir);
    const copies = join(dir, 'copies');
    const asked: string[] = [];
    const started: { path: string }[][] = [];
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start) => {
        started.push(start.plugins ?? []);
        return base.create(start);
      },
    };
    let host: ReturnType<typeof createHost>;
    host = createHost({
      path: dir,
      agents: [agent],
      automations: memoryAutomations(),
      clientPlugins: clientPluginsIn(copies, () => host.clients),
    });
    const p = reading(tree, asked, gone, before);
    const client = host.accept(p);
    await client.handle({
      method: 'initialize',
      params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
    });
    return { host, client, peer: p, copies, asked, started };
  }

  /** A template whose session names these plugins. */
  const naming = (plugins: unknown[]) => ({ ...DEFINITION, session: { ...DEFINITION.session, customizations: plugins } });

  /** Patch the automation's session, the way a client editing it does. */
  const patch = async (
    client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
    session: Record<string, unknown>,
  ) => client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/updateRequested', resource: ONE, changes: { session } } },
  });

  /** The copies one automation's entry reports, and the paths on this disk behind them. */
  const kept = async (client: Parameters<typeof entries>[0]) => {
    const found = (await entries(client))[0] as { customizations?: { id: string; uri: string; name: string }[] };
    return (found.customizations ?? []).map((one) => ({ ...one, path: localPath(one.uri) }));
  };

  it('copies what a template names, and off its own disk rather than the client\'s', async () => {
    const { client, asked, copies: under } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const held = await kept(client);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ id: 'p1', name: 'one' });
    // Under the folder the client plugins port was given, in `automations/`,
    // and holding the client's own files: a run loads this path, with nobody
    // connected to serve the URI the template named.
    expect(held[0]?.uri.startsWith('file://')).toBe(true);
    expect(held[0]?.path.startsWith(join(under, 'automations'))).toBe(true);
    expect(existsSync(join(held[0]?.path ?? '', 'plugin.json'))).toBe(true);
    expect(existsSync(join(held[0]?.path ?? '', 'agents', 'one.md'))).toBe(true);
    expect(asked).toContain(PLUGIN);
  });

  it('reads nothing from the client when the same revision is saved again', async () => {
    const { client, asked } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const before = asked.length;
    await patch(client, { ...DEFINITION.session, customizations: ONE_PLUGIN });
    await settle();
    expect(asked.length).toBe(before);
    expect(await kept(client)).toHaveLength(1);
  });

  it('copies again when the revision moved, and keeps only the copy it names', async () => {
    const { client } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const [first] = await kept(client);
    await patch(client, { ...DEFINITION.session, customizations: [{ ...ONE_PLUGIN[0], nonce: 'n2' }] });
    await settle();

    const [second] = await kept(client);
    expect(second?.uri).not.toBe(first?.uri);
    expect(existsSync(join(second?.path ?? '', 'plugin.json'))).toBe(true);
    // No automation names the first one any more, so it is not left behind.
    expect(existsSync(first?.path ?? '')).toBe(false);
  });

  it('takes an empty list as the template having none, and drops the copies', async () => {
    const { client, asked } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const [copy] = await kept(client);
    const before = asked.length;

    await patch(client, { ...DEFINITION.session, customizations: [] });
    await settle();
    // A list saying "none" is a template with no plugins, which is the copies
    // going - not a patch about something else, which leaves them where they
    // are. And nothing is read from the client to say so.
    expect(existsSync(copy?.path ?? '')).toBe(false);
    expect(await kept(client)).toEqual([]);
    expect(asked.length).toBe(before);
  });

  it('refuses the whole action when a copy fails, and keeps what it had', async () => {
    const { client, peer: p } = await serving(TREE, new Set([`${PLUGIN}/agents/one.md`]));
    await write(client, DEFINITION);
    await settle();
    await patch(client, { ...DEFINITION.session, customizations: ONE_PLUGIN });
    await settle();

    expect(refusals(p, AUTOMATIONS).at(-1)).toContain(`${PLUGIN}/agents/one.md`);
    // The entry is the one it was: the copy half made is not a template this
    // host kept, because every run of it would load half of what it names.
    expect(await kept(client)).toEqual([]);
  });

  it('refuses a template whose plugins share an id, which nothing could read', async () => {
    const { client, peer: p } = await serving();
    await write(client, naming([...ONE_PLUGIN, { id: 'p1', type: 'plugin', uri: PLUGIN, nonce: 'n2' }]));
    await settle();
    expect(refusals(p, AUTOMATIONS).at(-1)).toContain('an id of its own');
    expect(await entries(client)).toEqual([]);
  });

  it('starts a run with the copies, as an active client of the run\'s own session', async () => {
    const { client, asked, started } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const run = await client.handle({
      method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
    }) as { resource: string };
    await until(() => started.length > 0);
    await settle();

    // The backend was handed the copy, which is the whole point: a plugin is
    // loaded when a session starts and cannot be added to one after.
    const given = started.at(-1) ?? [];
    expect(given).toHaveLength(1);
    expect(existsSync(join(given[0]?.path ?? '', 'plugin.json'))).toBe(true);

    // And the run asks the client for nothing: what it loads is this host's
    // own copy, so a run at nine o'clock needs nobody connected.
    const before = asked.length;
    const state = await runState(client, run.resource);
    const opened = await client.handle({
      method: 'subscribe', params: { channel: state.sessions[0] ?? '' },
    }) as { snapshot: { state: { activeClients?: { clientId: string; customizations?: { uri?: string }[] }[] } } };
    const mine = (opened.snapshot.state.activeClients ?? []).find((one) => one.clientId === 'Automation');
    expect(mine?.customizations).toHaveLength(1);
    expect(localPath(mine?.customizations?.[0]?.uri ?? '')).toBe(given[0]?.path);
    expect(asked.length).toBe(before);
  });

  it('removes the copies when the automation goes', async () => {
    const { client } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const [copy] = await kept(client);
    await client.handle({
      method: 'dispatchAction',
      params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: ONE } },
    });
    await settle();
    expect(existsSync(copy?.path ?? '')).toBe(false);
    expect(await entries(client)).toEqual([]);
  });

  it('keeps a copy a run was handed, after the automation that named it goes', async () => {
    const { client, started } = await serving();
    await write(client, naming(ONE_PLUGIN));
    await settle();
    await client.handle({
      method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
    });
    await until(() => started.length > 0);
    await settle();
    const [copy] = await kept(client);

    // The run's session is open and reading the copy where it is, so removing
    // the automation is not the host's to answer by taking the directory out
    // from under a turn.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: ONE } },
    });
    await settle();
    expect(await entries(client)).toEqual([]);
    expect(existsSync(join(copy?.path ?? '', 'plugin.json'))).toBe(true);
  });

  it('keeps a copy a capture is still making, while another write prunes', async () => {
    const other = 'virtual://plugin/other';
    let letGo: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { letGo = resolve; });
    const { host, client } = await serving(
      { ...TREE, [`${other}/plugin.json`]: '{"name":"other"}' },
      undefined,
      (method, uri) => (method === 'resourceRead' && uri.startsWith(other) ? blocked : undefined),
    );
    /*
     * A second connection, because a dispatch that waits holds this
     * connection's later dispatches behind it - and the write that prunes has
     * to happen while the first one is still capturing.
     */
    const second = host.accept(peer());
    await second.handle({
      method: 'initialize',
      params: { clientId: 'b', protocolVersions: ['0.9.0'], initialSubscriptions: [] },
    });

    // One plugin is already this automation's, so the patch below has a copy
    // of its own to prune away and the test is about the second one alone.
    await write(client, naming(ONE_PLUGIN));
    await settle();
    const [first] = await kept(client);
    expect(first?.path).toBeTruthy();

    // A patch naming a second plugin, whose copy the client is still serving.
    // Its entry is not stored yet, so no automation names that copy.
    await patch(client, naming([{ id: 'p2', type: 'plugin', uri: other, nonce: 'n2', name: 'other' }]).session);
    await settle();

    // And a write that prunes while that capture is still going. It takes the
    // copy the entry no longer names, and leaves the one being made.
    await patch(second, naming([]).session);
    await settle();
    expect(existsSync(first?.path ?? '')).toBe(false);

    letGo?.();
    await until(async () => (await kept(client)).some((one) => one.id === 'p2'));
    await settle();

    const copy = await kept(client);
    expect(copy.map((one) => one.id)).toEqual(['p2']);
    expect(existsSync(join(copy[0]?.path ?? '', 'plugin.json'))).toBe(true);
  });

  it('advertises the customizations capability, so a client may name one', async () => {
    const { host } = await serving();
    const answer = await host.accept(peer()).handle({
      method: 'initialize',
      params: { clientId: 'b', protocolVersions: ['0.9.0'], initialSubscriptions: [] },
    }) as { automations?: Record<string, unknown> };
    expect(answer.automations).toEqual({ create: {}, schedules: {}, customizations: {} });
  });
});

it('keeps the pinned chat the host holds, whatever a client writes', async () => {
  const auto = memoryAutomations();
  const { client } = await connected(true, 0, auto);
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });

  /*
   * Which chat a pinned automation works in is the host's own note - it is
   * written as a run makes the chat and read back by the next one - so a client
   * writing it would be choosing a chat for a run of its own to type in, which
   * is the one road into a session that does not go through `createSession`.
   * The value is dropped, and everything else the client wrote in the same place
   * stays: the rest of `ahpd` is what a client says about waking.
   */
  await write(client, {
    ...DEFINITION,
    _meta: {
      ahpd: { session: 'pinned', overlap: 'steer', pinnedSession: 'claude:/somebody-elses' },
      note: 'kept',
    },
  });
  const written = (await entries(client))[0] as { definition: Record<string, unknown> };
  expect(keyed(keyed(written.definition['_meta'])['ahpd']))
    .toEqual({ session: 'pinned', overlap: 'steer' });
  expect(keyed(written.definition['_meta'])['note']).toBe('kept');

  // And once the host has one, a patch cannot move it: what the client asked
  // for is answered with the chat the host holds rather than the one it named.
  auto.update(ONE, {
    _meta: { ahpd: { session: 'pinned', overlap: 'steer', pinnedSession: 'claude:/mine' }, note: 'kept' },
  });
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: AUTOMATIONS,
      action: {
        type: 'automation/updateRequested',
        resource: ONE,
        changes: { _meta: { ahpd: { overlap: 'skip', pinnedSession: 'claude:/theirs' } } },
      },
    },
  });
  expect(keyed(keyed(auto.get(ONE)?.definition['_meta'])['ahpd']))
    .toEqual({ overlap: 'skip', pinnedSession: 'claude:/mine' });
});

it('offers to run one that is switched off, and a press starts it', async () => {
  const { client, store } = await connected();
  await write(client, { ...DEFINITION, enabled: false });
  const found = (await entries(client))[0] as { operations: string[] };
  // `enabled` governs the schedule and nothing else, which is what the protocol
  // says a disable condition governs too: a person pressing Run gets a run, so
  // the button is offered beside the switch rather than arguing with it.
  expect(found.operations).toEqual(['update', 'remove', 'run']);
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
  }) as { resource: string };
  expect(run.resource.startsWith('ahp-automation-run:/')).toBe(true);

  // And what it will not do is fire for itself: a run the schedule asked for is
  // the one `enabled` refuses.
  const started = await store.run(ONE, { kind: 'trigger' }, async () => 'ahp-session:/never');
  expect(started).toBeUndefined();
});

/*
 * What an automation does once its own definition says it has had enough.
 *
 * `afterRuns` is a count of scheduled runs and `afterDate` is a date, and the
 * protocol puts the number used on the entry rather than deriving it from the
 * runs - so what a client reads is what the store wrote down, and a manual run
 * is neither counted nor refused.
 */
describe('an automation that switches itself off', () => {
  const CAPPED = { ...DEFINITION, disableConditions: [{ kind: 'afterRuns', max: 2 }] };

  /** One run the schedule asked for, which is the only kind a condition gates. */
  const scheduled = (store: AutomationStore): Promise<AutomationRun | undefined> =>
    store.run(ONE, { kind: 'trigger', triggerId: 't1' }, async () => 'ahp-session:/made');

  const entry = async (client: Parameters<typeof entries>[0]) =>
    (await entries(client))[0] as {
      runCount?: number;
      definition: { enabled?: boolean };
      operations: string[];
    };

  it('counts scheduled runs, and switches itself off at the cap', async () => {
    const { client, store } = await connected();
    await write(client, CAPPED);
    // The count is on the entry from the start, because the definition names an
    // allowance and "none used" is what a fresh one is.
    expect((await entry(client)).runCount).toBe(0);

    await scheduled(store);
    expect((await entry(client)).runCount).toBe(1);

    await scheduled(store);
    const capped = await entry(client);
    expect(capped.runCount).toBe(2);
    // Met, so the switch is thrown - and the automation is still there, still
    // runnable by hand, and its entry says what happened.
    expect(capped.definition.enabled).toBe(false);
    expect(capped.operations).toContain('run');
    // The cap ends the allowance rather than refusing one run: nothing fires
    // for it any more.
    expect(await scheduled(store)).toBeUndefined();
    expect((await entry(client)).runCount).toBe(2);
  });

  it('runs by hand once it is switched off, without counting or re-enabling it', async () => {
    const { client, store } = await connected();
    await write(client, CAPPED);
    await scheduled(store);
    await scheduled(store);

    const run = await client.handle({
      method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
    }) as { resource: string };
    expect(run.resource.startsWith('ahp-automation-run:/')).toBe(true);
    await settle();
    // The protocol counts scheduled runs, and a press is not one: the number
    // stays where the allowance left it, and pressing Run does not switch a
    // switched-off automation back on.
    const found = await entry(client);
    expect(found.runCount).toBe(2);
    expect(found.definition.enabled).toBe(false);
  });

  it('reads a fresh allowance when one is switched back on, and when afterRuns is added', async () => {
    const { client, store } = await connected();
    await write(client, CAPPED);
    await scheduled(store);
    await scheduled(store);
    expect((await entry(client)).runCount).toBe(2);

    store.update(ONE, { enabled: true });
    const again = await entry(client);
    expect(again.definition.enabled).toBe(true);
    expect(again.runCount).toBe(0);

    // A cap raised is the allowance that was already running, not a new one.
    await scheduled(store);
    store.update(ONE, { disableConditions: [{ kind: 'afterRuns', max: 5 }] });
    expect((await entry(client)).runCount).toBe(1);

    // And one added where there was none is a new allowance, so the runs before
    // it were never counted against it.
    const { client: plain, store: bare } = await connected();
    await write(plain, DEFINITION);
    expect((await entries(plain))[0]?.runCount).toBeUndefined();
    await scheduled(bare);
    bare.update(ONE, { disableConditions: [{ kind: 'afterRuns', max: 5 }] });
    expect((await entry(plain)).runCount).toBe(0);
  });

  it('drops the count when the conditions are cleared, and re-enables nothing', async () => {
    const { client, store } = await connected();
    await write(client, CAPPED);
    await scheduled(store);
    await scheduled(store);

    store.update(ONE, { disableConditions: [] });
    const cleared = await entry(client);
    // The protocol says clearing does not re-enable, so the switch stays where
    // the met condition left it - and a count with no allowance behind it is a
    // number nobody asked for.
    expect(cleared.definition.enabled).toBe(false);
    expect(cleared.runCount).toBeUndefined();
  });

  it('refuses a scheduled run whose date has gone by, and switches itself off there', async () => {
    const { client, store } = await connected();
    // A date in the past, because this store holds no clock: what it compares
    // an `afterDate` against is the time it is asked at.
    await write(client, {
      ...DEFINITION,
      disableConditions: [{ kind: 'afterDate', date: '2020-01-01T00:00:00.000Z' }],
    });
    expect(await scheduled(store)).toBeUndefined();
    expect((await entry(client)).definition.enabled).toBe(false);
  });
});

it('starts a session and says the first message, which is the whole point', async () => {
  const { client } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, DEFINITION);

  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  expect(run.resource.startsWith('ahp-automation-run:/')).toBe(true);

  // The echo backend with no pace answers at once, so the turn is over before
  // this can look - and a run whose turn ended is terminal. Poll for it rather
  // than assuming a number of ticks, because the ending travels through the
  // host rather than at the store's own pace.
  await until(async () => (await runState(client, run.resource)).lifecycle.status === 'completed');
  const state = await runState(client, run.resource);
  expect(state.automation).toBe(ONE);
  expect(state.lifecycle.status).toBe('completed');
  expect(state.lifecycle.startedAt).toBeTypeOf('string');
  expect(state.lifecycle.completedAt).toBeTypeOf('string');
  expect(state.sessions).toHaveLength(1);
  expect(state.primarySession).toBe(state.sessions[0]);

  // A session created and never spoken to does nothing, and nobody is at the
  // keyboard to speak to it - so the turn has to have been started here.
  const chat = `ahp-chat:/${idOf(state.primarySession ?? '')}`;
  const opened = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns?: { message?: { text?: string; origin?: { kind?: string } } }[] } };
  };
  const turns = opened.snapshot.state.turns ?? [];
  const first = turns.find((turn) => turn.message?.text === 'review what changed today');
  expect(first).toBeDefined();
  // Said by the automation, not by a person: `MessageKind.Automation` is the
  // protocol's word for a session an automation run started.
  expect(first?.message?.origin?.kind).toBe('automation');
});

it('starts the first turn on the model the session template names', async () => {
  const base = echo({ path: DIR, pace: 0 });
  const models: unknown[] = [];
  const agent: Agent = {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start);
      return {
        ...session,
        begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom) => {
          models.push(model);
          session.begin(turnId, text, model, from);
        },
      };
    },
  };
  const host = createHost({ path: DIR, agents: [agent], automations: memoryAutomations() });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await write(client, { ...DEFINITION, session: { ...DEFINITION.session, model: { id: 'echo/fast', config: { effort: 'low' } } } });

  await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  });
  await until(() => models.length > 0);
  // Without it a backend with no default of its own refuses the turn, and
  // nobody is at the keyboard to pick one.
  expect(models[0]).toEqual({ id: 'echo/fast', config: { effort: 'low' } });
});

it('reads running while the session it started is still working', async () => {
  // A paced backend keeps the turn open, which is the one moment the protocol
  // says the run is `running` rather than terminal.
  const { client } = await connected(true, 10);
  await write(client, {
    ...DEFINITION,
    message: { text: 'a message with enough words that the turn is still being streamed' },
  });
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  const state = await runState(client, run.resource);
  expect(state.lifecycle.status).toBe('running');
  expect(state.lifecycle.startedAt).toBeTypeOf('string');
  expect(state.lifecycle.completedAt).toBeUndefined();
});

it('reads a finished run as completed in the catalogue, with its session still counted', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  await until(async () => (await runState(client, run.resource)).lifecycle.status === 'completed');

  const entry = await held(client);
  const summary = entry.runs.find((one) => one.resource === run.resource);
  expect(summary?.lifecycle.status).toBe('completed');
  expect(summary?.lifecycle.completedAt).toBeTypeOf('string');
  expect(summary?.sessionCount).toBe(1);
});

it('settles a run cancelled when its session is disposed mid-turn', async () => {
  const { client } = await connected(true, 10);
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, {
    ...DEFINITION,
    message: { text: 'a message with enough words that the turn is still being streamed' },
  });
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };

  const before = await runState(client, run.resource);
  expect(before.lifecycle.status).toBe('running');
  const session = before.sessions[0] ?? '';
  // Held under its provider's name, as a client's `createSession` is.
  expect(session).toMatch(/^echo:\/[0-9a-f-]+$/);

  await client.handle({ method: 'disposeSession', params: { channel: session } });
  await until(async () => (await runState(client, run.resource)).lifecycle.status === 'cancelled');
  const after = await runState(client, run.resource);
  expect(after.lifecycle.status).toBe('cancelled');
  expect(after.lifecycle.startedAt).toBeTypeOf('string');
  expect(after.lifecycle.completedAt).toBeTypeOf('string');
});

it('settles a run by hand, and never reopens one that ended', async () => {
  const store = memoryAutomations();
  store.create('ahp-automation:/one', {});
  const start = async (): Promise<string> => 'ahp-session:/one';

  const first = await store.run('ahp-automation:/one', { kind: 'manual' }, start);
  expect(first?.lifecycle.status).toBe('running');
  expect(store.settle).toBeTypeOf('function');
  expect(store.settle?.(first?.resource ?? '', { status: 'completed' })).toBe(true);
  expect(first?.lifecycle.status).toBe('completed');
  expect(first?.lifecycle.completedAt).toBeTypeOf('string');
  // Terminal is terminal: a late event does not move it.
  expect(store.settle?.(first?.resource ?? '', { status: 'cancelled' })).toBe(false);
  expect(first?.lifecycle.status).toBe('completed');

  // An unknown run is a no-op rather than a throw.
  expect(store.settle?.('ahp-automation-run:/never', { status: 'completed' })).toBe(false);

  // A failed ending carries the error and the protocol's `completedAt`, which
  // is the field the old failure path wrongly called `endedAt`.
  const second = await store.run('ahp-automation:/one', { kind: 'manual' }, start);
  expect(store.settle?.(second?.resource ?? '', { status: 'failed', error: { message: 'no backend' } })).toBe(true);
  expect(second?.lifecycle.status).toBe('failed');
  expect(second?.lifecycle.error).toEqual({ message: 'no backend' });
  expect(second?.lifecycle.completedAt).toBeTypeOf('string');
  expect('endedAt' in (second?.lifecycle ?? {})).toBe(false);

  // A pending run may be cancelled, and cannot be completed without the
  // `startedAt` the protocol requires of a completed one.
  const third = await store.run('ahp-automation:/one', { kind: 'manual' }, start);
  if (third) third.lifecycle = { status: 'pending', createdAt: '2020-01-01T00:00:00.000Z' };
  expect(store.settle?.(third?.resource ?? '', { status: 'completed' })).toBe(false);
  expect(store.settle?.(third?.resource ?? '', { status: 'cancelled' })).toBe(true);
  expect(third?.lifecycle.status).toBe('cancelled');
  expect('startedAt' in (third?.lifecycle ?? {})).toBe(false);
});

/** The catalogue's one entry, as a client reads it. */
type Held = {
  runs: {
    resource: string;
    automation: string;
    lifecycle: { status: string; startedAt?: string; completedAt?: string };
    sessionCount: number;
  }[];
  runsNextCursor?: string;
};
const held = async (
  client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
): Promise<Held> => (await entries(client))[0] as Held;

/** Run one automation `times` over, waiting for the store to have them all. */
const runTimes = async (
  client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
  times: number,
): Promise<void> => {
  for (let i = 0; i < times; i++) {
    await client.handle({
      method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: `r${String(i)}` },
    });
  }
};

it('records what it has run, and shows it on the entry', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  await runTimes(client, 3);

  const entry = await held(client);
  expect(entry.runs).toHaveLength(3);
  expect(entry.runs.every((one) => one.automation === ONE && one.sessionCount === 1)).toBe(true);
  // Three fits in a page, so there is nothing to ask for next.
  expect(entry.runsNextCursor).toBeUndefined();

  // And the request itself only acknowledges. The protocol's result for it is
  // empty because the page is not the answer: it is the entry, on the channel
  // the client is already subscribed to.
  await expect(client.handle({
    method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE },
  })).resolves.toEqual({});
});

it('grows the entry by a page, on the cursor the entry itself carries', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  await runTimes(client, 45);

  // The first page is what a client is shown without asking for anything.
  expect((await held(client)).runs).toHaveLength(20);
  expect((await held(client)).runsNextCursor).toBe('20');

  // The cursor the entry carries is the one the store answers, and asking for
  // it is what makes the entry longer - for this client and every other.
  await client.handle({
    method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE, cursor: '20' },
  });
  expect((await held(client)).runs).toHaveLength(40);
  expect((await held(client)).runsNextCursor).toBe('40');

  // The last page has no cursor, because there is nothing after it.
  await client.handle({
    method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE, cursor: '40' },
  });
  expect((await held(client)).runs).toHaveLength(45);
  expect((await held(client)).runsNextCursor).toBeUndefined();
});

it('moves the page for every subscriber, not only the one that asked', async () => {
  const { host, client } = await connected();
  const watcher = peer();
  const other = host.accept(watcher);
  await other.handle({
    method: 'initialize', params: { clientId: 'b', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await other.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });

  await write(client, DEFINITION);
  await runTimes(client, 21);
  const before = actions(watcher, AUTOMATIONS).length;

  await client.handle({
    method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE, cursor: '20' },
  });
  await settle();

  // The protocol keeps the catalogue's subscribers synchronized: the one that
  // asked and the one that did not read the same entry, off the same action.
  const said_ = actions(watcher, AUTOMATIONS).slice(before).filter((one) => one.type === 'automation/set');
  expect(said_).toHaveLength(1);
  const entry = (said_[0] as { automation: Held }).automation;
  expect(entry.runs).toHaveLength(21);
  expect(entry.runsNextCursor).toBeUndefined();
});

it('refuses a runs cursor it did not issue, rather than answering from the start', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  await runTimes(client, 3);

  // A cursor out of another store's history, one that is not a number, or one
  // past the end. Growing the page for any of them is a client that pages for
  // ever without noticing it is being asked about runs it has already read.
  for (const cursor of ['x', '-1', '999']) {
    await expect(client.handle({
      method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE, cursor },
    })).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unrecognised cursor') });
  }
});

it('forgets one when the client asks and the catalogue still says it may', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, DEFINITION);
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
  }) as { resource: string };
  await settle();
  expect(await entries(client)).toHaveLength(1);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: ONE } },
  });
  expect(await entries(client)).toEqual([]);
  expect(actions(p, AUTOMATIONS).filter((one) => one.type === 'automation/removed'))
    .toMatchObject([{ resource: ONE }]);
  // And its runs went with it: the channel one was watchable on is gone.
  await expect(client.handle({ method: 'subscribe', params: { channel: run.resource } })).rejects.toThrow();
});

it('offers remove for one that is switched off, and removes only what it holds', async () => {
  const { client } = await connected();
  await write(client, { ...DEFINITION, enabled: false });
  // `remove` is not what `enabled` governs, so it is offered whatever the
  // switch says - while a removal naming something this host does not hold is
  // a no-op, not an error and not a removal of something else.
  const found = (await entries(client))[0] as { operations: string[] };
  expect(found.operations).toContain('remove');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: 'ahp-automation:/never-existed' } },
  });
  // "Removing an unknown resource is a no-op" - not an error, and not a
  // removal of something else.
  expect(await entries(client)).toHaveLength(1);
});

/*
 * A store the test drives, so the two actions can be seen rather than the
 * state they add up to.
 *
 * `memoryAutomations` starts its session inside `run`, which resolves before
 * anything could subscribe to the run's own channel - so what a client
 * watching one actually receives is only visible with a store that says a run
 * moved when the test says so.
 */
const controllable = () => {
  const run = {
    resource: 'ahp-automation-run:/r1',
    automation: ONE,
    origin: { kind: 'schedule' },
    lifecycle: { status: 'running' },
    sessions: [] as string[],
    primarySession: undefined as string | undefined,
  };
  let watcher: ((event: { automation?: string; run?: string; removed?: string }) => void) | undefined;
  const moved = () => watcher?.({ automation: ONE, run: run.resource });
  return {
    run,
    moved,
    store: {
      list: () => [],
      get: () => undefined,
      triggers: () => [],
      create: () => ({ resource: ONE, definition: {}, runs: [], operations: [], createdAt: '', modifiedAt: '' }),
      update: () => undefined,
      remove: () => false,
      run: async () => run,
      runOf: (resource: string) => (resource === run.resource ? run : undefined),
      runs: () => true,
      onChanged: (observer: (event: { automation?: string; run?: string; removed?: string }) => void) => {
        watcher = observer;
      },
    },
  };
};

it('says which sessions a run has, one action per session', async () => {
  const driven = controllable();
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    automations: driven.store as never,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'subscribe', params: { channel: driven.run.resource } });

  /*
   * The difference, not the list.
   *
   * There is no action carrying a run's whole set of sessions:
   * `automationRun/sessionSet` appends one and `sessionRemoved` takes one
   * away. So a client watching the run channel builds the list out of these,
   * and a host that only announced the primary would leave it building one
   * with a single entry however many the run has.
   */
  driven.run.sessions = ['ahp-session:/one', 'ahp-session:/two'];
  driven.run.primarySession = 'ahp-session:/one';
  driven.moved();
  expect(actions(p, driven.run.resource)
    .filter((one) => one.type === 'automationRun/sessionSet')
    .map((one) => one.session))
    .toEqual(['ahp-session:/one', 'ahp-session:/two']);

  // And nothing said twice: the run moved again, and its sessions did not.
  driven.run.lifecycle = { status: 'completed' };
  driven.moved();
  expect(actions(p, driven.run.resource).filter((one) => one.type === 'automationRun/sessionSet')).toHaveLength(2);

  driven.run.sessions = ['ahp-session:/two'];
  driven.moved();
  expect(actions(p, driven.run.resource)
    .filter((one) => one.type === 'automationRun/sessionRemoved')
    .map((one) => one.session))
    .toEqual(['ahp-session:/one']);
});

it('lets go of a session a run was holding when the session is disposed', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, DEFINITION);

  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  await client.handle({ method: 'subscribe', params: { channel: run.resource } });
  await settle();
  const session = String((await client.handle({ method: 'subscribe', params: { channel: run.resource } }) as {
    snapshot: { state: { sessions: string[] } };
  }).snapshot.state.sessions[0] ?? '');
  // Held under its provider's name, as a client's `createSession` is.
  expect(session).toMatch(/^echo:\/[0-9a-f-]+$/);

  await client.handle({ method: 'disposeSession', params: { channel: session } });
  await settle();
  const gone = actions(p, run.resource).filter((one) => one.type === 'automationRun/sessionRemoved');
  expect(gone.map((one) => one.session)).toEqual([session]);
  // And the primary with it: a run pointing at a session nobody can open is
  // a run a client opens onto nothing.
  const state = (await client.handle({ method: 'subscribe', params: { channel: run.resource } }) as {
    snapshot: { state: { sessions: string[]; primarySession?: string } };
  }).snapshot.state;
  expect(state.sessions).toEqual([]);
  expect(state.primarySession).toBeUndefined();
});

/*
 * Whose work an automation is.
 *
 * An automation is work nobody starts, so nothing about it says who to charge
 * until somebody records that: the connection that created it, and from then
 * on every run it makes - scheduled or pressed - is that person's.
 */

const ana: Principal = { id: 'ana', roles: [], can: () => true, teams: [{ id: 'backend' }] };

const people = (): Users => ({
  resource: {
    resource: 'ahpd://users',
    resource_name: 'ahpd users',
    authorization_servers: ['https://example.test/users'],
    required: false,
  },
  verify: async () => undefined,
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

it('records whose work an automation is, and gives every run of it that owner', async () => {
  const store = memoryAutomations();
  const asked: StartSession[] = [];
  const start = async (options: StartSession): Promise<string> => { asked.push(options); return 'echo:/one'; };

  // The entry a client reads carries the owner in `_meta`, where the protocol
  // has room for it, and never under a field of its own.
  expect(store.create(ONE, DEFINITION, 'user:ana')._meta).toEqual({ 'ahpd.owner': 'user:ana' });
  expect(store.get(ONE)?._meta?.['ahpd.owner']).toBe('user:ana');
  // A patch does not move it: a colleague who edited the definition did not
  // take it over.
  store.update(ONE, { title: 'Renamed' });
  expect(store.get(ONE)?._meta?.['ahpd.owner']).toBe('user:ana');

  // The run record keeps it under its own name, because that is the store the
  // host's own gates read.
  const run = await store.run(ONE, { kind: 'manual' }, start);
  expect(run?.owner).toBe('user:ana');
  // And the session is handed the owner too, because the host is what opens
  // it and a store that fetched the owner to do that would be a second thing.
  expect(asked[0]?.owner).toBe('user:ana');

  // An automation made before this names nobody, and neither does a run of it.
  expect(store.create('ahp-automation:/plain', DEFINITION)._meta).toBeUndefined();
  const older = await store.run('ahp-automation:/plain', { kind: 'trigger' }, start);
  expect(older?.owner).toBeUndefined();
  expect(asked[1]?.owner).toBeUndefined();
});

it('takes the owner from the connection that made it, and a run is that person\'s work', async () => {
  const store = memoryAutomations();
  const sessions = memorySessions();
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    automations: store,
    sessions,
    users: people(),
  });
  const client = host.accept(peer(), ana);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await write(client, DEFINITION);

  // The catalogue says whose it is, which is the whole of what a create knows
  // that a definition does not. Under the key the protocol has room for and
  // nowhere else: `AutomationEntry` declares `_meta` and no `owner`.
  const catalogue = (await entries(client))[0] as Record<string, unknown>;
  expect(catalogue._meta).toEqual({ 'ahpd.owner': 'user:ana' });
  expect('owner' in catalogue).toBe(false);

  // A run pressed here is still that person's work: the manual origin is
  // `{ kind: 'manual' }` and carries nobody, and what runs at nine is the
  // thing somebody wrote rather than whoever presses the button.
  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  const state = await runState(client, run.resource);
  expect(state._meta).toEqual({ 'ahpd.owner': 'user:ana' });
  expect('owner' in state).toBe(false);
  // And the session it started is owned the same way.
  expect(sessions.owner(idOf(state.primarySession ?? ''))).toBe('user:ana');

  // An automation nobody was behind carries neither key: an `_meta` saying
  // nothing is a claim that there is no owner, which is not what it says.
  store.create(PLAIN, DEFINITION);
  const plain = (await entries(client)).find((one) => one.resource === PLAIN) as Record<string, unknown>;
  expect(plain._meta).toBeUndefined();
  expect('owner' in plain).toBe(false);
  const plainRun = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: PLAIN, requestId: 'req-2' },
  }) as { resource: string };
  const plainState = await runState(client, plainRun.resource);
  expect(plainState._meta).toBeUndefined();
  expect('owner' in plainState).toBe(false);
});
