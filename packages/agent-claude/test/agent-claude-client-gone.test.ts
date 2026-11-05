import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A call to a client that left ends at once.
 *
 * A handler the CLI started waits, by the id the CLI handed it, for the call
 * the frame reports. The client that provides the tool may leave in the gap
 * between the two, or the frame may name a tool nothing offers any more - and
 * then the call never opens, so the handler would wait until the turn is
 * stopped. These cases are that gap: the handler is answered with the refusal
 * at once.
 *
 * The holder ends the calls already open; what this backend adds is the waits
 * the holder never sees, so the cases drive `ranByClient` through the handler
 * the SDK server was handed.
 */

const seen = vi.hoisted(() => ({ server: undefined as Record<string, unknown> | undefined }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    seen.server = given;
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
}));

const { createClientTools } = await import('../src/session/clienttools.js');

/** A tool a client offers, named the way the host names one: `<clientId>__<name>`. */
const toolOf = (name: string, owner = 'probe'): BoundTool => ({
  owner,
  definition: { name: `${owner}__${name}`, description: name, inputSchema: { type: 'object', properties: {} } },
}) as unknown as BoundTool;

/** The handler the SDK server was handed for one tool, which is what runs a call. */
const handlerFor = (name: string): ((input: Bag, extra: unknown) => Promise<unknown>) => {
  const tools = (seen.server?.tools ?? []) as { name: string; handler: (input: Bag, extra: unknown) => Promise<unknown> }[];
  const tool = tools.find((one) => one.name === name);
  if (tool === undefined) throw new Error(`the server was handed no ${name}`);
  return tool.handler;
};

/** A session with one client's tool offered, and the client-tools area over it. */
const session = (owned = [toolOf('openFile')], others: BoundTool[] = []) => {
  const declared: Record<string, Bag> = { host: { type: 'sdk', name: 'host' } };
  const ctx = {
    options: { chatUri: 'ahp-chat:/probe' },
    emit: () => {},
    declared,
    offering: [] as BoundTool[],
    doing: () => {},
    handle: { setMcpServers: async () => {} },
    // The session's own chat holds every call here: no worker opened one.
    scopeOfCall: () => undefined,
  };
  const tools = createClientTools(ctx as never);
  // The model reaches a client's tool through this handler, the one the SDK
  // server is built with. `offering` starts empty, so the list coming in is a
  // change and the server is built for the cases to read.
  void tools.methods.setTools([...owned, ...others]);
  return { tools, ctx };
};

it('refuses a handler waiting by id when the client leaves', async () => {
  const { tools } = session();
  const handler = handlerFor('probe__openFile');
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } });
  // The client goes before the frame that would open the call arrives.
  tools.methods.clientGone('probe');
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toContain('no longer here');
});

/*
 * A handler the CLI hands no call id has no call to wait on, a client's answer
 * being keyed by the call's id, so it answers at once that it could not run,
 * in VS Code's words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L41-L56
 */
it('answers a handler handed no call id that it could not run', async () => {
  session();
  const handler = handlerFor('probe__openFile');
  const answer = await Promise.race([
    handler({ path: '/a.txt' }, undefined),
    new Promise((resolve) => { setTimeout(() => resolve('still waiting'), 50); }),
  ]);
  expect(answer).toEqual({
    content: [{
      type: 'text',
      text: 'Client tool "probe__openFile" could not run: SDK omitted tool_use_id (expected at extra._meta["claudecode/toolUseId"]).',
    }],
    isError: true,
  });
});

it('refuses a handler whose tool is no longer on offer when the frame arrives', async () => {
  const { tools, ctx } = session();
  const handler = handlerFor('probe__openFile');
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } });
  // The tool is taken away - its client left - without `clientGone` being told,
  // and then the frame for the call is reported for a tool nothing offers.
  ctx.offering = [];
  tools.openCall('mcp__ahp__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toContain('Nothing here offers');
});

it('leaves another client\'s waits alone when this one leaves', async () => {
  const other = toolOf('openFile', 'other');
  const { tools } = session([toolOf('openFile')], [other]);
  const handler = handlerFor('other__openFile');
  let done = false;
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-2' } })
    .then((answer) => { done = true; return answer; });
  tools.methods.clientGone('probe');
  await new Promise((r) => { setTimeout(r, 0); });
  // Not the one that left, so it is still waiting for its call.
  expect(done).toBe(false);

  // And it ends the way it should: the frame opens the call, and the holder's
  // own `clientGone` never touched it.
  tools.openCall('mcp__ahp__other__openFile', 't1', 'call-2', 'Open it', '{"path":"/a.txt"}');
  tools.calls.complete('call-2', 'other', { ok: true, text: 'opened', content: [{ type: 'text', text: 'opened' }] });
  const answer = await answering as { content: { text: string }[] };
  expect(answer.content[0]?.text).toBe('opened');
});
