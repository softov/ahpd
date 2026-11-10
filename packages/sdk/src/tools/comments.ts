import type {
  Annotation, AnnotationEntry, AnnotationOrigin, AnnotationsAction, AnnotationsState, TextRange,
} from '@microsoft/agent-host-protocol';
import type { HostTool, ToolCall } from '../types/host.js';

/**
 * The comment tools, and what a comment is on a session's annotations channel.
 *
 * `agentFeedbackServerTools.ts` in the reference host names the tools and says
 * what each answers, and `agentFeedbackAnnotations.ts` says what a feedback
 * annotation is: an {@link Annotation} on `<session>/annotations` whose `_meta`
 * carries `vscode.agentFeedback` with a `kind`, a `state` and the session it
 * belongs to, and each entry carrying an `author`. Both are copied rather than
 * redesigned: a window reads a comment's own fields from that meta, and a model
 * that gets a refusal fixes the call from the refusal's words, so the same
 * words here mean the same fix.
 *
 * A comment is only a comment when it carries the meta. The channel is shared
 * with whatever else any client put there, and these tools must never list,
 * reply to, resolve or delete another feature's annotation.
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/agentFeedbackServerTools.ts
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/meta/vscode/agentFeedbackAnnotations.ts
 */

/** The key the reference client reads a comment's own fields from. */
export const FEEDBACK_META = 'vscode.agentFeedback';

export const ADD_COMMENT = 'addComment';
export const LIST_COMMENTS = 'listComments';
export const REPLY_TO_COMMENT = 'replyToComment';
export const DELETE_COMMENTS = 'deleteComments';
export const RESOLVE_COMMENTS = 'resolveComments';
export const VIEW_UNREVIEWED_COMMENTS = 'viewUnreviewedComments';

/** Where a comment's thread came from, in the reference client's words. */
export type FeedbackKind = 'user' | 'codeReview' | 'prReview';
/** Where a comment stands, in the reference client's words. */
export type FeedbackState = 'created' | 'accepted' | 'submitted' | 'resolved';
/** Who typed one entry: the person, the agent, a pull request's reviewer, or nobody known. */
export type FeedbackAuthor = 'user' | 'agent' | 'prReviewer' | 'unknown';

/**
 * What a comment carries in its annotation's `_meta`.
 *
 * The optional members are written by a window when it turns a code or pull
 * request review comment into a comment here; these tools only ever write
 * `kind`, `state` and `sessionResource`, and carry the rest through a rewrite
 * untouched so a client does not lose what it put there.
 */
export interface FeedbackMeta {
  kind: FeedbackKind;
  state: FeedbackState;
  sessionResource: string;
  suggestion?: unknown;
  codeSelection?: string;
  diffHunks?: string;
  sourcePRReviewCommentId?: string;
  sourcePullRequest?: { owner: string; repo: string; number: number };
  /** Set by a client when the person revealed this comment to the agent; cleared once it is delivered. */
  pendingAgentReveal?: boolean;
}

const isKind = (value: unknown): value is FeedbackKind =>
  value === 'user' || value === 'codeReview' || value === 'prReview';

const isState = (value: unknown): value is FeedbackState =>
  value === 'created' || value === 'accepted' || value === 'submitted' || value === 'resolved';

const isAuthor = (value: unknown): value is FeedbackAuthor =>
  value === 'user' || value === 'agent' || value === 'prReviewer' || value === 'unknown';

const isPullRequest = (value: unknown): value is { owner: string; repo: string; number: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const one = value as Record<string, unknown>;
  return typeof one.owner === 'string' && typeof one.repo === 'string' && typeof one.number === 'number';
};

/**
 * The comment's own fields, or nothing for an annotation that is not a comment.
 *
 * Read through this rather than off the namespaced slot: the channel is
 * shared, and an annotation that happens to carry the key with the wrong shape
 * is somebody else's, not a comment to list.
 */
export const readFeedbackMeta = (annotation: Annotation): FeedbackMeta | undefined => {
  const slot = annotation._meta?.[FEEDBACK_META];
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return undefined;
  const raw = slot as Record<string, unknown>;
  if (!isKind(raw.kind) || !isState(raw.state) || typeof raw.sessionResource !== 'string') return undefined;
  const meta: FeedbackMeta = { kind: raw.kind, state: raw.state, sessionResource: raw.sessionResource };
  if (raw.suggestion !== undefined) meta.suggestion = raw.suggestion;
  if (typeof raw.codeSelection === 'string') meta.codeSelection = raw.codeSelection;
  if (typeof raw.diffHunks === 'string') meta.diffHunks = raw.diffHunks;
  if (typeof raw.sourcePRReviewCommentId === 'string') meta.sourcePRReviewCommentId = raw.sourcePRReviewCommentId;
  if (isPullRequest(raw.sourcePullRequest)) meta.sourcePullRequest = raw.sourcePullRequest;
  if (typeof raw.pendingAgentReveal === 'boolean') meta.pendingAgentReveal = raw.pendingAgentReveal;
  return meta;
};

/** The author stamped on one entry, or nothing for an entry written before authors were recorded. */
export const readEntryAuthor = (entry: AnnotationEntry): FeedbackAuthor | undefined => {
  const slot = entry._meta?.[FEEDBACK_META];
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return undefined;
  const author = (slot as Record<string, unknown>).author;
  return isAuthor(author) ? author : undefined;
};

/**
 * Who wrote the entry at `index`.
 *
 * An entry written before authors were recorded falls back to the thread's
 * origin for the opening entry and to the person for a reply, which was the
 * only hand that could type one then.
 */
export const authorOf = (entry: AnnotationEntry, index: number, kind: FeedbackKind | undefined): FeedbackAuthor => {
  const written = readEntryAuthor(entry);
  if (written !== undefined) return written;
  if (index > 0) return 'user';
  return kind === 'user' ? 'user' : kind === 'codeReview' ? 'agent' : kind === 'prReview' ? 'prReviewer' : 'unknown';
};

/** The `_meta` one entry of a comment carries. */
export const entryMeta = (author: FeedbackAuthor): Record<string, unknown> => ({ [FEEDBACK_META]: { author } });

const entryText = (text: AnnotationEntry['text']): string => (typeof text === 'string' ? text : text.markdown);

interface SerializedReply {
  author: FeedbackAuthor;
  text: string;
}

interface SerializedComment {
  id: string;
  resourceUri: string;
  range: OneBasedRange;
  text: string;
  kind: FeedbackKind | 'unknown';
  author: FeedbackAuthor;
  resolved: boolean;
  replies?: SerializedReply[];
}

interface OneBasedRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

const serializeComment = (annotation: Annotation): SerializedComment => {
  const entries = annotation.entries ?? [];
  const first = entries.at(0);
  const meta = readFeedbackMeta(annotation);
  const replies = entries.slice(1).map((entry, index): SerializedReply => ({
    author: authorOf(entry, index + 1, meta?.kind),
    text: entryText(entry.text),
  }));
  return {
    id: annotation.id,
    resourceUri: annotation.resource,
    range: fromTextRange(annotation.range),
    text: first === undefined ? '' : entryText(first.text),
    kind: meta?.kind ?? 'unknown',
    author: first === undefined ? 'unknown' : authorOf(first, 0, meta?.kind),
    resolved: annotation.resolved,
    ...(replies.length > 0 ? { replies } : {}),
  };
};

/**
 * The comments an agent may see: every one that carries the meta and holds at
 * least one entry, less the ones still in the `created` state, which an agent
 * added and the person has not accepted yet.
 */
export const listableComments = (state: AnnotationsState): Annotation[] =>
  state.annotations.filter((annotation) => {
    const meta = readFeedbackMeta(annotation);
    if (meta === undefined || !annotation.entries?.length) return false;
    const effective = annotation.resolved ? 'resolved' : meta.state;
    return effective !== 'created';
  });

/**
 * The kinds a review raises, which a person triages before an agent reads them.
 *
 * A `user` comment is the person's own words and is not waiting for them.
 */
const REVIEWABLE_KINDS: ReadonlySet<FeedbackKind> = new Set(['prReview', 'codeReview']);

/** The review comments the person revealed to the agent, which it has not read yet. */
const pendingReveal = (state: AnnotationsState): Annotation[] =>
  state.annotations.filter((annotation) => {
    const meta = readFeedbackMeta(annotation);
    if (meta === undefined || !annotation.entries?.length) return false;
    return REVIEWABLE_KINDS.has(meta.kind) && meta.pendingAgentReveal === true;
  });

/** The review comments the person has not accepted yet: still in the `created` state. */
const createdReviewable = (state: AnnotationsState): Annotation[] =>
  state.annotations.filter((annotation) => {
    const meta = readFeedbackMeta(annotation);
    if (meta === undefined || !annotation.entries?.length) return false;
    return REVIEWABLE_KINDS.has(meta.kind) && !annotation.resolved && meta.state === 'created';
  });

/** Whether there is a comment the person could reveal to the agent. */
export const hasRevealableComments = (state: AnnotationsState): boolean =>
  pendingReveal(state).length > 0 || createdReviewable(state).length > 0;

const withMeta = (annotation: Annotation, meta: FeedbackMeta): Annotation => ({
  ...annotation,
  _meta: { ...annotation._meta, [FEEDBACK_META]: meta },
});

/** The meta without the reveal flag, which is delivery's to clear. */
const withoutReveal = ({ pendingAgentReveal: _revealed, ...meta }: FeedbackMeta): FeedbackMeta => meta;

/** The comment with the reveal flag cleared, as the reference host clears it after delivery. */
const clearPendingReveal = (annotation: Annotation): Annotation => {
  const meta = readFeedbackMeta(annotation);
  return meta === undefined ? annotation : withMeta(annotation, withoutReveal(meta));
};

/** The comment in the `submitted` state, which is what reading an unreviewed one makes it. */
const markSubmitted = (annotation: Annotation): Annotation => {
  const meta = readFeedbackMeta(annotation);
  return meta === undefined ? annotation : withMeta(annotation, { ...withoutReveal(meta), state: 'submitted' });
};

/**
 * The note `listComments` appends while review comments wait, in the
 * reference host's words.
 *
 * It counts them by kind and points the model at the tool that reveals them,
 * so an agent that never thought to look still learns they are there.
 */
const unreviewedNote = (state: AnnotationsState): string | undefined => {
  const created = createdReviewable(state);
  if (created.length === 0) return undefined;
  let pullRequests = 0;
  let codeReviews = 0;
  for (const annotation of created) {
    const kind = readFeedbackMeta(annotation)?.kind;
    if (kind === 'prReview') pullRequests += 1;
    else if (kind === 'codeReview') codeReviews += 1;
  }
  const said: string[] = [];
  if (pullRequests > 0) said.push(`${pullRequests} pull request comment${pullRequests === 1 ? '' : 's'}`);
  if (codeReviews > 0) said.push(`${codeReviews} code review comment${codeReviews === 1 ? '' : 's'}`);
  const verb = created.length === 1 ? 'is' : 'are';
  return `There ${verb} ${said.join(' and ')} which the user has not reviewed yet. `
    + `If the user wants you to tackle them, call the \`${VIEW_UNREVIEWED_COMMENTS}\` tool to view them.`;
};

// A range is one-based on the wire and zero-based on the channel, as the
// reference host converts it in both directions.
const toTextRange = (range: OneBasedRange): TextRange => ({
  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
});

const fromTextRange = (range: TextRange | undefined): OneBasedRange => (range === undefined
  ? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  : {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  });

const requiredText = (value: unknown, field: string, tool: string): string => {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Invalid ${tool} input: ${field} must be a non-empty string.`);
  return value;
};

const requiredCount = (value: unknown, field: string, tool: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new Error(`Invalid ${tool} input: ${field} must be a positive integer.`);
  return value;
};

const uniqueIds = (value: unknown, tool: string): string[] => {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Invalid ${tool} input: commentIds must be a non-empty string array.`);
  return [...new Set(value.map((one) => requiredText(one, 'commentIds[]', tool)))];
};

const addArgs = (raw: unknown): { resourceUri: string; range: OneBasedRange; text: string } => {
  const args = (raw ?? {}) as Record<string, unknown>;
  const resourceUri = requiredText(args.resourceUri, 'resourceUri', ADD_COMMENT);
  const text = requiredText(args.text, 'text', ADD_COMMENT);
  if (!args.range || typeof args.range !== 'object' || Array.isArray(args.range))
    throw new Error(`Invalid ${ADD_COMMENT} input: range must be an object.`);
  const range = args.range as Record<string, unknown>;
  return {
    resourceUri,
    text,
    range: {
      startLineNumber: requiredCount(range.startLineNumber, 'range.startLineNumber', ADD_COMMENT),
      startColumn: requiredCount(range.startColumn, 'range.startColumn', ADD_COMMENT),
      endLineNumber: requiredCount(range.endLineNumber, 'range.endLineNumber', ADD_COMMENT),
      endColumn: requiredCount(range.endColumn, 'range.endColumn', ADD_COMMENT),
    },
  };
};

const includeResolvedFlag = (value: unknown): boolean => {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${LIST_COMMENTS} input: includeResolved must be a boolean.`);
  return value;
};

const resolvedFlag = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${RESOLVE_COMMENTS} input: resolved must be a boolean.`);
  return value;
};

/**
 * One write a comment tool makes, in the protocol's own words.
 *
 * Written as the strings the protocol's `ActionType` names rather than through
 * that enum, which is declared as a const enum and so cannot be read as a
 * value here. The three are the only annotations actions a comment tool sends.
 */
export type CommentAction =
  | { type: 'annotations/set'; annotation: Annotation }
  | { type: 'annotations/removed'; annotationId: string }
  | { type: 'annotations/entrySet'; annotationId: string; entry: AnnotationEntry };

/**
 * What one comment tool does to the channel.
 *
 * Pure: it reads the state it is given and answers the actions to dispatch and
 * the text the model reads, so a test needs no host. The caller is the only
 * writer, the same as a client's own dispatch.
 */
export interface CommentOutcome {
  actions: CommentAction[];
  result: string;
}

/**
 * Run `tool` against `state`, in the reference host's words.
 *
 * `session` is the URI the comment belongs to, which a new comment's meta
 * names and an older one keeps. `origin` names the session, chat and turn the
 * call ran in.
 *
 * Throws when the tool is unknown or the arguments are refused; the message is
 * the reference host's, because the model reads it to fix the call.
 */
export const applyCommentTool = (
  state: AnnotationsState,
  session: string,
  tool: string,
  raw: unknown,
  origin: AnnotationOrigin,
): CommentOutcome => {
  switch (tool) {
    case ADD_COMMENT: {
      const { resourceUri, range, text } = addArgs(raw);
      const id = crypto.randomUUID();
      // A comment an agent adds is `created` until the person accepts it: the
      // agent is proposing, and an unaccepted comment is not the person's.
      const meta: FeedbackMeta = { kind: 'codeReview', state: 'created', sessionResource: session };
      const annotation: Annotation = {
        id,
        origin,
        resource: resourceUri,
        range: toTextRange(range),
        resolved: false,
        entries: [{ id: `${id}:0`, text, _meta: entryMeta('agent') }],
        _meta: { [FEEDBACK_META]: meta },
      };
      return { actions: [{ type: 'annotations/set', annotation }], result: 'Comment added.' };
    }
    case LIST_COMMENTS: {
      const includeResolved = includeResolvedFlag((raw as Record<string, unknown> | undefined)?.includeResolved);
      const payload: { comments: SerializedComment[]; note?: string } = {
        comments: listableComments(state)
          .filter((annotation) => includeResolved || !annotation.resolved)
          .map(serializeComment),
      };
      const note = unreviewedNote(state);
      if (note !== undefined) payload.note = note;
      return { actions: [], result: JSON.stringify(payload, undefined, 2) };
    }
    case REPLY_TO_COMMENT: {
      const args = (raw ?? {}) as Record<string, unknown>;
      const commentId = requiredText(args.commentId, 'commentId', REPLY_TO_COMMENT);
      const text = requiredText(args.text, 'text', REPLY_TO_COMMENT);
      const annotation = listableComments(state).find((one) => one.id === commentId);
      if (annotation === undefined) throw new Error(`Comment not found: ${commentId}`);
      const entry: AnnotationEntry = { id: crypto.randomUUID(), text, _meta: entryMeta('agent') };
      const updated: Annotation = { ...annotation, entries: [...annotation.entries, entry] };
      return {
        actions: [{ type: 'annotations/entrySet', annotationId: commentId, entry }],
        result: JSON.stringify({ comment: serializeComment(updated) }, undefined, 2),
      };
    }
    case VIEW_UNREVIEWED_COMMENTS: {
      const pending = pendingReveal(state);
      if (pending.length === 0) {
        // Nothing was revealed, so every review comment still in `created` is
        // the person's to look at. Reading them here is their acceptance, as
        // the reference host treats it, so each one becomes `submitted`.
        const unreviewed = createdReviewable(state);
        return {
          actions: unreviewed.map((annotation): CommentAction => ({
            type: 'annotations/set',
            annotation: markSubmitted(annotation),
          })),
          result: JSON.stringify({ comments: unreviewed.map(serializeComment) }, undefined, 2),
        };
      }
      // A window flagged the comments the person chose to reveal. Deliver
      // them, and clear each flag so one reveal is one delivery.
      return {
        actions: pending.map((annotation): CommentAction => ({
          type: 'annotations/set',
          annotation: clearPendingReveal(annotation),
        })),
        result: JSON.stringify({ comments: pending.map(serializeComment) }, undefined, 2),
      };
    }
    case DELETE_COMMENTS: {
      const ids = uniqueIds((raw as Record<string, unknown> | undefined)?.commentIds, DELETE_COMMENTS);
      const listable = listableComments(state);
      const held = new Set(listable.map((one) => one.id));
      const deleted: string[] = [];
      const notFound: string[] = [];
      for (const id of ids) (held.has(id) ? deleted : notFound).push(id);
      return {
        actions: deleted.map((annotationId): CommentAction => ({ type: 'annotations/removed', annotationId })),
        result: JSON.stringify({
          deletedCommentIds: deleted,
          notFoundCommentIds: notFound,
          remainingComments: listable.filter((one) => !deleted.includes(one.id)).map(serializeComment),
        }, undefined, 2),
      };
    }
    case RESOLVE_COMMENTS: {
      const args = (raw ?? {}) as Record<string, unknown>;
      const ids = uniqueIds(args.commentIds, RESOLVE_COMMENTS);
      const resolved = resolvedFlag(args.resolved);
      const listable = listableComments(state);
      const held = new Map(listable.map((one) => [one.id, one]));
      const actions: CommentAction[] = [];
      const updated: string[] = [];
      const notFound: string[] = [];
      for (const id of ids) {
        const annotation = held.get(id);
        if (annotation === undefined) {
          notFound.push(id);
          continue;
        }
        const meta = readFeedbackMeta(annotation);
        const nextMeta: FeedbackMeta = {
          ...meta,
          kind: meta?.kind ?? 'user',
          state: resolved ? 'resolved' : 'submitted',
          sessionResource: meta?.sessionResource ?? session,
        };
        actions.push({
          type: 'annotations/set',
          annotation: { ...annotation, resolved, _meta: { ...annotation._meta, [FEEDBACK_META]: nextMeta } },
        });
        updated.push(id);
      }
      return {
        actions,
        result: JSON.stringify({
          resolved,
          updatedCommentIds: updated,
          notFoundCommentIds: notFound,
          comments: listable.map((one) => serializeComment(updated.includes(one.id) ? { ...one, resolved } : one)),
        }, undefined, 2),
      };
    }
    default:
      throw new Error(`Unknown comment tool: ${tool}`);
  }
};

/** The origin a comment written by this call carries. */
const originOf = (at: ToolCall): AnnotationOrigin => {
  const turnId = at.turn();
  return { session: at.session, chat: at.chat, ...(turnId === undefined ? {} : { turnId }) };
};

/** Refuse the call unless the person behind it may review this session. */
const allowed = (at: ToolCall): void => {
  const grant = 'session:review';
  if (!at.may(grant)) throw new Error(at.refusal(grant));
};

/**
 * Run one tool, say each write on the channel, and answer the model.
 *
 * Every write goes through `markAnnotation`, the same writer a client's
 * `annotations/*` action takes, so a comment an agent makes is one state to
 * every client of the session and is kept like any other.
 */
const run = (at: ToolCall, tool: string, input: unknown, writes: boolean): string => {
  if (writes) allowed(at);
  const outcome = applyCommentTool(at.annotations(), at.session, tool, input, originOf(at));
  // The strings are the protocol's own; the enum it types them with is a const
  // enum, so the cast stands in for naming it, as it does on the channel.
  for (const action of outcome.actions) at.markAnnotation(action as unknown as AnnotationsAction);
  return outcome.result;
};

/**
 * `viewUnreviewedComments`, which asks the person before a review comes over.
 *
 * The reference host's group asks for a confirmation only while there is
 * something to reveal, and that is this: no waiting comment means no question.
 * The client that would let the person pick which ones comes later, so an
 * answer of yes reveals every waiting comment, and an answer of no reveals
 * none.
 */
const viewUnreviewed = async (at: ToolCall): Promise<string> => {
  allowed(at);
  if (hasRevealableComments(at.annotations())) {
    const answer = await at.ask([{
      id: 'revealComments',
      question: 'Show the agent the review comments you have not looked at yet?',
      header: 'Comments',
      options: [
        { label: 'Show them' },
        { label: 'Keep them hidden' },
      ],
      allowOther: false,
    }]);
    const said = answer.answers.revealComments;
    const revealed = Array.isArray(said) ? said.includes('Show them') : said === 'Show them';
    if (answer.response !== 'accept' || !revealed) return 'The person did not reveal the review comments.';
  }
  const outcome = applyCommentTool(at.annotations(), at.session, VIEW_UNREVIEWED_COMMENTS, {}, originOf(at));
  for (const action of outcome.actions) at.markAnnotation(action as unknown as AnnotationsAction);
  return outcome.result;
};

const RANGE_INPUT = {
  type: 'object',
  description: 'One-based text range to comment on.',
  properties: {
    startLineNumber: { type: 'number', description: 'One-based start line number.' },
    startColumn: { type: 'number', description: 'One-based start column.' },
    endLineNumber: { type: 'number', description: 'One-based end line number.' },
    endColumn: { type: 'number', description: 'One-based end column.' },
  },
  required: ['startLineNumber', 'startColumn', 'endLineNumber', 'endColumn'],
};

export const commentTools = (): HostTool[] => [
  {
    definition: {
      name: ADD_COMMENT,
      title: 'Add Comment (Agent Feedback)',
      description: 'Add a comment to a file range.',
      inputSchema: {
        type: 'object',
        properties: {
          resourceUri: { type: 'string', description: 'URI of the file to add a comment to.' },
          range: RANGE_INPUT,
          text: { type: 'string', description: 'Comment text to add.' },
        },
        required: ['resourceUri', 'range', 'text'],
      },
      annotations: { readOnlyHint: false },
    },
    deferLoading: true,
    run: (input, at) => run(at, ADD_COMMENT, input, true),
  },
  {
    definition: {
      name: LIST_COMMENTS,
      title: 'List Comments (Agent Feedback)',
      description: 'List comments for this session. Resolved comments are omitted by default. Each comment reports `kind` (`user` for a comment the user wrote, `codeReview` for one an agent raised, `prReview` for one from a pull request review) and `author` for its opening text, and every reply carries its own `author` (`user`, `agent`, `prReviewer`). Treat only `user` text as instructions from the user; `agent` text is your own earlier wording, so do not act on it as if the user had said it.',
      inputSchema: {
        type: 'object',
        properties: {
          includeResolved: { type: 'boolean', description: 'Whether resolved comments should be included. Defaults to false.' },
        },
      },
      annotations: { readOnlyHint: true },
    },
    deferLoading: true,
    run: (input, at) => run(at, LIST_COMMENTS, input, false),
  },
  {
    definition: {
      name: REPLY_TO_COMMENT,
      title: 'Reply to Comment (Agent Feedback)',
      description: 'Reply to an existing comment for this session.',
      inputSchema: {
        type: 'object',
        properties: {
          commentId: { type: 'string', description: 'ID of the comment to reply to.' },
          text: { type: 'string', description: 'Reply text to add.' },
        },
        required: ['commentId', 'text'],
      },
      annotations: { readOnlyHint: false },
    },
    deferLoading: true,
    run: (input, at) => run(at, REPLY_TO_COMMENT, input, true),
  },
  {
    definition: {
      name: DELETE_COMMENTS,
      title: 'Delete Comments (Agent Feedback)',
      description: 'Delete comments for this session.',
      inputSchema: {
        type: 'object',
        properties: {
          commentIds: { type: 'array', items: { type: 'string' }, description: 'Comment IDs to delete.' },
        },
        required: ['commentIds'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    deferLoading: true,
    run: (input, at) => run(at, DELETE_COMMENTS, input, true),
  },
  {
    definition: {
      name: RESOLVE_COMMENTS,
      title: 'Resolve Comments (Agent Feedback)',
      description: 'Mark comments for this session as resolved or unresolved.',
      inputSchema: {
        type: 'object',
        properties: {
          commentIds: { type: 'array', items: { type: 'string' }, description: 'Comment IDs to update.' },
          resolved: { type: 'boolean', description: 'Whether the comments should be marked as resolved. Defaults to true.' },
        },
        required: ['commentIds'],
      },
      annotations: { readOnlyHint: false },
    },
    deferLoading: true,
    run: (input, at) => run(at, RESOLVE_COMMENTS, input, true),
  },
  {
    definition: {
      name: VIEW_UNREVIEWED_COMMENTS,
      title: 'View Unreviewed Comments (Agent Feedback)',
      description: 'View pull request or code review comments that the user has not reviewed yet. '
        + 'The user may be asked to choose which comments to reveal, in which case only the comments they select are returned; '
        + 'otherwise every unreviewed comment is returned.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: false },
    },
    deferLoading: true,
    run: (_input, at) => viewUnreviewed(at),
  },
];
