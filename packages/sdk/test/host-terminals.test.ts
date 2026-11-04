import { WAIT_MS } from '../../../tools/wait.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, McpServer, Start } from '../src/types/agent.js';
import type { OpenedTerminal, SpawnPty } from '../src/types/terminals.js';
import { uriOf } from '../src/resources/resources.js';
import { localPath } from '../src/resources/fileuri.js';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine,
  peer, sdk, settle, shellTerminals,
} from './support/host.js';
import { fakePty } from './support/pty.js';
import { callsIn, openedFrom, replayed } from './support/replay.js';
import { undeclaredIn } from './support/wire.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/** What a terminal sends for ctrl+c. Written as a code so it survives a diff. */
const ETX = String.fromCharCode(3);

beforeEach(resetSdk);

/*
 * `!ls` in the composer, which is a command rather than a question.
 *
 * The protocol standardises the marker and leaves the behaviour to the host:
 * `InitializeResult.terminalCommandPrefix` says what a host recognises, and
 * absence says it recognises nothing. The turn is still the chat's, because a
 * transcript that lost the command would be a conversation with a gap in it.
 */
describe('a command typed into the conversation', () => {
  /** A Claude session on a host with a shell: pipes, or the pseudoterminal `pty` binds. */
  const shelled = async (pty?: SpawnPty) => {
    const host = createHost({
      path: tmpdir(),
      agents: [claude({ paths: [tmpdir()] })],
      ...machine(),
      ...(pty === undefined ? {} : { terminals: shellTerminals({ pty }) }),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const uri = 'ahp-session:/banged';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(tmpdir())] } });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
    return { host, client, peer: p, uri, chatUri, opened };
  };

  /**
   * Wait for a turn to end, however it ended: any, or the named one, which is
   * the turn of that id or the turn that took the queued message of that id.
   */
  const ended = async (p: ReturnType<typeof peer>, chatUri: string, named?: string) => {
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 25); });
      const said = actions(p, chatUri).map((e) => e.action);
      const turnId = said.find((one) => one.type === 'chat/turnStarted' && one.queuedMessageId === named)?.turnId ?? named;
      if (said.some((one) => one.type === 'chat/turnComplete' && (named === undefined || one.turnId === turnId))) break;
    }
    return actions(p, chatUri).map((e) => e.action);
  };

  it('says it recognises the marker, and says nothing when there is no shell', async () => {
    const withShell = await shelled();
    const first = await withShell.client.handle(hello(['0.9.0'])).catch(() => undefined);
    expect(first).toBeUndefined(); // already introduced

    const bare = createHost({ path: tmpdir(), agents: [claude({ paths: [tmpdir()] })] }).accept(peer());
    const said = await bare.handle(hello(['0.9.0'])) as { terminalCommandPrefix?: string };
    // Absence is the protocol's own way of saying the shorthand is
    // unsupported, and a host with no shell cannot support it.
    expect(said.terminalCommandPrefix).toBeUndefined();

    const able = createHost({ path: tmpdir(), agents: [claude({ paths: [tmpdir()] })], ...machine() }).accept(peer());
    const also = await able.handle(hello(['0.9.0'])) as { terminalCommandPrefix?: string };
    expect(also.terminalCommandPrefix).toBe('!');
  });

  it('runs it in a terminal and puts the whole thing in the turn', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo ran-from-the-composer' } } },
    });
    const said = await ended(p, chatUri);
    // Not the agent's. A command handed to the CLI would be answered with
    // prose about the command rather than by running it.
    expect(sdk.said).toEqual([]);

    const start = said.find((one) => one.type === 'chat/toolCallStart');
    expect(start).toMatchObject({ toolName: 'terminal', intention: 'echo ran-from-the-composer' });
    const done = said.find((one) => one.type === 'chat/toolCallComplete');
    const result = done?.result as { success: boolean; content: { type: string; text?: string; resource?: string }[] };
    expect(result.success).toBe(true);
    expect(result.content.find((one) => one.type === 'text')?.text).toContain('ran-from-the-composer');
    // The terminal it ran in, so a client can watch the output arrive rather
    // than wait for the whole of it.
    expect(result.content.find((one) => one.type === 'terminal')?.resource).toMatch(/^ahp-terminal:/);

    // And in the snapshot, not only in the stream: a client that subscribes
    // afterwards reads the transcript rather than the actions it missed.
    const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { message: { text: string }; responseParts: { kind?: string; toolCall?: { toolName: string; status: string } }[] }[] } };
    }).snapshot.state.turns;
    expect(kept.at(-1)?.message.text).toBe('!echo ran-from-the-composer');
    // A part, not a bare call: `kind` is what a client draws by.
    expect(kept.at(-1)?.responseParts[0]?.kind).toBe('toolCall');
    expect(kept.at(-1)?.responseParts[0]?.toolCall?.toolName).toBe('terminal');
    expect(kept.at(-1)?.responseParts[0]?.toolCall?.status).toBe('completed');
  });

  /*
   * The terminal as soon as it opens, as the reference host names its own:
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104
   */
  it('names its terminal while it runs, and says a pseudoterminal runs it', async () => {
    const pty = fakePty();
    const { client, peer: p, chatUri, opened } = await shelled(pty.spawn);
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: '!make preview', origin: { kind: 'user' } } } },
    });
    const changed = () => actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallContentChanged')?.action;
    for (const until = Date.now() + WAIT_MS; changed() === undefined && Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 5); });
    }
    // Before the command has printed anything, and with no `_meta`, which the
    // reducer would put in place of the call's own.
    const named = { type: 'terminal', resource: expect.stringMatching(/^ahp-terminal:/), title: 'Terminal', isPty: true };
    expect(changed()?.content).toEqual([named]);
    expect(changed()).not.toHaveProperty('_meta');
    // A client that subscribes while the command runs reads what a watching one holds.
    const during = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
    expect(callsIn(during.state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));

    pty.say('built\r\n');
    pty.exit(0);
    const said = await ended(p, chatUri, 't1');
    const done = said.find((one) => one.type === 'chat/toolCallComplete');
    expect((done?.result as { content: unknown[] }).content).toEqual([
      { ...named, result: { exitCode: 0, preview: 'built\r\n' } },
      { type: 'text', text: 'built\r\n' },
    ]);
    const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));
    expect(undeclaredIn([...p.notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
  });

  it('leaves the chat and the session read', async () => {
    const { client, peer: p, uri, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo read' } } },
    });
    const said = await ended(p, chatUri);
    // Unread while it runs, as a client reduces the turn's start, and read
    // again at its end: somebody who ran a command watched it run.
    expect(said.filter((one) => one.type === 'chat/isReadChanged').map((one) => one.isRead)).toEqual([false, true]);
    for (const channel of [uri, chatUri]) {
      const state = (await client.handle({ method: 'subscribe', params: { channel } }) as {
        snapshot: { state: { status: number } };
      }).snapshot.state;
      expect(state.status & 32).toBe(32);
    }
  });

  it('leaves each chat read when two chats run a command turn of the same id', async () => {
    // A client names its own turns, so two chats can each run turn `t1` at
    // once. The short one ends first, and the long one still ends as a
    // command turn of its own chat.
    const { client, peer: p, uri, chatUri } = await shelled();
    const other = 'ahp-session:/banged-too';
    await client.handle({ method: 'createSession', params: { channel: other, provider: 'claude', workingDirectories: [uriOf(tmpdir())] } });
    const otherChat = (await client.handle({ method: 'subscribe', params: { channel: other } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: otherChat } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!sleep 0.5; echo long' } } },
    });
    client.handle({
      method: 'dispatchAction',
      params: { channel: otherChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo short' } } },
    });
    await ended(p, otherChat);
    await ended(p, chatUri);
    for (const channel of [uri, chatUri, other, otherChat]) {
      const state = (await client.handle({ method: 'subscribe', params: { channel } }) as {
        snapshot: { state: { status: number } };
      }).snapshot.state;
      expect([channel, state.status & 32]).toEqual([channel, 32]);
    }
  });

  /*
   * A command that ran and exited with a code is a call that failed with no
   * error, since nothing went wrong running it, and its turn is complete, as
   * the reference host completes the call and ends every local command's turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L141-L148
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L212
   */
  it('says a command that exited with a code failed, with no error, and holds its turn complete', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!exit 3' } } },
    });
    const said = await ended(p, chatUri, 't1');
    const result = said.find((one) => one.type === 'chat/toolCallComplete')?.result as Record<string, unknown> | undefined;
    expect(result).toMatchObject({ success: false, pastTenseMessage: 'Command exited with code 3' });
    expect(result).not.toHaveProperty('error');
    const held = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string; state: string }[] } };
    }).snapshot.state.turns;
    expect(held.map((turn) => [turn.id, turn.state])).toEqual([['t1', 'complete']]);
  });

  /*
   * A command that could not run is a call that failed with why, and its turn
   * is complete all the same, as the reference host completes the call of a
   * command that threw and ends the turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L118-L135
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L212
   */
  it('says a command that could not run failed with why, and completes its turn', async () => {
    const host = createHost({
      path: tmpdir(),
      agents: [claude({ paths: [tmpdir()] })],
      terminals: { create: () => { throw new Error('no shell to be had'); } },
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/unrun';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(tmpdir())] } });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!ls' } } },
    });
    const said = await ended(p, chatUri, 't1');
    expect(said.find((one) => one.type === 'chat/toolCallComplete')?.result).toEqual({
      success: false,
      pastTenseMessage: 'Failed to run command',
      error: { message: 'no shell to be had' },
    });
    expect(said.some((one) => one.type === 'chat/turnComplete' && one.turnId === 't1')).toBe(true);
    expect(sdk.said).toEqual([]);
  });

  it('sends a lone exclamation mark to the agent, because it is not a command', async () => {
    const { client, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!  ' } } },
    });
    await new Promise((r) => { setTimeout(r, 30); });
    // Somebody typing an exclamation mark, not somebody running nothing.
    expect(sdk.said).toEqual(['!  ']);
  });

  /** Queue `text` under `id`, as a composer does while a turn runs. */
  const queue = (client: Awaited<ReturnType<typeof shelled>>['client'], channel: string, id: string, text: string) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text, origin: { kind: 'user' } } } },
    });
  };

  it('runs a queued one when the turn in front of it ends, not asks the agent', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    queue(client, chatUri, 'q1', '!echo from-the-queue');
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    for (let i = 0; i < 80 && !actions(p, chatUri).some((e) => e.action.type === 'chat/toolCallComplete'); i++) {
      await new Promise((r) => { setTimeout(r, 25); });
    }
    expect(sdk.said).toEqual(['first']);
    const said = actions(p, chatUri).map((e) => e.action);
    expect(said.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({ toolName: 'terminal', intention: 'echo from-the-queue' });
    // Named on the turn that ran it, so a client takes it out of its queue.
    expect(said.filter((one) => one.type === 'chat/turnStarted').at(-1)?.queuedMessageId).toBe('q1');
  });

  it('edits a queued one in place when the same id comes again', async () => {
    const { client, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    queue(client, chatUri, 'q1', '!echo one');
    queue(client, chatUri, 'q1', '!echo two');
    await settle();
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { queuedMessages: { id: string; message: { text: string } }[] } };
    };
    expect(opened.snapshot.state.queuedMessages.map((m) => [m.id, m.message.text])).toEqual([['q1', '!echo two']]);
  });

  it('runs a queued one at once when nothing is running, and takes it out of the queue', async () => {
    const { client, peer: p, chatUri } = await shelled();
    queue(client, chatUri, 'q1', '!echo right-away');
    const said = await ended(p, chatUri);
    expect(sdk.said).toEqual([]);
    const started = said.find((one) => one.type === 'chat/turnStarted');
    expect(started?.queuedMessageId).toBe('q1');
    expect(said.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({ toolName: 'terminal', intention: 'echo right-away' });
  });

  it('runs it on a session resumed from disk for it, not asks the agent', async () => {
    // The road the daemon crashed on: a turn for a session nothing was
    // running, resumed on the spot, went to `begin` and the model saw `!ping`.
    sdk.sessions.push({ sessionId: 'on-disk', summary: 'Earlier', lastModified: 1, cwd: '/tmp' });
    const host = createHost({ path: tmpdir(), agents: [claude({ paths: [tmpdir()] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chatUri = `ahp-chat://default/${Buffer.from('ahp-session:/on-disk', 'utf8').toString('base64url')}`;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo from-disk' } } },
    });
    const said = await ended(p, chatUri);
    expect(sdk.said).toEqual([]);
    expect(said.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({ toolName: 'terminal', intention: 'echo from-disk' });
  });

  it('closes the shells a session was holding when the session goes', async () => {
    const { client, peer: p, uri, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo kept' } } },
    });
    await ended(p, chatUri);
    const listed = () => (actions(p, 'ahp-root://')
      .filter((e) => e.action.type === 'root/terminalsChanged').at(-1)
      ?.action.terminals as unknown[] | undefined) ?? [];
    expect(listed()).toHaveLength(1);

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    // The chat that pointed at it is gone, so what is left would be a channel
    // in the catalogue that nobody can reach.
    expect(listed()).toHaveLength(0);
  });

  it('runs a command queued during a turn instead of handing it to the agent', async () => {
    const { client, peer: p, chatUri } = await shelled();
    // A turn that stays open: the fake CLI answers only when a result frame
    // arrives, which is what leaves the session busy enough to queue behind.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 't2', message: { origin: { kind: 'user' }, text: '!echo queued-command' } } },
    });
    await settle();
    // Waiting, and not run: a command that jumped the queue would run against
    // a tree the turn in front of it is still editing.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/pendingMessageSet')).toBe(true);
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/toolCallStart')).toBe(false);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5 });
    // The command's own turn, the one that took its queued message: the one in
    // front of it ends first, and a shell can take longer to start than that
    // one took to end.
    const done = await ended(p, chatUri, 't2');
    /*
     * Run, not asked. The command waited as text so a client could see it, and
     * handing `!echo queued-command` to the CLI on its turn is exactly what
     * the prefix exists to prevent - `sdk.said` is what proves it did not.
     */
    const start = done.find((one) => one.type === 'chat/toolCallStart');
    expect(start).toMatchObject({ toolName: 'terminal', intention: 'echo queued-command' });
    const completed = done.find((one) => one.type === 'chat/toolCallComplete');
    expect((completed?.result as { success: boolean }).success).toBe(true);
    expect(sdk.said).toEqual(['first']);
  });

  /*
   * A command sent as a turn while a turn runs is taken: its start takes the
   * running turn's place, as the reducer replaces the active turn, and this
   * host runs it at once as its local command, as the reference host runs a
   * `!` command it is handed without forwarding it to the agent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L40
   */
  it('runs a command sent as a turn while a turn runs, in that turn\'s place', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 7, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo took-its-place' } } },
    });
    await ended(p, chatUri, 't2');
    const answers = actions(p, chatUri).filter((e) => e.origin?.clientSeq === 7);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ action: { type: 'chat/turnStarted', turnId: 't2' } });
    expect(answers[0]?.rejectionReason).toBeUndefined();
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/pendingMessageSet')).toBe(false);
    const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart' && e.action.turnId === 't2');
    expect(start?.action).toMatchObject({ toolName: 'terminal', intention: 'echo took-its-place' });
    // Not handed to the CLI, and the turn it took the place of is in no history.
    expect(sdk.said).toEqual(['first']);
    const held = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { id: string }[] } };
    }).snapshot.state;
    expect(held.turns.map((turn) => turn.id)).toEqual(['t2']);
  });

  it('says a command on pipes runs in no pseudoterminal', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: '!echo said-on-pipes', origin: { kind: 'user' } } } },
    });
    const said = await ended(p, chatUri, 't1');
    const named = { type: 'terminal', resource: expect.stringMatching(/^ahp-terminal:/), title: 'Terminal', isPty: false };
    expect(said.find((one) => one.type === 'chat/toolCallContentChanged')?.content).toEqual([named]);
    const done = said.find((one) => one.type === 'chat/toolCallComplete')?.result as { content: unknown[] } | undefined;
    expect(done?.content[0]).toMatchObject({ ...named, result: { exitCode: 0 } });
  });

  it('says how long the command ran at its completion, on the key VS Code reads', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: '!echo timed', origin: { kind: 'user' } } } },
    });
    const said = await ended(p, chatUri, 't1');
    const ready = said.find((one) => one.type === 'chat/toolCallReady');
    const done = said.find((one) => one.type === 'chat/toolCallComplete');
    // Nothing on the ready, as VS Code's local command says it.
    expect(ready?._meta).toBeUndefined();
    expect(done?._meta).toEqual({ 'vscode.toolCallDurationMs': expect.any(Number) });
  });

  /** A session of the echo example, which runs no command of its own and says back what it is handed, `pace` apart. */
  const echoing = async (pace = 0) => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const host = createHost({ path: tmpdir(), agents: [echo({ path: tmpdir(), pace })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/echoing';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(tmpdir())] } });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    return { client, peer: p, chatUri };
  };

  /*
   * A queued command on an idle chat: the client's set said first, then the
   * drain's start for it, and then the command run as that turn's local
   * command, as the reference host's drain admits a queued message and its
   * local command takes the turn, whatever agent the chat has.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L288-L326
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L40
   */
  it('runs a queued one on an idle chat once the drain starts its turn, after the set', async () => {
    const { client, peer: p, chatUri } = await echoing();
    queue(client, chatUri, 'q1', '!echo drained');
    const said = await ended(p, chatUri, 'q1');
    const told = ['chat/pendingMessageSet', 'chat/turnStarted', 'chat/toolCallStart'];
    expect(said.map((one) => String(one.type)).filter((type) => told.includes(type))).toEqual(told);
    expect(said.find((one) => one.type === 'chat/turnStarted')).toMatchObject({ queuedMessageId: 'q1', message: { text: '!echo drained' } });
    expect(said.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({ toolName: 'terminal', intention: 'echo drained' });
    // Never said back: the agent was not handed it.
    expect(said.some((one) => one.type === 'chat/responsePart')).toBe(false);
  });

  /*
   * A command sent as a turn while another runs runs at once, on a backend
   * that runs no command of its own as much as on any other: the reference
   * host runs its local commands ahead of the admission a question waits on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L14-L41
   */
  it('runs one sent while another turn runs at once, its terminal open before that turn ends', async () => {
    const { client, peer: p, chatUri } = await echoing(150);
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two three four five six seven eight nine ten eleven twelve' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo at-once' } } },
    });
    const said = await ended(p, chatUri, 't2');
    // Named, run and over, while the echo in front of it is still saying its words.
    expect(said.some((one) => one.type === 'chat/toolCallContentChanged' && one.turnId === 't2')).toBe(true);
    expect(said.find((one) => one.type === 'chat/toolCallComplete' && one.turnId === 't2')?.result).toMatchObject({ success: true, pastTenseMessage: 'Ran command' });
    expect(said.some((one) => one.type === 'chat/turnComplete' && one.turnId === 't1')).toBe(false);
    expect(said.some((one) => one.type === 'chat/delta' && String(one.content).includes('at-once'))).toBe(false);
  });
});

describe('a shell on this machine', () => {
  const opened = async () => {
    const host = createHost({ path: tmpdir(), agents: [claude({ paths: [tmpdir()] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { host, client, peer: p };
  };

  /** Wait for the shell to actually say something. */
  const spoken = async (p: ReturnType<typeof peer>, uri: string, want: string) => {
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 50); });
      const said = actions(p, uri)
        .filter((e) => e.action.type === 'terminal/data')
        .map((e) => String(e.action.data))
        .join('');
      if (said.includes(want)) return said;
    }
    return actions(p, uri).filter((e) => e.action.type === 'terminal/data').map((e) => String(e.action.data)).join('');
  };

  it('runs what it is sent and says what came back', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/one';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'echo hello-from-a-terminal\n' } },
    });
    expect(await spoken(p, uri, 'hello-from-a-terminal')).toContain('hello-from-a-terminal');
  });

  it('throws away the scrollback and keeps everything else', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/cleared';
    await client.handle({
      method: 'createTerminal',
      params: {
        channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()),
        cols: 132, rows: 43, name: 'the one being cleared',
      },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'echo scrolled-past\n' } },
    });
    await spoken(p, uri, 'scrolled-past');

    client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/cleared' } } });
    const after = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { content: unknown[]; cols: number; rows: number; title: string; claim: { clientId: string } } };
    }).snapshot.state;
    expect(after.content).toEqual([]);
    // The size, the title and the claim survive: a client clears a terminal to
    // stop reading what is there, not to give it up.
    expect(after.cols).toBe(132);
    expect(after.rows).toBe(43);
    expect(after.title).toBe('the one being cleared');
    expect(after.claim.clientId).toBe('probe');
    // And said, so a second client watching redraws rather than keeping what
    // the first one just discarded.
    expect(actions(p, uri).some((e) => e.action.type === 'terminal/cleared')).toBe(true);
  });

  it('says it is not a pseudoterminal, rather than leaving it to be discovered', async () => {
    const { client } = await opened();
    const uri = 'ahp-terminal:/two';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    const found = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { isPty: boolean; supportsCommandDetection: boolean } };
    };
    // Pipes, not a PTY: anything that draws itself with cursor movement will
    // not look right, and a client that had to find that out by rendering it
    // would find out too late.
    expect(found.snapshot.state.isPty).toBe(false);
    expect(found.snapshot.state.supportsCommandDetection).toBe(false);
  });

  it('lists them on the root channel, and stops when one is disposed', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/three';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    const listed = actions(p, 'ahp-root://').filter((e) => e.action.type === 'root/terminalsChanged').at(-1);
    expect((listed?.action.terminals as { resource: string }[]).map((t) => t.resource)).toEqual([uri]);

    await client.handle({ method: 'disposeTerminal', params: { channel: uri } });
    const after = actions(p, 'ahp-root://').filter((e) => e.action.type === 'root/terminalsChanged').at(-1);
    expect(after?.action.terminals).toEqual([]);
    // And the channel is gone with it.
    await expect(client.handle({ method: 'subscribe', params: { channel: uri } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('starts a shell where the client said, even when the folder needs encoding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd terminals '));
    try {
      mkdirSync(join(dir, 'my dir'));
      const { client, peer: p } = await opened();
      const uri = 'ahp-terminal:/spaced';
      await client.handle({
        method: 'createTerminal',
        params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(join(dir, 'my dir')) },
      });
      await client.handle({ method: 'subscribe', params: { channel: uri } });
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'terminal/input', data: 'pwd\n' } },
      });

      // Read as text rather than decoded, the URI names a directory called
      // `my%20dir`, which is not the one the client picked and not one that
      // exists - so nothing starts there at all.
      expect(await spoken(p, uri, join(dir, 'my dir'))).toContain(join(dir, 'my dir'));
      // Windows keeps a folder a process is in, so the shell goes before the folder.
      await client.handle({ method: 'disposeTerminal', params: { channel: uri } });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('reports the directory it is in as the URI a client reads, not as a path with a raw hash in it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd terminals '));
    try {
      mkdirSync(join(dir, 'C#'));
      const { client } = await opened();
      const uri = 'ahp-terminal:/hashed';
      const where = join(dir, 'C#');
      await client.handle({
        method: 'createTerminal',
        params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(where) },
      });
      const found = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { cwd: string } };
      };
      // Built as `file://<dir>/C#`, a client that reads the state back the way
      // this host reads a URI opens the folder above the one the shell is in -
      // and one that hands it back verbatim is answered about a directory
      // called `C`, which is not either.
      expect(found.snapshot.state.cwd).toBe(uriOf(where));
      expect(localPath(found.snapshot.state.cwd)).toBe(where);
      // Windows keeps a folder a process is in, so the shell goes before the folder.
      await client.handle({ method: 'disposeTerminal', params: { channel: uri } });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('opens one wherever it is asked, as the reference host does', async () => {
    const { client } = await opened();
    // A terminal is arbitrary code on this machine, and so is a session; the
    // connection token is what decides who gets either, not the directory.
    await expect(client.handle({
      method: 'createTerminal',
      params: { channel: 'ahp-terminal:/four', claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    })).resolves.toBeDefined();
  });

  it('reports the exit code when the shell goes', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/five';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 3\n' } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    // Reporting nothing would read as still running.
    expect(actions(p, uri).find((e) => e.action.type === 'terminal/exited')?.action.exitCode).toBe(3);

    /*
     * And in the shape 0.9.0 asks for.
     *
     * That version moved the exit code inside `lifecycle` and made the field
     * required, so a terminal described without it is one a client cannot ask
     * about: `lifecycle.status` comes back undefined, which reads as a process
     * that never exits. The flat `exitCode` stays beside it because this host
     * negotiates down to 0.5.1, and every version before 0.9.0 reads that.
     */
    const after = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle?: { status?: string; exitCode?: number }; exitCode?: number } };
    };
    expect(after.snapshot.state.lifecycle).toEqual({ status: 'exited', exitCode: 3 });
    expect(after.snapshot.state.exitCode).toBe(3);
  });

  /*
   * The catalogue has to hear about an exit too.
   *
   * `root/terminalsChanged` fired when a terminal was created and when it was
   * disposed, and not when the shell inside it went - so the root channel went
   * on describing a dead terminal as running until somebody closed it. Older
   * than 0.9.0 and made worse by it: the old shape simply had no exit code to
   * report, and this one says `{ status: 'running' }` out loud.
   */
  it('tells the root channel when the shell goes, not only when it is closed', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/six';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 5\n' } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    await settle();

    const listed = actions(p, 'ahp-root://')
      .filter((e) => e.action.type === 'root/terminalsChanged')
      .at(-1)?.action.terminals as { resource: string; lifecycle?: { status?: string; exitCode?: number } }[] | undefined;
    expect(listed?.find((one) => one.resource === uri)?.lifecycle)
      .toEqual({ status: 'exited', exitCode: 5 });
  });

  it('says a terminal that is still running is running', async () => {
    const { client } = await opened();
    const uri = 'ahp-terminal:/alive';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    const found = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle?: { status?: string }; exitCode?: number } };
    };
    // Required, and not the absence of an exit code: a client should not have
    // to infer "running" from a field that is not there.
    expect(found.snapshot.state.lifecycle).toEqual({ status: 'running' });
    expect(found.snapshot.state.exitCode).toBeUndefined();

    // The root channel lists the same fact, and 0.9.0 requires it there too.
    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { terminals?: { resource: string; lifecycle?: { status?: string } }[] } };
    };
    expect(root.snapshot.state.terminals?.find((one) => one.resource === uri)?.lifecycle)
      .toEqual({ status: 'running' });
  });

  /*
   * Every terminal action a client sends is answered, its echo or its refusal.
   * Input is side-effect only, so the protocol's reducer changes nothing on it,
   * and a title set to the one it has changes nothing either: each goes to
   * every client of the terminal as the sender's own action, and so does the
   * refusal of either.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143
   */
  const watched = async (uri: string) => {
    const opened_ = await opened();
    await opened_.client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    await opened_.client.handle({ method: 'subscribe', params: { channel: uri } });
    const other = peer();
    const watching = opened_.host.accept(other);
    await watching.handle(hello(['0.9.0']));
    await watching.handle({ method: 'subscribe', params: { channel: uri } });
    const send = (clientSeq: number, action: Record<string, unknown>) =>
      opened_.client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq, action } });
    return { ...opened_, other, send };
  };

  it('says input to every client of the terminal, the sender\'s own action', async () => {
    const uri = 'ahp-terminal:/answered';
    const { peer: p, other, send } = await watched(uri);
    await send(3, { type: 'terminal/input', data: 'echo answered-input\n' });
    await spoken(p, uri, 'answered-input');

    for (const q of [p, other]) {
      const said = actions(q, uri).filter((e) => e.action.type === 'terminal/input');
      expect(said.map((e) => [e.origin?.clientSeq, e.rejectionReason])).toEqual([[3, undefined]]);
    }
    // One envelope, one number, the same at both clients.
    const seqOf = (q: typeof p) => actions(q, uri).find((e) => e.action.type === 'terminal/input')?.serverSeq;
    expect(seqOf(other)).toBe(seqOf(p));
    const seqs = p.notes.filter((n) => n.method === 'action').map((n) => (n.params as { serverSeq: number }).serverSeq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  /*
   * Input after the shell has gone goes out, and reaches no process: VS Code's
   * host says a client's terminal action before its terminal manager reads
   * it, and that manager writes input only to a running process.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527
   */
  it('says what it is sent once the shell has gone to every client of the terminal', async () => {
    const uri = 'ahp-terminal:/gone';
    const { peer: p, other, send } = await watched(uri);
    await send(4, { type: 'terminal/input', data: 'exit 0\n' });
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    const before = actions(p, uri).length;
    await send(5, { type: 'terminal/input', data: 'echo too-late\n' });
    await settle();

    expect(actions(p, uri).slice(before).map((e) => [e.action.type, e.origin?.clientSeq, e.rejectionReason]))
      .toEqual([['terminal/input', 5, undefined]]);
    // It reaches who any input reaches, the same envelope.
    const late = (q: typeof p) => actions(q, uri)
      .filter((e) => e.action.type === 'terminal/input' && e.origin?.clientSeq === 5)
      .map((e) => [e.serverSeq, e.rejectionReason]);
    expect(late(other)).toEqual(late(p));
  });

  it('says a new title and a title it already has to every client of the terminal', async () => {
    const uri = 'ahp-terminal:/titled';
    const { peer: p, other, send } = await watched(uri);
    await send(6, { type: 'terminal/titleChanged', title: 'build' });
    await send(7, { type: 'terminal/titleChanged', title: 'build' });
    await settle();

    for (const q of [p, other]) {
      const said = actions(q, uri).filter((e) => e.action.type === 'terminal/titleChanged');
      expect(said.map((e) => [e.origin?.clientSeq, e.rejectionReason])).toEqual([[6, undefined], [7, undefined]]);
    }
  });

  it('refuses a claim that names nobody', async () => {
    const uri = 'ahp-terminal:/unclaimed';
    const { peer: p, send } = await watched(uri);
    await send(8, { type: 'terminal/claimed', claim: {} });
    await settle();

    const refused = actions(p, uri).find((e) => e.action.type === 'terminal/claimed' && e.origin?.clientSeq === 8);
    expect(refused?.rejectionReason).toBeDefined();
  });
});

/*
 * The factory a backend gets on `Start.terminals`.
 *
 * The raw store was not usable by a backend: the host allocates the URI,
 * registers the terminal on its own root list and supplies the emit that
 * routes an action to the terminal's channel. This is that machinery, driven
 * through a backend's own call.
 */
describe('a terminal a backend opens', () => {
  /** A backend that opens one through the host as it starts. */
  const opening = (held: OpenedTerminal[]): Agent => {
    const inner = claude({ paths: [tmpdir()] });
    return {
      ...inner,
      create: (start) => {
        const opened = start.terminals?.open({
          cwd: tmpdir(),
          command: 'sleep',
          args: ['30'],
          name: 'backend shell',
        });
        if (opened !== undefined) held.push(opened);
        return inner.create(start);
      },
    };
  };

  it('lists it on the root channel, and takes it off when released', async () => {
    const held: OpenedTerminal[] = [];
    const host = createHost({ path: tmpdir(), agents: [opening(held)], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/shells', provider: 'claude' } });

    const listed = () => (actions(p, 'ahp-root://')
      .filter((e) => e.action.type === 'root/terminalsChanged').at(-1)
      ?.action.terminals as { resource: string; claim?: { kind?: string; session?: string } }[] | undefined) ?? [];

    const opened = held[0];
    if (opened === undefined) throw new Error('the backend opened no terminal');
    // The URI is the host's, not one the backend invented, and the claim is
    // the session's - which is what makes the root list and session cleanup
    // both know about it.
    expect(listed()).toHaveLength(1);
    expect(listed()[0]?.resource).toMatch(/^ahp-terminal:\//);
    expect(listed()[0]?.claim).toMatchObject({ kind: 'session', session: 'ahp-session:/shells' });
    expect(opened.uri).toBe(listed()[0]?.resource);

    opened.release();
    // The row goes, and with it the process: a released terminal that left a
    // shell running would be one nothing lists and nothing can stop.
    expect(listed()).toEqual([]);
    await expect(opened.waitForExit()).resolves.toBeDefined();
  });

  it('says whether a pseudoterminal runs it', async () => {
    const opens = async (held: OpenedTerminal[], pty?: SpawnPty): Promise<void> => {
      const host = createHost({
        path: tmpdir(),
        agents: [opening(held)],
        ...machine(),
        ...(pty === undefined ? {} : { terminals: shellTerminals({ pty }) }),
      });
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/shells', provider: 'claude' } });
    };
    const piped: OpenedTerminal[] = [];
    await opens(piped);
    expect(piped[0]?.isPty).toBe(false);
    piped[0]?.release();

    const bound: OpenedTerminal[] = [];
    await opens(bound, fakePty().spawn);
    expect(bound[0]?.isPty).toBe(true);
    bound[0]?.release();
  });
});

describe('interrupting a terminal', () => {
  it('turns ^C into a signal, because there is no line discipline to', async () => {
    const host = createHost({ path: tmpdir(), agents: [claude({ paths: [tmpdir()] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-terminal:/int';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'sleep 30\n' } },
    });
    await new Promise((r) => { setTimeout(r, 300); });
    /*
     * A pseudoterminal's driver sees the byte and signals the foreground
     * group. Pipes have no driver, so it would arrive as ordinary input and
     * the command would run on - a terminal a runaway command cannot be
     * stopped in.
     */
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: ETX } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    expect(actions(p, uri).some((e) => e.action.type === 'terminal/exited')).toBe(true);
  });
});
