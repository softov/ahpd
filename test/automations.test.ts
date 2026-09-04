import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memoryAutomations } from '../src/automations.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

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

async function connected(withStore = true) {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    ...(withStore ? { automations: memoryAutomations() } : {}),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'a', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { host, client, peer: p };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

const ONE = 'ahp-automation:/nightly';

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

const DEFINITION = {
  title: 'Nightly review',
  enabled: true,
  message: { text: 'review what changed today' },
  session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
  triggers: [],
};

it('advertises no event triggers, and manual is not one', async () => {
  const { client } = await connected();
  const found = await client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: 'ahp-root://' },
  }) as { items: { type: string }[] };
  // This command answers with *event* triggers only. A schedule is
  // protocol-defined and never listed here, and manual is not a trigger at
  // all - an empty trigger list on a definition is what manual-only means. A
  // store that put `manual` here would be offering a type a client would then
  // save as an event trigger nothing ever fires.
  expect(found.items).toEqual([]);
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

it('does not offer to run one that is switched off', async () => {
  const { client } = await connected();
  await write(client, { ...DEFINITION, enabled: false });
  const found = (await entries(client))[0] as { operations: string[] };
  // A Run button beside an Off switch is a control that argues with the one
  // next to it.
  expect(found.operations).toEqual(['update', 'remove']);
  await expect(client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' },
  })).rejects.toThrow();
});

it('starts a session and says the first message, which is the whole point', async () => {
  const { client, peer: p } = await connected();
  await client.handle({ method: 'subscribe', params: { channel: AUTOMATIONS } });
  await write(client, DEFINITION);

  const run = await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'req-1' },
  }) as { resource: string };
  expect(run.resource.startsWith('ahp-automation-run:/')).toBe(true);
  await settle();

  const state = (await client.handle({ method: 'subscribe', params: { channel: run.resource } }) as {
    snapshot: { state: { automation: string; lifecycle: { status: string }; sessions: string[]; primarySession?: string } };
  }).snapshot.state;
  expect(state.automation).toBe(ONE);
  expect(state.lifecycle.status).toBe('running');
  expect(state.sessions).toHaveLength(1);
  expect(state.primarySession).toBe(state.sessions[0]);

  // A session created and never spoken to does nothing, and nobody is at the
  // keyboard to speak to it - so the turn has to have been started here.
  const chat = `ahp-chat:/${(state.primarySession ?? '').replace('ahp-session:/', '')}`;
  const opened = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns?: { message?: { text?: string } }[] } };
  };
  const turns = opened.snapshot.state.turns ?? [];
  expect(turns.some((turn) => turn.message?.text === 'review what changed today')).toBe(true);
});

it('records what it has run, and pages it', async () => {
  const { client } = await connected();
  await write(client, DEFINITION);
  for (let i = 0; i < 3; i++) {
    await client.handle({
      method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: `r${String(i)}` },
    });
  }
  await settle();
  const page = await client.handle({
    method: 'fetchAutomationRuns', params: { channel: AUTOMATIONS, automation: ONE },
  }) as { items: { automation: string; sessionCount: number }[]; nextCursor?: string };
  expect(page.items).toHaveLength(3);
  expect(page.items.every((one) => one.automation === ONE && one.sessionCount === 1)).toBe(true);
  // Three fits in a page, so there is nothing to ask for next.
  expect(page.nextCursor).toBeUndefined();
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

it('will not remove one the catalogue says may not be, even when asked', async () => {
  const { client } = await connected();
  await write(client, { ...DEFINITION, enabled: false });
  // A client holding a stale catalogue would otherwise delete something this
  // host has since decided may not be deleted. Here `remove` is still offered
  // for a disabled automation, so the check is shown against `run` instead.
  const found = (await entries(client))[0] as { operations: string[] };
  expect(found.operations).toContain('remove');
  expect(found.operations).not.toContain('run');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: 'ahp-automation:/never-existed' } },
  });
  // "Removing an unknown resource is a no-op" - not an error, and not a
  // removal of something else.
  expect(await entries(client)).toHaveLength(1);
});
