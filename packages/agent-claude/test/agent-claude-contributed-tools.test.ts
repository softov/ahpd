import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A client's tool list, kept only once the SDK has taken it.
 *
 * This lives beside `clienttools.ts` and not in `packages/sdk`, where the task
 * placed it, because what is under test is this backend's `setTools`, the
 * send that gives the CLI the set, and its `ctx.declared`: the holder and the
 * entry a call is raised against are the sdk's, but "kept only once the SDK
 * has taken it" is this file's. So the cases build the small part of a
 * session's context the two read and drive them, rather than a whole host.
 */

/** The one argument the SDK server was built from, held for the cases. */
const seen = vi.hoisted(() => ({ given: undefined as Record<string, unknown> | undefined }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    seen.given = given;
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
}));

const { createClientTools } = await import('../src/session/clienttools.js');

/** A tool a client offers, which is all `setTools` reads of one. */
const offeredTool = (name: string, owner = 'probe'): BoundTool => ({
  owner,
  definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
}) as unknown as BoundTool;

/**
 * A session whose `setMcpServers` refuses: every declaration, one of them, or
 * none.
 *
 * Only the fields `setTools` reads are here. `declared` starts as a session's
 * does: the host's own server, and no `ahp` - `session.ts` declares that one
 * from `ctx.offering`, so a session built with nothing contributed has none.
 * A case that wants an `ahp` to move declares one with a first change, which
 * is one declaration; every change after that is two.
 */
const session = () => {
  /** Which of the declarations refuse: all of them, the `n`th, or none. */
  let refuse: 'all' | number | undefined;
  let made = 0;
  const sent: Record<string, Bag>[] = [];
  const hostServer = { type: 'sdk', name: 'host' } as Bag;
  const ctx = {
    options: { chatUri: 'ahp-chat:/contributed' },
    emit: () => {},
    declared: { host: hostServer } as Record<string, Bag>,
    offering: [] as BoundTool[],
    toolDiff: undefined as BoundTool[] | undefined,
    handle: {
      setMcpServers: async (servers: Record<string, Bag>) => {
        made += 1;
        if (refuse === 'all' || refuse === made) throw new Error('the CLI said no');
        sent.push(servers);
      },
    },
  };
  const tools = createClientTools(ctx as never);
  return {
    /** A set handed to the session, and the send that gives it to the CLI: whether the CLI took it. */
    setTools: async (list: BoundTool[]): Promise<boolean> => {
      expect(await tools.methods.setTools(list)).toBe(true);
      return tools.rebindForClientTools().then(() => true, () => false);
    },
    sent,
    /** What the session offers and declares now, which `setTools` moves. */
    state: () => ({ offering: ctx.offering, declared: ctx.declared }),
    refusing: (on: boolean) => { made = 0; refuse = on ? 'all' : undefined; },
    /** Refuse the `at`-th declaration made from here on, and no other. */
    refusingAt: (at: number) => { made = 0; refuse = at; },
  };
};

it('sends a list the SDK refused again when the same list comes back', async () => {
  const held = session();
  held.refusing(true);
  const list = [offeredTool('openFile')];
  expect(await held.setTools(list)).toBe(false);
  // No `ahp` yet, so the one declaration is the one that adds it, and it
  // refused: nothing went out, and what is held is what it was, the host's
  // own server still beside it.
  expect(held.sent).toEqual([]);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['host']);

  held.refusing(false);
  expect(await held.setTools(list)).toBe(true);
  // The same list, sent again because the session never took it the first time.
  expect(held.sent).toHaveLength(1);
  expect(held.state().offering).toEqual(list);
});

it('does not send a list the SDK took when it comes again', async () => {
  const held = session();
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(held.sent).toHaveLength(1);
  // Taken, so what comes again is what is already there.
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(held.sent).toHaveLength(1);
});

/*
 * The order is the whole of it: the SDK connects only a name it has not
 * registered, and `ahp` is registered from the session's start. A declaration
 * that carries it is taken for the server already there, so only the one that
 * leaves it out makes the SDK let it go.
 */
it('removes the ahp server first, then declares it again with the new tools', async () => {
  const held = session();
  // A session with no `ahp` yet has nothing to remove: one declaration.
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(held.sent).toHaveLength(1);
  expect(await held.setTools([offeredTool('openFile'), offeredTool('closeFile')])).toBe(true);
  expect(held.sent).toHaveLength(3);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['host']);
  expect(Object.keys(held.sent[2] as Record<string, Bag>).sort()).toEqual(['ahp', 'host']);
});

it('declares one set, with no ahp in it, when the list is emptied', async () => {
  const held = session();
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(await held.setTools([])).toBe(true);
  // Two declarations in all: the add of the first change, then the removal
  // alone - an empty list has no server to add back.
  expect(held.sent).toHaveLength(2);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['host']);
  expect(held.state().offering).toEqual([]);
});

it('holds the set without ahp when the declaration that adds it back is refused', async () => {
  const held = session();
  const first = [offeredTool('openFile')];
  expect(await held.setTools(first)).toBe(true);
  held.refusingAt(2);
  expect(await held.setTools([offeredTool('closeFile')])).toBe(false);
  // The removal went through and the re-add did not, so the CLI has no `ahp`,
  // and the session holds just that rather than the list it no longer offers.
  expect(held.sent).toHaveLength(2);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['host']);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['host']);
  // So the first list coming back is a change to send, and not one taken.
  held.refusing(false);
  expect(await held.setTools(first)).toBe(true);
  expect(held.sent).toHaveLength(3);
  expect(held.state().offering).toEqual(first);
});

/*
 * The one host tool this backend does not take.
 *
 * Claude has its own question tool, and the plan
 * `host/20261103-1620-an-agent-asks-the-person` leaves it on that for now. The
 * host's `ask_user` is therefore never declared, so the model is never offered
 * `mcp__ahp__ask_user` beside the question tool it already has.
 */
it('does not take the host\'s ask_user, because it asks with its own tool', async () => {
  const held = session();
  expect(await held.setTools([offeredTool('ask_user'), offeredTool('openFile')])).toBe(true);
  // The server the CLI was given, which is what it registers as `mcp__ahp__*`.
  const tools = seen.given?.tools as { name: string }[];
  expect(tools.map((one) => one.name)).toEqual(['openFile']);
  expect(held.state().offering.map((one) => one.definition.name)).toEqual(['openFile']);

  // A list of nothing but ask_user leaves the session with no `ahp` at all.
  expect(await held.setTools([offeredTool('ask_user')])).toBe(true);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['host']);
});

it('declares the set whole, so a re-declare cannot take the host server away', async () => {
  const held = session();
  await held.setTools([offeredTool('openFile')]);
  const set = held.sent.at(-1) as Record<string, Bag>;
  expect(Object.keys(set).sort()).toEqual(['ahp', 'host']);
  expect((set.ahp as { name: string }).name).toBe('ahp');
  expect(seen.given?.name).toBe('ahp');
});
