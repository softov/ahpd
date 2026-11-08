import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A handler and the call its frame reports.
 *
 * A handler the CLI started waits, by the id the CLI handed it, for the call
 * the frame reports. The frame may name a tool nothing offers any more, its
 * client gone, and then the call never opens, so the handler is answered with
 * the refusal at once. A call a gone client owes is the host's to fail, as VS
 * Code's host fails one, through `completeToolCall`; this backend ends none
 * itself. The cases drive `ranByClient` through the handler the SDK server
 * was handed.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2085-L2115
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
  const declared: Record<string, Bag> = { files: { type: 'sdk', name: 'files' } };
  const ctx = {
    options: { chatUri: 'ahp-chat:/probe' },
    emit: () => {},
    mcpServers: declared,
    offering: [] as BoundTool[],
    toolDiff: undefined as BoundTool[] | undefined,
    doing: () => {},
    query: { setMcpServers: async () => {} },
    // The session's own chat holds every call here: no worker opened one.
    scopeOfCall: () => undefined,
    values: {} as Bag,
  };
  const tools = createClientTools(ctx as never);
  // The model reaches a client's tool through this handler, the one the SDK
  // server is built with. `offering` starts empty, so the list handed is a
  // change, and the send that gives it to the CLI builds the server for the
  // cases to read.
  void tools.methods.setTools([...owned, ...others]);
  void tools.rebindForClientTools();
  return { tools, ctx };
};

it('ends no call of a client that left itself, the host failing the calls it owes', async () => {
  const { tools } = session();
  expect(Object.keys(tools.methods).sort()).toEqual(['completeToolCall', 'setTools', 'toolCallOwner']);
  await new Promise((r) => { setTimeout(r, 0); });
  const handler = handlerFor('probe__openFile');
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } });
  tools.openCall('mcp__client__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  // The host's failure for a client that went, in VS Code's words.
  const words = 'Client probe disconnected before completing openFile';
  tools.calls.complete('call-1', 'probe', { ok: false, text: words, content: [{ type: 'text', text: words }] });
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toBe(words);
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
  // The tool is taken away, its client gone, and then the frame for the call
  // is reported for a tool nothing offers.
  ctx.offering = [];
  tools.openCall('mcp__client__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toContain('Nothing here offers');
});

it('keeps as many framed calls for a late handler as the record\'s keepFramed names', async () => {
  const { tools, ctx } = session();
  ctx.values = { keepFramed: 1 };
  await new Promise((r) => { setTimeout(r, 0); });
  // Two calls the CLI framed before either handler ran: only the later is kept.
  tools.openCall('mcp__client__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  tools.openCall('mcp__client__probe__openFile', 't1', 'call-2', 'Open it', '{"path":"/b.txt"}');
  const handler = handlerFor('probe__openFile');
  let first = false;
  void handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } }).then(() => { first = true; });
  const second = handler({ path: '/b.txt' }, { _meta: { 'claudecode/toolUseId': 'call-2' } });
  await new Promise((r) => { setTimeout(r, 0); });
  tools.calls.complete('call-1', 'probe', { ok: true, text: 'a', content: [{ type: 'text', text: 'a' }] });
  tools.calls.complete('call-2', 'probe', { ok: true, text: 'b', content: [{ type: 'text', text: 'b' }] });
  expect(((await second) as { content: { text: string }[] }).content[0]?.text).toBe('b');
  await new Promise((r) => { setTimeout(r, 0); });
  // The first handler's call went past the kept one, so it waits for a frame.
  expect(first).toBe(false);
  tools.releaseCalls('done');
});
