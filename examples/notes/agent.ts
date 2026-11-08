import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Turn } from '@microsoft/agent-host-protocol';
import { idOf, uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Listed, MessageAttachment, MessageFrom, Session, Start, WireTurn } from '@ahpd/sdk';

/**
 * A backend with tools, and the two ways one stops to ask.
 *
 * `examples/echo` is the smallest thing that satisfies `Agent`: it says back
 * what you said, and because nothing it does needs permission, `confirm` and
 * `answer` are empty there and half the session contract is described rather
 * than shown. This is the other half. It keeps notes in a directory, reads
 * them with a tool that never asks and writes them with one that does, and
 * when you leave out which note you meant it asks a question that is not a
 * tool call at all.
 *
 * Two backends rather than one bigger one, because echo's worth is that it is
 * short enough to read in a sitting - and because tools are where the traps
 * are, and a trap wants a page of its own.
 *
 * Reading order:
 *
 * 1. `notes()` at the bottom is the `Agent`, and is echo's again except for
 *    the config key.
 * 2. `createSession()` is the `Session`. `runTool` and `requestInput` are the
 *    two shapes worth taking away; everything else is bookkeeping around them.
 *
 * What this shows that echo does not:
 *
 * - `chat/toolCallStart` opens a response part *by itself*, so a tool call is
 *   held rather than announced with `chat/responsePart`.
 * - `chat/toolCallReady` with `confirmed: 'not-needed'` is a tool running
 *   without asking; the same action without it is one waiting to be allowed.
 * - `chat/toolCallComplete` carries a `result` object. Its `content` lives
 *   inside that, not beside it.
 * - `session/inputNeededSet` is how a client that is not watching the chat
 *   still learns somebody is being asked, in both its forms:
 *   `kind: 'toolConfirmation'` and `kind: 'chatInput'`.
 * - `chat/inputRequested` opens its own response part too, the same way
 *   `toolCallStart` does.
 * - `onFileEdit` is how a turn's changeset is the turn's rather than the
 *   working tree's at the time somebody looked.
 */

/**
 * When a tool stops and waits for a person: VS Code's approvals levels
 * (`AutoApproveLevel`, src/vs/platform/agentHost/common/agentHostSchema.ts L266
 * at 6b68d3fe). Reading runs at every level, writing waits unless the level is
 * `autoApprove`: this backend's one risky tool is the write.
 */
type AutoApprove = 'default' | 'assisted' | 'autoApprove';

/**
 * Something the session is waiting on, by request id.
 *
 * A map rather than a slot, because a backend that can ask twice will: one
 * held answer is a second question that overwrites the first, and then the
 * first waits for a reply nobody can give any more.
 */
interface Waiting {
  /** The id both `inputNeeded` and the answer name it by. */
  id: string;
  /** The session-level entry, kept so the snapshot can list it. */
  entry: Bag;
  /**
   * Let the parked turn go. `answers` is empty for a confirmation, and
   * `response` is the kind the client answered a question with, where it sent one.
   */
  settle(accepted: boolean, answers: Bag, response?: string): void;
}

/** What one line asks for. Anything unrecognised is `help`. */
type Line =
  | { verb: 'read'; name?: string }
  | { verb: 'write'; name?: string; text: string }
  | { verb: 'help' };

const parse = (said: string): Line => {
  const [first = '', ...rest] = said.trim().split(/\s+/);
  // A command picked from the slash menu the probe fills runs as the same
  // command typed, as VS Code's providers run the commands they offer.
  const verb = (first.startsWith('/') ? first.slice(1) : first).toLowerCase();
  const name = rest[0];
  if (verb === 'read') return { verb: 'read', ...(name ? { name } : {}) };
  if (verb === 'write') {
    return { verb: 'write', ...(name ? { name } : {}), text: rest.slice(1).join(' ') };
  }
  return { verb: 'help' };
};

/**
 * A file name from what somebody typed, or nothing.
 *
 * The confirmation is what stops a *person* writing the wrong file; this is
 * what stops a name being a path. A backend that joins user text onto a
 * directory without this serves the whole filesystem through a tool call.
 */
const nameOf = (said: string): string | undefined => {
  const one = said.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(one) || one === '.' || one === '..') return undefined;
  return one.endsWith('.md') ? one : `${one}.md`;
};

/** What the two commands do, said by the `autoApprove` level in force, since that decides whether writing asks. */
const helpOf = (level: AutoApprove): string => [
  'I keep notes in a directory. Two things I can do, typed or picked from the slash menu:',
  '',
  '- `read <name>` - read one. Leave the name out and I will ask which.',
  `- \`write <name> <text>\` - write one.${level === 'autoApprove' ? '' : ' I will ask before I do.'}`,
].join('\n');

/**
 * A title seeded from a first message, as VS Code's host seeds one: trimmed,
 * each run of whitespace one space, and cut to 200 characters.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L252-L255
 */
const titleOf = (text: string): string => Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, 200).join('').trim();

/** How to build the notes backend. */
export interface NotesOptions {
  /** The directory notes are kept in, and the one this backend serves. */
  path: string;
  /** Milliseconds between streamed words. `0` answers all at once. */
  pace?: number;
}

/**
 * A session that has finished, kept so the catalogue has something in it.
 *
 * In memory, like echo's, which is what makes the example runnable with
 * nothing installed and why restarting the host empties the list. The notes
 * themselves are on disk and outlive it.
 */
interface Kept {
  id: string;
  title: string;
  /** When the session began, which its later turns leave as it was. */
  createdAt: string;
  modifiedAt: string;
  /** The folder the session worked in. */
  workingDirectory: string;
  turns: Bag[];
}

export function notes(options: NotesOptions): Agent<Session> {
  const dir = options.path;
  const pace = options.pace ?? 40;
  const kept = new Map<string, Kept>();

  /**
   * One key, of this backend's own invention.
   *
   * `permissionMode`, `model`, `effortLevel` and `outputStyle` have setters of
   * their own on `Session`, because they mean something to the host - it sets a
   * permission mode on every chat in a session, not only the one that was
   * asked. Anything else in a schema arrives at `setConfig`, which is what
   * makes `sessionMutable` true here: a client draws its controls from this
   * schema and dispatches the key it drew.
   */
  const schema = (): Bag => ({
    properties: {
      /*
       * VS Code's approvals key, its name, words and levels, so a VS Code
       * client draws its own control for it
       * (src/vs/platform/agentHost/common/agentHostSchema.ts L387-L405 at
       * 6b68d3fe).
       */
      autoApprove: {
        type: 'string',
        title: 'Approvals',
        description: 'Tool approval behavior for this session',
        enum: ['default', 'assisted', 'autoApprove'],
        enumLabels: ['Manual permissions', 'Assisted permissions', 'Allow all'],
        enumDescriptions: [
          'Asks when approval settings don\'t apply',
          'Evaluates risk before running tools',
          'Runs tool calls without asking',
        ],
        default: 'default',
        sessionMutable: true,
      },
      /*
       * One this backend will not take once a session is running.
       *
       * Declared so the *host* refuses it rather than this backend: the two
       * fields the host reads off a schema are `sessionMutable` and `scope`,
       * and a key marked immutable never reaches `setConfig` at all.
       */
      tone: {
        type: 'string',
        title: 'Tone',
        description: 'How the notes are written. Fixed when the session starts.',
        enum: ['plain', 'terse'],
        default: 'plain',
        sessionMutable: false,
      },
    },
  });

  const defaults = (): Record<string, unknown> => ({ autoApprove: 'default', tone: 'plain' });

  /** Every note there is, newest name last. Missing directory means none yet. */
  const listNotes = async (): Promise<string[]> => {
    try {
      return (await readdir(dir)).filter((one) => one.endsWith('.md')).sort();
    } catch {
      return [];
    }
  };

  function createSession(start: Start): Session {
    const settings = { ...start.settings };
    /** Finished turns. The running one is `active` and is deliberately not here. */
    const turns: Bag[] = [...(start.seed ?? [])];
    let active: Bag | undefined;
    /** The turns handed while another ran, each worked once the one in front of it is done. */
    const handed: { turn: Bag; text: string }[] = [];
    /** The turns a later one took the place of. */
    const replaced = new Set<string>();
    let title = 'Notes session';
    let modified = new Date().toISOString();
    let closed = false;
    let activity: string | undefined;
    let draft: Bag | undefined;
    const id = start.resume ?? idOf(start.uri);
    /** When the session began: a resumed one keeps the moment it first did. */
    const created = kept.get(id)?.createdAt ?? modified;
    const where = start.workingDirectory ?? dir;

    /** Tool call parts by their call id, so a result can find the part it belongs to. */
    const parts = new Map<string, Bag>();
    const waiting = new Map<string, Waiting>();

    const said = start.seed?.[0];
    if (said) title = titleOf(String((said.message as Bag | undefined)?.text ?? '')) || title;

    /** The chat's modified time, which moves at a turn's start and its end. */
    const touch = (): void => { modified = new Date().toISOString(); };

    const doing = (what: string | undefined): void => {
      if (activity === what) return;
      activity = what;
      start.emit('chat', { type: 'chat/activityChanged', ...(what !== undefined ? { activity: what } : {}) });
      start.emit('session', { type: 'session/activityChanged', ...(what !== undefined ? { activity: what } : {}) });
    };

    /**
     * `SessionStatus`: 24 is waiting on a person, 8 is in progress, 1 is idle.
     *
     * `InputNeeded` *carries* `InProgress`, so it has to be tested before it -
     * a session waiting for an answer is also a session with a turn open.
     */
    const status = (): number => (waiting.size > 0 ? 24 : active ? 8 : 1);

    const remember = (): void => {
      kept.set(id, { id, title, createdAt: created, modifiedAt: modified, workingDirectory: where, turns: [...turns] });
    };

    const rest = (ms: number): Promise<void> => new Promise((wake) => { setTimeout(wake, ms); });

    /** Both halves of `inputNeeded`, which is a list keyed by id. */
    const setInputNeeded = (held: Waiting): void => {
      waiting.set(held.id, held);
      start.emit('session', { type: 'session/inputNeededSet', request: held.entry });
    };
    const removeInputNeeded = (id: string): void => {
      waiting.delete(id);
      start.emit('session', { type: 'session/inputNeededRemoved', id });
    };

    /**
     * Prose, streamed into a response part.
     *
     * `chat/responsePart` opens it and `chat/delta` fills it, in that order:
     * a delta naming a part nobody opened appends to nothing. It stops once
     * its turn is not the one running, as a stopped turn's work stops.
     */
    const responsePart = async (turn: Bag, text: string): Promise<void> => {
      if (closed || active !== turn) return;
      const part: Bag = { id: `${String(turn.id)}:${String((turn.responseParts as Bag[]).length)}`, kind: 'markdown', content: '' };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId: turn.id, part });
      for (const word of text.split(' ')) {
        if (closed || active !== turn) return;
        if (pace > 0) await rest(pace);
        if (closed || active !== turn) return;
        const chunk = part.content === '' ? word : ` ${word}`;
        part.content = `${String(part.content)}${chunk}`;
        start.emit('chat', { type: 'chat/delta', turnId: turn.id, partId: part.id, content: chunk });
      }
    };

    /**
     * Ask a question that is not about a tool.
     *
     * `chat/inputRequested` creates the response part on the client side, the
     * same way `chat/toolCallStart` does - so the part is held here and never
     * announced with `chat/responsePart`, or the question appears twice.
     *
     * Resolves with the answers, or nothing if the person did not accept or
     * the turn was stopped.
     */
    const requestInput = async (turn: Bag, request: Bag): Promise<Bag | undefined> => {
      const part: Bag = { id: String(request.id), kind: 'inputRequest', request };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/inputRequested', request });
      const given = await new Promise<{ accepted: boolean; answers: Bag; response?: string }>((settle) => {
        setInputNeeded({
          id: String(request.id),
          entry: { id: request.id, chat: start.chatUri, kind: 'chatInput', request },
          settle: (accepted, answers, response) => { settle({ accepted, answers, ...(response !== undefined ? { response } : {}) }); },
        });
      });
      // A question a stop ended keeps no response, as the protocol's reducer
      // keeps none, and the turn's work stops with it.
      if (active !== turn) return undefined;
      // On the part this backend holds, so a snapshot shows the question
      // answered as the client answered it. Every client is told by the host,
      // which says the `chat/inputCompleted` back once `answer` has taken it.
      part.response = given.response ?? (given.accepted ? 'accept' : 'decline');
      if (given.accepted) (part.request as Bag).answers = given.answers;
      return given.accepted ? given.answers : undefined;
    };

    /** What one tool call is asked to do, and what it says it did. */
    interface Tool {
      /** The name in the transcript, and what a client logs. */
      name: string;
      /** What a person reads instead of the name. */
      displayName: string;
      /** The sentence above the input - never the input itself, or it is printed twice. */
      invocation: string;
      /** The input, as one line. */
      input: string;
      /** The question, if this one asks. */
      confirmationTitle?: string;
      /** The file this will change, so the turn's changeset knows about it. */
      edits?: string;
      /** Do it. The string is what the tool says it did. */
      run(): Promise<string>;
    }

    /**
     * One tool call, start to finish.
     *
     * Held rather than announced: `chat/toolCallStart` creates the response
     * part on the client side, so sending `chat/responsePart` for one as well
     * puts the same call in the transcript twice.
     *
     * Returns false when the person said no, so the turn can say so rather
     * than carrying on as if it had run.
     */
    const runTool = async (turn: Bag, tool: Tool): Promise<boolean> => {
      const callId = crypto.randomUUID();
      const asks = tool.confirmationTitle !== undefined;
      // The record a snapshot and the session's inputNeeded entry show, with
      // the sentence `toolCallReady` says, which the protocol's call requires.
      const call: Bag = {
        toolCallId: callId,
        toolName: tool.name,
        displayName: tool.displayName,
        invocationMessage: tool.invocation,
        toolInput: tool.input,
        status: asks ? 'pending-confirmation' : 'running',
        ...(asks ? { confirmationTitle: tool.confirmationTitle } : {}),
        ...(asks ? {} : { confirmed: 'not-needed' }),
      };
      const part: Bag = { id: callId, kind: 'toolCall', toolCall: call };
      parts.set(callId, part);
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', {
        type: 'chat/toolCallStart',
        turnId: turn.id,
        toolCallId: callId,
        toolName: tool.name,
        displayName: tool.displayName,
      });
      start.emit('chat', {
        type: 'chat/toolCallReady',
        turnId: turn.id,
        toolCallId: callId,
        invocationMessage: tool.invocation,
        toolInput: tool.input,
        // Nothing is being asked, and saying so is the whole difference. A
        // `toolCallReady` without this moves the call into
        // `pending-confirmation`, and a transcript of tools that ran is then
        // drawn as a queue of questions nobody put.
        ...(asks ? { confirmationTitle: tool.confirmationTitle } : { confirmed: 'not-needed' }),
      });

      if (asks) {
        const allowed = await new Promise<boolean>((settle) => {
          setInputNeeded({
            id: callId,
            entry: { id: callId, chat: start.chatUri, kind: 'toolConfirmation', turnId: turn.id, toolCall: call },
            settle: (accepted) => { settle(accepted); },
          });
        });
        // A stop ends the turn and the call with it, as VS Code aborts the
        // work a stopped turn had parked.
        if (active !== turn) return false;
        call.status = allowed ? 'running' : 'cancelled';
        if (allowed) call.confirmed = 'user-action';
        else call.reason = 'denied';
        // The host has said the client's decision, as VS Code's host echoes a
        // confirmation once and hands it to its agent
        // (src/vs/platform/agentHost/node/agentSideEffects.ts L1878-L1904 at
        // 6b68d3fe), so it is not said again here.
        if (!allowed) return false;
      }

      doing(tool.displayName);
      // The file as it is now, before the tool has run, and again once it has.
      // Paired by the path, and what makes a changeset the turn's own.
      if (tool.edits !== undefined) start.onFileEdit?.(String(turn.id), tool.edits, 'before');
      let ok = true;
      let told = '';
      try {
        told = await tool.run();
      } catch (wrong) {
        ok = false;
        told = wrong instanceof Error ? wrong.message : String(wrong);
      }
      if (tool.edits !== undefined) start.onFileEdit?.(String(turn.id), tool.edits, 'after');
      if (active !== turn) return false;

      /*
       * A tool that failed is `completed`, and says so in its result.
       *
       * `ToolCallStatus` has no `failed`. What went wrong lives in
       * `result.success` and `result.error`, which is where a client looks for
       * it - a status of this host's invention is one a reducer ignores.
       */
      call.status = 'completed';
      call.success = ok;
      call.pastTenseMessage = told;
      call.content = [{ type: 'text', text: told }];
      /*
       * The result is one object, and everything about the result is in it.
       *
       * `success` and `pastTenseMessage` are required, and `content` belongs
       * inside rather than beside: the reducer spreads `action.result` over
       * the call and reads nothing else, so a `content` at the top level of
       * this action is dropped without a word and the tool's output never
       * reaches a screen.
       */
      start.emit('chat', {
        type: 'chat/toolCallComplete',
        turnId: turn.id,
        toolCallId: callId,
        result: {
          success: ok,
          pastTenseMessage: told,
          content: [{ type: 'text', text: told }],
          ...(ok ? {} : { error: { message: told } }),
        },
      });
      return ok;
    };

    /** Which note, when the line did not say. Existing ones as options, and anything else typed. */
    const whichNote = async (turn: Bag): Promise<string | undefined> => {
      const there = await listNotes();
      const request: Bag = {
        id: crypto.randomUUID(),
        message: 'Which note?',
        questions: [{
          id: 'name',
          kind: 'single-select',
          message: there.length > 0 ? 'Which note did you mean?' : 'There are none yet. Name one anyway?',
          required: true,
          options: there.map((one) => ({ id: one, label: one })),
          // Because the answer is a name, and the names that exist are a
          // convenience rather than the whole set.
          allowFreeformInput: true,
        }],
      };
      const given = await requestInput(turn, request);
      if (!given) return undefined;
      const answer = (given.name ?? {}) as Bag;
      const value = (answer.value ?? {}) as Bag;
      // A picked note is the value's own; a name typed instead of picked is
      // its first freeform value.
      // https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L618-L623
      const typed = Array.isArray(value.freeformValues) ? value.freeformValues[0] : undefined;
      return String(value.value || typed || '') || undefined;
    };

    /**
     * Work a turn the host handed. The host said its start, so one handed
     * while another runs took that one's place in every client's state as the
     * protocol's reducer replaces the active turn, and is worked once that one
     * is done; `waited` is such a turn, worked now. The turn it replaced runs
     * on, in no history.
     */
    const sendMessage = (turnId: string, text: string, from?: MessageFrom, attachments?: MessageAttachment[], waited?: Bag): void => {
      const seeded = titleOf(text);
      if (waited === undefined && title === 'Notes session' && seeded !== '') {
        title = seeded;
        start.emit('session', { type: 'session/titleChanged', title });
      }
      const startedAt = new Date().toISOString();
      // The message as the client sent it, its origin and attachments with it:
      // a client reads `message.origin` of every turn it is served.
      const message: Bag = {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      const turn: Bag = waited ?? { id: turnId, startedAt, message, responseParts: [] };
      if (waited === undefined && (active !== undefined || handed.length > 0)) {
        replaced.add(String((handed.at(-1)?.turn ?? active)?.id));
        handed.push({ turn, text });
        touch();
        return;
      }
      active = turn;
      doing('Reading what you asked');
      const began = Date.now();

      void (async () => {
        let failure: string | undefined;
        try {
          await work(turn, text);
        } catch (wrong) {
          failure = wrong instanceof Error ? wrong.message : String(wrong);
        }
        if (closed || active !== turn) return;
        turn.duration = Date.now() - began;
        /*
         * A turn that failed ends in `chat/error` with the error as its last
         * part, and one that did not ends complete, as VS Code's host ends a
         * failed send and a finished one:
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2329-L2337
         */
        const part: Bag | undefined = failure === undefined ? undefined : { kind: 'error', error: { errorType: 'sendFailed', message: failure } };
        if (part !== undefined) (turn.responseParts as Bag[]).push(part);
        turn.state = part === undefined ? 'complete' : 'error';
        if (!replaced.delete(turnId)) turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', part === undefined
          ? { type: 'chat/turnComplete', turnId, duration: turn.duration }
          : { type: 'chat/error', turnId, duration: turn.duration, part });
        sendNext();
      })();
      touch();
    };

    /** What the line asked for, done. */
    const work = async (turn: Bag, text: string): Promise<void> => {
      const line = parse(text);
      const policy = (settings.autoApprove ?? 'default') as AutoApprove;

      if (line.verb === 'help') {
        await responsePart(turn, helpOf(policy));
        return;
      }

      const named = line.name ?? await whichNote(turn);
      if (named === undefined) {
        await responsePart(turn, 'No note named, so nothing to do.');
        return;
      }
      const file = nameOf(named);
      if (file === undefined) {
        await responsePart(turn, `\`${named}\` is not a name I will use as a file.`);
        return;
      }
      const path = join(dir, file);

      if (line.verb === 'read') {
        const ran = await runTool(turn, {
          name: 'readNote',
          displayName: 'Read note',
          invocation: `Read ${file}`,
          input: file,
          // Reading is the tool that does not ask.
          run: async () => {
            const held = await readFile(path, 'utf8');
            return held === '' ? `${file} is empty` : held;
          },
        });
        await responsePart(turn, ran ? `That is all of ${file}.` : `Left ${file} unread.`);
        return;
      }

      const ran = await runTool(turn, {
        name: 'writeNote',
        displayName: 'Write note',
        invocation: `Write ${file}`,
        input: line.text === '' ? file : `${file}: ${line.text}`,
        // Writing is the tool that asks, unless the level is Allow all.
        ...(policy === 'autoApprove' ? {} : { confirmationTitle: `Write ${file}?` }),
        edits: path,
        run: async () => {
          await mkdir(dir, { recursive: true });
          await writeFile(path, `${line.text}\n`, 'utf8');
          return `Wrote ${String(line.text.length + 1)} bytes to ${file}`;
        },
      });
      await responsePart(turn, ran ? `${file} is saved.` : `Left ${file} alone.`);
    };

    /** The next turn handed while another ran, worked once nothing runs. */
    const sendNext = (): void => {
      if (active || closed) return;
      const first = handed.shift();
      if (first !== undefined) sendMessage(String(first.turn.id), first.text, undefined, undefined, first.turn);
    };

    return {
      uri: start.uri,
      chatUri: start.chatUri,

      models: () => [],
      agentId: () => id,
      customizations: () => start.seedCustomizations ?? [],

      allTurns: () => turns,
      activity: () => activity,
      status,
      title: () => title,
      modifiedAt: () => modified,
      workingDirectories: () => [uriOf(where)],

      sessionState: () => ({
        // No `resource`: it is declared on `SessionSummary` and not on
        // `SessionState`, and a client subscribed to this channel named it.
        provider: 'notes',
        title,
        status: status(),
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title }],
        workingDirectories: [uriOf(where)],
        customizations: start.seedCustomizations ?? [],
        ...(activity !== undefined ? { activity } : {}),
        config: { schema: start.schema(), values: { ...settings } },
        // Present only while something is wanted. A client that opened the
        // session after the question was asked learns about it from here and
        // from nowhere else - the action that announced it is behind them.
        ...(waiting.size > 0 ? { inputNeeded: [...waiting.values()].map((one) => one.entry) } : {}),
      }),

      chatState: () => ({
        resource: start.chatUri,
        title,
        status: status(),
        modifiedAt: modified,
        turns,
        ...(active ? { activeTurn: active } : {}),
        ...(activity !== undefined ? { activity } : {}),
        ...(draft !== undefined ? { draft } : {}),
      }),

      sendMessage: (turnId, text, from, attachments) => { sendMessage(turnId, text, from, attachments); },

      // Notes are taken on no model and as no agent, so a pick of either is
      // kept by nothing.
      changeModel: () => {},
      changeAgent: () => {},

      // The draft the host said, held for the chat's state.
      setDraft: (next) => { draft = next; },

      /**
       * Stop the turn, and answer anything it was blocked on.
       *
       * Both halves, because a cancelled turn that leaves a question standing
       * is a session that reports `InputNeeded` for the rest of its life and
       * a promise that is never settled.
       */
      abort: () => {
        // The chat's turn is the last one handed; the turns it took the place
        // of stop with it, in no history.
        const turn = handed.at(-1)?.turn ?? active;
        // Each parked call and question is let go, and what it was parked in
        // stops there: by the time it resumes its turn is not the running one.
        for (const held of [...waiting.values()]) {
          removeInputNeeded(held.id);
          held.settle(false, {});
        }
        if (!turn) return;
        handed.length = 0;
        replaced.clear();
        turn.state = 'cancelled';
        // Required, and required in earnest: a client's reducer clamps it with
        // `Math.max(0, duration)` and adds it to the turn's start, so an absent
        // one is `NaN` and the reducer throws building a timestamp out of it.
        turn.duration = Date.now() - Date.parse(String(turn.startedAt));
        turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', {
          type: 'chat/turnCancelled',
          turnId: String(turn.id),
          duration: turn.duration,
        });
      },

      /**
       * Answer a tool call.
       *
       * Found by the call's own id rather than assumed to be the only one:
       * with two calls open, comparing against whichever was held last and
       * returning when it does not match is a person pressing Approve and
       * nothing at all happening.
       */
      confirm: (toolCallId, approved) => {
        const held = waiting.get(toolCallId);
        if (!held || held.entry.kind !== 'toolConfirmation') return false;
        removeInputNeeded(held.id);
        held.settle(approved, {});
        return true;
      },

      /**
       * Answer a question, keyed by the request's own id. False when nothing
       * is waiting on it; the host says the `chat/inputCompleted` back on true.
       */
      answer: (requestId, accepted, answers, response) => {
        const held = waiting.get(requestId);
        if (!held || held.entry.kind !== 'chatInput') return false;
        removeInputNeeded(held.id);
        held.settle(accepted, answers as Bag, response);
        return true;
      },

      /**
       * This backend's own key, changed on a running session.
       *
       * A sentence for a key or a value it does not have, saying which, for
       * the host's log: a key nobody serves and a value nobody takes are two
       * different things to go and fix.
       */
      setConfig: (key, value) => {
        if (key !== 'autoApprove') return `${key} is not a config key this backend takes`;
        if (value !== 'default' && value !== 'assisted' && value !== 'autoApprove') {
          return `autoApprove is one of default, assisted or autoApprove - not ${String(value)}`;
        }
        settings.autoApprove = value;
        return true;
      },

      setCustomizationEnabled: async () => false,
      startMcpServer: async () => false,
      stopMcpServer: async () => false,
      settings: () => ({ ...settings }),
      close: () => {
        closed = true;
        // Nothing else will ever settle these, and a turn parked on one is a
        // promise that outlives the session holding it.
        for (const held of [...waiting.values()]) {
          waiting.delete(held.id);
          held.settle(false, {});
        }
      },
    };
  }

  return {
    provider: 'notes',
    displayName: 'Notes',
    description: `Reads and writes notes in ${dir}`,
    schema,
    defaults,

    probe: async () => ({
      models: [],
      commands: [
        { name: 'read', description: 'Read a note' },
        { name: 'write', description: 'Write a note' },
      ],
      customizations: [],
    }),

    directories: () => [dir],

    list: async (): Promise<Listed[]> => [...kept.values()].map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      workingDirectories: [uriOf(session.workingDirectory)],
    })),

    // Asserted, not checked. This example assembles a turn by mutation - a
    // part is filled in as it streams - so its turns are `Bag`s here, while
    // the port now takes `WireTurn<Turn>`. The built-in provider checks each
    // literal where it is built; doing the same here is worth a pass of its own.
    transcript: async (id) => kept.get(id)?.turns as WireTurn<Turn>[] | undefined,

    create: createSession,
  };
}
