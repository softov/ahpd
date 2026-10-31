import type { ActiveTurn, ToolCallCompletedState, ToolCallRunningState, ToolResultTerminalContent, ToolResultTextContent } from '@microsoft/agent-host-protocol';
import { titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, CommandTerminal, MessageAttachment, MessageFrom, OnWire, RunCommand, TurnOptions, WireTurn } from '@ahpd/sdk';
import { blocksFor } from './attachments.js';
import { bag, list, str, UUID } from './common.js';
import { EFFORTS } from './config.js';
import type { Owed, SessionContext } from './context.js';

/** What this area offers the rest of the session. */
export interface Turns {
  /** The messages waiting for a turn, in the order they will be sent. */
  queued: Bag[];
  /** Start the head of the queue, once there is nothing running. */
  startNext: () => void;
  /**
   * What a turn sent a CLI that was put away, sent to the one that took its
   * place: the running turn's prompt, as it went out the first time, and then
   * `steers`, the steering messages the CLI put away still owed an answer to.
   *
   * Each under a new uuid, the prompt's told to the host, because the first may
   * already be written under the old one. With no turn running, the steering
   * messages go alone, and are answered in a turn of their own.
   */
  again: (steers: readonly Owed[]) => Promise<void>;
  /** Open the turn that answers the steering messages a turn that ended left with the CLI, when the CLI holds one. */
  handOver: (turnId: string) => void;
  /** Open the turn that answers the steering message sent under `uuid`, with the others its turn left. */
  present: (uuid: string) => void;
  methods: {
    begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions) => void;
    setTitle: (title: string) => void;
    ran: (turnId: string, command: string, run: RunCommand, queuedAs?: string) => void;
    steer: (id: string, text: string, attachments?: MessageAttachment[]) => boolean;
    queue: (id: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions) => void;
    setDraft: (draft: Bag | undefined) => void;
    unqueue: (id: string) => void;
    reorder: (order: string[]) => void;
    resume: (turnId: string) => boolean;
    cancel: (turnId: string) => void;
  };
}

/** The attachments a message holds, as a message sent to the CLI takes them. */
const attachedTo = (message: Bag): MessageAttachment[] | undefined =>
  Array.isArray(message.attachments) ? message.attachments as MessageAttachment[] : undefined;

export function createTurns(ctx: SessionContext): Turns {
  /**
   * Messages waiting for the running turn to end.
   *
   * The host's, not a client's. A client that held them would be the only
   * thing that could ever send them, and would not - nothing in a client is
   * watching for a turn to end - and a second client watching the same chat
   * would not see them at all.
   */
  const queued: Bag[] = [];

  /** Whether a turn of this session is running, or is part-way into becoming one. */
  const busy = (): boolean => ctx.active !== undefined || ctx.beginning !== undefined;

  /**
   * Start a turn, whoever asked for it.
   *
   * `queuedMessageId` names the waiting message this turn came from, and the
   * client's reducer takes it out of the queue on that word - which is what
   * makes the queue empty as its turns start rather than needing a second
   * action to say so.
   */
  /** Context for the first prompt only, which never reaches the wire. */
  let carried = ctx.options.context;

  /**
   * A message onto the CLI's own input stream, as what it is.
   *
   * Where a turn beginning, a message steering one, and a message taken off the
   * queue all reach the CLI: the wake and the touch happen in one place, and a
   * message's attachments become the blocks the CLI takes whichever way it
   * arrived. A message with none is the string it always was. `uuid` is the id
   * the CLI writes the prompt under and names its answer by, and `owed` is the
   * answer that is to come, held until a result names the uuid.
   */
  const push = async (
    text: string,
    attachments?: MessageAttachment[],
    uuid?: string,
    owed?: Owed,
  ): Promise<void> => {
    // Held before the wait: a result read while the blocks are built is not
    // this prompt's answer, and has to know that one is still to come.
    if (uuid !== undefined && owed !== undefined) ctx.owed.set(uuid, owed);
    const to = ctx.handle;
    const content = await blocksFor(text, attachments);
    // A CLI put away meanwhile took what it was owed with it, and the one in
    // its place is sent that by whatever put it there.
    if (ctx.handle !== to) return;
    ctx.waiting.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      ...(uuid === undefined ? {} : { uuid: uuid as `${string}-${string}-${string}-${string}-${string}` }),
    });
    ctx.wake?.();
    ctx.wake = undefined;
    ctx.touch();
  };

  /**
   * The id a turn's prompt is written under in the CLI's transcript, which is
   * the id a read after a restart gives the turn.
   *
   * The CLI writes a streamed prompt under the `uuid` it carries and echoes
   * nothing back, so the id is chosen here rather than heard: the turn's own id
   * where it is a UUID, as the reference writes a prompt under its turn id, and
   * one of its own otherwise, said to the host so what it keeps against the
   * turn is kept under that id too. A prompt sent again takes a new one, since
   * the first may already be written under the old.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1294-L1298
   */
  const writtenAs = (turnId: string, again: boolean): string => {
    const uuid = !again && UUID.test(turnId) ? turnId : crypto.randomUUID();
    if (uuid !== turnId) ctx.options.onTurnRecorded?.(turnId, uuid);
    return uuid;
  };

  /**
   * The running turn's prompt as it went to the CLI, with what rode on it.
   *
   * The text a side chat's first prompt carries is not the message's text, and
   * a message's attachments are blocks of their own, so a prompt sent again is
   * this rather than the turn's message. A turn opened for a steering message
   * has that message as its prompt.
   */
  let prompted: { turn: string; text: string; attachments?: MessageAttachment[] } | undefined;

  const again = async (steers: readonly Owed[]): Promise<void> => {
    const turn = ctx.active;
    if (turn !== undefined && prompted?.turn === String(turn.id)) {
      const uuid = writtenAs(String(turn.id), true);
      await push(prompted.text, prompted.attachments, uuid, { message: bag(turn.message), steering: false, turn: String(turn.id), cli: 'sent' });
    }
    // Behind the prompt, in the order they went.
    for (const one of steers) {
      void push(str(one.message.text) ?? '', attachedTo(one.message), crypto.randomUUID(), { ...one, cli: 'sent' });
    }
  };

  /**
   * A turn that never reaches the CLI, recorded as one that started and failed.
   *
   * The ordinary lifecycle compressed. Both events rather than the error alone,
   * because `queuedMessageId` rides on the first: a turn taken from the queue
   * has to clear its waiting row, and a client that is only told about the
   * failure keeps showing a message it already sent.
   */
  const refuseTurn = (
    turnId: string,
    text: string,
    why: string,
    queuedMessageId?: string,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
  ): void => {
    const turn = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        origin: from?.origin ?? { kind: 'user' },
        ...(from?._meta ? { _meta: from._meta } : {}),
        // Kept, though nothing was sent: the turn is in the transcript, and a
        // client reading it back shows the picture the person pasted.
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      },
      responseParts: [],
      state: 'error',
      duration: 0,
    } as unknown as Bag;
    const part = ctx.addFailure(turn, why);
    ctx.turns.push(turn);
    ctx.failed = why;
    ctx.emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: turn.startedAt,
      message: turn.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    ctx.emit('chat', { type: 'chat/error', turnId, duration: 0, part });
    ctx.doing(undefined);
    ctx.touch();
  };

  const beginTurn = async (
    turnId: string,
    text: string,
    model?: Chosen,
    queuedMessageId?: string,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ): Promise<void> => {
    /*
     * One turn at a time in a chat.
     *
     * `active` is the one turn this chat has, and a second begun on top of it
     * takes its place and the parts it has already streamed with it - so the
     * turn a person is watching leaves the transcript while its own answer is
     * still arriving. `begin` refuses a client's turn while one runs, and the
     * queue takes its next message once nothing does; `beginning` counts as
     * running, which is a turn switching its model.
     */
    if (busy()) return;
    /*
     * The tools the session was handed before this turn, landed first.
     *
     * A change of tools reaches the CLI as `setMcpServers`, which the CLI
     * answers once it has the servers, and the host hands it over without
     * waiting; a turn that comes after it is a turn of a session that has
     * those tools. Named in `beginning` while it waits, as a model switch is,
     * so a message queued behind it waits too.
     */
    if (ctx.retooling !== undefined) {
      ctx.beginning = turnId;
      await ctx.retooling;
      ctx.beginning = undefined;
      if (ctx.closed) return;
    }
    /*
     * A session whose CLI has exited answers at once, and says why.
     *
     * The turn is recorded as one that failed rather than refused, because a
     * person typed it and it belongs in the transcript beside the reason. The
     * alternative is what this replaces: `active` set on a session with
     * nothing left to answer it, which reads as thinking for ever and never
     * says the CLI never started.
     */
    if (ctx.gone !== undefined) {
      refuseTurn(turnId, text, ctx.gone, queuedMessageId, from, attachments);
      return;
    }
    /*
     * The agent this message picked, taken before the model and before the
     * prompt, because it is what decides which CLI the model is switched on.
     *
     * The record is read first: a session started from an agent record is one
     * somebody may edit while it runs, and the edit reaches the CLI here - on
     * the turn after it, with the conversation resumed onto the new CLI.
     *
     * Named in `beginning` for as long as it takes, so a message queued behind
     * this one waits rather than reaching the CLI beside the one being built.
     */
    ctx.beginning = turnId;
    const refused = ctx.refreshPreset() ?? ctx.switchAgent(from?.agent?.uri);
    ctx.beginning = undefined;
    if (refused !== undefined) {
      refuseTurn(turnId, text, refused, queuedMessageId, from, attachments);
      ctx.startNext();
      return;
    }
    /*
     * The model this turn names, taken before the prompt goes out and before
     * the turn is credited to it.
     *
     * The turn is busy for as long as this takes - named in `beginning` from
     * here, so a message queued behind it waits rather than reaching the CLI
     * first - and the marker comes off again whichever way the switch went,
     * because a turn that ends is a turn the next one may start behind.
     */
    if (model !== undefined && model.id !== ctx.chosen) {
      ctx.beginning = turnId;
      const refused = await ctx.take(model.id);
      ctx.beginning = undefined;
      if (refused !== undefined) {
        refuseTurn(turnId, text, refused, queuedMessageId, from, attachments);
        /*
         * The queue keeps going, which it does for any other turn that ends.
         *
         * Not the way an exited CLI's turn does, because that session has
         * nothing left to answer what is behind it, and this one does.
         */
        ctx.startNext();
        return;
      }
      ctx.chosen = model.id;
    }
    /*
     * The form the model came with, which is one key here.
     *
     * `thinkingLevel` is what a client writes into `ModelSelection.config`,
     * and the CLI holds one effort setting for the whole query rather than one
     * per turn - so a turn that names a level sets it from here on, and the
     * session-wide `effortLevel` is told so the two controls do not describe
     * different futures.
     */
    const level = EFFORTS.find((one) => one === (model?.config ?? {}).thinkingLevel);
    if (level !== undefined && level !== ctx.settings.effortLevel) {
      ctx.settings.effortLevel = level;
      void ctx.handle.applyFlagSettings({ effortLevel: level }).catch(() => {});
      ctx.emit('session', { type: 'session/configChanged', config: { effortLevel: level } });
    }
    ctx.active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        origin: from?.origin ?? { kind: 'user' },
        ...(from?._meta ? { _meta: from._meta } : {}),
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        ...(ctx.chosen ? { model: { id: ctx.chosen, ...(model?.config ? { config: model.config } : {}) } } : {}),
      },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    /*
     * What the host has to say on this turn, asked now that the turn exists.
     *
     * Asked here rather than held from the message that arrived, because a
     * message that waited its turn is told what is true when its turn comes:
     * the client that can report back may have joined, or left, in between.
     */
    ctx.hostInstructions = { turn: ctx.active, said: options?.instructions?.() ?? [] };
    ctx.startedAt = Date.now();
    ctx.failed = undefined;
    ctx.newTurn();
    // Said back, including to the client that started it. A host that only
    // reduced this privately would go on to emit `chat/responsePart` for a
    // turn no client has - so the parts land nowhere and the conversation
    // appears only when somebody reopens it and gets a fresh snapshot.
    ctx.emit('chat', {
      type: 'chat/turnStarted',
      turnId: ctx.active.id,
      startedAt: ctx.active.startedAt,
      message: ctx.active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    /*
     * The first message titles a session nobody has named.
     *
     * A message of nothing but blanks answers the fallback, which is the title
     * already held - so nothing moves and nothing is said about it.
     */
    if (ctx.title === 'New session' && text) ctx.retitle(titleFrom(text, 'New session'));
    ctx.doing('Thinking');
    /*
     * What the model is given, which is not always what the transcript shows.
     *
     * A side chat is started from a turn somewhere else and has to know what
     * that turn said, and the protocol is explicit that the source is *not*
     * copied into this chat's visible history. So it rides on the first prompt
     * and nowhere else: the wire message stays what the person typed.
     */
    const sent = carried === undefined ? text : `${carried}\n\n${text}`;
    carried = undefined;
    prompted = { turn: String(ctx.active.id), text: sent, ...(attachments === undefined ? {} : { attachments }) };
    const uuid = writtenAs(String(ctx.active.id), false);
    await push(sent, attachments, uuid, { message: bag(ctx.active.message), steering: false, turn: String(ctx.active.id), cli: 'sent' });
  };

  /**
   * The head of the queue, once there is nothing running.
   *
   * Called wherever a turn ends, which is the only place it can be: a queue
   * that waited for a client to notice would be a list, and every client
   * watching this chat would have to agree about which of them sends it. A
   * turn still switching its model is running as far as this is concerned.
   */
  const startNext = (): void => {
    if (busy() || ctx.closed)
      return;
    // Nor while the CLI owes an answer: a prompt handed to it now is read after
    // the one it owes, and that answer would be taken for this one's.
    if (ctx.owed.size > 0)
      return;
    const next = ctx.queued.shift();
    if (!next)
      return;
    /*
     * A command somebody typed is run, not asked.
     *
     * `ran` queued it as text so a client could see it waiting, and handing
     * that text to the CLI is the one thing `!` exists not to do. It runs
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
    // Read back, not re-parsed: `queue` wrote this entry from a `Chosen` and
    // the values in it are the ones it kept.
    const named = bag(message.model);
    const id = str(named.id);
    let model: Chosen | undefined;
    if (id !== undefined)
      model = named.config ? { id, config: named.config as NonNullable<Chosen['config']> } : { id };
    // With whose it was: a message an agent queued is still an agent's when
    // its turn comes.
    const from: MessageFrom = {};
    if (message.origin !== undefined) from.origin = bag(message.origin) as NonNullable<MessageFrom['origin']>;
    if (message._meta !== undefined) from._meta = bag(message._meta);
    const picked = bag(message.agent);
    if (typeof picked.uri === 'string') from.agent = { uri: str(picked.uri) as string };
    // What the message was holding while it waited, which is what it is still.
    const attachments = attachedTo(message);
    void beginTurn(crypto.randomUUID(), str(message.text) ?? '', model, str(next.id), from, attachments,
      next.options as TurnOptions | undefined);
  };

  /**
   * One shell command as a turn of this chat's.
   *
   * The whole of what `!command` means, and one function because it is reached
   * two ways: immediately from `ran`, and later from `startNext` when the
   * command was typed while a turn was already running. Both put the command
   * and its output in the transcript as a tool call rather than pushing
   * anything to the CLI. `queuedMessageId` names the waiting row the command
   * came from, so a client clears it the way it clears any other.
   */
  const runCommand = (
    turnId: string,
    command: string,
    run: RunCommand,
    queuedMessageId?: string,
  ): void => {
    const turn: Bag = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: { text: `!${command}`, origin: { kind: 'user' } },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    ctx.active = turn;
    ctx.startedAt = Date.now();
    ctx.failed = undefined;
    ctx.emit('chat', {
      type: 'chat/turnStarted', turnId, startedAt: turn.startedAt, message: turn.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    if (ctx.title === 'New session') ctx.retitle(titleFrom(command, 'New session'));
    ctx.doing('Running');
    const toolCallId = `${turnId}:command`;
    /*
     * `terminal` as the name, which is what the reference host calls it.
     *
     * A client draws a tool call by its name, and one called anything else
     * would be drawn as an unknown tool rather than as the shell it is.
     */
    const call = {
      toolCallId,
      toolName: 'terminal',
      displayName: 'Terminal',
      intention: command,
      invocationMessage: command,
      toolInput: command,
      // The person typed it themselves, so there is nobody left to ask.
      confirmed: 'not-needed',
      status: 'running',
      _meta: { toolKind: 'terminal' },
    } satisfies OnWire<ToolCallRunningState> as Bag;
    // As a part, the way every other call is held: the bare call went
    // into the snapshot with no `kind`, so a client that subscribed after
    // the command ran had a row it could not draw.
    ctx.holdPart(turn, { kind: 'toolCall', toolCall: call });
    ctx.emit('chat', {
      type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal',
      displayName: 'Terminal', intention: command, _meta: { toolKind: 'terminal' },
    });
    ctx.emit('chat', {
      type: 'chat/toolCallReady', turnId, toolCallId,
      invocationMessage: command, toolInput: command, confirmed: 'not-needed',
      _meta: ctx.stampStart(call),
    });
    /*
     * The block a client opens the command's terminal from. `isPty` is the
     * terminal's own, which a client reads to decide whether the output holds
     * VT sequences, and it is left out where the host says nothing.
     */
    const terminalOf = (terminal: CommandTerminal): OnWire<ToolResultTerminalContent> => ({
      type: 'terminal',
      resource: terminal.uri,
      title: 'Terminal',
      ...(terminal.isPty === undefined ? {} : { isPty: terminal.isPty }),
    });
    void run(toolCallId, (opened) => {
      if (ctx.active !== turn) return;
      /*
       * The terminal as soon as it opens, so a client watches the output
       * arrive, as the reference host names its own. Onto the call and into
       * the action from one object, and with no `_meta`, which the reducer
       * would put in place of the call's.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104
       */
      const content = [terminalOf(opened)];
      call.content = content;
      ctx.emit('chat', { type: 'chat/toolCallContentChanged', turnId, toolCallId, content });
    }).then((done) => {
      if (ctx.active !== turn) return;
      // The terminal again, with how the command ended, and then the text it
      // printed: `content` is replaced, not appended to.
      const watched = done.terminal === undefined ? [] : [{
        ...terminalOf({ uri: done.terminal, ...(done.isPty === undefined ? {} : { isPty: done.isPty }) }),
        result: {
          ...(done.code !== undefined ? { exitCode: done.code } : {}),
          ...(done.output === '' ? {} : { preview: done.output }),
        },
      } satisfies OnWire<ToolResultTerminalContent>];
      const said = done.output === ''
        ? []
        : [{ type: 'text', text: done.output } satisfies OnWire<ToolResultTextContent>];
      const shown = [...watched, ...said];
      const result = {
        success: done.success,
        pastTenseMessage: done.said,
        content: shown,
        ...(done.success ? {} : { error: { message: done.said } }),
      } satisfies Partial<OnWire<ToolCallCompletedState>>;
      Object.assign(call, result, { status: 'completed', confirmed: 'not-needed' });
      ctx.emit('chat', {
        type: 'chat/toolCallComplete', turnId, toolCallId, result, _meta: ctx.stampEnd(call),
      });
      turn.state = done.success ? 'complete' : 'error';
      turn.duration = Date.now() - ctx.startedAt;
      ctx.turns.push(turn);
      ctx.active = undefined;
      if (!done.success) ctx.failed = done.said;
      ctx.emit('chat', { type: 'chat/turnComplete', turnId, duration: turn.duration });
      ctx.doing(undefined);
      ctx.touch();
      ctx.startNext();
    });
  };

  /**
   * The turn that answers a steering message whose own turn ended, which the
   * steering messages that turn left with the CLI join.
   *
   * It carries the message, under the uuid the message went to the CLI with,
   * which is where the CLI writes it, and names it in `queuedMessageId`, as
   * AHP 1.1.0 shows a steering message taken in by a turn of its own. A
   * message the CLI took in inside the turn that ended stays with that turn.
   * The message is the new turn's prompt from then on, and ends with it: a
   * stop of that turn stops it, and the CLI's answer to it goes nowhere after.
   * https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/chat-channel.md#steering-messages
   */
  const present = (uuid: string): void => {
    const owed = ctx.owed.get(uuid);
    if (owed === undefined || ctx.active !== undefined) return;
    const ended = owed.turn;
    for (const one of ctx.owed.values()) {
      if (one.steering && one.turn === ended && one.cli !== 'started') one.turn = uuid;
    }
    owed.turn = uuid;
    owed.steering = false;
    const attachments = attachedTo(owed.message);
    prompted = { turn: uuid, text: str(owed.message.text) ?? '', ...(attachments === undefined ? {} : { attachments }) };
    ctx.openTurn(ctx.mainScope, { id: uuid, message: owed.message, ...(owed.id === undefined ? {} : { queuedMessageId: owed.id }) });
    ctx.doing('Thinking');
    ctx.touch();
  };

  /**
   * The steering messages a turn that was stopped or failed left with the CLI,
   * answered in a turn of their own that opens now.
   *
   * The CLI runs a steering message it holds once the turn it steered ends.
   * Opened now, the turn that answers it is the chat's running turn from that
   * moment, so a turn sent meanwhile waits behind it as behind any other:
   * a prompt that reached the CLI first would be run with the message, as one
   * turn with one answer. A message the CLI has not said it holds yet opens
   * its turn when its answer comes.
   */
  const handOver = (turnId: string): void => {
    const left = [...ctx.owed.entries()].filter(([, owed]) => owed.steering && owed.turn === turnId && owed.cli !== 'started');
    const first = left[0];
    if (first !== undefined && left.some(([, owed]) => owed.cli === 'queued')) present(first[0]);
  };

  const methods: Turns['methods'] = {
    /**
     * A model named on the turn takes effect and **stays** in effect.
     *
     * The SDK has no per-turn model, so honouring `message.model` means
     * `setModel` before the prompt - and setting it back afterwards would
     * race the next turn onto whichever call landed last. Leaving it is the
     * behaviour that can be explained; silently ignoring the field is the one
     * that cannot, because the transcript would then credit a turn to a model
     * that never ran it. The switch is awaited rather than fired, so a turn
     * naming a model the CLI will not take fails with its reason instead of
     * being labelled with it and answered by another one.
     */
    begin: (turnId, text, model, from, attachments, options) => {
      /*
       * One turn at a time, said to the client that sent this one.
       *
       * The host refuses a turn while the chat's state holds an active one,
       * and a turn still beginning - switching its model, or waiting on the
       * tools the session was handed - reaches that state only once it
       * starts, so this session alone knows of it. Its client holds the turn
       * until it is answered.
       */
      if (busy()) {
        ctx.options.handed?.({ type: 'chat/turnStarted', turnId })?.refuse('A turn is running in this chat');
        return;
      }
      void beginTurn(turnId, text, model, undefined, from, attachments, options);
    },
    setTitle: (said) => { if (said !== '') ctx.title = said; },

    /**
     * A turn this host answered itself, with a shell rather than the agent.
     *
     * The same shape as any other turn - it opens, carries one tool call, and
     * completes - because that is what makes it readable afterwards: the
     * command and its output are in the transcript beside the conversation
     * they interrupted, rather than in a panel that closed. Nothing is pushed
     * to the CLI, which is the whole difference from `begin`.
     */
    ran: (turnId, command, run, queuedAs) => {
      /*
       * A turn is already running, so the command waits its turn.
       *
       * A shell command that jumped the queue would run against a tree the
       * turn in front of it is still editing - and what waits is the command
       * itself, not the text of it: when its turn comes `startNext` runs it
       * rather than handing `!ping` to the CLI.
       */
      if (busy() || (queuedAs !== undefined && ctx.queued.length > 0)) {
        const id = queuedAs ?? turnId;
        const message = { text: `!${command}`, origin: { kind: 'user' } };
        const entry = { id, command: { text: command, run }, message };
        const at = ctx.queued.findIndex((held) => String(held.id) === id);
        if (at >= 0) ctx.queued[at] = entry;
        else ctx.queued.push(entry);
        ctx.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
        ctx.touch();
        return;
      }
      runCommand(turnId, command, run, queuedAs);
    },

    /**
     * Into the turn that is already running, rather than after it.
     *
     * The same door `begin` and the queue go through: the prompt handed to the
     * CLI is a generator that stays open for the life of the session, so a
     * message pushed while a turn runs reaches the CLI while that turn runs.
     * The CLI folds it into the turn at the turn's next tool call. Once the
     * model is writing its last answer there is no next tool call, and the CLI
     * runs it after that answer's result, as a turn of its own. Either way the
     * answer is this turn's, as the reference keeps it: it goes under a uuid,
     * which the frames and the result answering it name, and the turn stays
     * open until a result has named it.
     * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1595-L1609
     *
     * The uuid is the steering message's own id when that is a UUID, as a
     * turn's prompt goes under its turn's id, and a new one otherwise.
     */
    steer: (id, text, attachments) => {
      if (!ctx.active) return false;
      const message = {
        text,
        origin: { kind: 'user' },
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      // Held in the state as well as announced, and taken out again where the
      // CLI reads it rather than here: a client that only read the state saw
      // nothing waiting, because the announcement and its removal used to
      // happen in one tick.
      ctx.steering = { id, message };
      ctx.emit('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id, message });
      void push(text, attachments, UUID.test(id) ? id : crypto.randomUUID(), { message, steering: true, turn: String(ctx.active.id), id, cli: 'sent' });
      return true;
    },

    /**
     * Wait, then be the next turn.
     *
     * Idle *now* means this is not a queue at all, and the protocol says the
     * host starts the head as soon as it can - so it is announced and then
     * immediately started, which is a queue entry a client sees appear and
     * leave rather than one that was never there.
     */
    queue: (id, text, model, from, attachments, options) => {
      const entry: Bag = {
        id,
        // Held with the message and read when its turn comes, which is what
        // makes a turn's instruction follow the turn rather than the arrival.
        ...(options !== undefined ? { options } : {}),
        message: {
          text,
          origin: from?.origin ?? { kind: 'user' },
          ...(from?._meta ? { _meta: from._meta } : {}),
          // Held with the message, and echoed in the action below: a client
          // draws the chip from here while the message waits its turn.
          ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
          ...(model ? { model: { id: model.id, ...(model.config ? { config: model.config } : {}) } } : {}),
          // The agent, kept with the message rather than applied now: this
          // message waits for the turn in front of it, and the CLI it runs on is
          // the one in place when its turn comes.
          ...(from?.agent ? { agent: from.agent } : {}),
        },
      };
      const at = ctx.queued.findIndex((held) => str(held.id) === id);
      // The same id again edits what is waiting; a fresh one appends. That is
      // the client's spelling for "change my mind" and it costs nothing here.
      if (at >= 0) ctx.queued[at] = entry;
      else ctx.queued.push(entry);
      ctx.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      ctx.touch();
      ctx.startNext();
    },

    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(ctx.draft))
        return;
      ctx.draft = next;
      // Not `touch()`: typing is not a change to the conversation, and a
      // catalogue that reordered itself on every keystroke would be unusable.
      // The key is left off to clear it, which is what the action's
      // `undefined` means and the only way JSON can say it.
      ctx.emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    unqueue: (id) => {
      const at = ctx.queued.findIndex((held) => str(held.id) === id);
      if (at < 0) return;
      ctx.queued.splice(at, 1);
      ctx.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      ctx.touch();
    },

    reorder: (order) => {
      const byId = new Map(ctx.queued.map((held) => [str(held.id) ?? '', held]));
      const moved: Bag[] = [];
      const seen = new Set<string>();
      for (const id of order) {
        const held = byId.get(id);
        if (!held || seen.has(id)) continue;
        seen.add(id);
        moved.push(held);
      }
      // Anything the order did not mention keeps its place behind what did,
      // rather than being dropped for not having been named.
      for (const held of ctx.queued) {
        if (!seen.has(str(held.id) ?? '')) moved.push(held);
      }
      ctx.queued.length = 0;
      ctx.queued.push(...moved);
      ctx.emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => str(held.id) ?? '') });
      ctx.touch();
    },

    /*
     * The same turn, run again.
     *
     * The protocol is precise about this: the latest turn, in `error`, whose
     * last part is a resumable error, reopened with its message and parts
     * intact rather than replaced by a new one. So the turn moves back to
     * `active` as it was, and its text goes to a new CLI again - which is what
     * makes a failed turn retryable without somebody having to type it a second
     * time.
     *
     * A CLI cannot take the prompt without its own copy of the failed prompt
     * still in the conversation, so the new one resumes cut at the end of the
     * turn before this one, and the prompt goes out from here. A conversation
     * whose first turn this is has no turn to cut back to and starts over
     * under its id. Either way the calls the failed turn ran are run again,
     * because the cut drops them with the prompt.
     *
     * `chat/turnResume` is said here, while the client's action is being
     * applied, so it goes out as that action's echo.
     */
    resume: (turnId) => {
      if (busy()) return false;
      const last = ctx.turns.at(-1);
      if (last === undefined || String(last.id ?? '') !== turnId || last.state !== 'error') return false;
      const end = bag((last.responseParts as Bag[] | undefined)?.at(-1));
      if (end.kind !== 'error' || end.resumable !== true) return false;
      /*
       * The turn is off the history before the cut is read, because what a
       * rewind cuts is the end of the turn *before* this one. `cutOf` walks
       * the history back, and left on it this turn would answer with its own
       * last chain entry - the failed prompt and its reply, kept.
       *
       * A turn read back after a restart has no entry in `ends`, and a
       * conversation this process resumed cannot be started over: neither can
       * be cut back to, and the turn stays in the history as it was.
       */
      ctx.turns.pop();
      const cut = ctx.cutOf();
      if (cut === undefined) {
        ctx.turns.push(last);
        return false;
      }
      const again = { ...last } as Bag;
      // `state` and `duration` are what made it a finished turn; an active one
      // has neither, and the protocol says the reducer reopens *this* turn
      // rather than replacing it.
      delete again.state;
      delete again.duration;
      ctx.active = again as unknown as NonNullable<typeof ctx.active>;
      ctx.startedAt = Date.now();
      ctx.failed = undefined;
      ctx.emit('chat', { type: 'chat/turnResume', turnId });
      ctx.doing('Thinking');
      ctx.touch();
      const login = ctx.login;
      void (async () => {
        const restarted = await ctx.restartAt(turnId, cut, login);
        if (!restarted.started) return;
        if (restarted.failed === undefined) {
          await ctx.again([]);
          return;
        }
        ctx.failTurn(`The conversation could not start over: ${restarted.failed}`);
        // A message sent while the turn ran again goes now, as after a failed `moveOn`.
        ctx.startNext();
      })();
      return true;
    },

    cancel: (turnId) => {
      // Every call still open in the turn, before any of them is answered.
      const open = (list(ctx.active?.responseParts) as Bag[])
        .filter((part) => part.kind === 'toolCall')
        .map((part) => bag(part.toolCall))
        .filter((call) => call.status !== 'completed' && call.status !== 'cancelled')
        .map((call) => str(call.toolCallId))
        .filter((id): id is string => id !== undefined);
      const answered = new Set<string>();
      // A turn blocked on a person is stopped by answering no, not by leaving
      // a promise nobody will settle - the subprocess would sit there for ever.
      // All of them, not the last one: a turn stopped while two questions
      // were open used to leave the other tool waiting for ever.
      for (const one of [...ctx.pending.values()]) {
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The turn was stopped' });
        ctx.inputNeededRemoved(one.id);
        answered.add(one.id);
      }
      // And the previews those questions were carrying. A call that will never
      // run leaves no file to show, so the text the host was holding goes with
      // the question it was held for.
      ctx.settleEdits();
      // And the calls a client is running for us, for the same reason: a
      // promise settled by somebody else is one a stopped turn still waits on.
      for (const id of open) if (ctx.calls.owner(id) !== undefined) answered.add(id);
      ctx.releaseCalls('The turn was stopped');
      /*
       * The interrupt, once the CLI has recorded every answer above.
       *
       * The CLI keeps an answer only once it has recorded the call's result,
       * and an interrupt that reaches it first has it write its own text for
       * the call instead: "The user doesn't want to proceed with this tool use
       * ... STOP what you are doing and wait for the user to tell you how to
       * proceed". The model then takes a stop for a person refusing the call,
       * where the protocol closes it as skipped. So the reader sends the
       * interrupt once the CLI reports those results. A call the CLI runs
       * itself is stopped only by the interrupt, and is told that text by
       * whichever interrupt reaches it, so with one open the interrupt goes now.
       */
      if (answered.size === 0 || open.some((id) => !answered.has(id))) void ctx.handle.interrupt().catch(() => {});
      else ctx.stopAnswers = answered;
      /*
       * And the workers that turn spawned, foreground or background.
       *
       * A worker's turn is a turn of its own, and a main turn stopped halfway
       * leaves the workers it spawned with nothing left to answer them. A
       * background worker spawned by an earlier turn is not this turn's, keeps
       * running and ends on its own `task_notification`. A worker whose call
       * was never seen has no turn on record and is ended with this one.
       */
      /*
       * A worker still waiting to be told what it is.
       *
       * It has a chat to open either way, and a chat that opens five seconds
       * after the turn that spawned it was stopped is a chat nobody asked for.
       * So it is opened here, with whatever the record said by now - the
       * fallback title and no prompt if nothing did - and the loop below ends it
       * with the workers this turn already ends.
       */
      for (const scope of [...ctx.scopes.values()]) {
        if (scope.waiting !== undefined) ctx.releaseHeld(scope.parent);
      }
      const cancelling = turnId || str(ctx.active?.id);
      for (const scope of [...ctx.scopes.values()]) {
        if (scope.parent === '' || scope.chat === undefined) continue;
        const made = ctx.spawning.get(scope.parent)?.turn;
        if (made === undefined || made === cancelling) ctx.endWorker(scope.parent, 'cancelled');
      }
      const turn = ctx.active;
      if (turn) {
        turn.state = 'cancelled';
        turn.duration = Date.now() - ctx.startedAt;
        ctx.settleOpen(turn);
        ctx.turns.push(turn);
        ctx.active = undefined;
        ctx.interrupted = true;
        ctx.emit('chat', { type: 'chat/turnCancelled', turnId: turnId || turn.id, duration: turn.duration });
      }
      ctx.doing(undefined);
      ctx.touch();
      // Deliberately not `startNext`: somebody stopping a turn is stopping
      // this conversation, and starting the one behind it is the opposite of
      // what they asked for. What the CLI still runs after the stop is the
      // steering messages it holds, which are answered in a turn of their own.
      if (turn) handOver(String(turn.id));
    },
  };

  return { queued, startNext, again, handOver, present, methods };
}
