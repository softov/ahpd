import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { WAIT_MS } from '../../../tools/wait.ts';
import { ROOT } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { Status } from '../src/sessions/catalog.js';
import type { Agent, BoundTool, Listed, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Host } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

/*
 * The terminal a call of the agent terminal tool shows.
 *
 * A host tool's call shows its terminal through the `opened` callback the
 * backend gives it, as a `!` command's call does: the backend puts the
 * terminal on the call and a client draws it while the command runs. Here the
 * backend writes its calls and the host writes the terminal, so each case runs
 * a call the way a backend does: it starts the call, runs the host's `bash`
 * with the call's id and an `opened` of its own, and completes the call with
 * the answer and the terminal kept in it.
 */

const { createHost } = await import('../src/host.js');
const { shellTerminals } = await import('../src/machines/terminals.js');
const { hostTools } = await import('../src/tools/index.js');

/** Every frame the host put on the wire, in order. */
const wire: { method: string; params: Record<string, unknown> }[] = [];

function peer(): Peer {
  return {
    send: () => {},
    notify: (method, params) => { wire.push({ method, params: params as Record<string, unknown> }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/** Every action dispatched on one channel, in order. */
const on = (channel: string): Bag[] => wire
  .filter((one) => one.method === 'action' && one.params.channel === channel)
  .map((one) => one.params.action as Bag);

/** Wait for something to become true, by the clock. */
const until = async (check: () => boolean): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('waited too long');
};

/** What one turn of the backend does with its one call. */
interface Script {
  /** The input the backend hands the host's `bash`. */
  input: Record<string, unknown>;
  /** Content the backend writes on the call itself before the shell opens. */
  own?: Bag[];
}

/** The call every turn makes. */
const CALL = 'tc-1';

/**
 * A backend whose every turn makes one call of the host's `bash`.
 *
 * It keeps its own chat state the way the protocol's reducer would, which is
 * what a snapshot is served from. The terminal is the host's, handed over as
 * the tool opens it, and the backend puts it on the call and keeps it in the
 * completion, as every backend that takes the tool does.
 */
function shelling(script: Script): Agent {
  return {
    provider: 'fake',
    displayName: 'Fake',
    schema: () => ({ type: 'object', properties: {} }),
    defaults: () => ({}),
    list: async (): Promise<Listed[]> => [],
    create: (start: Start): Session => {
      const turns: Bag[] = [];
      let active: Bag | undefined;
      // The folder a new shell opens in, as the session reports it.
      const folders = start.workingDirectory === undefined ? [] : [uriOf(start.workingDirectory)];
      return {
        uri: start.uri,
        chatUri: start.chatUri,
        models: () => [],
        agentId: () => start.uri,
        customizations: () => [],
        allTurns: () => turns,
        activity: () => (active ? 'Working' : undefined),
        status: () => (active ? Status.InProgress : Status.Idle),
        title: () => 'Shell',
        modifiedAt: () => new Date().toISOString(),
        workingDirectories: () => folders,
        settings: () => ({}),
        sessionState: () => ({
          provider: 'fake', title: 'Shell', status: active ? Status.InProgress : Status.Idle,
          lifecycle: 'ready', defaultChat: start.chatUri, chats: [{ resource: start.chatUri, title: 'Shell' }],
          workingDirectories: folders, customizations: [], config: { schema: start.schema(), values: {} },
        }),
        chatState: () => ({
          resource: start.chatUri, title: 'Shell', status: active ? Status.InProgress : Status.Idle,
          modifiedAt: new Date().toISOString(), turns,
          ...(active ? { activeTurn: active } : {}), queuedMessages: [], interactivity: 'full',
        }),
        sendMessage: (turnId, text) => {
          const startedAt = new Date().toISOString();
          const turn: Bag = { id: turnId, startedAt, message: { text, origin: { kind: 'user' } }, responseParts: [] };
          active = turn;
          start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: turn.message });
          void (async () => {
            const call: Bag = {
              toolCallId: CALL, toolName: 'bash', displayName: 'Run command', status: 'running',
              confirmed: 'not-needed', invocationMessage: 'Run command', content: [],
            };
            (turn.responseParts as Bag[]).push({ kind: 'toolCall', toolCall: call });
            start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: CALL, toolName: 'bash', displayName: 'Run command' });
            start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId: CALL, invocationMessage: 'Run command', confirmed: 'not-needed' });
            if (script.own !== undefined) {
              call.content = script.own;
              start.emit('chat', { type: 'chat/toolCallContentChanged', turnId, toolCallId: CALL, content: script.own });
            }
            const bash: BoundTool | undefined = start.tools?.find((one) => one.definition.name === 'bash');
            if (bash?.run === undefined) throw new Error('the host offered no bash');
            /*
             * The terminal the host opens, put on the call as it opens: this is
             * the backend's half, and what a client draws while the command
             * runs. Kept for the completion, which replaces the call's content.
             */
            let kept: Bag | undefined;
            const opened = (terminal: { uri: string; isPty?: boolean }): void => {
              const block = {
                type: 'terminal',
                resource: terminal.uri,
                title: 'Terminal',
                ...(terminal.isPty === undefined ? {} : { isPty: terminal.isPty }),
              };
              kept = block;
              call.content = [block];
              start.emit('chat', { type: 'chat/toolCallContentChanged', turnId, toolCallId: CALL, content: [block] });
            };
            let success = true;
            let answer: string;
            try {
              answer = await bash.run(script.input, { toolCallId: CALL, opened });
            }
            catch (error) {
              success = false;
              answer = (error as Error).message;
            }
            const shown = [
              ...(kept === undefined ? [] : [kept]),
              { type: 'text', text: answer },
            ];
            const result = { success, pastTenseMessage: 'Ran command', content: shown };
            Object.assign(call, { status: 'completed', ...result });
            start.emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId: CALL, result });
            turns.push(turn);
            active = undefined;
            start.emit('chat', { type: 'chat/turnComplete', turnId, duration: 1 });
          })();
        },
        changeModel: () => {},
        changeAgent: () => {},
        abort: () => {},
        setDraft: () => {},
        confirm: () => false,
        answer: () => false,
        setCustomizationEnabled: async () => false,
        startMcpServer: async () => false,
        stopMcpServer: async () => false,
        close: () => {},
      };
    },
  };
}

/** Every host a case opened, closed after it so no shell outlives the case. */
const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }) =>
  async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => await client.handle({ method, params });

/**
 * A host with the agent terminal tool on, one session of the scripted backend
 * in a folder of its own, and one turn sent and finished.
 */
async function ran(script: Script) {
  wire.length = 0;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-call-terminal-')));
  const host = createHost({ path: dir, agents: [shelling(script)], terminals: shellTerminals(), tools: hostTools() });
  opened.push(host);
  const client = host.accept(peer());
  const ask = asking(client);
  await ask('initialize', { channel: ROOT, clientId: 'calls', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] });
  await ask('dispatchAction', { channel: ROOT, action: { type: 'root/configChanged', config: { enableCustomTerminalTool: true } } });
  await ask('createSession', { channel: 'ahp-session:/shell', provider: 'fake', workingDirectories: [uriOf(dir)] });
  const session = await ask('subscribe', { channel: 'ahp-session:/shell' }) as { snapshot: { state: { defaultChat: string } } };
  const chat = session.snapshot.state.defaultChat;
  await ask('subscribe', { channel: chat });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run it' } } },
  });
  await until(() => on(chat).some((one) => one.type === 'chat/turnComplete'));
  const root = await ask('subscribe', { channel: ROOT }) as { snapshot: { state: { terminals?: { resource: string; claim: Bag }[] } } };
  const terminal = (root.snapshot.state.terminals ?? []).find((one) => one.claim.toolCallId === CALL)?.resource;
  return { ask, chat, terminal };
}

/** The call's content changes on the wire, in order. */
const changes = (chat: string): Bag[][] => on(chat)
  .filter((one) => one.type === 'chat/toolCallContentChanged' && one.toolCallId === CALL)
  .map((one) => one.content as Bag[]);

/** The call's completion on the wire. */
const completion = (chat: string): Bag => on(chat).find((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === CALL) as Bag;

// A shell on pipes reads its commands from a pipe, which a POSIX shell does.
describe.skipIf(!posix)('the terminal of an agent terminal tool call', () => {
  it('is on the call while its command runs, and on the call it completes with', async () => {
    const { ask, chat, terminal } = await ran({ input: { command: 'echo hello' } });
    expect(terminal).toMatch(/^ahp-terminal:/u);
    // The store was handed no pseudoterminal, so the shell runs on pipes.
    const block = { type: 'terminal', resource: terminal, title: 'Terminal', isPty: false };
    expect(changes(chat)).toEqual([[block]]);
    const result = completion(chat).result as Bag;
    expect(result.success).toBe(true);
    expect(result.content).toEqual([
      block,
      { type: 'text', text: expect.stringMatching(/^Shell ID: \S+\nExit code: 0\nhello$/u) as unknown },
    ]);
    // A client that subscribes after reads the call as the wire left it.
    const late = await ask('subscribe', { channel: chat }) as { snapshot: { state: { turns: Bag[] } } };
    const part = (late.snapshot.state.turns[0]?.responseParts as Bag[]).find((one) => one.kind === 'toolCall') as Bag;
    expect((part.toolCall as Bag).content).toEqual(result.content);
  });

  it('names a command that failed as a failed call', async () => {
    const { chat, terminal } = await ran({ input: { command: 'false' } });
    const result = completion(chat).result as Bag;
    expect(result.success).toBe(false);
    expect((result.content as Bag[])[0]).toEqual({ type: 'terminal', resource: terminal, title: 'Terminal', isPty: false });
    expect(((result.content as Bag[])[1] as Bag).text).toMatch(/^Shell ID: \S+\nExit code: 1\n$/u);
  });

  it('replaces what the backend wrote on the call when the shell opens', async () => {
    const own = [{ type: 'text', text: 'working' }];
    const { chat, terminal } = await ran({ input: { command: 'echo hello' }, own });
    const block = { type: 'terminal', resource: terminal, title: 'Terminal', isPty: false };
    // The backend's own, then the terminal the host opened for the call.
    expect(changes(chat)).toEqual([own, [block]]);
  });

  it('keeps the terminal on a command that was still running when its call ended', async () => {
    const { chat, terminal } = await ran({ input: { command: 'sleep 5', timeout: 200 } });
    const result = completion(chat).result as Bag;
    expect(result.success).toBe(false);
    expect((result.content as Bag[])[0]).toEqual({ type: 'terminal', resource: terminal, title: 'Terminal', isPty: false });
    expect(((result.content as Bag[])[1] as Bag).text).toMatch(/Command timed out after/u);
  });
});
