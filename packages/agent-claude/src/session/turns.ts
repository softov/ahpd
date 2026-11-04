import type { ActiveTurn } from '@microsoft/agent-host-protocol';
import { titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, SteeringMessage, TurnOptions, WireTurn } from '@ahpd/sdk';
import { blocksFor } from './attachments.js';
import { bag, str, UUID } from './common.js';
import { EFFORTS } from './config.js';
import type { Owed, SessionContext } from './context.js';

/** What this area offers the rest of the session. */
export interface Turns {
  /** Begin the next prompt handed while another ran, once the CLI owes nothing in front of it. */
  sendNext: () => void;
  /**
   * What a turn sent a CLI that was put away, sent to the one that took its
   * place: the running turn's prompt, as it went out the first time, and then
   * `steers`, the steering messages the CLI put away still owed an answer to.
   *
   * Each under a new uuid, the prompt's told to the host, because the first may
   * already be written under the old one.
   */
  again: (steers: readonly Owed[]) => Promise<void>;
  methods: {
    sendMessage: (turnId: string, text: string, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions) => void;
    changeModel: (model: Chosen) => void;
    changeAgent: (agent: { uri: string } | undefined) => void;
    setTitle: (title: string) => void;
    sendSteeringMessage: (message: SteeringMessage) => boolean;
    withdrawSteeringMessage: (id: string) => void;
    setDraft: (draft: Bag | undefined) => void;
    resumeTurn: (turnId: string) => void;
    abort: () => void;
  };
}

/** The attachments a message holds, as a message sent to the CLI takes them. */
const attachedTo = (message: Bag): MessageAttachment[] | undefined =>
  Array.isArray(message.attachments) ? message.attachments as MessageAttachment[] : undefined;

/** A turn a client sent: what `sendMessage` was handed. */
interface Handed {
  turnId: string;
  text: string;
  model?: Chosen | undefined;
  from?: MessageFrom | undefined;
  attachments?: MessageAttachment[] | undefined;
  options?: TurnOptions | undefined;
}

export function createTurns(ctx: SessionContext): Turns {
  /**
   * The turns a client sent, in the order they came, until each is begun.
   *
   * Each is begun once the CLI has answered every prompt sent before it, as
   * the reference agent runs each send it is handed after the one before it,
   * each its own entry settled by its own result. The host said each start
   * when it came, so the turn a later one took the place of runs on here, and
   * its answer goes nowhere.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L408-L436
   */
  const handed: Handed[] = [];

  /** How many stops this session has taken, which a turn still preparing reads to know it was stopped. */
  let stops = 0;

  /** Context for the first prompt only, which never reaches the wire. */
  let carried = ctx.options.context;

  /**
   * A message onto the CLI's own input stream, as what it is.
   *
   * Where a turn beginning and a message steering one reach the CLI: the wake
   * happens in one place, and a message's attachments become the
   * blocks the CLI takes whichever way it arrived. A message with none is the
   * string it always was. `uuid` is the id the CLI writes the prompt under and
   * names its answer by, and `owed` is the answer that is to come, held until
   * a result names the uuid.
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
   * this rather than the turn's message. A turn whose prompt is out is the one
   * steering goes into.
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
   * A turn that never reaches the CLI, ended as one that failed for `why`.
   *
   * The host said its start, so its end is all that is said: `chat/error`, as
   * the reference host ends a send that failed. A turn handed behind it is a
   * send of its own and goes on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2328-L2336
   */
  const refuseTurn = (
    turnId: string,
    text: string,
    why: string,
    began: number,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
  ): void => {
    const turn = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: {
        text,
        origin: from?.origin ?? { kind: 'user' },
        ...(from?._meta ? { _meta: from._meta } : {}),
        // Kept, though nothing was sent: the turn is in the transcript, and a
        // client reading it back shows the picture the person pasted.
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      },
      responseParts: [],
    } as unknown as Bag;
    const part = ctx.addFailure(turn, 'sendFailed', why);
    turn.state = 'error';
    turn.duration = Math.max(0, Date.now() - began);
    ctx.turns.push(turn);
    ctx.failed = why;
    ctx.endedAt(turn);
    ctx.emit('chat', { type: 'chat/error', turnId, duration: turn.duration, part });
    sendNext();
  };

  /**
   * One turn's prompt to the CLI, once the CLI owes nothing in front of it.
   *
   * Prepared first, named in `beginning` so a turn handed meanwhile waits and
   * steering is declined: a CLI the last stop or a stream that ended put away
   * is started again on the conversation, as the reference rebinds its query at
   * the next send; the tools the session was handed land; the agent and the
   * model the turn picked are taken, and one the CLI will not take is logged
   * while the turn runs on the one it has, as the reference logs a model or an
   * agent that would not change. A stop while it prepares sends nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L415-L421
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L351-L360
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2238
   */
  const beginTurn = async (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ): Promise<void> => {
    const began = Date.now();
    const stopped = stops;
    ctx.beginning = turnId;
    if (ctx.rebind !== undefined) {
      ctx.rebind = undefined;
      ctx.gone = undefined;
      ctx.handle = ctx.startQuery(ctx.running, false);
      void ctx.consume();
    }
    /*
     * The tools the session was handed before this turn, landed first.
     *
     * A change of tools reaches the CLI as `setMcpServers`, which the CLI
     * answers once it has the servers, and the host hands it over without
     * waiting; a turn that comes after it is a turn of a session that has
     * those tools.
     */
    if (ctx.retooling !== undefined) await ctx.retooling;
    if (ctx.closed || stops !== stopped) return;
    /*
     * A session whose CLI has exited answers at once, and says why.
     *
     * The turn is recorded as one that failed rather than refused, because a
     * person typed it and it belongs in the transcript beside the reason.
     */
    if (ctx.gone !== undefined) {
      ctx.beginning = undefined;
      refuseTurn(turnId, text, ctx.gone, began, from, attachments);
      return;
    }
    /*
     * The record read again first: a session started from an agent record is
     * one somebody may edit while it runs, and the edit reaches the CLI here,
     * on the turn after it, with the conversation resumed onto the new CLI.
     * A record that cannot be run fails the turn.
     */
    const unrunnable = ctx.refreshPreset();
    if (unrunnable !== undefined) {
      ctx.beginning = undefined;
      refuseTurn(turnId, text, unrunnable, began, from, attachments);
      return;
    }
    // The agent this message picked, which decides which CLI the model is switched on.
    const unswitched = ctx.switchAgent(from?.agent?.uri);
    if (unswitched !== undefined) console.warn(`@ahpd/agent-claude: ${unswitched}; the turn runs on the agent it has`);
    // The model this turn names, before the prompt goes out and before the turn is credited to it.
    if (model !== undefined && model.id !== ctx.chosen) {
      const unmoved = await ctx.take(model.id);
      if (unmoved === undefined) ctx.chosen = model.id;
      else console.warn(`@ahpd/agent-claude: ${unmoved}; the turn runs on ${ctx.chosen ?? 'the default model'}`);
      if (ctx.closed || stops !== stopped) return;
    }
    /*
     * The form the model came with, which is one key here.
     *
     * `thinkingLevel` is what a client writes into `ModelSelection.config`,
     * and it is this turn's: the reference host hands a turn's model to its
     * agent, which sets the model's effort on the SDK, and no session config
     * moves. The CLI holds one effort for the whole query, so a turn that
     * names none after one that did puts the session's `effortLevel` back.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1206-L1226
     */
    const level = EFFORTS.find((one) => one === (model?.config ?? {}).thinkingLevel);
    const sessions = EFFORTS.find((one) => one === ctx.settings.effortLevel);
    const running = ctx.turnEffort ?? sessions;
    if (level !== undefined && level !== running) {
      ctx.turnEffort = level === sessions ? undefined : level;
      void ctx.handle.applyFlagSettings({ effortLevel: level }).catch(() => {});
    }
    else if (level === undefined && ctx.turnEffort !== undefined) {
      ctx.turnEffort = undefined;
      if (sessions !== undefined) void ctx.handle.applyFlagSettings({ effortLevel: sessions }).catch(() => {});
    }
    ctx.beginning = undefined;
    // The turn this session runs from now, as the host said it.
    const turn = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
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
    ctx.active = turn;
    ctx.setModifiedAt(String(turn.startedAt));
    /*
     * What the host has to say on this turn, asked now that the turn exists.
     *
     * Asked here rather than held from the message that arrived, because a
     * message that waited its turn is told what is true when its turn comes:
     * the client that can report back may have joined, or left, in between.
     */
    ctx.hostInstructions = { turn, said: options?.instructions?.() ?? [] };
    ctx.newTurn();
    ctx.startedAt = Date.now();
    ctx.failed = undefined;
    /*
     * The first message titles a session nobody has named.
     *
     * A message of nothing but blanks answers the fallback, which is the title
     * already held - so nothing moves and nothing is said about it.
     */
    if (ctx.title === 'New session' && text) ctx.retitle(titleFrom(text, 'New session'));
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
    prompted = { turn: turnId, text: sent, ...(attachments === undefined ? {} : { attachments }) };
    await push(sent, attachments, writtenAs(turnId, false), { message: bag(turn.message), steering: false, turn: turnId, cli: 'sent' });
  };

  /**
   * The first turn handed and not yet begun, begun once nothing runs, nothing
   * prepares and the CLI owes nothing: called where a turn is handed and where
   * one ends, however it ended, since each send is its own.
   */
  const sendNext = (): void => {
    if (ctx.closed || ctx.active !== undefined || ctx.beginning !== undefined || ctx.owed.size > 0) return;
    const next = handed.shift();
    if (next !== undefined) void beginTurn(next.turnId, next.text, next.model, next.from, next.attachments, next.options);
  };

  /**
   * The model a client picked, taken by the next send: the CLI keeps a model
   * it took, and the chat keeps the one it has when the CLI will not.
   */
  let wanted: Chosen | undefined;
  /** The agent a client picked for this chat's turns, or the CLI's own. */
  let picked: { uri: string } | undefined;

  const methods: Turns['methods'] = {
    /**
     * A model picked takes effect and **stays** in effect.
     *
     * The SDK has no per-turn model, so honouring a turn's model means
     * `setModel` before its prompt - and setting it back afterwards would
     * race the next turn onto whichever call landed last. Leaving it is the
     * behaviour that can be explained.
     */
    sendMessage: (turnId, text, from, attachments, options) => {
      const sent = picked === undefined ? from : { ...from, agent: picked };
      const model = wanted;
      wanted = undefined;
      handed.push({ turnId, text, model, from: sent, attachments, options });
      sendNext();
    },
    changeModel: (model) => { wanted = model; },
    changeAgent: (agent) => { picked = agent; },
    setTitle: (said) => { if (said !== '') ctx.title = said; },

    /**
     * Into the turn that is already running, rather than after it.
     *
     * The same door a turn's prompt goes through: the prompt handed to the CLI
     * is a generator that stays open for the life of the session, so a message
     * pushed while a turn runs reaches the CLI while that turn runs. The CLI
     * folds it into the turn at the turn's next tool call. Once the model is
     * writing its last answer there is no next tool call, and the CLI runs it
     * after that answer's result, as a turn of its own. Either way the answer is
     * this turn's, as the reference keeps it: it goes under a uuid, which the
     * frames and the result answering it name, and the turn stays open until a
     * result has named it.
     * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1595-L1609
     *
     * Declined until the turn's prompt is out, as the reference agent takes
     * steering only into a send in flight; the host hands it again on the
     * turn's next action. It goes into the turn whose prompt the CLI was handed
     * last, which is the turn this session runs.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2494-L2498
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L454-L470
     *
     * The uuid is the steering message's own id when that is a UUID, as a
     * turn's prompt goes under its turn's id, and a new one otherwise.
     */
    sendSteeringMessage: ({ id, text, attachments }) => {
      if (ctx.active === undefined || prompted?.turn !== String(ctx.active.id)) return false;
      const message = {
        text,
        origin: { kind: 'user' },
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      // Held until the CLI reads it, which is when its removal is said.
      ctx.steering = { id, message };
      void push(text, attachments, UUID.test(id) ? id : crypto.randomUUID(), { message, steering: true, turn: String(ctx.active.id), id, cli: 'sent' });
      return true;
    },

    /*
     * A steering message the CLI was handed and has not taken in, taken back
     * by a client: withdrawn, as the reference host has its provider withdraw
     * a steering message a client removes after handing it over. One the CLI
     * has not read leaves its input; one it holds is answered nowhere. Nothing
     * is said: the host has said the removal.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1950-L1955
     */
    withdrawSteeringMessage: (id) => {
      for (const [uuid, owed] of [...ctx.owed]) {
        if (!owed.steering || owed.id !== id || owed.cli === 'started') continue;
        const unread = ctx.waiting.findIndex((one) => one.uuid === uuid);
        if (unread >= 0) {
          ctx.waiting.splice(unread, 1);
          ctx.owed.delete(uuid);
        }
        else owed.withdrawn = true;
      }
      if (str(bag(ctx.steering).id) === id) ctx.steering = undefined;
    },

    // The draft the host said, held for the chat's state.
    setDraft: (next) => { ctx.draft = next; },

    /*
     * The same turn, run again.
     *
     * The protocol is precise about this: the latest turn, in `error`, whose
     * last part is a resumable error, reopened with its message and parts
     * intact rather than replaced by a new one. So the turn moves back to
     * `active` as it was, and its text goes to a new CLI again - which is what
     * makes a failed turn retryable without somebody having to type it a second
     * time. The host said the client's resume.
     *
     * A CLI cannot take the prompt without its own copy of the failed prompt
     * still in the conversation, so the new one resumes cut at the end of the
     * turn before this one, and the prompt goes out from here. A conversation
     * whose first turn this is has no turn to cut back to and starts over
     * under its id. Either way the calls the failed turn ran are run again,
     * because the cut drops them with the prompt.
     */
    resumeTurn: (turnId) => {
      const unrunnable = new Error(`${turnId} is not a turn this backend can run again`);
      if (ctx.active !== undefined || ctx.beginning !== undefined || handed.length > 0) throw unrunnable;
      const last = ctx.turns.at(-1);
      if (last === undefined || String(last.id ?? '') !== turnId || last.state !== 'error') throw unrunnable;
      const end = bag((last.responseParts as Bag[] | undefined)?.at(-1));
      if (end.kind !== 'error' || end.resumable !== true) throw unrunnable;
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
        throw unrunnable;
      }
      const again = { ...last } as Bag;
      // `state` and `duration` are what made it a finished turn; an active one
      // has neither, and the protocol says the reducer reopens *this* turn
      // rather than replacing it.
      ctx.resumedFrom = {
        duration: typeof last.duration === 'number' ? last.duration : 0,
        usage: typeof last.usage === 'object' && last.usage !== null ? last.usage as Bag : undefined,
      };
      delete again.state;
      delete again.duration;
      ctx.active = again as unknown as NonNullable<typeof ctx.active>;
      // This run counts its own calls, which the host merges over the run before's.
      ctx.newTurn();
      ctx.startedAt = Date.now();
      ctx.failed = undefined;
      const login = ctx.login;
      void (async () => {
        const restarted = await ctx.restartAt(turnId, cut, login);
        if (!restarted.started) return;
        if (restarted.failed === undefined) {
          await ctx.again([]);
          return;
        }
        ctx.failTurn(`The conversation could not start over: ${restarted.failed}`);
      })();
    },

    /*
     * A stop, which closes the CLI, as the reference stop aborts its query:
     * every prompt and steering message the CLI has not answered goes with it,
     * the turns handed behind the one running are sent to nobody, and the next
     * send starts a CLI that resumes the conversation. The turn ends cancelled
     * in this session's record and in what it says, which the host, having
     * said the stop already, keeps the turn's end by.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
     */
    abort: () => {
      stops += 1;
      handed.length = 0;
      // A turn blocked on a person is stopped by answering no, not by leaving
      // a promise nobody will settle. All of them, not the last one. Their
      // entries follow the chat's state: the host said the stop that ended the
      // turn and took down every entry that no longer stands.
      for (const one of [...ctx.pending.values()]) {
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The turn was stopped' });
      }
      // And the previews those questions were carrying. A call that will never
      // run leaves no file to show, so the text the host was holding goes with
      // the question it was held for.
      ctx.settleEdits();
      // And the calls a client is running for us, for the same reason: a
      // promise settled by somebody else is one a stopped turn still waits on.
      ctx.releaseCalls('The turn was stopped');
      /*
       * And every worker and task the CLI runs, foreground or background,
       * since they go with the CLI the stop closes, as a background task ends
       * with the reference's abort. A worker still waiting to be told what it
       * is is opened first, with whatever the record said by now, so the loop
       * below ends it with the rest.
       */
      for (const scope of [...ctx.scopes.values()]) {
        if (scope.waiting !== undefined) ctx.releaseHeld(scope.parent);
      }
      for (const scope of [...ctx.scopes.values()]) {
        if (scope.parent !== '' && scope.chat !== undefined) ctx.endWorker(scope.parent, 'cancelled');
      }
      ctx.noteLive({ tasks: [] });
      // The files the turn's edit calls began changing, as the stop leaves them.
      ctx.editsStopped();
      const was = ctx.handle;
      ctx.rebind = was;
      try { was.close(); }
      catch { /* A CLI already closing is stopped all the same. */ }
      ctx.waiting.length = 0;
      ctx.owed.clear();
      ctx.answering = undefined;
      ctx.steering = undefined;
      ctx.beginning = undefined;
      const turn = ctx.active;
      if (turn) {
        turn.state = 'cancelled';
        const attempt = Date.now() - ctx.startedAt;
        turn.duration = (ctx.resumedFrom?.duration ?? 0) + attempt;
        ctx.resumedFrom = undefined;
        ctx.settleOpen(turn);
        ctx.turns.push(turn);
        ctx.active = undefined;
        ctx.endedAt(turn);
        ctx.emit('chat', { type: 'chat/turnCancelled', turnId: turn.id, duration: attempt });
      }
    },
  };

  return { sendNext, again, methods };
}
