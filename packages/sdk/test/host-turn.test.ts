import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../src/catalog.js';
import {
  resetSdk, actions, emit, hello, peer, sdk, settle,
  running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('driving a turn', () => {
  it('announces the session, and answers for it once it exists', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    // The catalogue moved, and every client watching the root hears it.
    expect(p.notes.some((n) => n.method === 'root/sessionAdded')).toBe(true);

    // `session/ready` is dispatched at creation, which is before any client
    // can be watching that channel - so it is for *other* clients if creation
    // ever becomes asynchronous, and the creating client learns readiness
    // from the snapshot it gets when it subscribes. That snapshot is the
    // contract worth pinning.
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle: string; defaultChat: string; status: number } };
    };
    expect(opened.snapshot.state.lifecycle).toBe('ready');
    expect(opened.snapshot.state.defaultChat).toBe(chatUri);
    expect(opened.snapshot.state.status).toBe(1);
  });

  it('passes the client\'s turn to the agent', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
    });
    await settle();
    expect(sdk.said).toEqual(['hello']);
  });

  it('opens the part before it streams into it', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hey' } } },
    );

    const types = actions(p, chatUri).map((e) => e.action.type);
    // The protocol is explicit: responsePart creates the target, delta
    // appends to it. A delta naming a part nobody opened appends to nothing.
    expect(types.indexOf('chat/responsePart')).toBeLessThan(types.indexOf('chat/delta'));
    const delta = actions(p, chatUri).find((e) => e.action.type === 'chat/delta');
    expect(delta?.action.content).toBe('Hey');
  });

  it('streams a tool call\'s arguments into it, and finishes it when they are complete', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'Read' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path"' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"/tmp/a"}' } },
      },
    );

    const said = actions(p, chatUri);
    const types = said.map((e) => e.action.type);
    // The row exists before the arguments do, which is the whole point of a
    // `streaming` status: a client draws the tool's name straight away.
    expect(types.indexOf('chat/toolCallStart')).toBeLessThan(types.indexOf('chat/toolCallDelta'));
    expect(said.filter((e) => e.action.type === 'chat/toolCallDelta').map((e) => e.action.content))
      .toEqual(['{"file_path"', ':"/tmp/a"}']);
    const mid = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { activeTurn: { responseParts: { toolCall?: { status: string; partialInput?: string } }[] } } };
    }).snapshot.state.activeTurn.responseParts.find((one) => one.toolCall !== undefined)?.toolCall;
    expect(mid?.status).toBe('streaming');
    expect(mid?.partialInput).toBe('{"file_path":"/tmp/a"}');

    // The completed block is the same call, not a second one: one row, now
    // carrying the input properly rather than the json it was typed as.
    await emit({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/tmp/a' } }] },
    });
    expect(said.filter((e) => e.action.type === 'chat/toolCallStart')).toHaveLength(1);
    const done = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { activeTurn: { responseParts: { toolCall?: { status: string; partialInput?: string } }[] } } };
    }).snapshot.state.activeTurn.responseParts.filter((one) => one.toolCall !== undefined);
    expect(done).toHaveLength(1);
    expect(done[0]?.toolCall?.status).toBe('running');
    expect(done[0]?.toolCall?.partialInput).toBeUndefined();
  });

  /*
   * `_meta.toolKind`, the one well-known key the reference client routes a
   * tool call's rendering by. Not protocol: `terminal` gets the command and
   * output renderer, `subagent` the subagent view, and a call with none is a
   * name in a box. The reference host derives it for a "remote host" from a
   * Copilot-internal permission payload this backend does not have, so it is
   * stamped here from the harness's own tool names.
   */
  describe('what kind of row a tool call is', () => {
    const kinds = async (frames: Record<string, unknown>[]) => {
      const { client, peer: p, uri, chatUri } = await running();
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
      });
      await settle();
      await emit(...frames);
      const started = actions(p, chatUri)
        .filter((e) => e.action.type === 'chat/toolCallStart')
        .map((e) => [e.action.toolName, (e.action._meta as { toolKind?: string } | undefined)?.toolKind]);
      const held = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
        snapshot: { state: { activeTurn: { responseParts: { toolCall?: { toolName: string; _meta?: { toolKind?: string } } }[] } } };
      }).snapshot.state.activeTurn.responseParts
        .filter((one) => one.toolCall !== undefined)
        .map((one) => [one.toolCall?.toolName, one.toolCall?._meta?.toolKind]);
      return { started, held };
    };

    it('says so from the first frame, and in the snapshot', async () => {
      const { started, held } = await kinds([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'Bash' } },
        },
        {
          type: 'assistant',
          message: {
            id: 'm1',
            content: [
              { type: 'tool_use', id: 'tc1', name: 'Bash', input: { command: 'ls' } },
              { type: 'tool_use', id: 'tc2', name: 'Grep', input: { pattern: 'x' } },
              { type: 'tool_use', id: 'tc3', name: 'Task', input: { description: 'look' } },
              { type: 'tool_use', id: 'tc4', name: 'Read', input: { file_path: '/a' } },
            ],
          },
        },
      ]);
      // On the action that opens the row - before the arguments, because a
      // client that waited for them would draw a box and then redraw it.
      expect(started).toEqual([['Bash', 'terminal'], ['Grep', 'search'], ['Task', 'subagent'], ['Read', 'read']]);
      // And on the call a late subscriber reads, which is the same row.
      expect(held).toEqual([['Bash', 'terminal'], ['Grep', 'search'], ['Task', 'subagent'], ['Read', 'read']]);
    });

    it('carries a running subagent\'s progress line, and drops it when the call ends', async () => {
      const { client, peer: p, uri, chatUri } = await running();
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
      });
      await settle();
      const progress = (extra: Record<string, unknown>) => ({
        type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'tc1', description: 'look',
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 }, ...extra,
      });
      await emit(
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'Task', input: { description: 'look' } }] } },
        progress({ summary: 'Reading the tests' }),
        // The same line again is not news.
        progress({ summary: 'Reading the tests' }),
        // Without a summary, the last tool it reached for is the line.
        progress({ last_tool_name: 'Grep' }),
      );
      const changed = actions(p, chatUri)
        .filter((e) => e.action.type === 'chat/toolCallContentChanged')
        .map((e) => e.action._meta);
      // `_meta.progressMessage`, the reference client's word for a line on a
      // running row - never the result, which is what the tool answered and
      // not what it was doing on the way. The kind and the worker's keys
      // stamped at the start ride along, because an action carrying `_meta`
      // replaces the bag whole.
      const worker = { toolKind: 'subagent', subagentDescription: 'look', subagentChatUri: expect.stringMatching(/^ahp-chat:\/\/subagent\/[^/]+\/tc1$/) };
      // The times ride with them: the plugin stamped the call's start when it
      // began running and the completion adds the end.
      const started = { ...worker, 'ahpd.startedAt': expect.any(String) };
      const ended = {
        ...started, 'ahpd.endedAt': expect.any(String), 'ahpd.durationMs': expect.any(Number),
      };
      expect(changed).toEqual([
        { ...started, progressMessage: 'Reading the tests' },
        { ...started, progressMessage: 'Running Grep' },
      ]);
      const mid = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
        snapshot: { state: { activeTurn: { responseParts: { toolCall?: { _meta?: Record<string, unknown> } }[] } } };
      }).snapshot.state.activeTurn.responseParts[0]?.toolCall?._meta;
      expect(mid).toEqual({ ...started, progressMessage: 'Running Grep' });

      await emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'found it' }] } });
      // Gone with the running state it described: a completed row that still
      // says "Running Grep" is a row saying two things.
      const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
      expect(done?.action._meta).toEqual(ended);
      const after = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
        snapshot: { state: { activeTurn: { responseParts: { toolCall?: { _meta?: Record<string, unknown> } }[] } } };
      }).snapshot.state.activeTurn.responseParts[0]?.toolCall?._meta;
      expect(after).toEqual(ended);
    });

    it('says nothing for a tool it has no kind for', async () => {
      const { started, held } = await kinds([{
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'Write', input: { file_path: '/a' } }] },
      }]);
      // Unstamped rather than guessed: the generic renderer is the right one
      // for a tool nobody here knows, and an empty `_meta` is a bag that says
      // nothing while looking like it might.
      expect(started).toEqual([['Write', undefined]]);
      expect(held).toEqual([['Write', undefined]]);
    });
  });

  it('moves the running turn into the history when it completes', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Done' }] } });

    const mid = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    };
    // Running, and *not* in `turns` - a client reading only the history shows
    // an empty conversation for as long as somebody is watching one happen.
    expect(mid.snapshot.state.activeTurn).toBeDefined();
    expect(mid.snapshot.state.turns).toHaveLength(0);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 42 });
    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { duration: number }[]; activeTurn?: unknown } };
    };
    expect(after.snapshot.state.activeTurn).toBeUndefined();
    expect(after.snapshot.state.turns).toHaveLength(1);
    expect(after.snapshot.state.turns[0]?.duration).toBe(42);
    expect(actions(p, chatUri).map((e) => e.action.type)).toContain('chat/turnComplete');
  });

  /*
   * A turn that failed says why, in the turn.
   *
   * 0.9.0 took `error` off `Turn` and gave the reason a response part instead.
   * This host set the state to `error` and put the words nowhere the protocol
   * defines, so a client saw a turn that stopped and no account of it - which
   * is the shape a reader is least able to do anything about.
   */
  /*
   * A turn that worked says so, and says who asked for it.
   *
   * `Turn.state` is required and was only ever set when something went wrong,
   * so a turn that simply worked went into the history with none. `Message`
   * requires an `origin` and this host sent none anywhere it built one. Both
   * were found by typing the construction sites against the package rather
   * than by anything failing - which is the whole argument for doing it.
   */
  /*
   * Two tools asking at once, which is the ordinary case and used to break.
   *
   * The CLI calls `canUseTool` per tool call, and an agent that fires two in
   * parallel asks twice before either is answered. This host held one pending
   * input, so the second overwrote the first: the first tool waited for an
   * answer nobody could give any more, and approving it did nothing at all -
   * `confirm` compared the id against the survivor, missed, and returned
   * without a word.
   */
  it('asks about two tools at once and answers each of them', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'weather?' } } },
    });
    await settle();

    // Both in flight before either is answered.
    const first = sdk.canUseTool?.('WebFetch', { url: 'https://example.test' }, { toolUseID: 'call-a' });
    const second = sdk.canUseTool?.('WebSearch', { query: 'rain' }, { toolUseID: 'call-b' });
    await settle();

    const asked = actions(p, uri)
      .filter((e) => e.action.type === 'session/inputNeededSet')
      .map((e) => (e.action.request as { id: string }).id);
    expect(asked).toEqual(['call-a', 'call-b']);

    // Both are on the session, because `inputNeeded` is a list.
    const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { id: string }[] } };
    };
    expect(state.snapshot.state.inputNeeded?.map((one) => one.id)).toEqual(['call-a', 'call-b']);

    // Answer the *first* one, which is the one that used to be unreachable.
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: true, confirmed: 'user-action' },
      },
    });
    await settle();
    await expect(first).resolves.toMatchObject({ behavior: 'allow' });

    // And the other is still waiting, named by its own id.
    const after = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { id: string }[] } };
    };
    expect(after.snapshot.state.inputNeeded?.map((one) => one.id)).toEqual(['call-b']);
    const dropped = actions(p, uri)
      .filter((e) => e.action.type === 'session/inputNeededRemoved')
      .map((e) => e.action.id);
    expect(dropped).toEqual(['call-a']);

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-b', approved: false, reason: 'denied' },
      },
    });
    await settle();
    await expect(second).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('finishes a turn with a state and an origin on its message', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { state?: string; usage?: unknown; message?: { origin?: { kind?: string } } }[] } };
    };
    const turn = after.snapshot.state.turns[0];
    // A client driven by actions never saw this - its reducer fills the state
    // in on `chat/turnComplete`. One that subscribes afterwards reads the
    // snapshot, and the snapshot is this.
    expect(turn?.state).toBe('complete');
    expect(turn?.message?.origin?.kind).toBe('user');
    // Present and undefined, not absent: `usage` is a required key meaning
    // "not measured".
    expect(turn && 'usage' in turn).toBe(true);
  });

  it('puts the reason a turn failed inside the turn', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Working' }] } });
    await emit({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ['the tool exploded'], duration_ms: 7,
    });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { state: string; responseParts: { kind: string; error?: { message?: string } }[] }[] } };
    };
    const turn = after.snapshot.state.turns[0];
    expect(turn?.state).toBe('error');
    const failure = turn?.responseParts.find((one) => one.kind === 'error');
    expect(failure?.error?.message).toBe('the tool exploded');
    // After what the agent managed to say, not instead of it: three things
    // said and then a failure is a turn with four parts.
    expect(turn?.responseParts.map((one) => one.kind)).toEqual(['markdown', 'error']);
    /*
     * And announced as it happens, on the action that ends the turn.
     *
     * `chat/error` is the ending, not a message beside one: it carries the
     * `turnId`, a required `duration` and the error part it appends. So there
     * is no `chat/turnComplete` for a turn that failed, and no
     * `chat/responsePart` for the failure either - the part travels on the
     * action, and sending it twice is the reason printed twice.
     */
    const ending = actions(p, chatUri).map((e) => e.action).filter((one) => one.type === 'chat/error'
      || one.type === 'chat/turnComplete');
    expect(ending.map((one) => one.type)).toEqual(['chat/error']);
    expect(ending[0]).toMatchObject({
      turnId: 't1',
      duration: 7,
      part: { kind: 'error', error: { message: 'the tool exploded' } },
    });
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/responsePart'
      && (e.action.part as { kind?: string } | undefined)?.kind === 'error')).toBe(false);
  });

  /**
   * A failure is about the turn that failed, not about the session for ever.
   *
   * `Status.Error` was read off a flag that was set when a turn failed and
   * never unset, so one bad tool call left every client showing the session
   * in error through every turn after it - and through a restart of the
   * client, because the flag lives in the host rather than in the client that
   * draws it. The only way back was a new session.
   */
  it('stops calling a session failed once it is working again', async () => {
    const { client, uri } = await running();
    const statusOf = async (): Promise<number> => {
      const seen = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { status: number; error?: string } };
      };
      return seen.snapshot.state.status;
    };
    const errorOf = async (): Promise<string | undefined> => {
      const seen = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { error?: string } };
      };
      return seen.snapshot.state.error;
    };

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ['the tool exploded'], duration_ms: 7,
    });

    expect(await statusOf()).toBe(Status.Error);
    expect(await errorOf()).toBe('the tool exploded');

    // The next thing asked of it. Running, not still in error, from the
    // moment the turn starts - the row does not wait for it to succeed to
    // stop saying the last one failed.
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
    });
    await settle();
    expect(await statusOf()).toBe(Status.InProgress);
    expect(await errorOf()).toBeUndefined();

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5 });
    expect(await statusOf()).toBe(Status.Idle);
    expect(await errorOf()).toBeUndefined();
  });

  it('says a turn ended badly even when the harness gave no words', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // A subtype that is not `success` and no `errors` at all - which happens,
    // and used to leave the turn silent.
    await emit({ type: 'result', subtype: 'error_max_turns', duration_ms: 3 });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { responseParts: { kind: string; error?: { message?: string } }[] }[] } };
    };
    const failure = after.snapshot.state.turns[0]?.responseParts.find((one) => one.kind === 'error');
    expect(failure?.error?.message).toContain('error_max_turns');
  });
  it('tells every client when a session goes', async () => {
    const { host, client, peer: p, uri } = await running();
    const other = peer();
    const b = host.accept(other);
    await b.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    // The session was theirs too.
    expect(other.notes.some((n) => n.method === 'root/sessionRemoved')).toBe(true);
    await expect(client.handle({ method: 'subscribe', params: { channel: uri } }))
      .rejects.toMatchObject({ code: -32001 });
    // And the client that asked for it hears it too - it is not exempt from
    // its own broadcast, because it is not the only one holding that session.
    expect(p.notes.some((n) => n.method === 'root/sessionRemoved')).toBe(true);
  });

  it('moves serverSeq with state, so a snapshot has a place in the stream', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Done' }] } });

    const seqs = actions(p).map((e) => e.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const snap = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { fromSeq: number };
    };
    // Every action after a snapshot carries a greater seq, which is how a
    // client knows it missed nothing.
    expect(snap.snapshot.fromSeq).toBeGreaterThanOrEqual(Math.max(...seqs));
  });
});

describe('what the client is told about its own turn', () => {
  it('says the turn started, so the parts that follow have somewhere to go', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // Reducing it privately is not enough. A client applies what the host
    // says, including what it asked for itself - and `chat/responsePart` for
    // a turn it has never heard of is dropped, so the whole answer lands
    // nowhere and appears only when somebody reopens the session.
    const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
    expect(started?.action).toMatchObject({ turnId: 't1', message: { text: 'hi' } });

    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    );
    // The part names the turn the client was told about, and not one of the
    // host's own making.
    const part = actions(p, chatUri).find((e) => e.action.type === 'chat/responsePart');
    expect(part?.action.turnId).toBe('t1');
  });
});

describe('one tool call, one row', () => {
  /** A turn with a `Bash` call the agent has already announced. */
  async function calling() {
    const started = await running();
    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
      },
    });
    return started;
  }

  const toolParts = (state: Record<string, unknown>) => {
    const active = state.activeTurn as { responseParts?: Record<string, unknown>[] } | undefined;
    return (active?.responseParts ?? []).filter((part) => part.kind === 'toolCall');
  };

  it('lets chat/toolCallStart make the part, and does not make it twice', async () => {
    const { client, peer: p, chatUri } = await calling();
    // `chat/toolCallStart` *creates* the response part on the client side, so
    // a `chat/responsePart` for the same call is the row drawn twice.
    const announced = actions(p, chatUri).filter((e) => e.action.type === 'chat/responsePart');
    expect(announced.some((e) => (e.action.part as Record<string, unknown>).kind === 'toolCall')).toBe(false);
    expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart')).toHaveLength(1);

    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(toolParts(opened.snapshot.state)).toHaveLength(1);
  });

  it('says the transcript is not asking anything', async () => {
    const { peer: p, chatUri } = await calling();
    // Without `confirmed`, the reducer moves every tool call into
    // `pending-confirmation` and draws it as a question nobody put.
    const ready = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady');
    expect(ready?.action.confirmed).toBe('not-needed');
    // Drawn by the call's description, or VS Code's line when it has none, as
    // the same call read back from its transcript is.
    expect(ready?.action.invocationMessage).toEqual({ markdown: 'Running `ls`' });
    expect(ready?.action.toolInput).toBe('ls');
  });

  it('says what a finished call ran, as its transcript does', async () => {
    const { peer: p, chatUri } = await calling();
    await emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a b' }] } });
    await settle();
    const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
    expect((done?.action.result as Record<string, unknown>).pastTenseMessage).toEqual({ markdown: 'Ran `ls`' });
  });

  it('says the same on the call as it says in the action', async () => {
    const { client, chatUri } = await calling();
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    const call = (toolParts(opened.snapshot.state)[0] as { toolCall: Record<string, unknown> }).toolCall;

    /*
     * A client driven by actions builds its own state from
     * `chat/toolCallReady`. A client that subscribes reads this instead, and
     * `ToolCallState` requires both fields - so a transcript full of tool
     * calls was a transcript full of rows with no sentence to draw and no
     * answer to whether anybody had approved them.
     */
    expect(call.invocationMessage).toEqual({ markdown: 'Running `ls`' });
    expect(call.confirmed).toBe('not-needed');
  });

  it('says on the call that a person approved it', async () => {
    const { client, uri, chatUri } = await calling();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'toolu_1', approved: true } },
    });
    await settle();

    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    const call = (toolParts(opened.snapshot.state)[0] as { toolCall: Record<string, unknown> }).toolCall;
    expect(call.status).toBe('running');
    // How it was approved, which the action said and the call did not.
    expect(call.confirmed).toBe('user-action');
  });

  it('asks about the call the agent announced, not one of its own', async () => {
    const { client, peer: p, chatUri } = await calling();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, {
      toolUseID: 'toolu_1',
      title: 'Claude wants to run ls',
      displayName: 'Run in terminal',
    });
    await settle();

    // Still one part. The confirmation is *the* call, not a second one beside
    // it - which is also why answering it reaches the agent.
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(toolParts(opened.snapshot.state)).toHaveLength(1);

    const asking = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady').at(-1);
    expect(asking?.action.toolCallId).toBe('toolu_1');
    expect(asking?.action.confirmed).toBeUndefined();
    // The row's line; the CLI's own sentence is the card's title.
    expect(asking?.action.invocationMessage).toEqual({ markdown: 'Running `ls`' });
  });

  it('answers the agent, and says so', async () => {
    const { client, peer: p, uri, chatUri } = await calling();
    const answer = sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'toolu_1', approved: true } },
    });
    await settle();

    expect(await answer).toMatchObject({ behavior: 'allow' });
    // Said back, because nothing in a client applies its own dispatch: an
    // approved row stayed pending on every screen watching it, including the
    // one that had just answered.
    const confirmed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallConfirmed');
    expect(confirmed?.action).toMatchObject({ toolCallId: 'toolu_1', approved: true, confirmed: 'user-action' });
  });
});

describe('a compacted context', () => {
  it('says so in the turn, and does not throw the conversation away', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'a long one' } } },
    });
    await settle();
    await emit({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 120000, post_tokens: 30000 },
    });

    const part = actions(p, chatUri)
      .filter((e) => e.action.type === 'chat/responsePart')
      .map((e) => e.action.part as Record<string, unknown>)
      .find((held) => held.kind === 'systemNotification');
    expect(part?.content).toBe('Context compacted automatically: 120000 tokens to 30000.');

    // Not `chat/truncated`. That means "drop the turns after this one", and
    // every one of them is still in the transcript and still readable - what
    // was compacted is the model's context, not the conversation.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/truncated')).toBe(false);
  });
});

describe('running a failed turn again', () => {
  it('reopens the same turn rather than starting another', async () => {
    const { client, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'do it' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5 });
    const said = sdk.said.length;

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnResume', turnId: 't1' } },
    });
    await settle();
    /*
     * The same prompt, sent again.
     *
     * The protocol is precise: the latest turn, in `error`, reopened with its
     * message and parts intact rather than replaced. So the text goes back to
     * the CLI without anybody having to type it a second time.
     */
    expect(sdk.said.length).toBe(said + 1);
    expect(sdk.said.at(-1)).toBe('do it');
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: { id: string } } };
    }).snapshot.state;
    expect(state.activeTurn?.id).toBe('t1');
    // Reopened, not duplicated: the finished copy is gone from the history.
    expect(state.turns).toEqual([]);
  });

  it('refuses one that is not the latest errored turn', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnResume', turnId: 'nothing' } },
    });
    await settle();
    const refused = p.notes
      .map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
      .filter((one): one is string => typeof one === 'string');
    expect(refused.some((one) => one.includes('not a turn that can be resumed'))).toBe(true);
  });
});
