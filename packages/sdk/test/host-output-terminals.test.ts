/*
 * An output terminal: text a backend has, on a channel a client reads.
 *
 * No process is behind one, which is the whole point - a background shell's
 * output is already somewhere else, and what the host adds is the channel. The
 * cases below are the verbs a client reads it with and the one place it must
 * not appear: the list of this machine's shells.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions, createHost, echo, hello, peer, settle } from './support/host.js';
import type { Agent, Start } from '@ahpd/sdk';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-output-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** The state an output terminal's subscription carries. */
interface TerminalSnapshot {
  snapshot: { state: { content?: { type: string; value: string }[]; isPty?: boolean } };
}

/**
 * A host with one session, the `Start` its backend was handed, and a client
 * subscribed to the root and the chat.
 */
async function opened() {
  let start: Start | undefined;
  const base = echo({ path: dir, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (given) => {
      start = given;
      return base.create(given);
    },
  };
  const host = createHost({ path: dir, agents: [agent] });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
  const uri = 'ahp-session:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return {
    host,
    client,
    p,
    uri,
    chatUri,
    /** The output-terminal factory the backend was handed. */
    out: () => start?.outputTerminals as NonNullable<Start['outputTerminals']>,
  };
}

/** Everything a channel's terminal data actions said, in order. */
const data = (p: ReturnType<typeof peer>, channel: string) => actions(p, channel)
  .filter((one) => one.action.type === 'terminal/data')
  .map((one) => one.action.data);

describe('an output terminal', () => {
  it('shows what was appended, live and to a client that comes later', async () => {
    const { host, client, p, chatUri, out } = await opened();
    const terminal = out().create({ title: 'sleep 100', chat: chatUri });
    await client.handle({ method: 'subscribe', params: { channel: terminal.uri } });

    terminal.append('one\n');
    terminal.append('two\n');
    await settle();

    expect(data(p, terminal.uri)).toEqual(['one\n', 'two\n']);
    // The same bytes read back from the state, which is what a window that
    // opens late gets instead of the events it was not there for.
    const late = host.accept(peer());
    await late.handle(hello(['0.9.0'], { clientId: 'late' }));
    const opened_ = await late.handle({ method: 'subscribe', params: { channel: terminal.uri } }) as TerminalSnapshot;
    expect(opened_.snapshot.state.content).toEqual([{ type: 'unclassified', value: 'one\ntwo\n' }]);
    // Plain text, so a client does not go looking for escape sequences.
    expect(opened_.snapshot.state.isPty).toBe(false);
  });

  it('leaves only the new text when the whole of it is replaced', async () => {
    const { host, client, p, chatUri, out } = await opened();
    const terminal = out().create({ title: 'a shell', chat: chatUri });
    await client.handle({ method: 'subscribe', params: { channel: terminal.uri } });

    terminal.append('the old output\n');
    terminal.replace('the new output\n');
    await settle();

    // Cleared then written, which is the pair a client's reducer understands
    // as a replacement rather than as appended text.
    expect(actions(p, terminal.uri).map((one) => one.action.type))
      .toContain('terminal/cleared');
    const late = host.accept(peer());
    await late.handle(hello(['0.9.0'], { clientId: 'late' }));
    const opened_ = await late.handle({ method: 'subscribe', params: { channel: terminal.uri } }) as TerminalSnapshot;
    expect(opened_.snapshot.state.content).toEqual([{ type: 'unclassified', value: 'the new output\n' }]);
  });

  it('is not on the root list, though its channel is served', async () => {
    const { client, chatUri, out } = await opened();
    const terminal = out().create({ title: 'a shell', chat: chatUri });
    await settle();

    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { terminals?: { resource: string }[] } };
    };
    expect((root.snapshot.state.terminals ?? []).map((one) => one.resource)).not.toContain(terminal.uri);

    // And it is a channel all the same, or the row that names it would point
    // at nothing.
    const found = await client.handle({ method: 'subscribe', params: { channel: terminal.uri } }) as TerminalSnapshot;
    expect(found.snapshot.state.content).toEqual([]);
  });

  it('ends with the exit code it is given, and goes when its session does', async () => {
    const { client, p, uri, chatUri, out } = await opened();
    const terminal = out().create({ title: 'a shell', chat: chatUri });
    await client.handle({ method: 'subscribe', params: { channel: terminal.uri } });
    terminal.append('done\n');
    terminal.finalize(0);
    await settle();

    expect(actions(p, terminal.uri).filter((one) => one.action.type === 'terminal/exited').at(-1)?.action)
      .toMatchObject({ exitCode: 0 });
    const found = await client.handle({ method: 'subscribe', params: { channel: terminal.uri } }) as {
      snapshot: { state: { lifecycle?: { status?: string; exitCode?: number } } };
    };
    expect(found.snapshot.state.lifecycle).toEqual({ status: 'exited', exitCode: 0 });

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    // The channel is gone with the session: nothing serves it, so a client
    // that kept its name is told rather than drawing an empty terminal.
    await expect(client.handle({ method: 'subscribe', params: { channel: terminal.uri } }))
      .rejects.toThrow();
  });

  /*
   * A client's action on one is answered, as on any terminal: input has no
   * process to reach and goes nowhere, as VS Code's host writes input only to
   * a running process terminal, and a new size is the size it reads back.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527
   */
  it('answers input, which has no process to reach', async () => {
    const { client, p, chatUri, out } = await opened();
    const terminal = out().create({ title: 'a build', chat: chatUri });
    await client.handle({ method: 'subscribe', params: { channel: terminal.uri } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: terminal.uri, clientSeq: 2, action: { type: 'terminal/input', data: 'y\n' } },
    });
    await settle();

    const answer = actions(p, terminal.uri).find((one) => one.action.type === 'terminal/input');
    expect(answer?.origin?.clientSeq).toBe(2);
    expect(answer?.rejectionReason).toBeUndefined();
  });

  it('takes a new size, and reads it back', async () => {
    const { client, p, chatUri, out } = await opened();
    const terminal = out().create({ title: 'a build', chat: chatUri });
    await client.handle({ method: 'subscribe', params: { channel: terminal.uri } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: terminal.uri, clientSeq: 3, action: { type: 'terminal/resized', cols: 120, rows: 40 } },
    });
    await settle();

    const answer = actions(p, terminal.uri).find((one) => one.action.type === 'terminal/resized');
    expect([answer?.origin?.clientSeq, answer?.rejectionReason]).toEqual([3, undefined]);
    const found = await client.handle({ method: 'subscribe', params: { channel: terminal.uri } }) as {
      snapshot: { state: { cols?: number; rows?: number } };
    };
    expect([found.snapshot.state.cols, found.snapshot.state.rows]).toEqual([120, 40]);
  });
});
