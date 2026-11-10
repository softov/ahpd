import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { annotationsReducer } from '@microsoft/agent-host-protocol';
import type { Annotation, AnnotationsAction, AnnotationsState } from '@microsoft/agent-host-protocol';
import {
  ADD_COMMENT, DELETE_COMMENTS, FEEDBACK_META, LIST_COMMENTS, REPLY_TO_COMMENT, RESOLVE_COMMENTS, VIEW_UNREVIEWED_COMMENTS,
  applyCommentTool, commentTools, listableComments,
} from '../src/tools/comments.js';
import type { CommentAction } from '../src/tools/comments.js';
import { createHost } from '../src/host.js';
import { hostTools } from '../src/tools/index.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, BoundTool, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { AskedAnswers, AskedQuestion, Host, ToolCall } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * The comment tools, in the shapes VS Code's host answers them.
 *
 * The text and the checks are the reference host's
 * (`agentFeedbackServerTools.ts`), because a model that got a refusal there
 * fixes the call from its words, and a comment is an annotation carrying the
 * `vscode.agentFeedback` meta that a window reads it back from.
 */

const SESSION = 'ahp-session:/s';
const ORIGIN = { session: SESSION, chat: 'ahp-chat:/s/0', turnId: 't1' };

const tool = (name: string) => {
  const found = commentTools().find((one) => one.definition.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

/** A comment as a window left it on the channel. */
const comment = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'c1',
  origin: { session: SESSION },
  resource: 'file:///repo/a.ts',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  resolved: false,
  entries: [{ id: 'c1:0', text: 'Please check', _meta: { [FEEDBACK_META]: { author: 'user' } } }],
  _meta: { [FEEDBACK_META]: { kind: 'user', state: 'accepted', sessionResource: SESSION } },
  ...over,
});

/** An annotation another feature put on the same channel: no comment meta. */
const other = (): Annotation => ({
  id: 'bare',
  origin: { session: SESSION },
  resource: 'file:///repo/a.ts',
  resolved: false,
  entries: [{ id: 'bare:0', text: 'not a comment' }],
});

const run = (tool: string, raw: unknown, state: Annotation[] = []) =>
  applyCommentTool({ annotations: state }, SESSION, tool, raw, ORIGIN);

const added = (raw: unknown) => {
  const outcome = run(ADD_COMMENT, raw);
  const action = outcome.actions[0] as Extract<CommentAction, { type: 'annotations/set' }>;
  return { outcome, action, annotation: action.annotation };
};

/*
 * A `ToolCall` holding a channel, as the tool sees one.
 *
 * The write is reduced with the protocol's own reducer, so a sequence of calls
 * through the tools is the sequence the host would keep.
 */
/* A review comment the person has not accepted yet, as a window leaves one. */
const review = (over: Partial<Annotation> = {}): Annotation => comment({
  _meta: { [FEEDBACK_META]: { kind: 'codeReview', state: 'created', sessionResource: SESSION } },
  ...over,
});

const toolAt = (start: Annotation[] = [], grant = true, answers: AskedAnswers = {
  response: 'accept', answers: { revealComments: 'Show them' },
}) => {
  let state: AnnotationsState = { annotations: start };
  const writes: AnnotationsAction[] = [];
  const asks: AskedQuestion[][] = [];
  const at = {
    session: SESSION,
    chat: ORIGIN.chat,
    turn: () => ORIGIN.turnId,
    may: () => grant,
    refusal: (needed: string) => `this turn may not ${needed} here`,
    annotations: () => state,
    markAnnotation: (action: AnnotationsAction) => {
      writes.push(action);
      state = annotationsReducer(state, action);
    },
    ask: async (questions: AskedQuestion[]) => {
      asks.push(questions);
      return answers;
    },
  } as unknown as ToolCall;
  return { at, writes, asks, state: () => state, set: (next: AnnotationsState) => { state = next; } };
};

describe('what a comment is on the channel', () => {
  it('writes an agent comment as a created code review, with a one-based range', () => {
    const { outcome, annotation } = added({
      resourceUri: 'file:///repo/a.ts',
      range: { startLineNumber: 2, startColumn: 3, endLineNumber: 4, endColumn: 5 },
      text: 'Use a map here.',
    });
    expect(outcome.result).toBe('Comment added.');
    expect(annotation).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      origin: ORIGIN,
      resource: 'file:///repo/a.ts',
      range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
      resolved: false,
    });
    expect(annotation.entries).toHaveLength(1);
    expect(annotation.entries.at(0)?.text).toBe('Use a map here.');
    expect(annotation.entries.at(0)?._meta).toEqual({ [FEEDBACK_META]: { author: 'agent' } });
    expect(annotation._meta).toEqual({ [FEEDBACK_META]: { kind: 'codeReview', state: 'created', sessionResource: SESSION } });
  });

  it('hides a created comment from the agent until the person accepts it', () => {
    const { annotation } = added({
      resourceUri: 'file:///repo/a.ts',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
      text: 'x',
    });
    expect(listableComments({ annotations: [annotation] })).toEqual([]);
    // The comment waits for the person, so the listing says so and points at
    // `viewUnreviewedComments`, which is the only tool that reveals it.
    expect(JSON.parse(run(LIST_COMMENTS, {}, [annotation]).result)).toEqual({
      comments: [],
      note: 'There is 1 code review comment which the user has not reviewed yet. '
        + 'If the user wants you to tackle them, call the `viewUnreviewedComments` tool to view them.',
    });
  });

  it('lists only comments, resolved ones only when asked', () => {
    const open = comment();
    const done = comment({ id: 'c2', resolved: true, _meta: { [FEEDBACK_META]: { kind: 'user', state: 'resolved', sessionResource: SESSION } } });
    const state = [open, done, other()];
    const plain = JSON.parse(run(LIST_COMMENTS, {}, state).result);
    expect(plain.comments).toHaveLength(1);
    expect(plain.comments[0]).toMatchObject({
      id: 'c1', resourceUri: 'file:///repo/a.ts', kind: 'user', author: 'user', resolved: false,
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
    });
    const all = JSON.parse(run(LIST_COMMENTS, { includeResolved: true }, state).result);
    expect(all.comments.map((one: { id: string }) => one.id)).toEqual(['c1', 'c2']);
  });

  it('reads an entry author, and falls back to the thread for one written before authors', () => {
    const legacy = comment({
      entries: [{ id: 'c1:0', text: 'By the user' }, { id: 'c1:1', text: 'A reply' }],
    });
    const listed = JSON.parse(run(LIST_COMMENTS, {}, [legacy]).result).comments[0];
    expect(listed.author).toBe('user');
    expect(listed.replies).toEqual([{ author: 'user', text: 'A reply' }]);
    const review = comment({
      entries: [{ id: 'c1:0', text: 'From the reviewer' }, { id: 'c1:1', text: 'A reply' }],
      _meta: { [FEEDBACK_META]: { kind: 'prReview', state: 'accepted', sessionResource: SESSION } },
    });
    expect(JSON.parse(run(LIST_COMMENTS, {}, [review]).result).comments[0]).toMatchObject({
      kind: 'prReview', author: 'prReviewer', replies: [{ author: 'user', text: 'A reply' }],
    });
  });

  it('refuses an annotation of another feature everywhere', () => {
    const state = [other()];
    expect(run(LIST_COMMENTS, {}, state).result).toBe(JSON.stringify({ comments: [] }, undefined, 2));
    expect(() => run(REPLY_TO_COMMENT, { commentId: 'bare', text: 'x' }, state)).toThrow('Comment not found: bare');
    expect(run(DELETE_COMMENTS, { commentIds: ['bare'] }, state).actions).toEqual([]);
    expect(JSON.parse(run(DELETE_COMMENTS, { commentIds: ['bare'] }, state).result).notFoundCommentIds).toEqual(['bare']);
    expect(run(RESOLVE_COMMENTS, { commentIds: ['bare'] }, state).actions).toEqual([]);
    expect(JSON.parse(run(RESOLVE_COMMENTS, { commentIds: ['bare'] }, state).result).updatedCommentIds).toEqual([]);
  });

  it('ignores the key when its slot is not a comment', () => {
    const wrong = comment({ _meta: { [FEEDBACK_META]: { kind: 'poem', state: 'accepted', sessionResource: SESSION } } });
    expect(listableComments({ annotations: [wrong] })).toEqual([]);
    const noSession = comment({ _meta: { [FEEDBACK_META]: { kind: 'user', state: 'accepted' } } });
    expect(listableComments({ annotations: [noSession] })).toEqual([]);
  });
});

describe('the five tools', () => {
  it('replies with an agent entry and answers the whole comment', () => {
    const { result, actions } = run(REPLY_TO_COMMENT, { commentId: 'c1', text: 'Fixed in the next commit.' }, [comment()]);
    const action = actions[0] as Extract<CommentAction, { type: 'annotations/entrySet' }>;
    expect(action).toMatchObject({ type: 'annotations/entrySet', annotationId: 'c1' });
    expect(action.entry._meta).toEqual({ [FEEDBACK_META]: { author: 'agent' } });
    expect(action.entry.text).toBe('Fixed in the next commit.');
    expect(JSON.parse(result).comment.replies).toEqual([{ author: 'agent', text: 'Fixed in the next commit.' }]);
  });

  it('resolves and re-opens, saying which state it left them in', () => {
    const done = run(RESOLVE_COMMENTS, { commentIds: ['c1'] }, [comment()]);
    const set = done.actions[0] as Extract<CommentAction, { type: 'annotations/set' }>;
    expect(set.annotation.resolved).toBe(true);
    expect(set.annotation._meta).toEqual({ [FEEDBACK_META]: { kind: 'user', state: 'resolved', sessionResource: SESSION } });
    expect(JSON.parse(done.result)).toMatchObject({ resolved: true, updatedCommentIds: ['c1'], notFoundCommentIds: [] });

    const open = run(RESOLVE_COMMENTS, { commentIds: ['c1'], resolved: false }, [comment()]);
    const reopened = open.actions[0] as Extract<CommentAction, { type: 'annotations/set' }>;
    expect(reopened.annotation.resolved).toBe(false);
    expect(reopened.annotation._meta).toEqual({ [FEEDBACK_META]: { kind: 'user', state: 'submitted', sessionResource: SESSION } });
    expect(JSON.parse(open.result).resolved).toBe(false);
  });

  it('keeps what a client put in the meta and names the kind when it was missing', () => {
    const carried = comment({
      _meta: { [FEEDBACK_META]: {
        kind: 'codeReview', state: 'accepted', sessionResource: SESSION,
        codeSelection: 'const a = 1', sourcePRReviewCommentId: '42',
        sourcePullRequest: { owner: 'softov', repo: 'ahpd', number: 7 },
      } },
    });
    const { actions } = run(RESOLVE_COMMENTS, { commentIds: ['c1'] }, [carried]);
    const set = actions[0] as Extract<CommentAction, { type: 'annotations/set' }>;
    expect((set.annotation._meta?.[FEEDBACK_META] as Bag)).toMatchObject({
      kind: 'codeReview', state: 'resolved', codeSelection: 'const a = 1', sourcePRReviewCommentId: '42',
      sourcePullRequest: { owner: 'softov', repo: 'ahpd', number: 7 },
    });
  });

  it('deletes by id, naming what it did not find and what is left', () => {
    const { result, actions } = run(DELETE_COMMENTS, { commentIds: ['c1', 'c1', 'gone'] }, [comment(), other()]);
    expect(actions).toEqual([{ type: 'annotations/removed', annotationId: 'c1' }]);
    expect(JSON.parse(result)).toEqual({ deletedCommentIds: ['c1'], notFoundCommentIds: ['gone'], remainingComments: [] });
  });

  it('refuses in the reference host\'s words', () => {
    const refuses = (tool: string, raw: unknown) => () => run(tool, raw);
    expect(refuses(ADD_COMMENT, { resourceUri: '', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' }))
      .toThrow('Invalid addComment input: resourceUri must be a non-empty string.');
    expect(refuses(ADD_COMMENT, { resourceUri: 'file:///a', range: 'x', text: 'x' }))
      .toThrow('Invalid addComment input: range must be an object.');
    expect(refuses(ADD_COMMENT, { resourceUri: 'file:///a', range: { startLineNumber: 0, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' }))
      .toThrow('Invalid addComment input: range.startLineNumber must be a positive integer.');
    expect(refuses(ADD_COMMENT, { resourceUri: 'file:///a', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '' }))
      .toThrow('Invalid addComment input: text must be a non-empty string.');
    expect(refuses(REPLY_TO_COMMENT, { commentId: 'c1' })).toThrow('Invalid replyToComment input: text must be a non-empty string.');
    expect(refuses(DELETE_COMMENTS, { commentIds: [] })).toThrow('Invalid deleteComments input: commentIds must be a non-empty string array.');
    expect(refuses(DELETE_COMMENTS, { commentIds: [''] })).toThrow('Invalid deleteComments input: commentIds[] must be a non-empty string.');
    expect(refuses(LIST_COMMENTS, { includeResolved: 'yes' })).toThrow('Invalid listComments input: includeResolved must be a boolean.');
    expect(refuses(RESOLVE_COMMENTS, { commentIds: ['c1'], resolved: 'yes' })).toThrow('Invalid resolveComments input: resolved must be a boolean.');
    expect(refuses(REPLY_TO_COMMENT, { commentId: 'nobody', text: 'x' })).toThrow('Comment not found: nobody');
  });
});

describe('viewUnreviewedComments, which asks the person first', () => {
  it('asks nothing when no review comment waits', async () => {
    const { at, asks, writes } = toolAt([comment()]);
    expect(JSON.parse(String(await tool(VIEW_UNREVIEWED_COMMENTS).run({}, at)))).toEqual({ comments: [] });
    expect(asks).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('asks once, and shows every waiting comment the person revealed', async () => {
    const pull = review({
      id: 'r1',
      _meta: { [FEEDBACK_META]: { kind: 'prReview', state: 'created', sessionResource: SESSION } },
    });
    const { at, asks, writes, state } = toolAt([pull, review({ id: 'r2' })]);
    const said = String(await tool(VIEW_UNREVIEWED_COMMENTS).run({}, at));
    expect(asks).toHaveLength(1);
    expect(asks[0]?.map((one) => one.id)).toEqual(['revealComments']);
    expect(asks[0]?.[0]?.options?.map((one) => one.label)).toEqual(['Show them', 'Keep them hidden']);
    expect(JSON.parse(said).comments.map((one: { id: string }) => one.id)).toEqual(['r1', 'r2']);
    // Reading an unreviewed comment accepts it, as the reference host treats it.
    expect(writes).toHaveLength(2);
    expect(state().annotations.map((one) => (one._meta?.[FEEDBACK_META] as Bag).state))
      .toEqual(['submitted', 'submitted']);
  });

  it('shows nothing when the person says no', async () => {
    const kept = toolAt([review()], true, { response: 'accept', answers: { revealComments: 'Keep them hidden' } });
    expect(String(await tool(VIEW_UNREVIEWED_COMMENTS).run({}, kept.at))).toBe('The person did not reveal the review comments.');
    expect(kept.asks).toHaveLength(1);
    expect(kept.writes).toEqual([]);

    const declined = toolAt([review()], true, { response: 'decline', answers: {} });
    expect(String(await tool(VIEW_UNREVIEWED_COMMENTS).run({}, declined.at))).toBe('The person did not reveal the review comments.');
    expect(declined.writes).toEqual([]);
  });

  it('delivers a comment the person flagged, and clears the flag', async () => {
    const flagged = review({
      id: 'r1',
      _meta: { [FEEDBACK_META]: {
        kind: 'prReview', state: 'accepted', sessionResource: SESSION, pendingAgentReveal: true,
      } },
    });
    const { at, writes, state } = toolAt([flagged]);
    const said = JSON.parse(String(await tool(VIEW_UNREVIEWED_COMMENTS).run({}, at)));
    expect(said.comments.map((one: { id: string }) => one.id)).toEqual(['r1']);
    expect(writes).toHaveLength(1);
    expect((state().annotations[0]?._meta?.[FEEDBACK_META] as Bag)).toEqual({
      kind: 'prReview', state: 'accepted', sessionResource: SESSION,
    });
  });

  it('refuses without session:review, before it asks anything', async () => {
    const { at, asks } = toolAt([review()], false);
    await expect(tool(VIEW_UNREVIEWED_COMMENTS).run({}, at)).rejects.toThrow('this turn may not session:review here');
    expect(asks).toEqual([]);
  });
});

describe('as a tool', () => {
  it('writes through the channel and answers the model', () => {
    const { at, writes, state } = toolAt([comment()]);
    const said = tool(REPLY_TO_COMMENT).run({ commentId: 'c1', text: 'Done.' }, at);
    expect(JSON.parse(String(said)).comment.replies).toEqual([{ author: 'agent', text: 'Done.' }]);
    expect(writes).toHaveLength(1);
    expect(state().annotations.at(0)?.entries).toHaveLength(2);
    expect(String(tool(LIST_COMMENTS).run({}, at))).toBe(JSON.stringify({
      comments: [JSON.parse(String(said)).comment],
    }, undefined, 2));
  });

  it('round-trips an added comment once the person accepts it', () => {
    const { at, state, set } = toolAt();
    expect(tool(ADD_COMMENT).run({
      resourceUri: 'file:///repo/a.ts',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
      text: 'x',
    }, at)).toBe('Comment added.');
    expect(state().annotations).toHaveLength(1);
    // The agent's own comment is not listed until the person accepts it.
    expect(JSON.parse(String(tool(LIST_COMMENTS).run({}, at))).comments).toEqual([]);

    const accepted = annotationsReducer(state(), {
      type: 'annotations/set',
      annotation: {
        ...state().annotations[0],
        _meta: { [FEEDBACK_META]: { kind: 'codeReview', state: 'accepted', sessionResource: SESSION } },
      },
    } as unknown as AnnotationsAction);
    set(accepted);
    const listed = JSON.parse(applyCommentTool(accepted, SESSION, LIST_COMMENTS, {}, ORIGIN).result).comments;
    expect(listed).toHaveLength(1);
    expect(tool(DELETE_COMMENTS).run({ commentIds: [listed[0].id] }, at)).toContain('"deletedCommentIds"');
    expect(state().annotations).toEqual([]);
  });

  it('refuses a write without session:review, and still lists', () => {
    const { at, writes } = toolAt([comment()], false);
    expect(tool(LIST_COMMENTS).run({}, at)).toContain('"c1"');
    expect(() => tool(ADD_COMMENT).run({
      resourceUri: 'file:///repo/a.ts',
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
      text: 'x',
    }, at)).toThrow('this turn may not session:review here');
    expect(() => tool(DELETE_COMMENTS).run({ commentIds: ['c1'] }, at)).toThrow('this turn may not session:review here');
    expect(writes).toEqual([]);
  });

  it('carries every tool deferred, as the reference host does', () => {
    expect(Object.fromEntries(commentTools().map((one) => [one.definition.name, one.deferLoading]))).toEqual({
      addComment: true, listComments: true, replyToComment: true, deleteComments: true, resolveComments: true,
      viewUnreviewedComments: true,
    });
  });
});

// The host's own road: a tool run in a real session, and the mark a client
// subscribed to the annotations channel then reads.
let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-comments-'));
  made.push(dir);
  return dir;
};

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const until = async (ready: () => boolean | Promise<boolean>, what: string, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened in ${ms} ms`);
};

/** The echo backend, keeping the tools each start was handed. */
const counted = (dir: string, tools: Map<string, BoundTool[]>): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    create: (start: Start) => {
      tools.set(start.chatUri, start.tools ?? []);
      return base.create(start);
    },
  };
};

it('keeps a comment a tool wrote, and says it on the annotations channel', async () => {
  const dir = temp();
  const handed = new Map<string, BoundTool[]>();
  const host: Host = createHost({ path: dir, agents: [counted(dir, handed)], tools: hostTools() });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const session = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo' } });
  const chat = String(((await client.handle({ method: 'subscribe', params: { channel: session } })) as {
    snapshot: { state: Bag };
  }).snapshot.state.defaultChat);
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
  });
  await until(() => handed.has(chat), 'the tools');

  const add = handed.get(chat)?.find((one) => one.definition.name === ADD_COMMENT);
  if (add?.run === undefined) throw new Error('the chat was handed no addComment');
  expect(await add.run({
    resourceUri: 'file:///repo/a.ts',
    range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 9 },
    text: 'Name this.',
  })).toBe('Comment added.');

  const channel = `${session}/annotations`;
  const state = ((await client.handle({ method: 'subscribe', params: { channel } })) as {
    snapshot: { state: AnnotationsState };
  }).snapshot.state;
  expect(state.annotations).toHaveLength(1);
  expect(state.annotations[0]).toMatchObject({
    resource: 'file:///repo/a.ts',
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 8 } },
    resolved: false,
    entries: [{ text: 'Name this.', _meta: { [FEEDBACK_META]: { author: 'agent' } } }],
  });
  expect(state.annotations.at(0)?._meta).toEqual({ [FEEDBACK_META]: { kind: 'codeReview', state: 'created', sessionResource: session } });

  // The comment the tool wrote is what `listComments` reads back once the
  // person accepts it, so the two roads hold one state.
  const listed = applyCommentTool(state, session, LIST_COMMENTS, {}, ORIGIN);
  expect(JSON.parse(listed.result).comments).toEqual([]);
  host.close();
});
