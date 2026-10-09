/**
 * One pi conversation, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one embedded `AgentSession` behind a turn, and the lifecycle
 * around the translation in `mapping.ts`.
 *
 * What pi gives this bridge for free, and what it does not:
 *
 * - **Steering** is pi's own `steer()`, so a message mid-turn is the thing it
 *   says it is rather than a queued message pretending.
 * - **Truncation** is `navigateTree`: pi's sessions are append-only trees, the
 *   leaf moves, and the abandoned path stops being context. That is exactly
 *   what `chat/truncated` asks for, so `rewindAt` is honest here.
 * - **Confirmation** is an inline pi extension's `tool_call` handler: the call
 *   is opened `pending-confirmation`, a `toolConfirmation` entry is published
 *   as `session/inputNeeded`, and `confirm` answers it. Which calls are asked
 *   about is the session's `permissionMode`.
 * - **A fork** is pi's own `createBranchedSession`: the leaf each turn settled
 *   at is what `forkPoint` names, and branching there writes the conversation
 *   through that turn under a new id, which is what AHP asks a fork for.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Status, callTimes, createClientCalls, idFor, partsOf, startOf, uriOf, withCallTimes } from '@ahpd/sdk';
import type {
  Bag, BoundTool, Chosen, MessageAttachment, MessageFrom, Ran, Session, Start, ToolEffects,
} from '@ahpd/sdk';
import type { AgentSessionEvent, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai';
import { isUuid, openPi } from './backend.js';
import type { BackendOptions, PiBackend } from './backend.js';
import { watch } from './catalog.js';
import { activityOf, addUsage, describe, mapEvent, readyRow, untime } from './mapping.js';
import { listed } from './models.js';
import { replayed } from './replay.js';
import type { ReplayPi } from './replay.js';
import { toPiTool } from './tools.js';
import type { RunByClient } from './tools.js';
import type { PiOptions, PiTurn, WatchedSession, WatchedTurn } from './types.js';
import { modeOf, PERMISSION_MODES, permissionModeProperty } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The space characters pi folds to a plain space before it reads a path. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * pi's two tools that write a named file. Nothing else reports an edit: a
 * shell writes without naming one.
 */
const EDITS = new Set(['edit', 'write']);

/**
 * How pi is opened for a session.
 *
 * The default opens the embedded pi this package ships; a caller may pass its
 * own, and then the whole turn lifecycle runs against that backend.
 */
export type OpenPi = (options: BackendOptions) => Promise<PiBackend>;

/** The title a conversation carries until something better is known. */
const UNTITLED = 'pi session';

/** The first line of what was said, as a title for a session nobody named. */
const titleFrom = (text: string): string => {
  const line = text.split('\n').map((one) => one.trim()).find((one) => one !== '') ?? '';
  return line === '' ? UNTITLED : line.slice(0, 80);
};

/**
 * A message, as pi's `prompt` and `steer` take it: one text, and its images.
 *
 * `partsOf` decides which attachment is an image, which is an inlined text and
 * which is named by its path, within the limits every backend shares. pi takes
 * a single text, so the parts that are text - what was said, an inlined
 * attachment, the reference block - are joined with a blank line, in the order
 * the client attached them.
 *
 * `takesImages` is the model the turn runs on, so a picture goes as bytes only
 * where pi's model takes one. Everywhere else the helper names it by path.
 */
const promptFor = async (
  text: string,
  attachments: MessageAttachment[] | undefined,
  takesImages: boolean,
): Promise<{ text: string; images: ImageContent[] }> => {
  if (attachments === undefined || attachments.length === 0) return { text, images: [] };
  const parts = await partsOf(text, attachments, { images: takesImages });
  const said: string[] = [];
  const images: ImageContent[] = [];
  for (const part of parts) {
    if (part.type === 'image') images.push({ type: 'image', data: part.data, mimeType: part.mimeType });
    else said.push(part.text);
  }
  return { text: said.join('\n\n'), images };
};

/** The attachments a message a client sent carries, where it carries any. */
const attachmentsOf = (message: unknown): MessageAttachment[] | undefined => {
  const kept = bag(message).attachments;
  return Array.isArray(kept) ? kept as MessageAttachment[] : undefined;
};

/**
 * One conversation over one embedded pi.
 *
 * pi is opened lazily, on the first turn, so a session somebody made and never
 * used costs no model runtime and reads no project resources.
 */
export function piSession(
  options: PiOptions,
  start: Start,
  open: OpenPi = openPi,
  replay: ReplayPi = (id, directory) => replayed(options, id, [directory]),
): Session {
  const provider = options.provider ?? 'pi';
  const emit = start.emit;
  const where = start.workingDirectory ?? process.cwd();

  const settings: Record<string, unknown> = { ...start.settings };
  /**
   * The tools this session offers the model, as the host and its clients bound
   * them.
   *
   * Held rather than read from `start` once, because a client's tools arrive
   * and go while the session runs.
   */
  let offering: BoundTool[] = [...(start.tools ?? [])];
  /** The tools the live or opening backend was built with, by their names. */
  let built: BoundTool[] = [];
  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  const seeds: Bag[] = [...(start.seedCustomizations ?? [])];
  let active: Bag | undefined;
  /** The running turn's mapping, so an event knows what it belongs to. */
  let mapping: PiTurn | undefined;
  let live: PiBackend | undefined;
  /** The one opening, shared by every caller, so one pi is built. */
  let opening: Promise<PiBackend> | undefined;
  /** Whether the tools changed since pi was built, so it is rebuilt next turn. */
  let stale = false;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let cancelled = false;
  let activity: string | undefined;
  let title = UNTITLED;
  let modified = new Date().toISOString();
  /** What a turn failed with, or nothing. Cleared when a turn starts. */
  let failed: string | undefined;
  /**
   * The last assistant message of the running turn, or nothing yet.
   *
   * How the turn ends is judged from this at the settle rather than from each
   * `message_end`: pi retries a failed call itself, and a retry that answered
   * replaces the error, so only the last message counts. What the turn used is
   * read from the same message.
   */
  let answered: AssistantMessage | undefined;
  /**
   * What the running turn has used over every call it made, or nothing yet.
   *
   * Each assistant `message_end` adds its own usage to this and sends what the
   * turn has used so far, so a client watches the number grow rather than
   * being handed the last answer's count, and the sum is what the turn ends on.
   */
  let spent: Bag | undefined;
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  let draft: Bag | undefined;
  /** The models pi reported, once it has been asked. */
  let models: { id: string; name: string }[] = [];
  /**
   * The turns this process watched, after those a resumed session read from
   * pi's file, kept by reference.
   *
   * The array exists before the record does, because the first turn starts
   * before pi has opened: `begin` returns as soon as the turn is announced and
   * pi is built inside it. A record created later and given a fresh array
   * would be a session whose first turn is missing from its own transcript.
   */
  const watchedTurns: WatchedTurn[] = [];
  /**
   * The entry each watched turn ended at, by this host's turn id.
   *
   * What both cuts take. A truncation of that turn has to cut here, and so
   * does a fork, which copies the conversation through the turn it names.
   * pi's sessions are append-only trees, so the leaf at the settle is the last
   * thing the turn left behind, and nothing is dropped until `navigateTree`
   * moves it there.
   */
  const ends = new Map<string, string>();
  /*
   * A resumed session's earlier turns, as pi's file has them. They open the
   * watched record, so a transcript read after this session runs a turn still
   * has them, and they end where the file says, so one can be truncated like a
   * watched turn. A turn this session watched keeps the end it saw.
   */
  if (start.resume !== undefined) {
    void replay(start.resume, where).then((rebuilt) => {
      for (const [turnId, end] of rebuilt?.ends ?? []) if (!ends.has(turnId)) ends.set(turnId, end);
      // Ahead of any turn this session has already run, which came after them.
      watchedTurns.unshift(...(rebuilt?.turns ?? []));
    }).catch(() => {});
  }
  /** The catalogue's record, so a transcript can be read back after the turn. */
  let record: WatchedSession | undefined;
  let watched: WatchedTurn | undefined;

  const touch = (): void => { modified = new Date().toISOString(); };

  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /**
   * Calls a client is running for this session, held in one place.
   *
   * Held for the same reason a queued message is: the thing that settles one
   * arrives later and from somewhere else, and anything that ends the turn has
   * to settle it itself or pi waits for ever on a promise nobody owns. The
   * holder also raises the session entry a client reads and times a call out,
   * which is what the map this replaces did neither of - see
   * `packages/sdk/src/tools/clientcalls.ts`.
   */
  const calls = createClientCalls({
    chat: start.chatUri,
    emit,
    ...(start.clientToolTimeoutMs === undefined ? {} : { timeoutMs: start.clientToolTimeoutMs }),
    providers: (name) => built
      .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
      .map((one) => String(one.owner)),
  });

  /** The client that provides a tool, by the name pi calls it. */
  const clientOf = (toolName: string): string | undefined =>
    built.find((one) => one.definition.name === toolName)?.owner;

  /**
   * Ask the client that provides a tool to run a call, once the call is running.
   *
   * Where a call is running and not merely announced: an entry names a call
   * somebody has to run, and a call a person is still being asked about is one
   * nobody has allowed yet. `line` is what a client shows for it, which is the
   * sentence the chat's `chat/toolCallReady` carries beside it.
   */
  const openClientCall = (id: string, toolName: string, turnId: string, line: string, input: Bag): void => {
    const owner = clientOf(toolName);
    if (owner === undefined) return;
    calls.open({
      turnId,
      owner,
      toolCall: {
        toolCallId: id,
        // The name the client announced: the tool under its own name, not the
        // `<clientId>__<name>` the model was offered.
        toolName: toolName.slice(owner.length + 2),
        displayName: toolName,
        invocationMessage: line,
        confirmed: 'not-needed',
        toolInput: JSON.stringify(input),
      },
    });
  };

  /** Hand a call to the client that provides the tool, and wait for its answer. */
  const ranByClient: RunByClient = async (bound, toolCallId) => {
    const owner = bound.owner ?? '';
    doing(`Waiting on ${owner}: ${bound.definition.title ?? bound.definition.name}`);
    return await calls.wait(toolCallId);
  };

  /**
   * Calls waiting on a person, by pi's call id.
   *
   * A map because a turn can ask twice at once: the protocol's `inputNeeded`
   * is a list and `session/inputNeededSet` matches by id.
   */
  const pending = new Map<string, {
    id: string;
    entry: Bag;
    settle: (answer: ToolCallEventResult | undefined) => void;
    /** Ask the client to run the call, for a call the person then allows. */
    open?: () => void;
  }>();

  /** The requests a client can still answer: the person's, and the clients'. */
  const needed = (): Bag[] => [...pending.values()].map((one) => one.entry).concat(calls.entries());

  /** What a declined call answers, which is the reason the model reads. */
  const DECLINED = 'The person declined this action';

  /**
   * Cancel every question still waiting, so pi does not wait for ever.
   *
   * Each one is said back as an answer nobody gave and taken off the input
   * list, and its row is moved to `cancelled`, which is what a client watching
   * the actions sees too.
   */
  const releasePending = (why: string): void => {
    for (const [id, held] of [...pending.entries()]) {
      pending.delete(id);
      const part = mapping?.parts.find((one) => one.id === id);
      if (part !== undefined) {
        bag(part.toolCall).status = 'cancelled';
        // The question was cancelled, so the call never ran: the start
        // `tool_execution_start` stamped is taken off with it.
        untime(bag(part.toolCall));
      }
      emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: String(held.entry.turnId ?? (active === undefined ? '' : active.id)),
        toolCallId: id,
        approved: false,
        reason: 'denied' as const,
      });
      emit('session', { type: 'session/inputNeededRemoved', id });
      held.settle({ block: true, reason: why });
    }
  };

  /** What pi's own tools do to the world, by the name pi calls them. */
  const PI_EFFECTS: Record<string, ToolEffects> = {
    read: { reads: true },
    grep: { reads: true },
    find: { reads: true },
    ls: { reads: true },
    edit: { writes: true },
    write: { writes: true },
    bash: { writes: true, destructive: true },
    powershell: { writes: true, destructive: true },
  };

  /** What one call does, from pi's own name for it or the tool the host bound. */
  const effectsOf = (toolName: string): ToolEffects => {
    // pi's own name wins, so a host tool dropped for shadowing it changes
    // nothing about the built-in of that name.
    const owned = PI_EFFECTS[toolName];
    if (owned !== undefined) return owned;
    // A tool that declares no effects does not change anything, which is how
    // cofold's `createTool` reads one.
    return built.find((one) => one.definition.name === toolName)?.effects ?? {};
  };

  /** The path a pi tool input names, with `~` expanded and a leading `@` stripped. */
  const piPath = (value: string): string => {
    let at = value.replace(UNICODE_SPACES, ' ');
    if (at.startsWith('@')) at = at.slice(1);
    if (at === '~') return homedir();
    if (at.startsWith('~/') || at.startsWith('~\\')) return join(homedir(), at.slice(2));
    if (/^file:\/\//.test(at)) return fileURLToPath(at);
    return at;
  };

  /** A path with symlinks followed, up to its nearest ancestor that exists. */
  const realPath = (path: string): string => {
    const rest: string[] = [];
    let at = path;
    while (!existsSync(at)) {
      const parent = dirname(at);
      if (parent === at) return path;
      rest.unshift(basename(at));
      at = parent;
    }
    try { return join(realpathSync(at), ...rest); }
    catch { return path; }
  };

  /** Whether a path names somewhere under the directory this session works in. */
  const insideWorkspace = (path: unknown): boolean => {
    if (typeof path !== 'string' || path === '') return false;
    const named = piPath(path);
    const at = realPath(isAbsolute(named) ? named : resolve(where, named));
    const rel = relative(realPath(where), at);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };

  /** The path a read names: its own `path`, or the `cwd` it works from. */
  const readTarget = (input: Bag): unknown =>
    (typeof input.path === 'string' ? input.path : input.cwd);

  /**
   * What to do about one call: run it, ask a person, or refuse it.
   *
   * The modes are the siblings' six - decision
   * `permission-modes-live-in-the-harness`.
   */
  const decide = (toolName: string, input: Bag): ToolCallEventResult | 'ask' | undefined => {
    const effects = effectsOf(toolName);
    /** Whether the modes that ask before a change ask about this call. */
    const asks = (): boolean => {
      if (effects.writes === true || effects.destructive === true || effects.network === true) return true;
      // A read outside the workspace asks, as cofold's does; one that names
      // nothing reads where the session works.
      if (effects.reads === true) {
        const target = readTarget(input);
        if (target !== undefined && !insideWorkspace(target)) return true;
      }
      return false;
    };
    const onEffects = (): ToolCallEventResult | 'ask' | undefined => (asks() ? 'ask' : undefined);
    switch (modeOf(settings.permissionMode)) {
      case 'bypassPermissions':
        return undefined;
      case 'plan':
        return effects.writes === true || effects.destructive === true
          ? { block: true, reason: `${toolName} would change something and the mode is plan` }
          : onEffects();
      case 'auto':
        return effects.destructive === true ? 'ask' : undefined;
      case 'acceptEdits':
        // An edit is a write that does not destroy, and only one that names a
        // path inside the working directory is let through.
        return effects.writes === true && effects.destructive !== true && insideWorkspace(input.path)
          ? undefined
          : onEffects();
      case 'dontAsk':
        return asks()
          ? { block: true, reason: `${toolName} would need approval and the mode is dontAsk` }
          : undefined;
      default:
        return onEffects();
    }
  };

  /*
   * One state, not a set of bits.
   *
   * A call waiting on a person is what the session is doing, ahead of the
   * turn that is running behind it; a running turn is next, whatever it
   * failed with last.
   */
  const status = (): number => (pending.size > 0 ? Status.InputNeeded
    : active !== undefined ? Status.InProgress
      : failed !== undefined ? Status.Error
        : Status.Idle);

  /**
   * Decide a call and ready its row, asking a person when the policy says to.
   *
   * The row is open already, from the model's stream or from pi's
   * `tool_execution_start`, and pi calls this before it runs the tool, so the
   * row is moved rather than opened again. Answers nothing to run the call,
   * or a block to refuse it.
   */
  const askBefore = async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
    const id = event.toolCallId;
    const input = bag(event.input);
    const displayName = event.toolName;
    const turnId = active === undefined ? '' : String(active.id);
    const part = mapping?.parts.find((one) => one.id === id);
    const row = part === undefined ? undefined : bag(part.toolCall);
    const owner = mapping?.ownerOf?.(event.toolName);
    const contributor = owner === undefined
      ? {}
      : { contributor: { kind: 'client' as const, clientId: owner } };
    /** Move the row and say where it stands, once. */
    const ready = (extra: Bag): void => {
      if (row !== undefined) readyRow(row, displayName, input, extra);
      emit('chat', {
        type: 'chat/toolCallReady',
        turnId,
        toolCallId: id,
        invocationMessage: describe(displayName, input),
        toolInput: JSON.stringify(input),
        ...contributor,
        ...extra,
        // The whole bag, because an action's `_meta` replaces the call's: the
        // start `tool_execution_start` stamped is what the row holds.
        ...(row?._meta === undefined ? {} : { _meta: row._meta }),
      });
    };

    const decided = decide(event.toolName, input);
    if (decided === 'ask') {
      const title = `Run ${displayName}?`;
      return await new Promise<ToolCallEventResult | undefined>((settle) => {
        ready({ confirmationTitle: title });
        const toolCall = row ?? { toolCallId: id, toolName: event.toolName, displayName };
        const entry: Bag = { id, chat: start.chatUri, kind: 'toolConfirmation', turnId, toolCall };
        pending.set(id, {
          id,
          entry,
          settle,
          // A client's tool is asked for the same way as any other call that
          // writes, and it is the client that runs it once the person allows
          // it - the same open an unasked call gets at its own running ready.
          ...(owner === undefined
            ? {}
            : { open: () => { openClientCall(id, event.toolName, turnId, describe(displayName, input), input); } }),
        });
        emit('session', { type: 'session/inputNeededSet', request: entry });
        doing(`Waiting on you: ${displayName}`);
        touch();
      });
    }
    ready({ confirmed: 'not-needed' });
    openClientCall(id, event.toolName, turnId, describe(displayName, input), input);
    return decided;
  };

  const schemaOf = (): Bag => ({
    type: 'object',
    properties: {
      projectTrust: {
        scope: 'session',
        type: 'string',
        title: 'Project resources',
        description: "Whether this project's own pi extensions, skills and prompts are loaded.",
        enum: ['trust', 'deny'],
        // Not while it runs: the resources are read when pi opens, and a value
        // taken after that would say something the session is not doing.
        sessionMutable: false,
      },
      permissionMode: permissionModeProperty(),
    },
  });

  /** Seal the turn being watched, which is what makes a transcript turns. */
  const seal = (state: WatchedTurn['state'], duration: number): void => {
    if (watched === undefined) return;
    watched.state = state;
    watched.duration = Number.isFinite(duration) ? duration : 0;
    watched = undefined;
  };

  /**
   * The file each open `edit` or `write` call named, by pi's own call id.
   *
   * A call is announced with `before` and finished with `after`, and the id is
   * all `tool_execution_end` carries; an entry still here when the turn
   * ends is a call that never reported its end.
   */
  const editing = new Map<string, string>();

  /** A writing call is about to run: report the file as it is now. */
  const announceEdit = (callId: string, path: string): void => {
    editing.set(callId, path);
    start.onFileEdit?.(String(active?.id ?? ''), path, 'before');
  };

  /** The `after` a call owes, once. */
  const settleEdit = (callId: string): void => {
    const path = editing.get(callId);
    if (path === undefined) return;
    editing.delete(callId);
    start.onFileEdit?.(String(active?.id ?? ''), path, 'after');
  };

  /**
   * End the running turn, whoever ended it.
   *
   * pi says a run is over twice - `agent_end` and then `agent_settled` - and
   * only the second means nothing more is coming, so the turn is closed on
   * the settle and this is called once.
   */
  const finish = (ending: 'complete' | 'cancelled' | 'error', why?: string): void => {
    const turn = active;
    if (turn === undefined) return;
    const turnId = String(turn.id);
    // A call cut off before its end still owes the `after` it was announced with.
    for (const callId of [...editing.keys()]) settleEdit(callId);
    doing(undefined);
    /*
     * A call the model was still writing when the turn ended is one pi never
     * runs, and a client's reducer skips it on the turn's end; the snapshot
     * says the same, or a reload shows it streaming forever.
     */
    for (const part of turn.responseParts as Bag[]) {
      const row = part.kind === 'toolCall' ? bag(part.toolCall) : undefined;
      if (row?.status !== 'streaming') continue;
      row.status = 'cancelled';
      row.reason = 'skipped';
      row.invocationMessage = row.invocationMessage ?? row.displayName;
    }
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    turn.state = ending;
    turn.duration = duration;
    turns.push(turn);
    seal(ending, duration);
    // Before the ending action, not after: the host reads `status()` as it
    // passes that action on, and a turn still active there reads as running.
    active = undefined;
    mapping = undefined;
    cancelled = false;
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration });
    else {
      const message = why === undefined || why === '' ? 'pi did not answer' : why;
      failed = message;
      emit('chat', {
        type: 'chat/error',
        turnId,
        duration,
        part: { kind: 'error', error: { errorType: 'turnFailed', message } },
      });
    }
    touch();
    startNext();
  };

  /** Everything pi says while a turn runs, turned into what a client reads. */
  const heard = (event: AgentSessionEvent): void => {
    const said = activityOf(event);
    if (said !== false) doing(said);

    // Each new answer replaces the last, so a retried error is forgotten the
    // moment the retry answers.
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      answered = event.message;
      /*
       * What a turn used is every call it made, and a call is a message of its
       * own, so this one adds to what the earlier ones used and sends the sum.
       * A turn that runs tools spends most of what it costs between its first
       * and its last call, so the total is sent as it stands rather than only
       * at the settle. A call that used nothing hands the sum back as it was,
       * and then nothing is sent for it.
       */
      const sum = addUsage(spent, event.message);
      if (sum !== undefined && sum !== spent && active !== undefined) {
        spent = sum;
        active.usage = sum;
        if (watched !== undefined) watched.usage = sum;
        emit('chat', { type: 'chat/usage', turnId: String(active.id), usage: sum });
      }
    }

    if (mapping !== undefined) {
      for (const action of mapEvent(mapping, event)) emit('chat', action);
    }

    switch (event.type) {
      /*
       * pi's own name for the conversation, which a person may have set from
       * its terminal. It is the session's title here, and the host decides
       * whether that goes out as the session's or a peer chat's.
       */
      case 'session_info_changed': {
        const named = event.name;
        if (named === undefined || named === '' || named === title) return;
        title = named;
        if (record !== undefined) record.title = named;
        emit('session', { type: 'session/titleChanged', title });
        touch();
        return;
      }

      /*
       * The level moved, which is a value in force rather than a turn part:
       * pi can change it itself, and a client that drew the form should see
       * where it actually sits.
       */
      case 'thinking_level_changed': {
        settings.thinkingLevel = event.level;
        emit('session', { type: 'session/configChanged', values: { ...settings } });
        return;
      }

      /*
       * A run that pi will retry itself is not a turn that ended. `willRetry`
       * is exactly that case, and closing the turn on it would draw a finished
       * answer that is about to be replaced.
       */
      case 'agent_end': {
        if (event.willRetry) doing('Retrying');
        return;
      }

      /** A file pi's `edit` or `write` is about to change, by the path pi resolves. */
      case 'tool_execution_start': {
        const path = bag(event.args).path;
        if (!EDITS.has(event.toolName) || typeof path !== 'string' || path === '') return;
        announceEdit(event.toolCallId, resolve(where, piPath(path)));
        return;
      }

      case 'tool_execution_end': {
        settleEdit(event.toolCallId);
        return;
      }

      /** Nothing more is coming. This is where a turn actually ends. */
      case 'agent_settled': {
        // Recorded before `finish` seals the turn, so a truncation asked for
        // the moment the turn appears already has the point it cuts to.
        if (active !== undefined && live !== undefined) {
          const at = live.leaf();
          if (at !== undefined) ends.set(String(active.id), at);
        }
        // Before the ending action: a client hangs usage on the turn it is
        // ending, and the ending is what moves that turn into the history.
        // The sum of the calls is already what it sent as it stood; what ends
        // the turn is the whole of it.
        if (spent !== undefined && active !== undefined) {
          active.usage = spent;
          if (watched !== undefined) watched.usage = spent;
          emit('chat', { type: 'chat/usage', turnId: String(active.id), usage: spent });
        }
        if (cancelled) finish('cancelled');
        else if (answered?.stopReason === 'error') finish('error', answered.errorMessage);
        else finish('complete');
        return;
      }

      default:
        return;
    }
  };

  /**
   * Build pi for this session, over the tools currently on offer.
   *
   * `first` distinguishes the session's own opening from a rebuild after the
   * tools changed: only the first applies the configured model and a
   * truncation, because a rebuilt session continues one and keeps what it
   * already chose.
   */
  const build = async (resume: string | undefined, first: boolean): Promise<PiBackend> => {
    // One cut at a time, refused before pi is asked for
    // either: a fork writes a session file of its own, and a refused one would
    // leave it behind.
    if (first && start.forkAt !== undefined && start.rewindAt !== undefined) {
      throw new Error('pi: a session cannot fork and rewind at once');
    }
    const trust = settings.projectTrust ?? options.projectTrust ?? 'trust';
    // What this backend is built with, so a turn it runs judges owner and
    // effects against the list pi was handed and not one a client changed
    // while the turn ran.
    const building = [...offering];
    built = building;
    const tools = (await Promise.all(building.map((one) => toPiTool(one, ranByClient))))
      .flatMap((tool) => (tool === undefined ? [] : [tool]));
    // An empty entry is not an instruction, and pi would put a blank paragraph
    // in the system prompt for one.
    const instructions = (start.instructions ?? []).filter((one) => one.trim() !== '');
    const backend = await open({
      cwd: where,
      ...(resume !== undefined ? { resume } : {}),
      // Only the first open forks: a rebuild continues the copy it made.
      ...(first && resume !== undefined && start.forkAt !== undefined ? { forkAt: start.forkAt } : {}),
      ...(first && resume === undefined && isUuid(idFor(start.uri)) ? { id: idFor(start.uri) } : {}),
      ...(options.sessionDir !== undefined ? { sessionDir: options.sessionDir } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(instructions.length > 0 ? { instructions } : {}),
      // The inline extension pi loads is this host's, and this is the handler
      // it calls before a tool runs.
      onToolCall: askBefore,
      /*
       * Both have to say yes. `projectTrust` is this session's own answer and
       * can only narrow: a folder the host did not vouch for loads none of its
       * own extensions or settings however the session is configured, and an
       * absent `Start.trusted` is the host having said nothing, which is the
       * same answer - decision
       * `a-folder-is-untrusted-until-a-client-says-otherwise`.
       */
      trustProject: trust !== 'deny' && start.trusted?.(where) === true,
    });
    live = backend;
    unsubscribe = backend.subscribe(heard);
    record = watch(provider, {
      id: backend.id,
      title,
      // A rebuild continues the same conversation, so its creation time stays
      // the one already recorded rather than the moment pi was replaced.
      createdAt: record?.createdAt ?? modified,
      modifiedAt: modified,
      directory: where,
      turns: watchedTurns,
    });
    // The model list is held for `Session.models()`, which the host reads for
    // a client; pi only knows it once its runtime exists.
    const available = await backend.models();
    models = available.map(listed);
    if (first) {
      /*
       * The model the configuration names, when nobody has chosen one.
       *
       * A resumed or forked session keeps the model its own file recorded,
       * and pi's own current model when the option is left out. A turn's own
       * choice arrives in `begin` after this and still wins.
       */
      if (options.model !== undefined && start.resume === undefined && start.forkAt === undefined) {
        await backend.choose(options.model);
      }
      // `rewindAt` is the host asking for a truncation on a resumed session.
      if (start.rewindAt !== undefined) {
        /*
         * pi can refuse the move - an extension's `session_before_tree`
         * handler cancels it - and the session would then run on the leaf it
         * was resumed at. Failing the turn says that rather than answering
         * from a conversation the person asked to be rid of.
         */
        const moved = await backend.rewind(start.rewindAt);
        if (!moved) throw new Error('pi refused to move the leaf back to the truncation point');
      }
      // The host learns this agent's models from here; a rebuild lists the
      // same ones, so only the first open says so.
      start.onHandshake?.();
    }
    return backend;
  };

  /** Open pi, once, however many callers arrive at the same moment. */
  const opened = async (): Promise<PiBackend> => {
    if (opening !== undefined) return opening;
    const started = build(start.resume, true);
    opening = started;
    try {
      return await started;
    }
    catch (error: unknown) {
      /*
       * A first open that failed leaves nothing live, so the next turn opens
       * pi again rather than reusing the rejection. A refused rewind is this
       * case: the truncation the client asked for is tried again.
       */
      if (opening === started) opening = undefined;
      const abandoned: unknown = live;
      if (abandoned !== undefined) (abandoned as PiBackend).close();
      live = undefined;
      throw error;
    }
  };

  /**
   * Replace pi with one built over the tools now on offer.
   *
   * pi fixes its custom tools when the session is built, so a tool a client
   * announced after it opened reaches the model only through a new session on
   * the same file. The subscription, the record and the model list move to the
   * new backend before the turn runs, and it continues on the model and
   * thinking level the conversation was on.
   */
  const reopen = async (previous: PiBackend): Promise<PiBackend> => {
    const id = previous.id;
    // Read before closing: the new session has its own model until told.
    const carrying = previous.chosen();
    unsubscribe?.();
    unsubscribe = undefined;
    previous.close();
    live = undefined;
    stale = false;
    const rebuilt = build(id, false);
    opening = rebuilt;
    try {
      const backend = await rebuilt;
      if (carrying !== undefined) await backend.choose(carrying.id, carrying.config);
      return backend;
    }
    catch (error: unknown) {
      // Nothing is live after a failed rebuild, so the next turn opens again.
      const abandoned: unknown = live;
      if (abandoned !== undefined && abandoned !== previous) (abandoned as PiBackend).close();
      live = undefined;
      if (opening === rebuilt) opening = undefined;
      throw error;
    }
  };

  /** Start a turn, once there is nothing else running. */
  const begin = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    queuedMessageId?: string,
    attachments?: MessageAttachment[],
  ): void => {
    failed = undefined;
    cancelled = false;
    answered = undefined;
    spent = undefined;
    const startedAt = new Date().toISOString();
    /*
     * The model this turn runs on, so a client that reopens the chat can show
     * the one it used. A turn's own choice wins, then the model the session is
     * already on, then the one the configuration names.
     */
    const ran = model?.id ?? live?.chosen()?.id ?? options.model;
    const message: Bag = {
      text,
      ...(from?.origin !== undefined ? { origin: from.origin } : { origin: { kind: 'user' } }),
      ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      // Kept on the turn's own message, so a client reopening the chat reads
      // the picture beside the words the turn was accepted with.
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      ...(ran !== undefined
        ? { model: { id: ran, ...(model?.config !== undefined ? { config: model.config } : {}) } }
        : {}),
    };
    // No part yet: each is opened when pi starts writing the block it holds.
    active = {
      id: turnId,
      startedAt,
      message,
      responseParts: [],
      state: 'running',
    };
    mapping = {
      turnId,
      messages: 0,
      blocks: new Map(),
      waiting: new Map(),
      parts: active.responseParts as Bag[],
      calls: new Map(),
      ownerOf: clientOf,
    };
    watched = { turnId, startedAt, message, parts: active.responseParts as Bag[], state: 'complete' };
    watchedTurns.push(watched);

    if (title === UNTITLED) {
      title = titleFrom(text);
      if (record !== undefined) record.title = title;
      emit('session', { type: 'session/titleChanged', title });
    }

    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt,
      message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    doing('Thinking');
    touch();

    void (async () => {
      try {
        let backend = await opened();
        // pi fixes its custom tools when it is built, so a change made since
        // means a rebuilt pi on the same file before this turn runs.
        if (stale) backend = await reopen(backend);
        if (model !== undefined) {
          /*
           * A turn that named a model pi does not have is not answered by
           * whatever the session was on before: it asked for that model, and
           * the model is left where it was for the next turn. The catch below
           * turns this into the turn's error, before anything is prompted.
           */
          if (!await backend.choose(model.id, model.config)) {
            throw new Error(`pi has no model ${model.id}`);
          }
        }
        const asked = await promptFor(text, attachments, backend.takesImages());
        await backend.prompt(asked.text, asked.images);
        /*
         * `prompt` settling is not the turn ending: pi raises `agent_settled`
         * for that, and the two are not the same moment when it retries. So
         * nothing is closed here, and a turn that settled already has been.
         */
      }
      catch (error) {
        finish('error', error instanceof Error ? error.message : String(error));
      }
    })();
  };

  /** Whatever was waiting, once the turn in front of it is done. */
  const startNext = (): void => {
    if (closed || active !== undefined) return;
    const next = queued.shift();
    if (next === undefined) return;
    const id = String(next.id);
    emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
    const command = bag(next.command);
    if (typeof command.text === 'string') {
      // A `!command` that waited. What waited is the command, not its text, so
      // it is run rather than asked about.
      runCommand(id, String(command.text), command.run as (toolCallId: string) => Promise<Ran>);
      return;
    }
    begin(
      id,
      String(bag(next.message).text ?? ''),
      next.model as Chosen | undefined,
      undefined,
      id,
      attachmentsOf(next.message),
    );
  };

  /**
   * A person's `!command`, run by the host in one of its own shells.
   *
   * pi has a shell of its own, but this turn is not pi's: the person asked the
   * host to run something, and the host owns the terminal a client watches.
   */
  const runCommand = (turnId: string, command: string, run: (toolCallId: string) => Promise<Ran>): void => {
    const startedAt = new Date().toISOString();
    const toolCallId = `${turnId}:shell`;
    const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
    const part: Bag = {
      id: toolCallId,
      kind: 'toolCall',
      toolCall: { toolCallId, toolName: 'shell', displayName: command, status: 'running' },
    };
    active = { id: turnId, startedAt, message, responseParts: [part], state: 'running' };
    mapping = undefined;
    emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message });
    emit('chat', {
      type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'shell', displayName: command,
    });
    const held = bag(part.toolCall);
    held._meta = withCallTimes(bag(held._meta), callTimes(Date.now()));
    emit('chat', {
      type: 'chat/toolCallReady',
      turnId,
      toolCallId,
      invocationMessage: command,
      confirmed: 'not-needed',
      toolInput: JSON.stringify({ command }),
      _meta: held._meta,
    });
    doing(`Running ${command}`);

    void run(toolCallId).then((ran) => {
      held.status = 'completed';
      held.success = ran.success;
      held.pastTenseMessage = ran.said;
      held._meta = withCallTimes(bag(held._meta), callTimes(startOf(held._meta) ?? Date.now(), Date.now()));
      emit('chat', {
        type: 'chat/toolCallComplete',
        turnId,
        toolCallId,
        _meta: held._meta,
        result: {
          success: ran.success,
          pastTenseMessage: ran.said,
          ...(ran.output === '' ? {} : { content: [{ type: 'text', text: ran.output }] }),
          ...(ran.success
            ? {}
            : { error: { message: ran.code === undefined ? ran.said : `Exited ${ran.code}` } }),
        },
      });
      finish('complete');
    }).catch((error: unknown) => {
      finish('error', error instanceof Error ? error.message : String(error));
    });
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    models: () => models,
    agentId: () => live?.id,
    // A fork copies the conversation through the turn it names, answer
    // included, so it cuts where the turn ended rather than where it began.
    forkPoint: (turnId) => ends.get(turnId),
    endPoint: (turnId) => ends.get(turnId),
    customizations: () => [...seeds],
    allTurns: () => turns,

    status,
    activity: () => activity,
    title: () => title,
    setTitle: (next) => {
      title = next;
      if (record !== undefined) record.title = next;
      // pi keeps a name of its own, so the title survives outside this host -
      // a session renamed here is renamed in `pi` too.
      live?.rename(next);
      touch();
    },
    modifiedAt: () => modified,
    workingDirectories: () => [uriOf(where)],

    sessionState: () => ({
      provider,
      title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title }],
      workingDirectories: [uriOf(where)],
      customizations: [...seeds],
      ...(activity !== undefined ? { activity } : {}),
      // The requests still waiting - the questions and the calls a client has
      // to run - each as `session/inputNeededSet` sent it, so a client that
      // subscribes while one waits can answer it.
      ...(needed().length > 0 ? { inputNeeded: needed() } : {}),
      /*
       * The host's schema when it gave one, which is the same one every other
       * backend publishes.
       *
       * This used to be `schemaOf()` alone, so a key a plugin contributed -
       * the computer a session runs in - never reached a pi session and the
       * window drew no control for it. `start.schema()` is the host's
       * `sessionSchema`, which already carries `projectTrust` from `agent.ts`
       * and a contributed key beside it; `schemaOf()` is the fallback for a
       * session started without one.
       */
      config: { schema: start.schema?.() ?? schemaOf(), values: { ...settings } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title,
      status: status(),
      modifiedAt: modified,
      turns,
      ...(active !== undefined ? { activeTurn: active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: (turnId, text, model, from, attachments) => {
      if (active !== undefined) {
        const message: Bag = {
          text,
          origin: from?.origin ?? { kind: 'user' },
          ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        };
        queued.push({ id: turnId, message, ...(model !== undefined ? { model } : {}) });
        emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id: turnId, message });
        touch();
        return;
      }
      begin(turnId, text, model, from, undefined, attachments);
    },

    ran: (turnId, command, run, queuedAs) => {
      if (active !== undefined || (queuedAs !== undefined && queued.length > 0)) {
        const id = queuedAs ?? turnId;
        const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
        const entry: Bag = { id, command: { text: command, run }, message };
        const at = queued.findIndex((held) => String(held.id) === id);
        if (at >= 0) queued[at] = entry; else queued.push(entry);
        emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
        touch();
        return;
      }
      // Taken out of the client's queue the way `startNext` takes one out.
      if (queuedAs !== undefined) emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id: queuedAs });
      runCommand(turnId, command, run);
    },

    /**
     * A message into the turn that is already running.
     *
     * pi's own `steer`, so this is the thing the protocol means rather than a
     * queued message dressed as one. False when there is nothing to steer,
     * which the host turns into a refusal rather than an ordinary message.
     */
    steer: (id, text, attachments) => {
      void id;
      const backend = live;
      if (active === undefined || backend === undefined) return false;
      // Built the way the turn's own prompt is, so a picture pasted into a
      // correction reaches pi as one when the model takes it.
      void promptFor(text, attachments, backend.takesImages())
        .then((asked) => backend.steer(asked.text, asked.images))
        .catch((error: unknown) => {
          emit('chat', {
            type: 'chat/error',
            turnId: String(bag(active).id ?? ''),
            part: {
              kind: 'error',
              error: { errorType: 'turnFailed', message: error instanceof Error ? error.message : String(error) },
            },
          });
        });
      touch();
      return true;
    },

    cancel: (turnId) => {
      if (active === undefined || String(bag(active).id) !== turnId) return;
      cancelled = true;
      doing('Stopping');
      // What a client was running for this turn is not coming back, so pi is
      // told the calls failed rather than left waiting on a stopped turn.
      calls.release('The turn was stopped');
      // A question nobody can answer any more is answered the same way.
      releasePending('The turn was stopped');
      // The turn is closed on pi's settle rather than here, so what it had
      // already said stays in the transcript.
      void live?.abort().catch(() => { finish('cancelled'); });
    },

    queue: (id, text, model, from, attachments) => {
      const message: Bag = {
        text,
        origin: from?.origin ?? { kind: 'user' },
        // Held with the message, so a picture pasted into one that waits is
        // still a picture when its turn comes.
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      const at = queued.findIndex((held) => String(held.id) === id);
      const entry: Bag = { id, message, ...(model !== undefined ? { model } : {}) };
      if (at >= 0) queued[at] = entry; else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
      touch();
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => String(held.id) === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    setDraft: (next) => {
      draft = next;
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    reorder: (order) => {
      const moved: Bag[] = [];
      for (const id of order) {
        const at = queued.findIndex((held) => String(held.id) === id);
        if (at >= 0) moved.push(...queued.splice(at, 1));
      }
      queued.unshift(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: queued.map((held) => String(held.id)) });
    },

    /*
     * A person's answer to a call that was shown `pending-confirmation`.
     *
     * Found by id rather than assumed to be the only one: two calls can wait
     * at once, and answering one must not answer the other.
     */
    confirm: (toolCallId, approved) => {
      const held = pending.get(toolCallId);
      if (held === undefined) return;
      pending.delete(toolCallId);
      emit('session', { type: 'session/inputNeededRemoved', id: held.id });
      const toolCall = bag(held.entry.toolCall);
      const part = mapping?.parts.find((one) => one.id === toolCallId);
      let times: Bag | undefined;
      if (part !== undefined) {
        const row = bag(part.toolCall);
        row.status = approved ? 'running' : 'cancelled';
        if (approved) row.confirmed = 'user-action';
        /*
         * A call starts running now, and not at the `tool_execution_start`
         * that came before the question: the wait for a person is not work. A
         * call refused never runs, so it loses the start it was given.
         */
        times = approved
          ? withCallTimes(bag(row._meta), callTimes(Date.now()))
          : untime(row);
        row._meta = times;
      }
      emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: String(held.entry.turnId ?? (active === undefined ? '' : active.id)),
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' as const } : { reason: 'denied' as const }),
        // The whole bag, because an action's `_meta` replaces the call's.
        ...(times === undefined || Object.keys(times).length === 0 ? {} : { _meta: times }),
      });
      // Said back like every other action a client originates. Nothing in a
      // client applies its own dispatch, so a row approved here would stay
      // pending on every screen watching it, including the answering one.
      if (approved) doing(`Running ${String(toolCall.displayName ?? '')}`);
      else doing('Thinking');
      // An allowed call is one a client now has to run, so it is asked here.
      if (approved) held.open?.();
      held.settle(approved ? undefined : { block: true, reason: DECLINED });
      touch();
    },
    answer: () => false,

    toolCallOwner: (toolCallId) => calls.owner(toolCallId),

    /*
     * What a client says its own tool did.
     *
     * Only from the client the call was reported against: the protocol makes
     * that one responsible for the call, and a result from anybody else is a
     * client answering for work it did not do. Nothing is emitted here: pi's
     * own `tool_execution_end` reports the completion through the path every
     * other call takes, and a completion announced here as well would be the
     * same row finished twice.
     */
    completeToolCall: (toolCallId, clientId, result) =>
      calls.complete(toolCallId, clientId, result),

    clientGone: (clientId) => {
      // A call whose client has gone is a turn waiting on a promise nothing
      // will settle. The agent is told it failed, which is true.
      calls.gone(clientId);
    },

    /**
     * The tools on offer, replaced whole.
     *
     * Held and used for the next build. Before pi has opened it is simply what
     * `opened` will offer; once pi is open the session is rebuilt on the same
     * file before the next turn, because pi fixes its custom tools when the
     * session is built.
     */
    setTools: async (next) => {
      const key = (list: BoundTool[]): string => list
        .map((one) => `${one.definition.name}\u0000${one.owner ?? ''}`)
        .join('\n');
      if (key(offering) === key(next)) return true;
      offering = [...next];
      // A backend already built or being built holds the old list; the next
      // turn rebuilds it. Nothing built yet just takes the new list.
      if (opening !== undefined || live !== undefined) stale = true;
      return true;
    },

    setConfig: async (key, value) => {
      if (key === 'projectTrust') {
        if (value !== 'trust' && value !== 'deny') return 'projectTrust is "trust" or "deny"';
        settings[key] = value;
        return true;
      }
      if (key === 'permissionMode') {
        if (typeof value !== 'string' || !(PERMISSION_MODES as readonly string[]).includes(value)) {
          return `permissionMode is one of ${PERMISSION_MODES.join(', ')}`;
        }
        settings[key] = value;
        return true;
      }
      return `pi sessions have no "${key}" setting`;
    },
    settings: () => ({ ...settings }),

    /*
     * pi's extensions and skills are loaded when it opens and have no runtime
     * switch, and its MCP servers are an extension's business rather than
     * pi's. False and false are the real answers, and a control that reported
     * success and changed nothing would be worse.
     */
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    close: () => {
      closed = true;
      calls.release('The turn was stopped');
      releasePending('The turn was stopped');
      unsubscribe?.();
      unsubscribe = undefined;
      live?.close();
      live = undefined;
      opening = undefined;
    },
  };
}
