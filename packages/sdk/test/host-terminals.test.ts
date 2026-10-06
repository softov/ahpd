import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, McpServer, Start } from '../src/types/agent.js';
import type { OpenedTerminal } from '../src/types/terminals.js';
import { uriOf } from '../src/resources.js';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine,
  peer, sdk, settle,
} from './support/host.js';

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
  const shelled = async () => {
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const uri = 'ahp-session:/banged';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: ['file:///tmp'] } });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    return { host, client, peer: p, uri, chatUri };
  };

  /** Wait for the turn to end, however it ended. */
  const ended = async (p: ReturnType<typeof peer>, chatUri: string) => {
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => { setTimeout(r, 25); });
      if (actions(p, chatUri).some((e) => e.action.type === 'chat/turnComplete')) break;
    }
    return actions(p, chatUri).map((e) => e.action);
  };

  it('says it recognises the marker, and says nothing when there is no shell', async () => {
    const withShell = await shelled();
    const first = await withShell.client.handle(hello(['0.9.0'])).catch(() => undefined);
    expect(first).toBeUndefined(); // already introduced

    const bare = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })] }).accept(peer());
    const said = await bare.handle(hello(['0.9.0'])) as { terminalCommandPrefix?: string };
    // Absence is the protocol's own way of saying the shorthand is
    // unsupported, and a host with no shell cannot support it.
    expect(said.terminalCommandPrefix).toBeUndefined();

    const able = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() }).accept(peer());
    const also = await able.handle(hello(['0.9.0'])) as { terminalCommandPrefix?: string };
    expect(also.terminalCommandPrefix).toBe('!');
  });

  it('runs it in a terminal and puts the whole thing in the turn', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!echo ran-from-the-composer' } } },
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

  it('says a command failed when it did', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!exit 3' } } },
    });
    const said = await ended(p, chatUri);
    const result = said.find((one) => one.type === 'chat/toolCallComplete')?.result as {
      success: boolean; pastTenseMessage: string;
    };
    expect(result.success).toBe(false);
    expect(result.pastTenseMessage).toContain('3');
  });

  it('sends a lone exclamation mark to the agent, because it is not a command', async () => {
    const { client, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!  ' } } },
    });
    await new Promise((r) => { setTimeout(r, 30); });
    // Somebody typing an exclamation mark, not somebody running nothing.
    expect(sdk.said).toEqual(['!  ']);
  });

  /** Queue `text` under `id`, as a composer does while a turn runs. */
  const queue = (client: Awaited<ReturnType<typeof shelled>>['client'], channel: string, id: string, text: string) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text } } },
    });
  };

  it('runs a queued one when the turn in front of it ends, not asks the agent', async () => {
    const { client, peer: p, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
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
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chatUri = `ahp-chat://default/${Buffer.from('claude:/on-disk', 'utf8').toString('base64url')}`;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!echo from-disk' } } },
    });
    const said = await ended(p, chatUri);
    expect(sdk.said).toEqual([]);
    expect(said.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({ toolName: 'terminal', intention: 'echo from-disk' });
  });

  it('closes the shells a session was holding when the session goes', async () => {
    const { client, peer: p, uri, chatUri } = await shelled();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!echo kept' } } },
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

  it('runs a command typed during a turn instead of handing it to the agent', async () => {
    const { client, peer: p, chatUri } = await shelled();
    // A turn that stays open: the fake CLI answers only when a result frame
    // arrives, which is what leaves the session busy enough to queue behind.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: '!echo queued-command' } } },
    });
    await settle();
    // Waiting, and not run: a command that jumped the queue would run against
    // a tree the turn in front of it is still editing.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/pendingMessageSet')).toBe(true);
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/toolCallStart')).toBe(false);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5 });
    const done = await ended(p, chatUri);
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

  it('refuses a command when the backend cannot hold one, rather than asking it', async () => {
    const { echo } = await import('../../../examples/echo/agent.js');
    const host = createHost({ path: '/tmp', agents: [echo({ path: '/tmp', pace: 0 })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/no-command';
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: ['file:///tmp'] },
    });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!echo must-not-run' } } },
    });
    await settle();
    // Refused, not asked. `echo` implements no `ran`, and a host that handed
    // `!echo must-not-run` to its model would answer with prose about the
    // command - which is what the prefix exists to prevent. The refusal is
    // also what tells the client to put its optimistic turn back.
    const rejection = p.notes
      .map((n) => (n.params as { rejectionReason?: string }).rejectionReason)
      .find((reason): reason is string => typeof reason === 'string');
    expect(rejection).toContain('cannot run a command in a turn');
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/toolCallStart')).toBe(false);
  });
});

describe('a shell on this machine', () => {
  const opened = async () => {
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { host, client, peer: p };
  };

  /** Wait for the shell to actually say something. */
  const spoken = async (p: ReturnType<typeof peer>, uri: string, want: string) => {
    for (let i = 0; i < 60; i++) {
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
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
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
        channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp',
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
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
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
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens one wherever it is asked, as the reference host does', async () => {
    const { client } = await opened();
    // A terminal is arbitrary code on this machine, and so is a session; the
    // connection token is what decides who gets either, not the directory.
    await expect(client.handle({
      method: 'createTerminal',
      params: { channel: 'ahp-terminal:/four', claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///etc' },
    })).resolves.toBeDefined();
  });

  it('reports the exit code when the shell goes', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/five';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 3\n' } },
    });
    for (let i = 0; i < 60; i++) {
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
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 5\n' } },
    });
    for (let i = 0; i < 60; i++) {
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
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
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
    const inner = claude({ paths: ['/tmp'] });
    return {
      ...inner,
      create: (start) => {
        const opened = start.terminals?.open({
          cwd: '/tmp',
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
    const host = createHost({ path: '/tmp', agents: [opening(held)], ...machine() });
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
    expect(listed()[0]?.claim).toMatchObject({ kind: 'session', session: 'claude:/shells' });
    expect(opened.uri).toBe(listed()[0]?.resource);

    opened.release();
    // The row goes, and with it the process: a released terminal that left a
    // shell running would be one nothing lists and nothing can stop.
    expect(listed()).toEqual([]);
    await expect(opened.waitForExit()).resolves.toBeDefined();
  });
});

describe('interrupting a terminal', () => {
  it('turns ^C into a signal, because there is no line discipline to', async () => {
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-terminal:/int';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
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
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    expect(actions(p, uri).some((e) => e.action.type === 'terminal/exited')).toBe(true);
  });
});
