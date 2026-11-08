import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A handler and the call its frame reports.
 *
 * A handler the CLI started waits to be joined to the call the frame reports.
 * The frame may name a tool nothing offers any more, its client gone, and then
 * the call never opens, so the handler is answered with the refusal at once. A
 * call a gone client owes is the host's to fail, as VS Code's host fails one,
 * through `completeToolCall`; this backend ends none itself. The cases drive
 * `ranByClient` through the handler the SDK server was handed.
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

it('ends no call of a client that left itself, the host failing the calls it owes', async () => {
  const { tools } = session();
  expect(Object.keys(tools.methods).sort()).toEqual(['completeToolCall', 'setTools', 'toolCallOwner']);
  // The offering lands once the tools the session was handed are set.
  await new Promise((r) => { setTimeout(r, 0); });
  const handler = handlerFor('probe__openFile');
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } });
  tools.openCall('mcp__ahp__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  // The host's failure for a client that went, in VS Code's words.
  const words = 'Client probe disconnected before completing openFile';
  tools.calls.complete('call-1', 'probe', { ok: false, text: words, content: [{ type: 'text', text: words }] });
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toBe(words);
});

it('answers a handler joined by name and input with the host\'s failure of a client that left', async () => {
  const { tools } = session();
  await new Promise((r) => { setTimeout(r, 0); });
  const handler = handlerFor('probe__openFile');
  // A CLI that names no call joins by tool name and input instead.
  const answering = handler({ path: '/a.txt' }, undefined);
  tools.openCall('mcp__ahp__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  const words = 'Client probe disconnected before completing openFile';
  tools.calls.complete('call-1', 'probe', { ok: false, text: words, content: [{ type: 'text', text: words }] });
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toBe(words);
});

it('refuses a handler whose tool is no longer on offer when the frame arrives', async () => {
  const { tools, ctx } = session();
  const handler = handlerFor('probe__openFile');
  const answering = handler({ path: '/a.txt' }, { _meta: { 'claudecode/toolUseId': 'call-1' } });
  // The tool is taken away, its client gone, and then the frame for the call
  // is reported for a tool nothing offers.
  ctx.offering = [];
  tools.openCall('mcp__ahp__probe__openFile', 't1', 'call-1', 'Open it', '{"path":"/a.txt"}');
  const answer = await answering as { content: { text: string }[]; isError?: boolean };
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).toContain('Nothing here offers');
});
