/**
 * One pi conversation, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one embedded `AgentSession` behind a turn, and the lifecycle
 * around the translation in `mapping.ts`.
 *
 * What pi gives this bridge for free, and what it does not:
 *
 * - **Steering** is pi's own `steer()`: a message mid-turn goes into the turn
 *   pi is running, read before its next step.
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
import { bag, createClientCalls, ensureWorkspacelessScratchDir, idFor, mergeLogicalTurnUsage, partsOf, reason, statusOf, titleFrom, uriOf } from '@ahpd/sdk';
import type {
  Bag, BoundTool, Chosen, MessageAttachment, MessageFrom, Session, Start, StatusBits, ToolEffects, TurnOptions,
} from '@ahpd/sdk';
import type { AgentSessionEvent, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai';
import { openPi } from './backend.js';
import type { BackendOptions, PiBackend } from './backend.js';
import { watch } from './catalog.js';
import { piCustomizations, switchedOffPaths } from './customizations.js';
import type { PiResources } from './customizations.js';
import { addUsage, callPartOf, describe, mapEvent, readyRow, stampStart, untime } from './mapping.js';
import { listed } from './models.js';
import { replayed } from './replay.js';
import type { ReplayPi } from './replay.js';
import { toPiTool } from './tools.js';
import type { PiOptions, PiTurn, WatchedSession, WatchedTurn } from './types.js';
import { MESSAGE_ENTRY, modeOf, PERMISSION_MODES, permissionModeProperty, UNTITLED } from './types.js';

/** The space characters pi folds to a plain space before it reads a path. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * pi's two tools that write a named file. Nothing else reports an edit: a
 * shell writes without naming one.
 */
const EDITS = new Set(['edit', 'write']);

/**
 * The fields of a record a turn reads again, copied onto the turn's options.
 *
 * `sessionDir` is not here: it is where a conversation is written, and moving
 * it under a running session would start a second file rather than continue
 * this one. `model` and `env` apply at the turn itself; `projectTrust` is read
 * where pi opens, which is when a project's resources are loaded, so an edit of
 * it applies at the next open and not to one already running.
 */
const LIVE_KEYS = ['model', 'env', 'projectTrust'] as const;

/**
 * How pi is opened for a session.
 *
 * The default opens the embedded pi this package ships; a caller may pass its
 * own, and then the whole turn lifecycle runs against that backend.
 */
export type OpenPi = (options: BackendOptions) => Promise<PiBackend>;

/**
 * A message, as pi's `prompt` and `steer` take it: one text, and its images.
 *
 * `partsOf` decides which attachment is an image, which is an inlined text and
 * which is named by its path, within the limits every backend shares. pi takes
 * a single text, so the parts that are text - what was said, an inlined
 * attachment, the reference block - are joined with a blank line, in the order
 * the client attached them.
 *
 * `supportsVision` is the model the turn runs on, so a picture goes as bytes
 * only where pi's model takes one. Everywhere else the helper names it by path.
 */
const promptFor = async (
  text: string,
  attachments: MessageAttachment[] | undefined,
  supportsVision: boolean,
): Promise<{ text: string; images: ImageContent[] }> => {
  if (attachments === undefined || attachments.length === 0) return { text, images: [] };
  const parts = await partsOf(text, attachments, { images: supportsVision });
  const texts: string[] = [];
  const images: ImageContent[] = [];
  for (const part of parts) {
    if (part.type === 'image') images.push({ type: 'image', data: part.data, mimeType: part.mimeType });
    else texts.push(part.text);
  }
  return { text: texts.join('\n\n'), images };
};

/** A turn handed while pi ran another: what `sendMessage` was handed. */
interface PendingTurn {
  turnId: string;
  text: string;
  model?: Chosen | undefined;
  from?: MessageFrom | undefined;
  attachments?: MessageAttachment[] | undefined;
  options?: TurnOptions | undefined;
}

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
  /*
   * The folder pi opens in: the host's when it named one, and a scratch folder
   * of the session's own otherwise, as VS Code's agents run a session with no
   * workspace.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1564-L1570
   */
  const where = start.workingDirectory ?? ensureWorkspacelessScratchDir(start.uri);

  /**
   * Read the record again, when this backend was opened for one.
   *
   * The view the kind was handed is live: an edit replaces what `config`
   * answers, so this is what makes it the next turn's rather than the turn
   * before's. `sessionDir` and `open` are not copied - see `LIVE_KEYS`.
   *
   * A record's key is in `env` here, already read from the vault by the
   * channel. It goes to pi's runtime and nowhere else: nothing in this package
   * writes the options, or an error about them, anywhere a person reads.
   */
  const refreshOptions = (): void => {
    const now = options.recordOf?.();
    if (now === undefined) return;
    const holding = options as unknown as Record<string, unknown>;
    const read = now as unknown as Record<string, unknown>;
    for (const key of LIVE_KEYS) {
      if (read[key] === undefined) delete holding[key];
      else holding[key] = read[key];
    }
  };

  /**
   * The model the record named as of the turn before.
   *
   * What tells an edit from the model pi is already on: a record's model is the
   * one the session runs on when nobody chooses, so a change of it moves pi at
   * the next turn, and the same value said again is not a second move.
   */
  let recordedModel = options.model;

  /** The config values in force, by key, which `setConfig` moves and each turn reads. */
  const values: Record<string, unknown> = { ...start.settings };
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
  /*
   * pi's own skills, prompt templates and extensions, as the last pi built for
   * this session found them, and the ids of those this session switched off.
   */
  let found: PiResources | undefined;
  let own: Bag[] = [];
  const off = new Set<string>();
  /** The list as this session last said it. */
  let saidCustomizations = JSON.stringify(seeds);
  let active: Bag | undefined;
  /** The running turn's mapping, so an event knows what it belongs to. */
  let mapping: PiTurn | undefined;
  let live: PiBackend | undefined;
  /** The entry the conversation ended at when the running turn prompted, which its prompt follows. */
  let promptedAfter: string | undefined;
  /**
   * Whether the running turn is one `resume` reopened. Its prompt was named
   * when it first ended, or it was read from pi's file under that name, so
   * there is nothing to name again.
   */
  let resumed = false;
  /** The one opening, shared by every caller, so one pi is built. */
  let opening: Promise<PiBackend> | undefined;
  /** Whether the tools changed since pi was built, so it is rebuilt next turn. */
  let stale = false;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let cancelled = false;
  /**
   * The turns handed while pi still ran another, in the order they came, each
   * run once the turn in front of it is over, as the reference agent runs each
   * send after the one before it: pi runs one prompt at a time. The host said
   * each start, so the turn it took the place of runs on here.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
   */
  const pendingTurns: PendingTurn[] = [];
  /** The turn whose prompt pi has been handed, which steering goes into. */
  let prompted: string | undefined;
  /** Whether the running turn's message is in pi's file, ahead of its prompt. */
  let kept = false;
  /** The turns a later one took the place of, which run on and end in no history. */
  const replaced = new Set<string>();
  let title = UNTITLED;

  /**
   * Whether a person has named this session.
   *
   * pi reports a rename of its own back as `session_info_changed`, so this is
   * what tells a name somebody chose from one the agent gave: the agent's
   * replaces a title derived from the first message, and never a person's.
   */
  let renamed = false;
  /** Whether the title is one a local command suggested, which the first real message replaces. */
  let provisional = false;
  /**
   * The running turn's earlier time and usage when a client resumed it, and
   * when it ran again, so the turn holds its time and usage across both runs.
   */
  let resumedFrom: { duration: number; at: number; usage: Bag | undefined } | undefined;
  let modified = new Date().toISOString();
  /** What a turn failed with, or nothing. Cleared when a turn starts. */
  let error: string | undefined;
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
  let usage: Bag | undefined;
  /**
   * The steering messages handed to pi and not yet read, by id, oldest first,
   * each with the answer its hand-off is waiting on: VS Code's submitted
   * steering.
   *
   * pi holds them in the order they were handed and says the queue on every
   * change, so the ones its queue no longer counts are the oldest here.
   */
  const submittedSteering: string[] = [];
  const answers = new Map<string, (taken: boolean) => void>();
  let draft: Bag | undefined;
  /** The models pi reported, once it has been asked, as the spec's model info. */
  let models: ReturnType<typeof listed>[] = [];
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
   * watched turn. A turn this session watched keeps the end it saw. The agent
   * reads them before it builds the session, so a file that cannot be read
   * fails the start, and hands them in through `replay`.
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
  /** The running turn's record in `watchedTurns`, sealed when the turn ends. */
  let turn: WatchedTurn | undefined;

  /**
   * A steering message pi read into the turn, VS Code's consumed steering:
   * taken out of the chat, its hand-off answered `true`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1624-L1626
   */
  const steeringConsumed = (id: string): void => {
    emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id });
    answers.get(id)?.(true);
    answers.delete(id);
  };

  /**
   * The steering messages pi still holds when the turn they went into ends,
   * handed back: their hand-offs answer `false`, for the host to steer the turn
   * that runs then or run them next, as the reference agent hands back a
   * steering message whose turn ended first. pi is told to let them go first,
   * so its queue says nothing of them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1949
   */
  const handBack = (): void => {
    const left = submittedSteering.splice(0);
    if (left.length === 0) return;
    live?.clearSteering();
    for (const id of left) {
      answers.get(id)?.(false);
      answers.delete(id);
    }
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

  /** The client that provides a tool, by the name pi calls it: the spec's contributor of its call. */
  const contributorOf = (toolName: string): string | undefined =>
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
    const owner = contributorOf(toolName);
    if (owner === undefined) return;
    // The name the client announced, off the `<clientId>__<name>` the model was
    // offered, which the call's row is named and drawn by too.
    const announced = toolName.slice(owner.length + 2);
    calls.open({
      turnId,
      owner,
      toolCall: {
        toolCallId: id,
        toolName: announced,
        displayName: announced,
        invocationMessage: line,
        confirmed: 'not-needed',
        toolInput: JSON.stringify(input),
      },
    });
  };

  /**
   * Calls waiting on a person, by pi's call id.
   *
   * A map because a turn can ask twice at once: the protocol's `inputNeeded`
   * is a list and `session/inputNeededSet` matches by id.
   */
  const pending = new Map<string, {
    id: string;
    /** pi's name for the call's tool, which a refusal names. */
    toolName: string;
    entry: Bag;
    settle: (answer: ToolCallEventResult | undefined) => void;
    /** Ask the client to run the call, for a call the person then allows. */
    open?: () => void;
  }>();

  /** The requests a client can still answer: the person's, and the clients'. */
  const needed = (): Bag[] => [...pending.values()].map((one) => one.entry).concat(calls.entries());

  /**
   * Cancel every question still waiting, so pi does not wait for ever.
   *
   * Nobody answered them, so nothing is said in anybody's name: the turn's
   * end forces each call to cancelled, `skipped`, in every client's state, as
   * it does here, and the reference host's chat draws a call its turn left
   * behind as skipped rather than as one a person turned down.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
   *
   * A stop's entries follow the chat's state: the host said the stop that
   * ended the turn and took down every entry of the chat that no longer
   * stands, as VS Code's host keeps a session's entries by its chats' state. A
   * close ends no turn, so `takeDown` takes each entry down here.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L120-L130
   */
  const releasePending = (why: string, takeDown: boolean): void => {
    for (const [id, held] of [...pending.entries()]) {
      pending.delete(id);
      const part = mapping === undefined ? undefined : callPartOf(mapping, id);
      if (part !== undefined) {
        Object.assign(bag(part.toolCall), { status: 'cancelled', reason: 'skipped' });
        // The question was cancelled, so the call never ran: the start
        // `tool_execution_start` gave it is forgotten with it.
        untime(bag(part.toolCall));
      }
      if (takeDown) emit('session', { type: 'session/inputNeededRemoved', id });
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
   * Whether the owner's rules already allow this shell call.
   *
   * The host answers from the rules the window that started this session
   * pushed, and only an approval reaches here: a rule that denied the line, a
   * line no rule could read and a host that says nothing all answer
   * `undefined`, and the question is put as it always was. `bash` and
   * `powershell` are pi's two shells and the check's two, and each carries its
   * own rules; the command is the one the model wrote, which is the input pi
   * is about to run. A call whose input names no command line is not one the
   * check can read, so it asks.
   */
  const allowedByRule = async (toolName: string, input: Bag): Promise<boolean> => {
    const shell = toolName === 'bash' ? 'bash' : toolName === 'powershell' ? 'powershell' : undefined;
    const command = input.command;
    if (shell === undefined || typeof command !== 'string') return false;
    return (await start.getAutoApproval?.('shell', command, shell)) === 'not-needed';
  };

  /**
   * What to do about one call: run it, ask a person, or refuse it.
   *
   * The operator's rule is read first, by the tool's name, because it is the
   * host's setting rather than a window's: a matched call is `ask` in every
   * mode, `bypassPermissions` included, and `dontAsk`, which never asks,
   * refuses it. Otherwise the modes are the siblings' six. A shell command the
   * owner's rules already allow is taken out of the ones a mode would ask
   * about; the check narrows the questions and adds none, so a mode that
   * refuses a call still refuses it and a mode that runs one still runs it
   * without consulting the rules.
   */
  const decide = async (toolName: string, input: Bag): Promise<ToolCallEventResult | 'ask' | undefined> => {
    // A tool the host offered is `host/<name>` to the rule, the name Claude and
    // ACP give it on the host's MCP server, which VS Code names `host`; pi's
    // own tools keep their own.
    const ruled = offering.some((one) => one.definition.name === toolName) ? `host/${toolName}` : toolName;
    if (start.getAutoApproval?.('tool', ruled) === 'ask') {
      return modeOf(values.permissionMode) === 'dontAsk'
        ? { block: true, reason: `${toolName} would need approval and the mode is dontAsk` }
        : 'ask';
    }
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
    const byMode = (): ToolCallEventResult | 'ask' | undefined => {
      switch (modeOf(values.permissionMode)) {
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
    const decided = byMode();
    // Only an ask is narrowed: a refusal is a mode's answer about the call,
    // and a run is one nobody was going to be asked about.
    if (decided !== 'ask') return decided;
    return (await allowedByRule(toolName, input)) ? undefined : 'ask';
  };

  /*
   * One state, not a set of bits.
   *
   * A call waiting on a person is what the session is doing, ahead of the
   * turn that is running behind it; a running turn is next, whatever it
   * failed with last. The bits are what the rule reads, and the order they
   * win in is the sdk's.
   */
  const bits = (): StatusBits => ({
    waiting: pending.size > 0,
    active: active !== undefined,
    failed: error !== undefined,
  });

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
    const turnId = active === undefined ? '' : String(active.id);
    const part = mapping === undefined ? undefined : callPartOf(mapping, id);
    const row = part === undefined ? undefined : bag(part.toolCall);
    const owner = mapping?.ownerOf?.(event.toolName);
    // The name the row draws: a client's tool by the name the client announced.
    const displayName = owner !== undefined && event.toolName.startsWith(`${owner}__`)
      ? event.toolName.slice(owner.length + 2)
      : event.toolName;
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
        // The whole bag, because an action's `_meta` replaces the call's.
        ...(row?._meta === undefined ? {} : { _meta: row._meta }),
      });
    };

    const decided = await decide(event.toolName, input);
    if (decided === 'ask') {
      const title = `Run ${displayName}?`;
      return await new Promise<ToolCallEventResult | undefined>((settle) => {
        ready({ confirmationTitle: title });
        const toolCall = row ?? { toolCallId: id, toolName: displayName, displayName };
        const entry: Bag = { id, chat: start.chatUri, kind: 'toolConfirmation', turnId, toolCall };
        pending.set(id, {
          id,
          toolName: event.toolName,
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
      });
    }
    /*
     * A refused call is not readied to run, and no client is asked to run it:
     * pi blocks it and closes it failed, as VS Code's host answers a call its
     * permissions deny without readying it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1726-L1734
     */
    if (decided !== undefined) return decided;
    ready({ confirmed: 'not-needed' });
    openClientCall(id, event.toolName, turnId, describe(displayName, input), input);
    return undefined;
  };

  const schemaOf = (): Bag => ({
    type: 'object',
    properties: {
      projectTrust: {
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

  /** Seal the running turn's record, which is what makes a transcript turns. */
  const seal = (state: NonNullable<WatchedTurn['state']>, duration: number): void => {
    if (turn === undefined) return;
    turn.state = state;
    turn.duration = Number.isFinite(duration) ? duration : 0;
    turn = undefined;
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
   * The entry pi wrote the running turn's prompt under, which is the id the
   * turn has when it is read back from pi's file, said to the host.
   *
   * pi writes that entry after its listeners hear the message, so it is read
   * once the turn is over: as the turn ends, however it ends, and as the
   * session closes under a turn still running, which is what a host that stops
   * does. The turn's first prompt names it, as agent-claude names a turn by its
   * first echo, and only a turn pi was handed has one.
   */
  const namePrompt = (): void => {
    if (active === undefined || live === undefined || resumed || prompted !== String(active.id)) return;
    const prompt = live.promptAfter(promptedAfter);
    if (prompt !== undefined && prompt !== String(active.id)) start.onTurnRecorded?.(String(active.id), prompt);
  };

  /**
   * End the running turn, whoever ended it.
   *
   * pi says a run is over twice - `agent_end` and then `agent_settled` - and
   * only the second means nothing more is coming, so the turn is closed on
   * the settle and this is called once.
   *
   * `resumable` marks an error a client may resume: a failed model call, whose
   * reply `resume` can take out of the model's context. A failure before pi had
   * the prompt has no such reply, and is not one.
   *
   * `errorType` is what the error is typed by: pi's own stop reason for a run
   * pi ended in error, as VS Code's agents type a runtime's failure by the
   * runtime's own code, and `sendFailed`, the stage VS Code's host names, for a
   * send that failed before pi had the prompt.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2574
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSdkChatError.ts#L54-L64
   */
  const finish = (ending: 'complete' | 'cancelled' | 'error', why?: string, resumable = false, errorType = 'sendFailed'): void => {
    const ended = active;
    if (ended === undefined) return;
    const turnId = String(ended.id);
    namePrompt();
    // A call cut off before its end still owes the `after` it was announced with.
    for (const callId of [...editing.keys()]) settleEdit(callId);
    /*
     * A call the model was still writing when the turn ended is one pi never
     * runs, and a client's reducer skips it on the turn's end; the snapshot
     * says the same, or a reload shows it streaming forever.
     */
    for (const part of ended.responseParts as Bag[]) {
      const row = part.kind === 'toolCall' ? bag(part.toolCall) : undefined;
      if (row?.status !== 'streaming') continue;
      row.status = 'cancelled';
      row.reason = 'skipped';
      row.invocationMessage = row.invocationMessage ?? row.displayName;
    }
    /*
     * A resumed turn's ending says this run's time alone, which the host adds
     * the run before's to, as VS Code's host says a resumed turn's end; the
     * turn holds its time across both runs.
     */
    const attempt = resumedFrom === undefined ? Date.now() - Date.parse(String(ended.startedAt)) : Date.now() - resumedFrom.at;
    const duration = resumedFrom === undefined ? attempt : resumedFrom.duration + attempt;
    resumedFrom = undefined;
    ended.state = ending;
    ended.duration = duration;
    // A turn a later one took the place of is in no history, as the reducer
    // keeps none of it, and its failure is not the chat's.
    const gone = replaced.delete(turnId);
    if (!gone) turns.push(ended);
    seal(ending, duration);
    // Before the ending action, not after: the host reads `status()` as it
    // passes that action on, and a turn still active there reads as running.
    active = undefined;
    mapping = undefined;
    cancelled = false;
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration: attempt });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration: attempt });
    else {
      const message = why === undefined || why === '' ? 'pi did not answer' : why;
      if (!gone) error = message;
      const part: Bag = {
        kind: 'error',
        error: { errorType, message },
        ...(resumable ? { resumable: true } : {}),
      };
      // On the turn as well, so a snapshot holds what a client that watched the
      // turn end was handed, and a client that reopens the chat can resume it.
      (ended.responseParts as Bag[]).push(part);
      emit('chat', { type: 'chat/error', turnId, duration: attempt, part });
    }
    /*
     * The chat's `modifiedAt` at a turn's end is its start plus its duration,
     * as the protocol's reducer moves it, and a turn a later one took the
     * place of ends in no state. The catalogue's record is dated the same, as
     * a listing dates a session by its last activity.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8204
     */
    if (!gone) {
      modified = new Date(Date.parse(String(ended.startedAt)) + duration).toISOString();
      if (record !== undefined) record.modifiedAt = modified;
    }
    // The steering the turn did not read, and the turn handed behind it, which
    // runs whatever the ending: each send is its own.
    handBack();
    prompted = undefined;
    sendNext();
  };

  /**
   * End the running turn as its last answer says, once nothing more is coming.
   *
   * pi says so with `agent_settled` at the end of its own run. A resumed run is
   * one `resume` started outside that run, which pi raises no settle for, so
   * `resume` calls this itself once the run is over.
   */
  const settle = (): void => {
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
    if (usage !== undefined && active !== undefined) {
      const held = mergeLogicalTurnUsage(resumedFrom?.usage, usage) ?? usage;
      active.usage = held;
      if (turn !== undefined) turn.usage = held;
      emit('chat', { type: 'chat/usage', turnId: String(active.id), usage });
    }
    if (cancelled) finish('cancelled');
    else if (answered?.stopReason === 'error') finish('error', answered.errorMessage, true, answered.stopReason);
    else finish('complete');
  };

  /** Everything pi says while a turn runs, turned into what a client reads. */
  const heard = (event: AgentSessionEvent): void => {
    /*
     * The turn's message as the turn had it, with the model it ran on, kept
     * just before pi writes the turn's prompt: pi writes a message after its
     * listeners hear it, so the entry kept here is the prompt's parent, which
     * is how `replay.ts` pairs them. The turn's own prompt is the first
     * person's message pi says once it has the prompt; a steering message
     * after it is not the turn's.
     */
    if (event.type === 'message_end' && event.message.role === 'user' && !kept
      && active !== undefined && live !== undefined && prompted === String(active.id)) {
      kept = true;
      live.appendEntry(MESSAGE_ENTRY, { message: turn?.message ?? active.message });
    }

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
       * and then nothing is sent for it. A resumed turn says this run's sum,
       * which the host merges over the run before's, and holds the two merged.
       */
      const sum = addUsage(usage, event.message);
      if (sum !== undefined && sum !== usage && active !== undefined) {
        usage = sum;
        const held = mergeLogicalTurnUsage(resumedFrom?.usage, sum) ?? sum;
        active.usage = held;
        if (turn !== undefined) turn.usage = held;
        emit('chat', { type: 'chat/usage', turnId: String(active.id), usage: sum });
      }
    }

    if (mapping !== undefined) {
      for (const action of mapEvent(mapping, event)) emit('chat', action);
    }

    switch (event.type) {
      /*
       * pi's queue, said on every change. A steering message it no longer
       * holds has been read into the turn, or let go, and is taken out.
       */
      case 'queue_update': {
        for (const id of submittedSteering.splice(0, Math.max(0, submittedSteering.length - event.steering.length))) steeringConsumed(id);
        return;
      }

      /*
       * pi's own name for the conversation, which a person may have set from
       * its terminal. It is the session's title here, and the host decides
       * whether that goes out as the session's or a peer chat's.
       */
      case 'session_info_changed': {
        const named = event.name;
        // Not once a person has named this session: a name somebody chose is
        // not the agent's to replace, which is where ACP's `renamed` guard sits.
        if (named === undefined || named === '' || named === title || renamed) return;
        title = named;
        provisional = false;
        if (record !== undefined) record.title = named;
        emit('session', { type: 'session/titleChanged', title });
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
        settle();
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
    const trust = values.projectTrust ?? options.projectTrust ?? 'trust';
    // What this backend is built with, so a turn it runs judges owner and
    // effects against the list pi was handed and not one a client changed
    // while the turn ran.
    const building = [...offering];
    built = building;
    // A client's call waits for the answer its client sends.
    const tools = (await Promise.all(building.map((one) => toPiTool(one, (_bound, toolCallId) => calls.wait(toolCallId)))))
      .flatMap((tool) => (tool === undefined ? [] : [tool]));
    // An empty entry is not an instruction, and pi would put a blank paragraph
    // in the system prompt for one.
    const instructions = (start.instructions ?? []).filter((one) => one.trim() !== '');
    /*
     * The name this conversation is written under, which the host chose.
     *
     * The chat's own id where it has one, and the session's id otherwise: a
     * peer chat is a conversation of its own, and pi writing it over the
     * session's file would make the two one transcript with two writers.
     */
    const writtenAs = start.chatId ?? idFor(start.uri);
    const backend = await open({
      cwd: where,
      ...(resume !== undefined ? { resume } : {}),
      // Only the first open forks: a rebuild continues the copy it made.
      ...(first && resume !== undefined && start.forkAt !== undefined ? { forkAt: start.forkAt } : {}),
      // Offered to pi, whose own check takes it or leaves pi's own name, which
      // the host records after.
      ...(first && resume === undefined ? { id: writtenAs } : {}),
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
       * same answer.
       */
      trustProject: trust !== 'deny' && start.trusted?.(where) === true,
      // What this session switched off, left out of what pi loads.
      ...(found === undefined || off.size === 0 ? {} : { switchedOff: switchedOffPaths(found, off) }),
    });
    live = backend;
    /*
     * What pi loaded, listed and said where it moved, as the CLI's own list is
     * said once it answers.
     */
    found = backend.resources();
    own = piCustomizations(found, off);
    const listing = [...seeds, ...own];
    if (JSON.stringify(listing) !== saidCustomizations) {
      saidCustomizations = JSON.stringify(listing);
      emit('session', { type: 'session/customizationsChanged', customizations: listing });
    }
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
    /*
     * The record's variables before the list, because one of them is what makes
     * its provider available: a list built before them would offer a client
     * every model but the ones the record was made for.
     */
    await backend.useEnv(options.env ?? {});
    // The model list is held for `Session.models()`, which the host reads for
    // a client; pi only knows it once its runtime exists.
    const available = await backend.models();
    models = available.map((model) => listed(model, backend.levels(model), backend.startsOn(model)));
    if (first) {
      /*
       * The model the configuration names, when nobody has chosen one.
       *
       * A resumed or forked session keeps the model its own file recorded,
       * and pi's own current model when the option is left out. A turn's own
       * choice arrives in `begin` after this and still wins.
       */
      if (options.model !== undefined && start.resume === undefined && start.forkAt === undefined) {
        await backend.setModel(options.model);
      }
      // `rewindAt` is the host asking for a truncation on a resumed session.
      if (start.rewindAt !== undefined) {
        /*
         * pi can refuse the move - an extension's `session_before_tree`
         * handler cancels it - and the session then runs on the leaf it was
         * resumed at. Said in the log, as the reference host logs an agent's
         * cut that failed and goes on: the clients already hold the cut.
         * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1982-L1986
         */
        const moved = await backend.truncate(start.rewindAt);
        if (!moved) console.warn(`@ahpd/agent-pi: pi refused to move the leaf back to ${start.rewindAt}`);
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
       * pi again rather than reusing the rejection.
       */
      if (opening === started) opening = undefined;
      const abandoned: unknown = live;
      if (abandoned !== undefined) (abandoned as PiBackend).dispose();
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
    // Read before disposing: the new session has its own model until told.
    const carrying = previous.modelSelection();
    unsubscribe?.();
    unsubscribe = undefined;
    previous.dispose();
    live = undefined;
    stale = false;
    const rebuilt = build(id, false);
    opening = rebuilt;
    try {
      const backend = await rebuilt;
      if (carrying !== undefined) await backend.setModel(carrying.id, carrying.config);
      return backend;
    }
    catch (error: unknown) {
      // Nothing is live after a failed rebuild, so the next turn opens again.
      const abandoned: unknown = live;
      if (abandoned !== undefined && abandoned !== previous) (abandoned as PiBackend).dispose();
      live = undefined;
      if (opening === rebuilt) opening = undefined;
      throw error;
    }
  };

  /**
   * The first message titles a session nobody has named, and replaces a title
   * a local command suggested, as VS Code's title controller seeds one.
   *
   * A message of nothing but blanks names nothing, so the title held stays
   * and nothing is said about it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L189-L229
   */
  const titled = (text: string): void => {
    if (title !== UNTITLED && !provisional) return;
    const said = titleFrom(text, '');
    if (said === '') return;
    provisional = false;
    if (said === title) return;
    title = said;
    if (record !== undefined) record.title = title;
    emit('session', { type: 'session/titleChanged', title });
  };

  /**
   * Start a turn, once there is nothing else running.
   *
   * Its preparation reads whether it was stopped after each of its steps, and
   * a turn stopped while it prepared sends pi nothing and ends cancelled, as
   * the reference host checks for a cancel after each step of a turn's
   * preparation. What the host has to say on the turn reaches that turn by
   * pi's own custom message, as every reference agent delivers the
   * instructions its host contributes for a send on that turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2307-L2316
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2281-L2288
   */
  const begin = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    turnOptions?: TurnOptions,
  ): void => {
    error = undefined;
    cancelled = false;
    resumed = false;
    kept = false;
    answered = undefined;
    usage = undefined;
    const startedAt = new Date().toISOString();
    /*
     * The record as it is now: what this turn runs on is the record's, and the
     * turn before's options are not what a person who just edited it asked for.
     * A record that can no longer be used is the turn's failure, said once the
     * turn is open, in the sentence cofold's turn ends with, as VS Code's host
     * ends a turn it cannot send with `chat/error`.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2328-L2349
     */
    let unusable: string | undefined;
    try {
      refreshOptions();
    }
    catch (why) {
      unusable = `${provider}: the record cannot be used: ${reason(why)}`;
    }
    /*
     * Whether the record's model changed since the turn before, which is when
     * pi is moved to it. A record names the model the session runs on when
     * nobody chooses, so a new one is a move at this turn; saying the same
     * model again is not.
     */
    const moved = options.model !== recordedModel;
    recordedModel = options.model;
    /*
     * The model this turn runs on, so a client that reopens the chat can show
     * the one it used. A turn's own choice wins, then a model the record moved
     * to, then the model the session is already on, then the record's default.
     */
    const ran = model?.id ?? (moved ? options.model : undefined) ?? live?.modelSelection()?.id ?? options.model;
    /*
     * The message as the client sent it, the start every client holds, as VS
     * Code's host says a client's start; the turn read back names the model
     * it ran on.
     */
    const message: Bag = {
      text,
      ...(from?.origin !== undefined ? { origin: from.origin } : { origin: { kind: 'user' } }),
      ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      // Kept on the turn's own message, so a client reopening the chat reads
      // the picture beside the words the turn was accepted with.
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      ...(model === undefined
        ? {}
        : { model: { id: model.id, ...(model.config !== undefined ? { config: model.config } : {}) } }),
    };
    // No part yet: each is opened when pi starts writing the block it holds.
    // The fields `ActiveTurn` declares; `finish` gives it the `state` a `Turn`
    // carries once it ends.
    active = {
      id: turnId,
      startedAt,
      message,
      responseParts: [],
    };
    mapping = {
      turnId,
      messages: 0,
      blocks: new Map(),
      parts: active.responseParts as Bag[],
      calls: new Map(),
      ownerOf: contributorOf,
    };
    const ranOn: Bag = ran === undefined
      ? message
      : { ...message, model: { id: ran, ...(model?.config !== undefined ? { config: model.config } : {}) } };
    turn = { turnId, startedAt: String(active.startedAt), message: ranOn, parts: active.responseParts as Bag[] };
    watchedTurns.push(turn);
    // A turn's start is the chat's `modifiedAt`, as the reducer moves it, and
    // the record's.
    modified = String(active.startedAt);
    if (record !== undefined) record.modifiedAt = modified;

    titled(text);
    if (unusable !== undefined) {
      finish('error', unusable);
      return;
    }
    // What the host has to say on this turn, asked now that the turn exists.
    const told = (turnOptions?.instructions?.() ?? []).filter((one) => one.trim() !== '');
    // Whether the turn ended, or a stop came, while it prepared: a stop ends it unsent.
    const stopped = (): boolean => {
      if (active?.id !== turnId) return true;
      if (!cancelled) return false;
      finish('cancelled');
      return true;
    };

    void (async () => {
      try {
        let backend = await opened();
        if (stopped()) return;
        // pi fixes its custom tools when it is built, so a change made since
        // means a rebuilt pi on the same file before this turn runs.
        if (stale) backend = await reopen(backend);
        if (stopped()) return;
        /*
         * The record's variables, before the choice and the prompt: the keys
         * are what a provider is available by, and a key edited between two
         * turns is the one this turn's request carries.
         */
        await backend.useEnv(options.env ?? {});
        if (stopped()) return;
        const wanted = model?.id ?? (moved ? options.model : undefined);
        if (wanted !== undefined) {
          /*
           * A model pi does not have runs the turn on the model pi is on, and
           * the daemon's log says so, as VS Code's host runs a turn naming a
           * model its agent does not offer on the chat's own.
           * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235
           */
          if (!await backend.setModel(wanted, model?.config)) {
            options.log?.(`${provider}: chat ${start.chatUri} keeps its model: pi does not offer ${wanted}`);
          }
          if (stopped()) return;
        }
        const asked = await promptFor(text, attachments, backend.supportsVision());
        if (stopped()) return;
        /*
         * What the host has to say on this turn, by pi's own channel for words
         * beside a prompt: a custom message the model reads with this turn's
         * run and nobody is shown, so the prompt, and the transcript read back,
         * hold the person's words alone.
         */
        if (told.length > 0) await backend.sendCustomMessage(told.join('\n\n'));
        promptedAfter = backend.leaf();
        prompted = turnId;
        await backend.prompt(asked.text, asked.images);
        /*
         * `prompt` settling is not the turn ending: pi raises `agent_settled`
         * for that, and the two are not the same moment when it retries. So
         * nothing is closed here, and a turn that settled already has been.
         */
      }
      catch (error) {
        if (active?.id === turnId) finish('error', reason(error));
      }
    })();
  };

  /** The first turn handed while another ran, once nothing runs. */
  const sendNext = (): void => {
    if (closed || active !== undefined) return;
    const next = pendingTurns.shift();
    if (next !== undefined) begin(next.turnId, next.text, next.model, next.from, next.attachments, next.options);
  };

  /** The model a client picked, taken by the next send: pi keeps a model it took. */
  let chosen: Chosen | undefined;

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    models: () => models,
    agentId: () => live?.id,
    // A fork copies the conversation through the turn it names, answer
    // included, so it cuts where the turn ended rather than where it began.
    forkPoint: (turnId) => ends.get(turnId),
    endPoint: (turnId) => ends.get(turnId),
    customizations: () => [...seeds, ...own],
    allTurns: () => turns,

    status: (): number => statusOf(bits()),
    /*
     * Nothing: a chat's activity is a wait before its turn can run, as VS Code's
     * host says one, and a turn here runs once the host hands it over, its
     * thinking, its tools and its questions shown in its own parts.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
     */
    activity: () => undefined,
    title: () => title,
    setTitle: (next) => {
      renamed = true;
      provisional = false;
      title = next;
      if (record !== undefined) record.title = next;
      // pi keeps a name of its own, so the title survives outside this host -
      // a session renamed here is renamed in `pi` too.
      live?.rename(next);
    },
    /*
     * A title a local command suggests, taken while the session has none of its
     * own or holds an earlier one of these, and said, as VS Code's host seeds
     * one; the first real message's title replaces it. pi's own name is left
     * alone, since this one holds only until somebody says something.
     */
    seedTitle: (said) => {
      if (said === '' || renamed || (title !== UNTITLED && !provisional) || said === title) return;
      title = said;
      provisional = true;
      if (record !== undefined) record.title = said;
      emit('session', { type: 'session/titleChanged', title });
    },
    modifiedAt: () => modified,
    workingDirectories: () => [uriOf(where)],

    sessionState: () => ({
      provider,
      title,
      status: statusOf(bits()),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title }],
      workingDirectories: [uriOf(where)],
      customizations: [...seeds, ...own],
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
      config: { schema: start.schema?.() ?? schemaOf(), values: { ...values } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title,
      status: statusOf(bits()),
      modifiedAt: modified,
      turns,
      ...(active !== undefined ? { activeTurn: active } : {}),
      ...(draft !== undefined ? { draft } : {}),
    }),

    // A turn sent while pi runs another is run after it; the turn it took the
    // place of in every client's state runs on here and ends in no history.
    sendMessage: (turnId, text, from, attachments, turnOptions) => {
      const model = chosen;
      chosen = undefined;
      const shown = pendingTurns.at(-1)?.turnId ?? (cancelled || active === undefined ? undefined : String(active.id));
      if (shown !== undefined) replaced.add(shown);
      pendingTurns.push({ turnId, text, model, from, attachments, options: turnOptions });
      sendNext();
    },

    changeModel: (model) => { chosen = model; },
    // pi runs as its own agent, so an agent picked is kept by nothing.
    changeAgent: () => {},

    /**
     * A message into the turn that is already running.
     *
     * pi's own `steer`, the thing the protocol means by steering. Answered as
     * the reference agents answer a steering message: `false` while pi has not
     * been handed the turn's prompt or the turn is stopping, which has the host
     * hand it again on the turn's next action, and a promise that answers
     * `true` once pi's queue no longer holds it, when its removal is said, or
     * `false` when the turn ended first and handed it back.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1955
     *
     * One pi never queued is taken out at once: an extension handled it, or the
     * steer failed.
     */
    sendSteeringMessage: ({ id, text, attachments }) => {
      const backend = live;
      const turnId = active === undefined ? undefined : String(active.id);
      if (backend === undefined || turnId === undefined || prompted !== turnId || cancelled) return false;
      return new Promise<boolean>((resolve) => {
        answers.set(id, resolve);
        void (async () => {
          let queued = false;
          try {
            // Built the way the turn's own prompt is, so a picture pasted into
            // a correction reaches pi as one when the model takes it.
            const asked = await promptFor(text, attachments, backend.supportsVision());
            // The turn ended while the pictures were read, and handed back what it held.
            if (prompted !== turnId) {
              answers.delete(id);
              resolve(false);
              return;
            }
            submittedSteering.push(id);
            queued = await backend.steer(asked.text, asked.images) === 'queued';
          }
          catch (error) {
            /*
             * A steer pi would not take is the steering message's failure: the
             * turn runs on in pi, and a client holds it running. Said in the
             * log and taken out, as the reference drops a steering message it
             * cannot hand its agent.
             * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L449-L474
             */
            console.warn(`@ahpd/agent-pi: pi did not take the steering message ${id}: ${reason(error)}`);
          }
          if (queued) return;
          const at = submittedSteering.indexOf(id);
          if (at >= 0) submittedSteering.splice(at, 1);
          if (answers.has(id)) steeringConsumed(id);
        })();
      });
    },

    /**
     * The latest turn, failed on a model call or cut off as pi's file read it
     * back, continued without a new message.
     *
     * The protocol reopens that turn rather than starting another: it moves
     * back to `active` with its message, parts and usage, and what the resumed
     * run writes is added after them. pi continues from the call that failed or
     * the request that was cut off - see `PiBackend.resume` - so the calls the
     * turn already ran are not run again.
     */
    resumeTurn: (turnId) => {
      const last = turns.at(-1);
      const part = (last?.responseParts as Bag[] | undefined)?.at(-1);
      if (closed || active !== undefined || pendingTurns.length > 0 || last === undefined || String(last.id) !== turnId
        || last.state !== 'error' || part?.kind !== 'error' || part.resumable !== true) {
        throw new Error(`${turnId} is not a turn this backend can run again`);
      }
      turns.pop();
      resumedFrom = {
        duration: typeof last.duration === 'number' ? last.duration : 0,
        at: Date.now(),
        usage: typeof last.usage === 'object' && last.usage !== null ? last.usage as Bag : undefined,
      };
      delete last.state;
      delete last.duration;
      active = last;
      error = undefined;
      cancelled = false;
      resumed = true;
      answered = undefined;
      // This run's own usage, which the host merges over the run before's.
      usage = undefined;
      const parts = last.responseParts as Bag[];
      mapping = {
        turnId,
        messages: 0,
        blocks: new Map(),
        parts,
        calls: new Map(),
        ownerOf: contributorOf,
      };
      // The transcript's own record of the turn, so what the run adds is read
      // back with it, running again until this run ends. A turn read from pi's
      // file is there once the file has been.
      turn = watchedTurns.find((one) => one.turnId === turnId);
      if (turn !== undefined) {
        turn.parts = parts;
        delete turn.state;
        delete turn.duration;
      }

      void (async () => {
        try {
          const backend = await opened();
          if (!await backend.resume()) {
            finish('error', 'pi has no failed reply or cut-off request to continue from');
            return;
          }
          // The run is over and pi raises no settle for it, so it is said here.
          if (active !== undefined && String(active.id) === turnId) settle();
        }
        catch (error) {
          finish('error', reason(error), true);
        }
      })();
    },

    /*
     * A stop: the turns handed behind the one running are sent to nobody, the
     * steering pi holds goes back, and the run is stopped, as the reference stop
     * aborts the agent's work in flight and drops what waits behind it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1946-L1954
     */
    abort: () => {
      pendingTurns.length = 0;
      if (active === undefined || cancelled) return;
      cancelled = true;
      handBack();
      // What a client was running for this turn is not coming back, so pi is
      // told the calls failed rather than left waiting on a stopped turn.
      calls.release('The turn was stopped');
      // A question nobody can answer any more is answered the same way.
      releasePending('The turn was stopped', false);
      // The turn is closed on pi's settle rather than here, so what it had
      // already said stays in the transcript.
      void live?.abort().catch(() => { finish('cancelled'); });
    },

    // The draft the host said, held for the chat's state.
    setDraft: (next) => { draft = next; },

    /*
     * A person's answer to a call that was shown `pending-confirmation`, which
     * the host has said as the client sent it.
     *
     * Found by id rather than assumed to be the only one: two calls can wait
     * at once, and answering one must not answer the other.
     */
    confirm: (toolCallId, approved) => {
      const held = pending.get(toolCallId);
      if (held === undefined) return false;
      pending.delete(toolCallId);
      // The entry follows the chat's state: the host took it down when it said
      // the confirmation that moved the call.
      const part = mapping === undefined ? undefined : callPartOf(mapping, toolCallId);
      if (part !== undefined) {
        const row = bag(part.toolCall);
        row.status = approved ? 'running' : 'cancelled';
        if (approved) row.confirmed = 'user-action';
        /*
         * A call starts running now, and not at the `tool_execution_start`
         * that came before the question: the wait for a person is not work. A
         * call refused never runs, so it loses the start it was given.
         */
        if (approved) stampStart(row, Date.now());
        else untime(row);
      }
      // An allowed call is one a client now has to run, so it is asked here.
      if (approved) held.open?.();
      /*
       * A call the person refused is blocked in pi's own words for a call its
       * approval gate refused, the reason its model reads: npm://@earendil-works/pi-coding-agent@1.3.0
       * docs/extensions.md L169-L178, `{ block: true, reason: \`${event.toolName} was not approved\` }`.
       */
      held.settle(approved ? undefined : { block: true, reason: `${held.toolName} was not approved` });
      return true;
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

    /*
     * Take a config value: the two keys the schema declares, each at a value
     * it offers. A value it does not offer and any other key are refused in
     * VS Code's two sentences.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L136-L147
     */
    setConfig: async (key, value) => {
      if (key === 'projectTrust') {
        if (value !== 'trust' && value !== 'deny') return `Session configuration '${key}' does not offer '${String(value)}'.`;
        values[key] = value;
        return true;
      }
      if (key === 'permissionMode') {
        if (typeof value !== 'string' || !(PERMISSION_MODES as readonly string[]).includes(value)) {
          return `Session configuration '${key}' does not offer '${String(value)}'.`;
        }
        values[key] = value;
        return true;
      }
      return `Session configuration '${key}' is not writable.`;
    },
    settings: () => ({ ...values }),

    /*
     * A skill, a prompt template or an extension of pi's own, or the folder or
     * package that holds it, switched for the pi built before the next turn,
     * which leaves what is off out through pi's loader overrides: pi loads them
     * when it is built, as it fixes its custom tools, so a switch reaches it as
     * a tool change does. Anything else is no customization of pi's.
     */
    setCustomizationEnabled: async (id, enabled) => {
      const ids = own.flatMap((one) => [String(one.id), ...((one.children as Bag[] | undefined) ?? []).map((child) => String(child.id))]);
      if (!ids.includes(id)) return false;
      if (enabled) off.delete(id);
      else off.add(id);
      if (found !== undefined) own = piCustomizations(found, off);
      if (opening !== undefined || live !== undefined) stale = true;
      return true;
    },
    // pi's MCP servers are its extensions' business.
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    close: () => {
      closed = true;
      calls.release('The turn was stopped');
      releasePending('The turn was stopped', true);
      /*
       * A turn still running ends for every client, as VS Code's agent ends a
       * turn whose runtime goes: an error part not marked resumable, and then
       * the turn's completion. Neither pi's own file nor this process's record
       * of the turn gets an ending, so a read back finds the turn interrupted
       * and resumable, as VS Code's reader finds one its runtime never ended.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L4606-L4646
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1152-L1155
       */
      if (active !== undefined) {
        const turnId = String(active.id);
        const duration = resumedFrom === undefined ? Date.now() - Date.parse(String(active.startedAt)) : Date.now() - resumedFrom.at;
        emit('chat', {
          type: 'chat/error',
          turnId,
          duration,
          part: { kind: 'error', error: { errorType: 'sessionClosed', message: 'The session closed while the turn ran.' } },
        });
        emit('chat', { type: 'chat/turnComplete', turnId, duration });
      }
      unsubscribe?.();
      unsubscribe = undefined;
      namePrompt();
      live?.dispose();
      live = undefined;
      opening = undefined;
    },
  };
}
