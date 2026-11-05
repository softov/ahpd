import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A client's tool list, kept only once the SDK has taken it.
 *
 * This lives beside `clienttools.ts` and not in `packages/sdk`, where the task
 * placed it, because what is under test is this backend's `setTools`, the
 * send that gives the CLI the set, and its `ctx.mcpServers`: the holder and the
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
 * Only the fields `setTools` reads are here. `mcpServers` starts as a session's
 * does: a server the host was given by a person, and neither in-process
 * server - `session.ts` declares those from the tools the session was built
 * with, so a session built with none has neither. A case that wants one to
 * move declares it with a first change, which is one declaration; every
 * change after that is two.
 */
const session = () => {
  /** Which of the declarations refuse: all of them, the `n`th, or none. */
  let refuse: 'all' | number | undefined;
  let made = 0;
  const sent: Record<string, Bag>[] = [];
  const filesServer = { type: 'sdk', name: 'files' } as Bag;
  const ctx = {
    options: { chatUri: 'ahp-chat:/contributed' },
    emit: () => {},
    mcpServers: { files: filesServer } as Record<string, Bag>,
    offering: [] as BoundTool[],
    toolDiff: undefined as BoundTool[] | undefined,
    query: {
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
    state: () => ({ offering: ctx.offering, declared: ctx.mcpServers }),
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
  // No in-process server yet, so the one declaration is the one that adds it,
  // and it refused: nothing went out, and what is held is what it was, the
  // person's server still beside it.
  expect(held.sent).toEqual([]);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['files']);

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
 * registered, and the in-process servers are registered from the session's
 * start. A declaration that carries one is taken for the server already
 * there, so only the one that leaves it out makes the SDK let it go.
 */
it('removes the in-process servers first, then declares them again with the new tools', async () => {
  const held = session();
  // A session with no in-process server yet has nothing to remove: one declaration.
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(held.sent).toHaveLength(1);
  expect(await held.setTools([offeredTool('openFile'), offeredTool('closeFile')])).toBe(true);
  expect(held.sent).toHaveLength(3);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['files']);
  expect(Object.keys(held.sent[2] as Record<string, Bag>).sort()).toEqual(['client', 'files']);
});

it('declares one set, with neither in-process server in it, when the list is emptied', async () => {
  const held = session();
  expect(await held.setTools([offeredTool('openFile')])).toBe(true);
  expect(await held.setTools([])).toBe(true);
  // Two declarations in all: the add of the first change, then the removal
  // alone - an empty list has no server to add back.
  expect(held.sent).toHaveLength(2);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['files']);
  expect(held.state().offering).toEqual([]);
});

it('holds the set without the in-process servers when the declaration that adds them back is refused', async () => {
  const held = session();
  const first = [offeredTool('openFile')];
  expect(await held.setTools(first)).toBe(true);
  held.refusingAt(2);
  expect(await held.setTools([offeredTool('closeFile')])).toBe(false);
  // The removal went through and the re-add did not, so the CLI has neither
  // server, and the session holds just that rather than the list it no longer
  // offers.
  expect(held.sent).toHaveLength(2);
  expect(Object.keys(held.sent[1] as Record<string, Bag>)).toEqual(['files']);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['files']);
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
 * `mcp__host__ask_user` beside the question tool it already has.
 */
it('does not take the host\'s ask_user, because it asks with its own tool', async () => {
  const held = session();
  const askUser = { definition: { name: 'ask_user', description: 'ask_user', inputSchema: { type: 'object', properties: {} } } } as unknown as BoundTool;
  expect(await held.setTools([askUser, offeredTool('openFile')])).toBe(true);
  // The server the CLI was given, which is what it registers as `mcp__client__*`.
  const tools = seen.given?.tools as { name: string }[];
  expect(tools.map((one) => one.name)).toEqual(['openFile']);
  expect(held.state().offering.map((one) => one.definition.name)).toEqual(['openFile']);

  // A list of nothing but ask_user leaves the session with neither in-process server.
  expect(await held.setTools([askUser])).toBe(true);
  expect(held.state().offering).toEqual([]);
  expect(Object.keys(held.state().declared)).toEqual(['files']);
});

it('declares the set whole, so a re-declare cannot take a person\'s server away', async () => {
  const held = session();
  await held.setTools([offeredTool('openFile')]);
  const set = held.sent.at(-1) as Record<string, Bag>;
  expect(Object.keys(set).sort()).toEqual(['client', 'files']);
  expect((set.client as { name: string }).name).toBe('client');
  expect(seen.given?.name).toBe('client');
});

/*
 * Two in-process servers, by VS Code's Claude's names: a client's tools on
 * `client`, round-tripped to the client, and the host's own on `host`, run
 * here, so the model calls them `mcp__client__<name>` and `mcp__host__<name>`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L80-L85
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeServerToolMcpServer.ts#L11-L21
 */
it('offers a client\'s tools on the client server and the host\'s own on the host server', async () => {
  const held = session();
  const hostTool = { definition: { name: 'list_sessions', description: 'List', inputSchema: { type: 'object', properties: {} } }, run: () => '' } as unknown as BoundTool;
  expect(await held.setTools([offeredTool('openFile'), hostTool])).toBe(true);
  const set = held.sent.at(-1) as Record<string, { name: string; tools: { name: string }[] }>;
  expect(Object.keys(set).sort()).toEqual(['client', 'files', 'host']);
  expect(set.client?.name).toBe('client');
  expect(set.client?.tools.map((one) => one.name)).toEqual(['openFile']);
  expect(set.host?.name).toBe('host');
  expect(set.host?.tools.map((one) => one.name)).toEqual(['list_sessions']);
});
