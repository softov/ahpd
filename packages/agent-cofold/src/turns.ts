import { run } from '@cofold/agents';
import type { Agent as CofoldAgent, ContentPart, ImagePart, TextPart } from '@cofold/agents';
import { bag, partsOf, reason, str, titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, CommandTerminal, MessageAttachment, MessageFrom, RunCommand, Session } from '@ahpd/sdk';
import { modelReferenceOf } from './agent.js';
import { mapTurn } from './mapping.js';
import type { TurnMapping } from './mapping.js';
import { ruleName, toolCallPart, toolStartAction } from './tools.js';
import { AGENT_ID } from './turnagent.js';
import type { SessionContext } from './context.js';

/** The attachments a message a client sent carries, where it carries any. */
const attachmentsOf = (message: unknown): MessageAttachment[] | undefined => {
  const kept = bag(message).attachments;
  return Array.isArray(kept) ? kept as MessageAttachment[] : undefined;
};

/**
 * A message's text and attachments, as the content parts cofold takes.
 *
 * `partsOf` decides what each attachment is - an image, an inlined text, or a
 * line in the one reference block at the end - within the limits every backend
 * shares, and `images` is the model in force, so a picture is sent as bytes
 * only to a model that takes one.
 *
 * What is added here is cofold's own two shapes. The `source` the helper keeps
 * for a backend whose block names what it carries is dropped: cofold sends the
 * part itself, and a second copy of a pasted file's text in the transcript is
 * a copy nothing reads.
 */
export const partsFor = async (
  text: string,
  attachments: MessageAttachment[],
  images: boolean,
): Promise<(TextPart | ImagePart)[]> => {
  const parts = await partsOf(text, attachments, { images });
  return parts.map((one) => (one.type === 'image'
    ? { type: 'image', mimeType: one.mimeType, data: one.data }
    : { type: 'text', text: one.text }));
};

/** What opening a turn and running the queue offer the other areas. */
export interface Turns {
  beginTurn: (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    queuedMessageId?: string,
    attachments?: MessageAttachment[],
  ) => void;
  startNext: () => void;
  /**
   * Whether the model the running turn was built on takes an image.
   *
   * Read by `steer`, which has no agent of its own: a correction reaches the
   * model the turn is already running on, and a picture sent to one that
   * refuses images is a turn that fails rather than a correction.
   */
  takesImages: () => boolean;
}

export const createTurns = (
  ctx: SessionContext,
): Turns & { methods: Pick<Session, 'ran' | 'queue' | 'unqueue' | 'reorder'> } => {
  const { start, options, harness, sessionId, where, settings, turns, queued } = ctx;

  /**
   * Whether the model the turn now running was built on takes an image.
   *
   * Set where the agent is built, because that is the one place the adapter in
   * force is known, and read by `steer` for a message sent into that same run.
   */
  let takesImages = false;

  /**
   * Title a session nobody has named from the first thing said in it.
   *
   * Said, because a client that opened the session holds the old one.
   */
  const retitle = (text: string): void => {
    if (ctx.title !== 'Cofold session' || text === '') return;
    const said = titleFrom(text, 'Cofold session');
    if (said === ctx.title) return;
    ctx.title = said;
    start.emit('session', { type: 'session/titleChanged', title: said });
  };

  /**
   * Open a turn on the wire, before anything runs it.
   *
   * `chat/turnStarted` is emitted here, before `run()` is called, because the
   * host has already dispatched that action and AHP requires the order
   * turnStarted, then an opened part, then deltas. cofold's own `run.started`
   * therefore means nothing on the wire and is dropped in `mapping.ts`.
   *
   * `queuedMessageId` names the waiting message it came from; a client's
   * reducer takes it out of the queue on that word.
   *
   * Answers nothing for a session that is closed or already running a turn.
   * Both a turn with a run behind it and one that has to be failed before it
   * starts share this opening, so a client sees the same turn either way.
   */
  const openTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    queuedMessageId?: string,
    attachments?: MessageAttachment[],
  ): { mapping: TurnMapping; values: Record<string, unknown>; reference: string | undefined } | undefined => {
    if (ctx.closed || ctx.active !== undefined) return undefined;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    // A model named on the turn wins over the session's, and is what the
    // usage report names; it is applied before the agent is built.
    const values: Record<string, unknown> = model === undefined ? settings : { ...settings, model: model.id };
    // The reference the turn runs on, by the one rule `connectionOf` resolves:
    // the values in force, then the plugin option, then the harness file.
    const reference = modelReferenceOf(options, values, harness);
    const began = Date.now();
    // No part yet: each is opened when the model starts writing the block it holds.
    ctx.active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
        // The message's own, so a client reopening the chat reads the picture
        // beside the words the turn was accepted with - and so a message the
        // queue handed over keeps what was pasted into it.
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        // The protocol's `Message.model`: the model this turn runs on, so a
        // client that reconnects shows it. The client's own `config` travels
        // with it, as a claude turn's does.
        ...(reference !== undefined
          ? { model: { id: reference, ...(model?.config === undefined ? {} : { config: model.config }) } }
          : {}),
      },
      responseParts: [],
    };
    start.emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: ctx.active.startedAt,
      message: ctx.active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    /*
     * The first message titles a session nobody has named.
     *
     * Said after the turn has started, as the other harnesses say it: VS Code
     * draws the message a second time when the title comes first. A message of
     * nothing but blanks answers the fallback, which is the title already held,
     * so nothing moves and nothing is said about it.
     */
    retitle(text);
    ctx.doing('Thinking');

    const mapping = mapTurn({
      turnId,
      chatUri: start.chatUri,
      parts: ctx.active.responseParts as Bag[],
      startedAt: began,
      displayNameOf: (name) => ctx.offered.find((one) => one.definition.name === name)?.definition.title ?? name,
      ownerOf: (name) => ctx.offered.find((one) => one.definition.name === name)?.owner,
      cancelled: () => ctx.cancelRequested,
      // The operator's rule, read when a call is put to a person: a matched
      // tool's question offers no session choice cofold would remember.
      asksEveryTime: (name) => start.getAutoApproval?.('tool', ruleName(ctx.offered, name)) === 'ask',
      ...(reference !== undefined ? { model: reference } : {}),
    });
    ctx.activeMapping = mapping;
    return { mapping, values, reference };
  };

  /**
   * Start a turn, whoever asked for it.
   *
   * A message with nothing attached runs in the tick the turn was opened in,
   * on the text it arrived with. One with attachments waits a turn of the
   * event loop first: `partsOf` reads the files the host wrote beside the
   * message, and only then is the model given parts rather than words. The
   * turn is open on the wire for that moment, so a stop or a close landing
   * inside it is answered here rather than left to a run that never started.
   */
  const startTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    queuedMessageId?: string,
    attachments?: MessageAttachment[],
  ): void => {
    const opened = openTurn(turnId, text, model, from, queuedMessageId, attachments);
    if (opened === undefined) return;
    /*
     * A turn that cannot start fails that turn, not the process.
     *
     * Building the agent resolves the model, and a session with none chosen,
     * no default and a harness file that names none has nothing to run on.
     * Thrown from here it would escape every handler and take the daemon and
     * every other session with it; answered, it is one failed turn with the
     * reason on it.
     */
    let agent: CofoldAgent;
    try {
      agent = ctx.agentOf(opened.values);
    }
    catch (error) {
      void ctx.apply(opened.mapping, turnId, refusal(turnId, 'start_failed', error));
      return;
    }
    // Before the run, so a correction sent the moment the turn appears is read
    // on the model this turn is about to run on.
    takesImages = agent.model.features.images;

    const launch = (input: string | ContentPart[]): void => {
      let live: ReturnType<typeof run>;
      try {
        live = run({
          agent,
          session: sessionId,
          workspace: where,
          input,
          // Kept on the run record, which is where a rebuilt turn reads its model.
          ...(opened.reference !== undefined ? { model: opened.reference } : {}),
        });
      }
      catch (error) {
        void ctx.apply(opened.mapping, turnId, refusal(turnId, 'start_failed', error));
        return;
      }
      ctx.handle = live;
      ctx.read(live, opened.mapping, turnId);
      ctx.touch();
    };

    if (attachments === undefined || attachments.length === 0) {
      launch(text);
      return;
    }
    /*
     * `images` is what the model this turn resolves takes, never assumed: an
     * image part to a model without the feature throws, and the message is
     * stored, so every later turn of the session would fail on it too.
     */
    void (async (): Promise<void> => {
      try {
        const parts = await partsFor(text, attachments, agent.model.features.images);
        // A turn somebody else settled while the files were being read is not
        // this call's to start, and not this call's to fail either.
        if (ctx.active === undefined || String(ctx.active.id) !== turnId) return;
        if (ctx.cancelRequested || ctx.closed) {
          await ctx.apply(opened.mapping, turnId, stopped(turnId));
          return;
        }
        launch(parts);
      }
      catch (error) {
        await ctx.apply(opened.mapping, turnId, refusal(turnId, 'start_failed', error));
      }
    })();
  };

  /** The `run.finished` a turn that never ran ends with. */
  const refusal = (turnId: string, code: string, why: unknown) => ({
    seq: 0,
    runId: `${turnId}:refused`,
    sessionId,
    agentId: AGENT_ID,
    at: new Date().toISOString(),
    type: 'run.finished' as const,
    outcome: {
      status: 'failed' as const,
      error: { code, message: reason(why) },
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0,
      denials: [],
    },
  });

  /**
   * The `run.finished` a turn that was stopped before it ran ends with.
   *
   * A cancel reaches a run through its handle, and a turn whose message is
   * still being read has no handle yet, so the stop finds nothing to stop. The
   * turn is already open on the wire, though, and one that never settles is a
   * spinner nothing can clear - so the ending it would have had is handed to
   * the mapping, the way a turn that cannot start is.
   */
  const stopped = (turnId: string) => ({
    seq: 0,
    runId: `${turnId}:stopped`,
    sessionId,
    agentId: AGENT_ID,
    at: new Date().toISOString(),
    type: 'run.finished' as const,
    outcome: {
      status: 'cancelled' as const,
      reason: 'the turn was stopped before it ran',
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0,
      denials: [],
    },
  });

  /**
   * A turn that cannot run, answered with the reason.
   *
   * The client has already dispatched its own `chat/turnStarted`, so the turn
   * exists whether or not a run does, and leaving it open would be a spinner
   * nothing can settle. The failure goes through the mapping like every other
   * ending, so a client draws the same `chat/error` a failed run produces.
   *
   * This is the path a session whose fork or rewind could not be cut takes: the
   * honest answer to "carry on from there" is that there is no there.
   */
  const failTurn = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    queuedMessageId: string | undefined,
    attachments: MessageAttachment[] | undefined,
    why: unknown,
  ): void => {
    const opened = openTurn(turnId, text, model, from, queuedMessageId, attachments);
    if (opened === undefined) return;
    void ctx.apply(opened.mapping, turnId, refusal(turnId, 'cut_refused', why));
  };

  /**
   * Begin a turn, once the resume lookup has settled.
   *
   * A resumed session may already have an open turn waiting on a person, so a
   * second run would fight the paused one for the session's writer claim and
   * fail `writer_busy`. Waiting for the lookup is what tells the two apart,
   * and it costs an ordinary session nothing: `opening` is only set when the
   * host named a conversation to continue and when a fork or a rewind is being
   * cut.
   *
   * A chain that ended in a refusal - a cut the store would not make - leaves
   * every turn on the failure path rather than on the ordinary one: the client
   * asked to carry on from a point, and carrying on from somewhere else
   * without saying so is the one answer that is worse than an error.
   */
  const beginTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    queuedMessageId?: string,
    attachments?: MessageAttachment[],
  ): void => {
    const start = (): void => {
      if (ctx.refused !== undefined) {
        failTurn(turnId, text, model, from, queuedMessageId, attachments, ctx.refused);
        return;
      }
      /*
       * The record first, so this turn runs on what it says now.
       *
       * A record that can no longer be used ends this turn with the sentence,
       * rather than running on the options of the turn before.
       */
      const why = ctx.refreshOptions();
      if (why !== undefined) {
        failTurn(turnId, text, model, from, queuedMessageId, attachments, new Error(why));
        return;
      }
      startTurn(turnId, text, model, from, queuedMessageId, attachments);
    };
    if (ctx.refused !== undefined) {
      start();
      return;
    }
    const waiting = ctx.opening;
    if (waiting === undefined) {
      start();
      return;
    }
    void waiting.then(start, start);
  };

  /** The head of the queue, once there is nothing running. */
  const startNext = (): void => {
    if (ctx.opening !== undefined) {
      // A paused run decides whether anything may be taken off the queue, so
      // the queue waits for the same lookup every turn does.
      void ctx.opening.then(startNext, startNext);
      return;
    }
    if (ctx.active !== undefined || ctx.closed) return;
    const next = queued.shift();
    if (next === undefined) return;
    /*
     * A command somebody typed is run, not asked.
     *
     * `ran` queued it as text so a client could see it waiting, and handing
     * that text to the run loop is the one thing `!` exists not to do. It runs
     * under a fresh turn id with the waiting row named, which is how a queued
     * message of any other kind becomes a turn.
     */
    const held = bag(next.command);
    const typed = str(held.text);
    if (typed !== undefined && typeof held.run === 'function') {
      runCommand(crypto.randomUUID(), typed, held.run as RunCommand, str(next.id));
      return;
    }
    const message = bag(next.message);
    beginTurn(
      crypto.randomUUID(),
      String(message.text ?? ''),
      next.model as Chosen | undefined,
      next.from as MessageFrom | undefined,
      String(next.id),
      attachmentsOf(message),
    );
  };

  /**
   * One shell command as a turn of this chat's.
   *
   * The whole of what `!command` means, and one function because it is reached
   * two ways: immediately from `ran`, and later from `startNext` when the
   * command was typed while a turn was already running. The host runs it in one
   * of its own terminals and hands back what happened, so nothing here reaches
   * cofold's run loop - which is the whole difference from `beginTurn`, and why
   * a person's shell command never becomes a question to a model.
   *
   * `queuedMessageId` names the waiting row it came from, so a client clears it
   * the way it clears any other.
   */
  const runCommand = (
    turnId: string,
    command: string,
    run: RunCommand,
    queuedMessageId?: string,
  ): void => {
    if (ctx.closed || ctx.active !== undefined) return;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    const began = Date.now();
    const toolCallId = `${turnId}:command`;
    // The call as a part, because a client that subscribes after the command
    // ran reads the snapshot rather than the actions it missed. The command is
    // its intention, as the reference host starts its own.
    const part = toolCallPart(toolCallId, 'terminal', 'Terminal', undefined, undefined, command);
    const call = bag(part.toolCall);
    ctx.active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: { text: `!${command}`, origin: { kind: 'user' } },
      responseParts: [part],
    };
    start.emit('chat', {
      type: 'chat/turnStarted', turnId, startedAt: ctx.active.startedAt, message: ctx.active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    retitle(command);
    start.emit('chat', toolStartAction(turnId, toolCallId, 'terminal', 'Terminal', undefined, undefined, command));
    /*
     * The ready the reference host sends for its own: the command is the line
     * and the input, and nobody is asked. Onto the held call and into the
     * action from one object, so a client that subscribes while the command
     * runs reads the running call a watching client holds.
     * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L75-L82
     */
    const ready: Bag = { invocationMessage: command, toolInput: command, confirmed: 'not-needed' };
    Object.assign(call, ready, { status: 'running' });
    start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId, ...ready });
    ctx.doing('Running');
    ctx.touch();
    /*
     * The block a client opens the command's terminal from. `isPty` is the
     * terminal's own, which a client reads to decide whether the output holds
     * VT sequences, and it is left out where the host says nothing.
     */
    const terminalOf = (terminal: CommandTerminal): Bag => ({
      type: 'terminal',
      resource: terminal.uri,
      title: 'Terminal',
      ...(terminal.isPty === undefined ? {} : { isPty: terminal.isPty }),
    });
    void run(toolCallId, (opened) => {
      if (ctx.active === undefined || String(ctx.active.id) !== turnId) return;
      /*
       * The terminal as soon as it opens, so a client watches the output
       * arrive, as the reference host names its own. Onto the call and into
       * the action from one object, and with no `_meta`, which the reducer
       * would put in place of the call's.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104
       */
      const content = [terminalOf(opened)];
      call.content = content;
      start.emit('chat', { type: 'chat/toolCallContentChanged', turnId, toolCallId, content });
    }).then((done) => {
      if (ctx.active === undefined || String(ctx.active.id) !== turnId) return;
      // The terminal again, with how the command ended, and then the text it
      // printed: `content` is replaced, not appended to.
      const content: Bag[] = [
        ...(done.terminal === undefined ? [] : [{
          ...terminalOf({ uri: done.terminal, ...(done.isPty === undefined ? {} : { isPty: done.isPty }) }),
          result: {
            ...(done.code !== undefined ? { exitCode: done.code } : {}),
            ...(done.output === '' ? {} : { preview: done.output }),
          },
        }]),
        ...(done.output === '' ? [] : [{ type: 'text', text: done.output }]),
      ];
      const result: Bag = {
        success: done.success,
        pastTenseMessage: done.said,
        content,
        ...(done.success ? {} : { error: { message: done.said } }),
      };
      // Into the part as well, so the snapshot a late subscriber reads holds
      // the finished call rather than the running one.
      Object.assign(call, result, { status: 'completed' });
      start.emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId, result });
      const duration = Date.now() - began;
      ctx.active.state = done.success ? 'complete' : 'error';
      ctx.active.duration = duration;
      turns.push(ctx.active);
      ctx.active = undefined;
      /*
       * The turn closes like any other.
       *
       * A shell command is a turn of this chat, so a client that watched it
       * needs the same completion a model's answer gets; without it the row
       * stays open on screen while the session already counts it as done.
       */
      start.emit('chat', { type: 'chat/turnComplete', turnId, duration });
      ctx.doing(undefined);
      ctx.touch();
      startNext();
    });
  };

  /**
   * A turn the host answered itself, with a shell rather than the agent.
   *
   * `!command` means "run this", and the host owns the shell, so what comes
   * back is the same shape as any other turn: it opens, carries one tool
   * call, and completes. What waits on a busy session is the command itself
   * and not the text of it, so when its turn comes `startNext` runs it
   * rather than handing `!ping` to a model.
   */
  const ran: Session['ran'] = (turnId, command, run, queuedAs) => {
    if (ctx.active !== undefined || ctx.opening !== undefined || (queuedAs !== undefined && queued.length > 0)) {
      const id = queuedAs ?? turnId;
      const message = { text: `!${command}`, origin: { kind: 'user' } };
      const entry = { id, command: { text: command, run }, message };
      const at = queued.findIndex((held) => String(held.id) === id);
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
      ctx.touch();
      return;
    }
    runCommand(turnId, command, run, queuedAs);
  };

  const queue: Session['queue'] = (id, text, model, from, attachments) => {
    const message: Bag = {
      text,
      ...(from?.origin !== undefined ? { origin: from.origin } : {}),
      ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      // Held with the message, so a picture pasted into one that waits is
      // still a picture when its turn comes - and so a client draws it while
      // it waits rather than only after it runs.
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    };
    const entry: Bag = {
      id,
      message,
      ...(model !== undefined ? { model } : {}),
      ...(from !== undefined ? { from } : {}),
    };
    const at = queued.findIndex((held) => held.id === id);
    if (at >= 0) queued[at] = entry;
    else queued.push(entry);
    start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
    ctx.touch();
    startNext();
  };

  const unqueue: Session['unqueue'] = (id) => {
    const at = queued.findIndex((held) => held.id === id);
    if (at < 0) return;
    queued.splice(at, 1);
    start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
    ctx.touch();
  };

  const reorder: Session['reorder'] = (order) => {
    const byId = new Map(queued.map((held) => [String(held.id), held]));
    const seen = new Set<string>();
    const moved: Bag[] = [];
    for (const id of order) {
      const held = byId.get(id);
      if (held === undefined || seen.has(id)) continue;
      seen.add(id);
      moved.push(held);
    }
    // Anything the order did not name keeps its place behind what it did.
    for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
    queued.length = 0;
    queued.push(...moved);
    start.emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
    ctx.touch();
  };

  return {
    beginTurn,
    startNext,
    takesImages: () => takesImages,
    methods: { ran, queue, unqueue, reorder },
  };
};