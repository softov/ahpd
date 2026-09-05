import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Turn } from '@microsoft/agent-host-protocol';
import type { Agent, Bag, Listed, Session, Start, WireTurn } from '../../src/index.js';

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
 * 2. `converse()` is the `Session`. `runTool` and `ask` are the two shapes
 *    worth taking away; everything else is bookkeeping around them.
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

/** When a tool stops and waits for a person. */
type Ask = 'writes' | 'always' | 'never';

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
  /** Let the parked turn go. `answers` is empty for a confirmation. */
  settle(accepted: boolean, answers: Bag): void;
}

/** What one line asks for. Anything unrecognised is `help`. */
type Line =
  | { verb: 'read'; name?: string }
  | { verb: 'write'; name?: string; text: string }
  | { verb: 'help' };

const parse = (said: string): Line => {
  const [verb = '', ...rest] = said.trim().split(/\s+/);
  const name = rest[0];
  if (verb.toLowerCase() === 'read') return { verb: 'read', ...(name ? { name } : {}) };
  if (verb.toLowerCase() === 'write') {
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

const HELP = [
  'I keep notes in a directory. Two things I can do:',
  '',
  '- `read <name>` - read one. Leave the name out and I will ask which.',
  '- `write <name> <text>` - write one. I will ask before I do.',
].join('\n');

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
  createdAt: string;
  modifiedAt: string;
  turns: Bag[];
}

export function notes(options: NotesOptions): Agent {
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
      ask: {
        type: 'string',
        title: 'Ask before',
        description: 'Which tools stop and wait for you.',
        enum: ['writes', 'always', 'never'],
        enumLabels: ['Writes', 'Everything', 'Nothing'],
        enumDescriptions: [
          'Reading runs; writing waits for you',
          'Every tool waits for you',
          'Nothing waits, which is what the difference looks like',
        ],
        default: 'writes',
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

  const defaults = (): Record<string, unknown> => ({ ask: 'writes', tone: 'plain' });

  /** Every note there is, newest name last. Missing directory means none yet. */
  const listNotes = async (): Promise<string[]> => {
    try {
      return (await readdir(dir)).filter((one) => one.endsWith('.md')).sort();
    } catch {
      return [];
    }
  };

  function converse(start: Start): Session {
    const settings = { ...start.settings };
    /** Finished turns. The running one is `active` and is deliberately not here. */
    const turns: Bag[] = [...(start.seed ?? [])];
    let active: Bag | undefined;
    let title = 'Notes session';
    let modified = new Date().toISOString();
    let closed = false;
    let activity: string | undefined;
    const queued: Bag[] = [];
    let draft = '';
    const id = start.resume ?? start.uri.replace(/^ahp-session:\//, '');
    const where = start.workingDirectory ?? dir;

    /** Tool call parts by their call id, so a result can find the part it belongs to. */
    const parts = new Map<string, Bag>();
    const waiting = new Map<string, Waiting>();

    const said = start.seed?.[0];
    if (said) title = String((said.message as Bag | undefined)?.text ?? title).slice(0, 60);

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
      kept.set(id, { id, title, createdAt: modified, modifiedAt: modified, turns: [...turns] });
    };

    const rest = (ms: number): Promise<void> => new Promise((wake) => { setTimeout(wake, ms); });

    /** Both halves of `inputNeeded`, which is a list keyed by id. */
    const wants = (held: Waiting): void => {
      waiting.set(held.id, held);
      start.emit('session', { type: 'session/inputNeededSet', request: held.entry });
      touch();
    };
    const wanted = (id: string): void => {
      waiting.delete(id);
      start.emit('session', { type: 'session/inputNeededRemoved', id });
      touch();
    };

    /**
     * Prose, streamed.
     *
     * `chat/responsePart` opens it and `chat/delta` fills it, in that order:
     * a delta naming a part nobody opened appends to nothing.
     */
    const say = async (turn: Bag, text: string): Promise<void> => {
      const part: Bag = { id: `${String(turn.id)}:${String((turn.responseParts as Bag[]).length)}`, kind: 'markdown', content: '' };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId: turn.id, part });
      for (const word of text.split(' ')) {
        if (closed) return;
        if (pace > 0) await rest(pace);
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
     * Resolves with the answers, or nothing if the person declined.
     */
    const ask = async (turn: Bag, request: Bag): Promise<Bag | undefined> => {
      const part: Bag = { id: String(request.id), kind: 'inputRequest', request };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/inputRequested', turnId: turn.id, request });
      doing('Waiting on you');
      const given = await new Promise<Bag | undefined>((settle) => {
        wants({
          id: String(request.id),
          entry: { id: request.id, chat: start.chatUri, kind: 'chatInput', request },
          settle: (accepted, answers) => { settle(accepted ? answers : undefined); },
        });
      });
      // Said back, because nothing in a client applies what it dispatched
      // itself: without this the question stays open on the screen that just
      // answered it, and on every other screen watching.
      part.response = given ? 'accept' : 'decline';
      if (given) (part.request as Bag).answers = given;
      start.emit('chat', {
        type: 'chat/inputCompleted',
        requestId: request.id,
        response: given ? 'accept' : 'decline',
        ...(given ? { answers: given } : {}),
      });
      return given;
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
      const call: Bag = {
        toolCallId: callId,
        toolName: tool.name,
        displayName: tool.displayName,
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
        doing(`Waiting on you: ${tool.displayName}`);
        const allowed = await new Promise<boolean>((settle) => {
          wants({
            id: callId,
            entry: { id: callId, chat: start.chatUri, kind: 'toolConfirmation', turnId: turn.id, toolCall: call },
            settle: (accepted) => { settle(accepted); },
          });
        });
        call.status = allowed ? 'running' : 'cancelled';
        if (allowed) call.confirmed = 'user-action';
        // Said back, like every other action a client originates.
        start.emit('chat', {
          type: 'chat/toolCallConfirmed',
          turnId: turn.id,
          toolCallId: callId,
          approved: allowed,
          ...(allowed ? { confirmed: 'user-action' } : { reason: 'denied' }),
        });
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
      const given = await ask(turn, request);
      if (!given) return undefined;
      const answer = (given.name ?? {}) as Bag;
      const value = (answer.value ?? {}) as Bag;
      // Selected says which option; freeform is the person's own words.
      return String(value.optionId ?? value.text ?? answer.value ?? '') || undefined;
    };

    const beginTurn = (turnId: string, text: string, queuedMessageId?: string): void => {
      if (title === 'Notes session' && text) {
        title = text.slice(0, 60);
        start.emit('session', { type: 'session/titleChanged', title });
      }
      const startedAt = new Date().toISOString();
      const turn: Bag = { id: turnId, startedAt, message: { text }, responseParts: [] };
      active = turn;
      start.emit('chat', {
        type: 'chat/turnStarted',
        turnId,
        startedAt,
        message: { text },
        ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
      });
      doing('Reading what you asked');
      const began = Date.now();

      void (async () => {
        try {
          await work(turn, text);
        } catch (wrong) {
          await say(turn, wrong instanceof Error ? wrong.message : String(wrong));
        }
        if (closed || active !== turn) return;
        turn.duration = Date.now() - began;
        turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', { type: 'chat/turnComplete', turnId, duration: turn.duration });
        startNext();
      })();
      touch();
    };

    /** What the line asked for, done. */
    const work = async (turn: Bag, text: string): Promise<void> => {
      const line = parse(text);
      const policy = (settings.ask ?? 'writes') as Ask;

      if (line.verb === 'help') {
        await say(turn, HELP);
        return;
      }

      const named = line.name ?? await whichNote(turn);
      if (named === undefined) {
        await say(turn, 'No note named, so nothing to do.');
        return;
      }
      const file = nameOf(named);
      if (file === undefined) {
        await say(turn, `\`${named}\` is not a name I will use as a file.`);
        return;
      }
      const path = join(dir, file);

      if (line.verb === 'read') {
        const ran = await runTool(turn, {
          name: 'readNote',
          displayName: 'Read note',
          invocation: `Read ${file}`,
          input: file,
          // Reading is the tool that does not ask, unless somebody set it to.
          ...(policy === 'always' ? { confirmationTitle: `Read ${file}?` } : {}),
          run: async () => {
            const held = await readFile(path, 'utf8');
            return held === '' ? `${file} is empty` : held;
          },
        });
        await say(turn, ran ? `That is all of ${file}.` : `Left ${file} unread.`);
        return;
      }

      const ran = await runTool(turn, {
        name: 'writeNote',
        displayName: 'Write note',
        invocation: `Write ${file}`,
        input: line.text === '' ? file : `${file}: ${line.text}`,
        // Writing is the tool that asks, unless somebody set it not to.
        ...(policy === 'never' ? {} : { confirmationTitle: `Write ${file}?` }),
        edits: path,
        run: async () => {
          await mkdir(dir, { recursive: true });
          await writeFile(path, `${line.text}\n`, 'utf8');
          return `Wrote ${String(line.text.length + 1)} bytes to ${file}`;
        },
      });
      await say(turn, ran ? `${file} is saved.` : `Left ${file} alone.`);
    };

    const startNext = (): void => {
      if (active || closed) return;
      const next = queued.shift();
      if (!next) return;
      const message = (next.message ?? {}) as Bag;
      beginTurn(crypto.randomUUID(), String(message.text ?? ''), String(next.id));
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
      workingDirectories: () => [`file://${where}`],

      sessionState: () => ({
        resource: start.uri,
        provider: 'notes',
        title,
        status: status(),
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title }],
        workingDirectories: [`file://${where}`],
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
        ...(draft !== '' ? { draft } : {}),
        queuedMessages: [...queued],
      }),

      begin: (turnId, text) => { beginTurn(turnId, text); },

      queue: (id, text) => {
        const entry: Bag = { id, message: { text } };
        const at = queued.findIndex((held) => held.id === id);
        if (at >= 0) queued[at] = entry;
        else queued.push(entry);
        start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
        touch();
        startNext();
      },

      unqueue: (id) => {
        const at = queued.findIndex((held) => held.id === id);
        if (at < 0) return;
        queued.splice(at, 1);
        start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
        touch();
      },

      reorder: (order) => {
        const byId = new Map(queued.map((held) => [String(held.id), held]));
        const seen = new Set<string>();
        const moved: Bag[] = [];
        for (const one of order) {
          const held = byId.get(one);
          if (!held || seen.has(one)) continue;
          seen.add(one);
          moved.push(held);
        }
        for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
        queued.length = 0;
        queued.push(...moved);
        start.emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
        touch();
      },

      setDraft: (text) => {
        if (text === draft) return;
        draft = text;
        start.emit('chat', { type: 'chat/draftChanged', draft: text });
      },

      /**
       * Stop the turn, and answer anything it was blocked on.
       *
       * Both halves, because a cancelled turn that leaves a question standing
       * is a session that reports `InputNeeded` for the rest of its life and
       * a promise that is never settled.
       */
      cancel: (turnId) => {
        const turn = active;
        for (const held of [...waiting.values()]) {
          wanted(held.id);
          held.settle(false, {});
        }
        if (!turn) return;
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
          turnId: turnId || String(turn.id),
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
        if (!held || held.entry.kind !== 'toolConfirmation') return;
        wanted(held.id);
        held.settle(approved, {});
      },

      /** Answer a question, keyed by the request's own id. */
      answer: (requestId, accepted, answers) => {
        const held = waiting.get(requestId);
        if (!held || held.entry.kind !== 'chatInput') return;
        wanted(held.id);
        held.settle(accepted, answers as Bag);
      },

      /**
       * This backend's own key, changed on a running session.
       *
       * A sentence for a key or a value it does not have, and saying which is
       * the point: a setter that reported success and changed nothing would
       * leave a client showing a session in a mode it is not in, and one that
       * said "no such key" about a bad *value* would tell it to stop drawing a
       * control that works.
       */
      setConfig: (key, value) => {
        if (key !== 'ask') return `${key} is not a config key this backend takes`;
        if (value !== 'writes' && value !== 'always' && value !== 'never') {
          return `ask is one of writes, always or never - not ${String(value)}`;
        }
        settings.ask = value;
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
      workingDirectories: [`file://${dir}`],
    })),

    // Asserted, not checked. This example assembles a turn by mutation - a
    // part is filled in as it streams - so its turns are `Bag`s here, while
    // the port now takes `WireTurn<Turn>`. The built-in provider checks each
    // literal where it is built; doing the same here is worth a pass of its own.
    transcript: async (id) => kept.get(id)?.turns as WireTurn<Turn>[] | undefined,

    create: converse,
  };
}
