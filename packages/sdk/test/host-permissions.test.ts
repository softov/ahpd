/*
 * The questions a backend puts to a person about a tool call, as this host
 * puts them: VS Code's options where the backend offered none, Allow Once and
 * Skip for a tool the operator's rule makes ask, and the session's
 * `permissions`, where an "Allow in this Session" answer is kept and which
 * answer a later question themselves, as VS Code's `SessionPermissionManager`
 * owns them for every agent of its host.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { chatUriFor, ROOT } from '../src/host/channels.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

const SESSION = 'ahp-session:/one';
const CHAT = chatUriFor(SESSION);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-permissions-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** An envelope as a client reads it. */
interface Heard {
  channel: string;
  action: Bag;
  origin?: { clientId: string; clientSeq: number };
}

/** A client keeping every action envelope it was sent. */
const listening = (): Peer & { heard: Heard[] } => {
  const heard: Heard[] = [];
  return {
    heard,
    send: () => {},
    notify: (method, params) => { if (method === 'action') heard.push(params as Heard); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

const until = async (ready: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened`);
};

/** One answer a backend was handed: the call, whether it was approved, and the option. */
type Answer = [string, boolean, string | undefined];

/**
 * The echo backend, asking a person about one call of `tool` in every turn it
 * is sent, and keeping every answer it is handed.
 */
const asking = (answers: Answer[], tool = 'bash', server?: { id: string; name: string }): Agent => {
  const base = echo({ path: dir, pace: 50 });
  return {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start) as Session;
      return {
        ...session,
        // An MCP server the backend loaded, which a call's contributor names by its id.
        ...(server === undefined ? {} : {
          sessionState: () => ({
            ...session.sessionState(),
            customizations: [{ type: 'mcpServer', id: server.id, uri: 'file:///servers.json', name: server.name, state: { status: 'ready' } }],
          }),
        }),
        sendMessage: (...args: Parameters<Session['sendMessage']>) => {
          session.sendMessage(...args);
          const turnId = args[0];
          const toolCallId = `call-${turnId}`;
          start.emit('chat', {
            type: 'chat/toolCallStart', turnId, toolCallId, toolName: tool, displayName: 'Bash',
            ...(server === undefined ? {} : { contributor: { kind: 'mcp', customizationId: server.id } }),
          });
          start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: 'Run ls', toolInput: 'ls', confirmationTitle: 'Run Bash?' });
        },
        confirm: (toolCallId: string, approved: boolean, optionId?: string) => {
          answers.push([toolCallId, approved, optionId]);
          return true;
        },
      };
    },
  };
};

/** A host serving `agent`, with one client watching the root, the session and its chat. */
const serving = async (agent: Agent) => {
  const host = createHost({ path: dir, agents: [agent], resources: fileResources() });
  const p = listening();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: SESSION } });
  await client.handle({ method: 'subscribe', params: { channel: CHAT } });
  const dispatch = async (channel: string, action: Bag): Promise<void> => {
    await client.handle({ method: 'dispatchAction', params: { channel, action } });
    await settle();
  };
  /** A turn begun, and the question its backend puts in it. */
  const turn = async (turnId: string): Promise<Bag> => {
    await dispatch(CHAT, { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
    await until(() => p.heard.some((one) => one.action.type === 'chat/toolCallReady' && one.action.turnId === turnId), 'the question');
    await settle();
    return p.heard.find((one) => one.action.type === 'chat/toolCallReady' && one.action.turnId === turnId)!.action;
  };
  return { host, p, dispatch, turn };
};

/** VS Code's options, in its words. */
const STANDARD = [
  { id: 'allow-session', label: 'Allow in this Session', kind: 'approve', group: 1 },
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

/** VS Code's options for a question nothing may keep an answer to. */
const ONCE = [
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

it('offers VS Code\'s options, in its words, on a question its backend put with none', async () => {
  const answers: Answer[] = [];
  const { host, turn } = await serving(asking(answers));
  expect((await turn('t1')).options).toEqual(STANDARD);
  expect(answers).toEqual([]);
  await host.close();
});

it('offers Allow Once and Skip alone where the operator\'s rule makes the tool ask, whatever the session allows', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers));
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { bash: false } } });
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['bash'], deny: [] } } });
  const ready = await turn('t1');
  expect(ready.options).toEqual(ONCE);
  expect(ready.confirmed).toBeUndefined();
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * An MCP server's tool is `<server>/<tool>` to the rule, its server the one the
 * call's contributor names among the session's customizations, as AHP names an
 * MCP tool's server on the call.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1338-L1344
 */
it('reads an MCP tool\'s server from the customization its call\'s contributor names', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch, turn } = await serving(asking(answers, 'mcp__tracker__create', { id: 'mcp:tracker', name: 'my.tracker' }));
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'my.tracker/create': false } } });
  expect((await turn('t1')).options).toEqual(ONCE);
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'), 'the first turn');
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'other.tracker/create': false } } });
  expect((await turn('t2')).options).toEqual(STANDARD);
  await host.close();
});

/* A call no MCP server contributes is named by its full tool name alone. */
it('names an MCP tool a call carries no contributor for by its full tool name alone', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch, turn } = await serving(asking(answers, 'mcp__my_tracker__create'));
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'my.tracker/create': false, 'my_tracker/create': false } } });
  expect((await turn('t1')).options).toEqual(STANDARD);
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'), 'the first turn');
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'mcp__my_tracker__create': false } } });
  expect((await turn('t2')).options).toEqual(ONCE);
  await host.close();
});

it('keeps an Allow in this Session answer in the session\'s permissions, and answers the next question about the tool itself', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch, turn } = await serving(asking(answers));
  await turn('t1');
  p.heard.length = 0;
  await dispatch(CHAT, { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-t1', approved: true, confirmed: 'user-action', selectedOptionId: 'allow-session' });
  expect(answers).toEqual([['call-t1', true, 'allow-session']]);
  const kept = p.heard.filter((one) => one.channel === SESSION && one.action.type === 'session/configChanged');
  expect(kept.map((one) => [one.action.config, one.origin])).toEqual([[{ permissions: { allow: ['bash'], deny: [] } }, undefined]]);
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'), 'the first turn');

  const ready = await turn('t2');
  expect(ready).toEqual({ type: 'chat/toolCallReady', turnId: 't2', toolCallId: 'call-t2', invocationMessage: 'Run ls', toolInput: 'ls', confirmed: 'not-needed' });
  expect(answers).toEqual([['call-t1', true, 'allow-session'], ['call-t2', true, undefined]]);
  await host.close();
});

/*
 * A call the permissions deny is refused before its question reaches any
 * client: no question and no confirmation is said, and the backend is handed
 * the refusal, as VS Code's host answers its agent.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1696-L1733
 */
it('refuses a call the session\'s permissions deny before any client is asked, and hands its backend the refusal', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch } = await serving(asking(answers));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['bash'], deny: ['bash'] } } });
  await dispatch(CHAT, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
  await until(() => answers.length > 0, 'the refusal');
  await settle();
  expect(answers).toEqual([['call-t1', false, undefined]]);
  expect(p.heard.filter((one) => one.channel === CHAT
    && (one.action.type === 'chat/toolCallReady' || one.action.type === 'chat/toolCallConfirmed'))).toEqual([]);
  await host.close();
});
