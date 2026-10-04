import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checker } from '../../../tools/wire.mjs';
import {
  resetSdk, actions, emit, sdk, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('driving a turn', () => {
  it('blocks on a confirmation and runs the tool when it is approved', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const decision = sdk.canUseTool?.('Bash', { command: 'rm -rf build' });
    await settle();

    const needed = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet');
    // `request`, singular, which is what the action carries - it adds or
    // updates the entry with that id rather than replacing a whole list.
    const entry = needed?.action.request as Record<string, unknown>;
    expect(entry.kind).toBe('toolConfirmation');
    // Both required on an input request, and neither used to be sent.
    expect(typeof entry.chat).toBe('string');
    expect(typeof entry.turnId).toBe('string');
    const callId = (entry.toolCall as { toolCallId: string }).toolCallId;

    const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { status: number } };
    };
    // InputNeeded is 24 and carries InProgress. A status that lost it reads
    // as merely running, and nobody goes to answer it.
    expect(state.snapshot.state.status).toBe(24);

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: callId, approved: true } },
    });
    expect(await decision).toMatchObject({ behavior: 'allow' });
    expect(actions(p, uri).map((e) => e.action.type)).toContain('session/inputNeededRemoved');
  });

  describe('an approval that can be kept', () => {
    const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }], behavior: 'allow', destination: 'localSettings' }];

    /** A Bash call asked about with these suggestions, and the frames that describe it. */
    const asking = async (suggestions?: unknown[]) => {
      const { client, peer: p, uri, chatUri } = await running();
      client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
      });
      await settle();
      const decision = sdk.canUseTool?.('Bash', { command: 'ls' }, {
        toolUseID: 'c9', ...(suggestions === undefined ? {} : { suggestions }),
      });
      await settle();
      const frames = p.notes.filter((n) => n.method === 'action');
      const ready = frames.find((n) => {
        const action = (n.params as { action: Record<string, unknown> }).action;
        return action.type === 'chat/toolCallReady' && action.toolCallId === 'c9';
      });
      const needed = frames.find((n) => (n.params as { action: Record<string, unknown> }).action.type === 'session/inputNeededSet');
      const answer = (action: Record<string, unknown>) => client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'c9', ...action } },
      });
      return { p, chatUri, decision, ready, needed, answer };
    };
    const actionOf = (frame: { params: unknown } | undefined) => (frame?.params as { action: Record<string, unknown> } | undefined)?.action;

    it('offers allow once, always allow and deny, and returns the suggestions when always is picked', async () => {
      const { p, chatUri, decision, ready, needed, answer } = await asking(rule);
      const offered = [
        { id: 'allow-once', label: 'Allow once', kind: 'approve', group: 1 },
        { id: 'allow-always', label: 'Always allow Bash(ls:*), kept in local settings', kind: 'approve', group: 1 },
        { id: 'deny', label: 'Deny', kind: 'deny', group: 2 },
      ];
      expect(actionOf(ready)?.options).toEqual(offered);
      expect((actionOf(needed)?.request as { toolCall: { options?: unknown } }).toolCall.options).toEqual(offered);
      // Checked as sent: the entry holds the live call, which the answer moves on.
      const check = checker();
      expect([ready, needed].flatMap((frame) => check.frame(frame)).map((one) => `${one.def} ${one.at} ${one.what}`))
        .toEqual([]);

      await answer({ approved: true, confirmed: 'user-action', selectedOptionId: 'allow-always' });
      expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: rule });
      const echoed = p.notes.find((n) => n.method === 'action'
        && (n.params as { channel: string }).channel === chatUri && actionOf(n)?.type === 'chat/toolCallConfirmed');
      expect(actionOf(echoed)?.selectedOptionId).toBe('allow-always');

      expect(check.frame(echoed).map((one) => `${one.def} ${one.at} ${one.what}`)).toEqual([]);
    });

    it('keeps nothing when the approval picked no option, or allow once', async () => {
      const plain = await asking(rule);
      await plain.answer({ approved: true, confirmed: 'user-action' });
      expect(await plain.decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });

      const once = await asking(rule);
      await once.answer({ approved: true, confirmed: 'user-action', selectedOptionId: 'allow-once' });
      expect(await once.decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    });

    it('says what a mode suggestion does', async () => {
      const { ready } = await asking([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
      const options = actionOf(ready)?.options as { id: string; label: string }[];
      expect(options.find((one) => one.id === 'allow-always')?.label).toBe('Allow edits for the rest of the session');
    });

    it('offers no options when the SDK suggested nothing', async () => {
      const { ready } = await asking();
      expect(actionOf(ready)?.options).toBeUndefined();
    });
  });

  it('answers a question keyed by its text, not by an id', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const questions = [{
      question: 'Which database?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
      multiSelect: false,
    }];
    const decision = sdk.canUseTool?.('AskUserQuestion', { questions });
    await settle();

    const requested = actions(p).find((e) => e.action.type === 'chat/inputRequested');
    const request = requested?.action.request as { id: string; questions: { id: string }[] };
    expect(request.questions[0]?.id).toBe('q1');

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: {
          type: 'chat/inputCompleted',
          requestId: request.id,
          accepted: true,
          answers: { q1: { kind: 'selected', value: 'SQLite' } },
        },
      },
    });
    // Keyed by the question's own text and valued by the option's own label,
    // with the questions echoed back - anything else is a call the tool
    // cannot process and a turn that stalls rather than errors.
    expect(await decision).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which database?': 'SQLite' } },
    });
  });

  it('syncs a half-typed answer, and completes with what was typed', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const questions = [{
      question: 'Which database?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
      multiSelect: false,
    }];
    const decision = sdk.canUseTool?.('AskUserQuestion', { questions });
    await settle();
    const request = actions(p).find((e) => e.action.type === 'chat/inputRequested')
      ?.action.request as { id: string };

    const answer = { state: 'draft', value: { kind: 'selected', value: 'SQLite' } };
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/inputAnswerChanged', requestId: request.id, questionId: 'q1', answer },
      },
    });
    await settle();
    // Said back, because the point of an answer being on the wire at all is
    // that the other people looking at the question see it being filled in.
    const synced = actions(p).filter((e) => e.action.type === 'chat/inputAnswerChanged');
    expect(synced).toHaveLength(1);
    expect(synced[0]?.action).toMatchObject({ requestId: request.id, questionId: 'q1', answer });

    // And on the request itself, which is what a client arriving now reads:
    // an empty form in front of somebody else's filled-in one is the state
    // this host would otherwise be serving.
    const open = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { request?: { answers?: unknown } }[] } };
    }).snapshot.state;
    expect(open.inputNeeded?.[0]?.request?.answers).toEqual({ q1: answer });

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/inputCompleted', requestId: request.id, response: 'accept' },
      },
    });
    /*
     * Completed with nothing of its own, and answered anyway.
     *
     * The protocol has `chat/inputCompleted` use the request's synced answer
     * state plus whatever the completion carries - so a client that has been
     * syncing each answer as it went has already said everything, and reading
     * only the action submitted an empty form to a tool that then stalled.
     */
    expect(await decision).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which database?': 'SQLite' } },
    });
  });

  it('clears one answer draft without touching the others', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    const questions = [
      { question: 'Which database?', options: [{ label: 'SQLite' }] },
      { question: 'Which port?', options: [{ label: '5432' }] },
    ];
    void sdk.canUseTool?.('AskUserQuestion', { questions });
    await settle();
    const request = actions(p).find((e) => e.action.type === 'chat/inputRequested')
      ?.action.request as { id: string };

    const said = (questionId: string, answer?: unknown) => {
      client.handle({
        method: 'dispatchAction',
        params: {
          channel: uri,
          action: {
            type: 'chat/inputAnswerChanged',
            requestId: request.id,
            questionId,
            ...(answer !== undefined ? { answer } : {}),
          },
        },
      });
    };
    said('q1', { state: 'draft', value: { kind: 'selected', value: 'SQLite' } });
    said('q2', { state: 'draft', value: { kind: 'selected', value: '5432' } });
    // No `answer` is the action's way of saying this one is cleared, which is
    // the only way JSON has of saying `undefined`.
    said('q2');
    await settle();

    const open = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { request?: { answers?: Record<string, unknown> } }[] } };
    }).snapshot.state;
    expect(Object.keys(open.inputNeeded?.[0]?.request?.answers ?? {})).toEqual(['q1']);
  });

  it('refuses an answer to a question nothing is waiting on', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/inputAnswerChanged', requestId: 'nobody', questionId: 'q1', answer: {} },
      },
    });
    await settle();
    // Refused rather than dropped: a client typing into a question this host
    // is not holding open is one whose screen is out of step, and it can only
    // find that out by being told.
    const refused = actions(p).filter((e) => e.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain('not a question this chat is waiting on');
  });

  it('settles the blocked promise when the turn is cancelled', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    const decision = sdk.canUseTool?.('Bash', { command: 'sleep 100' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnCancelled', turnId: 't1' } },
    });
    // A cancel that only interrupts leaves the subprocess waiting on a
    // promise nobody will ever settle.
    expect(await decision).toMatchObject({ behavior: 'deny' });
    expect(sdk.interrupted).toBe(1);
  });
});

describe('a message typed while a turn is running', () => {
  /** A live session with a turn under way. */
  const busy = async () => {
    const started = await running();
    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
    });
    await settle();
    return started;
  };

  const queue = (client: Awaited<ReturnType<typeof busy>>['client'], channel: string, id: string, text: string) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text } } },
    });
  };

  it('waits, rather than being dropped on the floor', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    // The composer invites you to queue one. It used to go nowhere: no queue,
    // nothing sent when the turn ended, and no error either.
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { queuedMessages: { id: string; message: { text: string } }[] } };
    };
    // With its origin, which `Message` requires and this host used to omit
    // everywhere it built one.
    expect(opened.snapshot.state.queuedMessages)
      .toEqual([{ id: 'q1', message: { text: 'second', origin: { kind: 'user' } } }]);
    // And the agent has not been told about it yet.
    expect(sdk.said).toEqual(['first']);
  });

  it('becomes the next turn when the running one ends', async () => {
    const { client, peer: p, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });

    expect(sdk.said).toEqual(['first', 'second']);
    // Named on the turn that consumed it, which is how a client's reducer
    // takes it out of the queue - rather than a second action saying so.
    const started = actions(p, chatUri)
      .filter((e) => e.action.type === 'chat/turnStarted')
      .at(-1);
    expect(started?.action.queuedMessageId).toBe('q1');
  });

  it('can be taken back while it is still waiting', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    expect(sdk.said).toEqual(['first']);
  });

  it('keeps the order it was given, and what was not named behind it', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'a', 'A');
    queue(client, chatUri, 'b', 'B');
    queue(client, chatUri, 'c', 'C');
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/queuedMessagesReordered', order: ['c', 'a'] } },
    });
    await settle();
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { queuedMessages: { id: string }[] } };
    };
    expect(opened.snapshot.state.queuedMessages.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('puts a steering message into the turn that is running, not behind it', async () => {
    const { client, chatUri } = await busy();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now' } } },
    });
    await settle();
    /*
     * Both, and before the turn ended.
     *
     * This was refused for years on the stated grounds that "the SDK has
     * nowhere to put one". The prompt handed to the CLI is a generator that
     * stays open for the life of the session, so a message pushed while a
     * turn runs is delivered to that turn - which is what `sdk.said` records,
     * and it records the second one here with the turn still open.
     */
    expect(sdk.said).toEqual(['first', 'now']);
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    expect(sdk.said).toEqual(['first', 'now']);
  });

  it('says it and then says it is gone, because it is consumed as it arrives', async () => {
    const { client, peer: p, chatUri } = await busy();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now' } } },
    });
    await settle();
    const said = actions(p, chatUri).map((one) => one.action)
      .filter((one) => String(one.type).startsWith('chat/pendingMessage'));
    // `steeringMessage` describes a message *waiting* to be injected, and
    // nothing waits here - so the pair goes out and the field stays empty.
    expect(said.map((one) => one.type)).toEqual(['chat/pendingMessageSet', 'chat/pendingMessageRemoved']);
    expect(said.every((one) => one.kind === 'steering')).toBe(true);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { steeringMessage?: unknown } };
    }).snapshot.state;
    expect(state.steeringMessage).toBeUndefined();
  });

  it('refuses one sent at a chat with nothing running to steer', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now' } } },
    });
    await settle();
    // A real refusal now, rather than the blanket one: there is no turn to
    // put it into, and turning it into an ordinary message would be sending
    // something the person meant as a correction.
    const refused = actions(p, chatUri).filter((one) => one.rejectionReason !== undefined).at(-1);
    expect(refused?.rejectionReason).toContain('Nothing is running');
    expect(sdk.said).toEqual([]);
  });

  it('starts one straight away when nothing is running', async () => {
    const { client, chatUri } = await running();
    queue(client, chatUri, 'q1', 'only');
    await settle();
    expect(sdk.said).toEqual(['only']);
  });
});

describe('what a chat says about itself', () => {
  it('declares its interactivity rather than leaving it to a default', async () => {
    const { client, chatUri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { interactivity?: string } };
    }).snapshot.state;
    // Absent means `full` by the protocol's own rule, and being assumed is not
    // the same as being told.
    expect(state.interactivity).toBe('full');
  });

  it('takes a steering message out of the state where the CLI reads it, not before', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'actually, stop' } },
      },
    });
    await settle();
    /*
     * `steeringMessage` describes a message *waiting* to be injected, so it is
     * cleared where the prompt generator hands it over rather than in the same
     * tick it arrived. Against this fake the CLI is always reading, so the
     * window is instant; against a real one mid-tool-call it is seconds. What
     * is observable either way is that the message reached the CLI and that
     * its removal was announced after it did.
     */
    expect(sdk.said).toContain('actually, stop');
    const said = p.notes
      .map((one) => one.params as { channel?: string; action?: { type?: string } })
      .filter((one) => one.channel === chatUri)
      .map((one) => String(one.action?.type ?? ''));
    expect(said.indexOf('chat/pendingMessageSet')).toBeGreaterThanOrEqual(0);
    expect(said.lastIndexOf('chat/pendingMessageRemoved'))
      .toBeGreaterThan(said.indexOf('chat/pendingMessageSet'));
  });

});
