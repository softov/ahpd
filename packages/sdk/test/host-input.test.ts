import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import { checker } from '../../../tools/wire.mjs';
import { fileSessions } from '../src/sessions/sessions.js';
import { Status } from '../src/sessions/catalog.js';
import {
  resetSdk, actions, emit, sdk, sessionQueries, settle, running, peer, hello,
} from './support/host.js';
import type { Bag } from '../src/types/common.js';
import { WAIT_MS } from '../../../tools/wait.ts';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('driving a turn', () => {
  it('blocks on a confirmation and runs the tool when it is approved', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
    // as merely running, and nobody goes to answer it. Without the read bit,
    // which is the person's and not the turn's.
    expect(state.snapshot.state.status & ~Status.IsRead).toBe(24);

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: callId, approved: true, confirmed: 'user-action' } },
    });
    expect(await decision).toMatchObject({ behavior: 'allow' });
    expect(actions(p, uri).map((e) => e.action.type)).toContain('session/inputNeededRemoved');
  });

  describe('an approval that can be kept', () => {
    const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }], behavior: 'allow', destination: 'localSettings' }];

    /** A Bash call asked about with these suggestions, and the frames that describe it. */
    const asking = async (suggestions?: unknown[]) => {
      // `ls` and `sleep` are in VS Code's table, which would approve them: no table, so the call asks.
      const { client, peer: p, uri, chatUri } = await running({ terminalAutoApproveDefaults: 'none' });
      client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
      // The confirmation as VS Code's client sends it, naming the turn the call is in.
      const answer = (action: Record<string, unknown>) => client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'c9', ...action } },
      });
      return { p, chatUri, decision, ready, needed, answer };
    };
    const actionOf = (frame: { params: unknown } | undefined) => (frame?.params as { action: Record<string, unknown> } | undefined)?.action;

    /*
     * Claude puts its question with no options of its own, whatever the SDK
     * suggested, and the host offers VS Code's; an answer keeps nothing in the
     * CLI's own settings, the host keeping an "Allow in this Session" itself.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L167-L180
     */
    it('offers VS Code\'s options whatever the SDK suggested, and hands the CLI no suggestion back', async () => {
      const { p, chatUri, decision, ready, needed, answer } = await asking(rule);
      // A shell command's, as Claude says the call is one and names its command.
      const offered = [
        { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
        { id: 'allow-session-rules:["Shell(ls *)"]', label: 'Allow `ls …` in this Session', kind: 'approve', group: 1 },
        { id: 'allow-always-rules:["Shell(ls *)"]', label: 'Always Allow `ls …`', kind: 'approve', group: 1 },
        { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
      ];
      expect(actionOf(ready)?.options).toEqual(offered);
      expect((actionOf(needed)?.request as { toolCall: { options?: unknown } }).toolCall.options).toEqual(offered);
      // Checked as sent: the entry holds the live call, which the answer moves on.
      const check = checker();
      expect([ready, needed].flatMap((frame) => check.frame(frame)).map((one) => `${one.def} ${one.at} ${one.what}`))
        .toEqual([]);

      await answer({ approved: true, confirmed: 'user-action', selectedOptionId: 'allow-once' });
      expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
      const echoed = p.notes.find((n) => n.method === 'action'
        && (n.params as { channel: string }).channel === chatUri && actionOf(n)?.type === 'chat/toolCallConfirmed');
      expect(actionOf(echoed)?.selectedOptionId).toBe('allow-once');

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

    /*
     * An "Allow in this Session" answer is the host's: the command's rule is
     * kept in the session's `permissions`, and the next call it matches is
     * answered from it with nobody asked, as VS Code's host keeps one for its
     * agents.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L619-L650
     */
    it('keeps an Allow in this Session answer, and the next call to the tool runs without a question', async () => {
      const { p, decision, answer } = await asking();
      await answer({ approved: true, confirmed: 'user-action', selectedOptionId: 'allow-session-rules:["Shell(ls *)"]' });
      expect(await decision).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
      await settle();
      const kept = p.notes.filter((n) => n.method === 'action' && actionOf(n)?.type === 'session/configChanged');
      expect(kept.map((n) => actionOf(n)?.config)).toEqual([{ permissions: { allow: ['Shell(ls *)'], deny: [] } }]);
      const before = p.notes.length;
      expect(await sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'c10' })).toMatchObject({ behavior: 'allow' });
      // Answered by the host from what it kept: the call is said running, and nobody is asked.
      expect(p.notes.slice(before).some((n) => n.method === 'action' && actionOf(n)?.type === 'chat/toolCallReady'
        && actionOf(n)?.confirmed === undefined)).toBe(false);
    });

    // The host's options for a shell command, in VS Code's words, where the backend offers none of its own.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76
    it('offers VS Code\'s options when the SDK suggested nothing', async () => {
      const { ready } = await asking();
      expect(actionOf(ready)?.options).toEqual([
        { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
        { id: 'allow-session-rules:["Shell(ls *)"]', label: 'Allow `ls …` in this Session', kind: 'approve', group: 1 },
        { id: 'allow-always-rules:["Shell(ls *)"]', label: 'Always Allow `ls …`', kind: 'approve', group: 1 },
        { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
      ]);
    });
  });

  it('answers a question keyed by its text, not by an id', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
    // A question with no header is keyed by its place, as VS Code's Claude keys it.
    expect(request.questions[0]?.id).toBe('q-0');

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: {
          type: 'chat/inputCompleted',
          requestId: request.id,
          accepted: true,
          answers: { 'q-0': { kind: 'selected', value: 'SQLite' } },
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
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
        channel: chatUri,
        action: { type: 'chat/inputAnswerChanged', requestId: request.id, questionId: 'q-0', answer },
      },
    });
    await settle();
    // Said back, because the point of an answer being on the wire at all is
    // that the other people looking at the question see it being filled in.
    const synced = actions(p).filter((e) => e.action.type === 'chat/inputAnswerChanged');
    expect(synced).toHaveLength(1);
    expect(synced[0]?.action).toMatchObject({ requestId: request.id, questionId: 'q-0', answer });

    // And on the request itself, which is what a client arriving now reads:
    // an empty form in front of somebody else's filled-in one is the state
    // this host would otherwise be serving.
    const open = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { request?: { answers?: unknown } }[] } };
    }).snapshot.state;
    expect(open.inputNeeded?.[0]?.request?.answers).toEqual({ 'q-0': answer });

    // Submitted the same way.
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/inputAnswerChanged', requestId: request.id, questionId: 'q-0', answer: { ...answer, state: 'submitted' } },
      },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
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
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
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
          channel: chatUri,
          action: {
            type: 'chat/inputAnswerChanged',
            requestId: request.id,
            questionId,
            ...(answer !== undefined ? { answer } : {}),
          },
        },
      });
    };
    said('q-0', { state: 'draft', value: { kind: 'selected', value: 'SQLite' } });
    said('q-1', { state: 'draft', value: { kind: 'selected', value: '5432' } });
    // No `answer` is the action's way of saying this one is cleared, which is
    // the only way JSON has of saying `undefined`.
    said('q-1');
    await settle();

    const open = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { request?: { answers?: Record<string, unknown> } }[] } };
    }).snapshot.state;
    expect(Object.keys(open.inputNeeded?.[0]?.request?.answers ?? {})).toEqual(['q-0']);
  });

  it('refuses an answer to a question nothing is waiting on', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
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

  describe('an answer said back to every client of the chat', () => {
    const questions = [{ question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }];

    /** Two clients on one chat, a question open on it, and the second one's chat as it reduces. */
    const twoAsked = async () => {
      const { host, client, peer: p, chatUri } = await running();
      const q = peer();
      const other = host.accept(q);
      await other.handle(hello(['0.9.0']));
      const opened = await other.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
        snapshot: { state: Record<string, unknown> };
      };
      client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
      });
      await settle();
      const decision = sdk.canUseTool?.('AskUserQuestion', { questions });
      await settle();
      const request = actions(p, chatUri).find((e) => e.action.type === 'chat/inputRequested')
        ?.action.request as { id: string };
      const complete = (action: Record<string, unknown>) => client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/inputCompleted', requestId: request.id, ...action } },
      });
      /** The second client's chat, put through the protocol's reducer. */
      const otherChat = () => {
        let chat = opened.snapshot.state;
        for (const e of actions(q, chatUri)) chat = chatReducer(chat as never, e.action as never) as never;
        return chat as { activeTurn?: { responseParts: { kind: string; response?: string; request?: { answers?: unknown } }[] } };
      };
      return { p, q, chatUri, request, decision, complete, otherChat };
    };

    it('reaches the answering client and the other one before the tool call completes', async () => {
      const { p, q, chatUri, request, decision, complete, otherChat } = await twoAsked();
      const answers = { 'q-0': { state: 'submitted', value: { kind: 'selected', value: 'SQLite' } } };
      complete({ response: 'accept', answers });
      for (const one of [p, q]) {
        const said = actions(one, chatUri).filter((e) => e.action.type === 'chat/inputCompleted');
        expect(said).toHaveLength(1);
        expect(said[0]?.action).toMatchObject({ requestId: request.id, response: 'accept', answers });
        expect(actions(one, chatUri).map((e) => e.action.type)).not.toContain('chat/toolCallComplete');
      }
      // Open on the other client's screen no longer: the part carries the response.
      const part = otherChat().activeTurn?.responseParts.find((one) => one.kind === 'inputRequest');
      expect(part?.response).toBe('accept');
      expect(part?.request?.answers).toEqual(answers);
      expect(await decision).toMatchObject({ behavior: 'allow' });
    });

    it('says a decline back as a decline', async () => {
      const { p, q, chatUri, decision, complete, otherChat } = await twoAsked();
      complete({ response: 'decline' });
      for (const one of [p, q]) {
        const said = actions(one, chatUri).filter((e) => e.action.type === 'chat/inputCompleted');
        expect(said.map((e) => e.action.response)).toEqual(['decline']);
      }
      expect(otherChat().activeTurn?.responseParts.find((one) => one.kind === 'inputRequest')?.response).toBe('decline');
      expect(await decision).toMatchObject({ behavior: 'deny' });
    });

    it('refuses an answer to a request nothing is waiting on, to every client of the chat', async () => {
      const { p, q, chatUri } = await running().then(async ({ host, client, peer: p, chatUri }) => {
        const q = peer();
        const other = host.accept(q);
        await other.handle(hello(['0.9.0']));
        await other.handle({ method: 'subscribe', params: { channel: chatUri } });
        client.handle({
          method: 'dispatchAction',
          params: { channel: chatUri, action: { type: 'chat/inputCompleted', requestId: 'nobody', response: 'accept' } },
        });
        await settle();
        return { p, q, chatUri };
      });
      // The protocol's chat-channel.md, "Server Validation of Client Actions": an answer to no
      // waiting request SHOULD be rejected, so its sender lets go of it.
      const refused = actions(p).filter((e) => e.rejectionReason !== undefined);
      expect(refused.map((e) => e.action.type)).toEqual(['chat/inputCompleted']);
      expect(refused[0]?.rejectionReason).toContain('nobody');
      // The other client of the chat hears the same refusal, and neither hears
      // the answer taken.
      expect(actions(q, chatUri).map((e) => [e.action.type, e.rejectionReason])).toEqual([['chat/inputCompleted', refused[0]?.rejectionReason]]);
      expect(actions(p, chatUri).filter((e) => e.rejectionReason === undefined).map((e) => e.action.type))
        .not.toContain('chat/inputCompleted');
    });

    it('refuses a confirmation of a call that waits on none', async () => {
      const { client, peer: p, uri, chatUri } = await running();
      client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'nobody', approved: true } },
      });
      await settle();
      // The same table: a confirmation of a call not in `pending-confirmation` MUST be rejected.
      const refused = actions(p).filter((e) => e.rejectionReason !== undefined);
      expect(refused.map((e) => e.action.type)).toEqual(['chat/toolCallConfirmed']);
      expect(refused[0]?.rejectionReason).toContain('nobody');
    });
  });

  it('settles the blocked promise when the turn is cancelled', async () => {
    // `ls` and `sleep` are in VS Code's table, which would approve them: no table, so the call asks.
    const { client, chatUri } = await running({ terminalAutoApproveDefaults: 'none' });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    const decision = sdk.canUseTool?.('Bash', { command: 'sleep 100' }, { toolUseID: 'toolu_sleep', signal: new AbortController().signal, suggestions: [] });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
    });
    // A stop that left the question standing would leave the subprocess
    // waiting on a promise nobody will ever settle.
    expect(await decision).toMatchObject({ behavior: 'deny' });
    // And once the CLI has recorded that answer, the turn is interrupted
    // through the SDK on the CLI it ran in, which stays: the Claude record's
    // `stopEnds` ends the turn alone by default.
    // https://code.claude.com/docs/en/agent-sdk/typescript#query-object
    await emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sleep', content: 'The turn was stopped', is_error: true }] }, parent_tool_use_id: null });
    expect(sdk.interrupted).toBe(1);
    expect(sessionQueries().at(-1)?.closed).toBe(false);
  });
});

describe('a message typed while a turn is running', () => {
  /** A live session with a turn under way. */
  const busy = async () => {
    const started = await running();
    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    return started;
  };

  const queue = (client: Awaited<ReturnType<typeof busy>>['client'], channel: string, id: string, text: string) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text, origin: { kind: 'user' } } } },
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

  /*
   * A removal of a message the chat never queued is said as the client sent
   * it, and the reducer leaves the chat as it was, as the reference host
   * applies any removal it does not refuse.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13520-L13537
   */
  it('says a removal of a message the chat never queued, as it was sent', async () => {
    const { client, peer: p, chatUri } = await busy();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 31, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'nobody' } },
    });
    await settle();
    const said = actions(p, chatUri).filter((e) => e.origin?.clientSeq === 31);
    expect(said.map((e) => [e.action.type, e.rejectionReason])).toEqual([['chat/pendingMessageRemoved', undefined]]);
  });

  /*
   * A removal naming a steering message the chat does not hold is said as the
   * client sent it, and the reducer leaves the queued message under that id
   * where it is, as the reference host applies any removal it does not refuse
   * (agentService.ts L13520-L13537 at 6b68d3fe).
   */
  it('says a removal of a queued message as a steering one, and leaves the message queued', async () => {
    const { client, peer: p, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageRemoved', kind: 'steering', id: 'q1' } },
    });
    await settle();
    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/pendingMessageRemoved' && e.action.id === 'q1')).toBe(true);
    // Still queued, so it still becomes the next turn.
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    expect(sdk.said).toEqual(['first', 'second']);
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
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'now' } } },
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
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'now' } } },
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

  /*
   * Steering that came with no turn to steer runs as a turn of its own.
   *
   * The reference host runs steering that arrived too late to steer a turn
   * next, ahead of queued messages, under its id, so the turn naming it takes
   * it out of every client's state (queueDrainContribution.ts L266-L267,
   * L283-L292 at a4e689ae).
   */
  it('runs one sent at a chat with nothing running as a turn of its own, under its id', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'now' } } },
    });
    await settle();
    expect(actions(p, chatUri).filter((one) => one.rejectionReason !== undefined)).toEqual([]);
    const answer = actions(p, chatUri).find((one) => one.origin?.clientSeq === 1);
    expect(answer?.action).toMatchObject({ type: 'chat/pendingMessageSet', kind: 'steering', id: 's1' });
    const started = actions(p, chatUri).map((one) => one.action).find((one) => one.type === 'chat/turnStarted');
    expect(started?.queuedMessageId).toBe('s1');
    expect(sdk.said).toEqual(['now']);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { steeringMessage?: unknown; activeTurn?: { message: { text: string } } } };
    }).snapshot.state;
    expect(state.steeringMessage).toBeUndefined();
    expect(state.activeTurn?.message.text).toBe('now');
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
    });
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'actually, stop' } },
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

describe('a message that carries attachments', () => {
  /** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

  const made: string[] = [];
  afterEach(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
    made.length = 0;
  });

  /**
   * A session whose messages' files the host writes to a real folder.
   *
   * The store answers `attachmentsDir`, which is the one thing that makes the
   * bytes a file rather than something the message carries - so the path a
   * pasted picture takes through the host is the path a real one takes.
   */
  const withFiles = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-input-attach-'));
    made.push(dir);
    return running({ sessions: fileSessions({ dir }) });
  };

  /** Wait for what the host writes and the CLI reads, which is off a promise. */
  const until = async (ready: () => boolean): Promise<void> => {
    const end = Date.now() + WAIT_MS;
    while (!ready() && Date.now() < end) await settle(1);
  };

  const png = (label = 'pasted.png'): Bag => ({
    type: 'embeddedResource', label, contentType: 'image/png', data: PNG.toString('base64'),
  });

  const txt = (label = 'note.txt'): Bag => ({
    type: 'embeddedResource', label, contentType: 'text/plain', data: Buffer.from('one\ntwo\n').toString('base64'),
  });

  type Live = Awaited<ReturnType<typeof running>>;

  /*
   * Every dispatch is awaited, because the host writes an attachment's bytes
   * to a file before it applies the action that carries it - and a message
   * applied late is not the message this case is about.
   */
  const send = (client: Live['client'], channel: string, action: Bag) => client.handle({
    method: 'dispatchAction',
    params: { channel, action },
  });

  const image = () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } });

  it('sends a turn with a pasted image to the CLI as an image block', async () => {
    const { client, chatUri } = await withFiles();
    await send(client, chatUri, {
      type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'what is this', attachments: [png()] },
    });
    await until(() => sdk.blocks.length > 0);

    const blocks = sdk.blocks.at(-1) as Bag[];
    expect(blocks[0]).toEqual({ type: 'text', text: 'what is this' });
    expect(blocks[1]).toEqual(image());
    // An image and not a string: the bytes went to a file the host wrote, and
    // the model is sent the picture rather than the path to it.
    expect(sdk.said).toEqual([]);
  });

  it('starts a queued message with its image when the running turn ends', async () => {
    const { client, chatUri } = await withFiles();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } });
    await until(() => sdk.said.length > 0);

    await send(client, chatUri, {
      type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { origin: { kind: 'user' }, text: 'second', attachments: [png()] },
    });
    await settle();
    // Waiting behind the turn, so nothing of it has reached the CLI.
    expect(sdk.blocks).toEqual([]);

    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    await until(() => sdk.blocks.length > 0);

    const blocks = sdk.blocks.at(-1) as Bag[];
    expect(blocks[0]).toEqual({ type: 'text', text: 'second' });
    expect(blocks[1]).toEqual(image());
  });

  it('sends a steering message\'s pasted text into the turn that is running', async () => {
    const { client, chatUri } = await withFiles();
    await send(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } });
    await until(() => sdk.said.length > 0);

    await send(client, chatUri, {
      type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'actually', attachments: [txt()] },
    });
    await until(() => sdk.blocks.length > 0);

    const blocks = sdk.blocks.at(-1) as Bag[];
    expect(blocks[0]).toEqual({ type: 'text', text: 'actually' });
    expect((blocks[1] as Bag).text).toBe('note.txt (lines 1-2):\n```\none\ntwo\n```');
  });
});
