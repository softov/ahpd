import type { ActiveTurn } from '@microsoft/agent-host-protocol';
import { reason, titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, SteeringMessage, TurnOptions, WireTurn } from '@ahpd/sdk';
import { blocksFor } from './attachments.js';
import { bag, str, UUID } from './common.js';
import { EFFORTS } from './config.js';
import type { PendingSdkMessage, SessionContext } from './context.js';

/** What this area offers the rest of the session. */
export interface Turns {
  /** Begin the next prompt handed while another ran, once no yielded entry is in front of it. */
  sendNext: () => void;
  /**
   * What a turn sent a CLI that was put away, sent to the one that took its
   * place: the running turn's prompt, as it went out the first time, and then
   * `steers`, the steering messages the CLI put away had not yet answered.
   *
   * Each under a new uuid, the prompt's told to the host, because the first may
   * already be written under the old one.
   */
  again: (steers: readonly PendingSdkMessage[]) => Promise<void>;
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
   * Where a turn beginning and a message steering one reach the CLI: the
   * pending message goes into the to-yield list at once and its blocks are
   * built there, a message's attachments becoming the blocks the CLI takes
   * whichever way it arrived; a message with none is a string. `pending` is
   * the answer that is to come, from then until a result names its uuid.
   */
  const push = async (text: string, attachments: MessageAttachment[] | undefined, pending: PendingSdkMessage): Promise<void> => {
    // In the queue before the wait: a result read while the blocks are built
    // is not this prompt's answer, and has to know that one is still to come.
    ctx.toYield.push(pending);
    const to = ctx.query;
    const content = await blocksFor(text, attachments);
    // A stop, a withdrawal or a CLI put away took it out of the queue meanwhile.
    const at = ctx.toYield.indexOf(pending);
    if (at < 0) return;
    // A CLI in the place of the one it was for is sent it by whatever put it there.
    if (ctx.query !== to) {
      ctx.toYield.splice(at, 1);
      return;
    }
    pending.sdkMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      /*
       * A steering message goes in now, into the work the CLI is doing, as
       * VS Code's Claude agent injects one.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1271-L1282
       */
      ...(pending.steeringPendingId === undefined ? {} : { priority: 'now' as const }),
      uuid: pending.sdkUuid as `${string}-${string}-${string}-${string}-${string}`,
    };
    ctx.pendingPromptDeferred?.();
    ctx.pendingPromptDeferred = undefined;
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
   * The running turn's prompt as it went to the CLI, with what rode on it: the
   * text and the attachments its pending message's `sdkMessage` was built from.
   *
   * A side chat's first prompt carries text of its own beside the message's,
   * and a message's attachments are blocks of their own, so a prompt sent
   * again is this. A turn whose prompt is out is the one steering goes into.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudePromptQueue.ts#L25
   */
  let prompt: { turn: string; text: string; attachments?: MessageAttachment[] } | undefined;

  const again = async (steers: readonly PendingSdkMessage[]): Promise<void> => {
    const turn = ctx.active;
    if (turn !== undefined && prompt?.turn === String(turn.id)) {
      const sdkUuid = writtenAs(String(turn.id), true);
      await push(prompt.text, prompt.attachments, { sdkUuid, turnId: String(turn.id), message: bag(turn.message), lifecycle: 'sent' });
    }
    // Behind the prompt, in the order they went.
    for (const one of steers) {
      void push(str(one.message.text) ?? '', attachedTo(one.message), {
        sdkUuid: crypto.randomUUID(),
        turnId: one.turnId,
        ...(one.steeringPendingId === undefined ? {} : { steeringPendingId: one.steeringPendingId }),
        message: one.message,
        lifecycle: 'sent',
      });
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
   * One turn's prompt to the CLI, once no yielded entry is in front of it.
   *
   * Prepared first, named in `preparingTurn` so a turn handed meanwhile waits and
   * steering is declined: a session's first CLI is started, and a CLI the last
   * stop or a stream that ended put away is started again on the conversation,
   * as the reference rebinds its query at the next send; the tools the session
   * was handed land; the agent and the model the turn picked are taken, and one
   * the CLI will not take is logged while the turn runs on the one it has, as
   * the reference logs a model or an agent that would not change; the servers
   * the session switched are switched on the CLI. A stop while it prepares
   * sends nothing.
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
    ctx.preparingTurn = turnId;
    /*
     * The session's first CLI, which its first send starts before anything
     * else, as VS Code's first send materializes its provisional session and
     * then sends: on the tools the session holds, the record's values and its
     * login read now, and the agent this message picked. A record whose logins
     * are none of them ready, and a CLI that does not start, refuse the turn,
     * the second in the SDK's words, and the session stays as it was for the
     * next send, as VS Code's failed materialize keeps its provisional session.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1766-L1776
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1266-L1273
     */
    if (ctx.query === undefined) {
      ctx.buildClientMcpServers();
      const unready = await ctx.rebindForSyncedState();
      if (ctx.disposed || stops !== stopped) return;
      if (unready !== undefined) {
        ctx.preparingTurn = undefined;
        refuseTurn(turnId, text, unready, began, from, attachments);
        return;
      }
      await ctx.rebindForRestart(from?.agent?.uri);
      let unstarted: string | undefined;
      try { await ctx.startQuery(ctx.appliedAgent, true); }
      catch (error: unknown) { unstarted = reason(error); }
      if (ctx.disposed || stops !== stopped) return;
      if (unstarted !== undefined) {
        ctx.preparingTurn = undefined;
        refuseTurn(turnId, text, unstarted, began, from, attachments);
        return;
      }
    }
    // A CLI put away is started again, and one that does not start is held for the send after.
    if (ctx.rebind !== undefined) {
      const was = ctx.rebind;
      ctx.rebind = undefined;
      ctx.buildClientMcpServers();
      let unstarted: string | undefined;
      try { await ctx.startQuery(ctx.appliedAgent, false); }
      catch (error: unknown) {
        unstarted = reason(error);
        ctx.rebind = was;
      }
      if (ctx.disposed || stops !== stopped) return;
      if (unstarted !== undefined) {
        ctx.preparingTurn = undefined;
        refuseTurn(turnId, text, unstarted, began, from, attachments);
        return;
      }
    }
    /*
     * The tools the session was handed since the CLI was last given a set,
     * given to it before this turn's prompt, as VS Code's send rebinds its
     * query when the client-tool diff is dirty: a turn that comes after a
     * client announced its tools is a turn of a session that has them. A set
     * the CLI refuses fails the turn, as VS Code's failed rebuild fails the
     * send, and waits for the next.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1072-L1080
     */
    let untooled: string | undefined;
    try { await ctx.rebindForClientTools(); }
    catch (error: unknown) { untooled = error instanceof Error ? error.message : String(error); }
    if (ctx.disposed || stops !== stopped) return;
    /*
     * A CLI that went while this turn prepared fails the turn, and says why;
     * the next send starts one again.
     *
     * The turn is recorded as one that failed rather than refused, because a
     * person typed it and it belongs in the transcript beside the reason.
     */
    if (ctx.gone !== undefined && ctx.rebind === ctx.query) {
      ctx.preparingTurn = undefined;
      refuseTurn(turnId, text, ctx.gone, began, from, attachments);
      return;
    }
    if (untooled !== undefined) {
      ctx.preparingTurn = undefined;
      refuseTurn(turnId, text, untooled, began, from, attachments);
      return;
    }
    /*
     * The record read again first: a session started from an agent record is
     * one somebody may edit while it runs, and the edit reaches the CLI here,
     * on the turn after it, with the conversation resumed onto the new CLI.
     * A record that cannot be run fails the turn.
     */
    const unrunnable = await ctx.rebindForSyncedState();
    if (ctx.disposed || stops !== stopped) return;
    if (unrunnable !== undefined) {
      ctx.preparingTurn = undefined;
      refuseTurn(turnId, text, unrunnable, began, from, attachments);
      return;
    }
    // The agent this message picked, which decides which CLI the model is switched on.
    let unbound: string | undefined;
    let unstarted: string | undefined;
    try { unbound = await ctx.rebindForRestart(from?.agent?.uri); }
    catch (error: unknown) { unstarted = reason(error); }
    if (ctx.disposed || stops !== stopped) return;
    if (unstarted !== undefined) {
      ctx.preparingTurn = undefined;
      refuseTurn(turnId, text, unstarted, began, from, attachments);
      return;
    }
    if (unbound !== undefined) console.warn(`@ahpd/agent-claude: ${unbound}; the turn runs on the agent it has`);
    /*
     * The servers the session switched, which a CLI is brought to before each
     * prompt, as VS Code's send reconciles them.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1084
     */
    let unswitched: string | undefined;
    try { await ctx.reconcileMcpServerEnablement(); }
    catch (error: unknown) { unswitched = error instanceof Error ? error.message : String(error); }
    if (ctx.disposed || stops !== stopped) return;
    if (unswitched !== undefined) {
      ctx.preparingTurn = undefined;
      refuseTurn(turnId, text, unswitched, began, from, attachments);
      return;
    }
    // The model this turn names, before the prompt goes out and before the turn is credited to it.
    if (model !== undefined && model.id !== ctx.chosen) {
      const unmoved = await ctx.take(model.id);
      if (unmoved === undefined) ctx.chosen = model.id;
      else console.warn(`@ahpd/agent-claude: ${unmoved}; the turn runs on ${ctx.chosen ?? 'the default model'}`);
      if (ctx.disposed || stops !== stopped) return;
    }
    /*
     * The form the model came with, which is one key here.
     *
     * `thinkingLevel` is what a client writes into `ModelSelection.config`,
     * and it is this turn's: VS Code's Claude sets the effort each model
     * selection resolves to, and clears it where the selection names none,
     * since the CLI holds one effort for the whole query. A level the CLI
     * already holds is not sent again, as VS Code's pipeline keeps the one it
     * applied.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1217-L1224
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L375-L385
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/claudeModelConfig.ts#L66-L78
     */
    const level = EFFORTS.find((one) => one === (model?.config ?? {}).thinkingLevel);
    if (level !== ctx.appliedEffort) {
      ctx.appliedEffort = level;
      void ctx.query?.applyFlagSettings({ effortLevel: level ?? null }).catch(() => {});
    }
    ctx.preparingTurn = undefined;
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
    prompt = { turn: turnId, text: sent, ...(attachments === undefined ? {} : { attachments }) };
    await push(sent, attachments, { sdkUuid: writtenAs(turnId, false), turnId, message: bag(turn.message), lifecycle: 'sent' });
  };

  /**
   * The first turn handed and not yet begun, begun once nothing runs, nothing
   * prepares and no prompt is in the queue: called where a turn is handed and
   * where one ends, however it ended, since each send is its own.
   */
  const sendNext = (): void => {
    if (ctx.disposed || ctx.active !== undefined || ctx.preparingTurn !== undefined || ctx.toYield.length > 0 || ctx.yielded.size > 0) return;
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
      if (ctx.active === undefined || prompt?.turn !== String(ctx.active.id)) return false;
      const message = {
        text,
        origin: { kind: 'user' },
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      // Held until the CLI reads it, which is when its removal is said.
      ctx.steering = { id, message };
      void push(text, attachments, {
        sdkUuid: UUID.test(id) ? id : crypto.randomUUID(),
        turnId: String(ctx.active.id),
        steeringPendingId: id,
        message,
        lifecycle: 'sent',
      });
      return true;
    },

    /*
     * A steering message the CLI was handed and has not taken in, taken back
     * by a client: withdrawn, as the reference host has its provider withdraw
     * a steering message a client removes after handing it over. One the CLI
     * has not read leaves its input; one it holds is withdrawn through the
     * CLI's own `cancel_async_message`, as VS Code's Copilot withdraws one its
     * SDK holds, and one the CLI no longer holds runs and is answered in the
     * turn, as Copilot keeps one already delivered. Nothing is said: the host
     * has said the removal.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1950-L1955
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L6884-L6905
     */
    withdrawSteeringMessage: (id) => {
      const unread = ctx.toYield.findIndex((one) => one.steeringPendingId === id);
      if (unread >= 0) ctx.toYield.splice(unread, 1);
      for (const [uuid, pending] of [...ctx.yielded]) {
        if (pending.steeringPendingId !== id || pending.lifecycle === 'started') continue;
        // The SDK's own request for the control the CLI names
        // `cancel_async_message`, which the SDK's types leave undeclared.
        const handle = ctx.query as (typeof ctx.query & { cancelAsyncMessage(messageUuid: string): Promise<boolean> }) | undefined;
        void handle?.cancelAsyncMessage(uuid).then((cancelled) => {
          if (cancelled && ctx.query === handle) ctx.yielded.delete(uuid);
        }, () => {});
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
      if (ctx.active !== undefined || ctx.preparingTurn !== undefined || handed.length > 0) throw unrunnable;
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
        // A CLI that did not start ends the turn in the SDK's words.
        if (restarted.unstarted !== undefined && !ctx.disposed) {
          ctx.failTurn(restarted.unstarted);
          return;
        }
        if (!restarted.started) return;
        if (restarted.failed === undefined) {
          await ctx.again([]);
          return;
        }
        ctx.failTurn(`The conversation could not start over: ${restarted.failed}`);
      })();
    },

    /*
     * A stop, which interrupts the turn through the SDK's own `interrupt()`
     * and keeps the CLI and its conversation: the turns handed behind the one
     * running are sent to nobody, what the CLI was not handed goes with the
     * stop, the steering it holds is answered in a turn of its own after it,
     * the workers the stopped turn spawned end with it, and the background
     * workers and tasks of earlier turns keep running. The turn ends cancelled
     * in this session's record and in what it says, which the host, having
     * said the stop already, keeps the turn's end by.
     * https://code.claude.com/docs/en/agent-sdk/typescript#query-object
     */
    abort: () => {
      stops += 1;
      handed.length = 0;
      // Every call still open in the turn, before any of them is answered.
      const open = ((ctx.active?.responseParts ?? []) as Bag[])
        .filter((part) => part.kind === 'toolCall')
        .map((part) => bag(part.toolCall))
        .filter((call) => call.status !== 'completed' && call.status !== 'cancelled')
        .map((call) => str(call.toolCallId))
        .filter((id): id is string => id !== undefined);
      const answered = new Set<string>();
      // A turn blocked on a person is stopped by answering no, not by leaving
      // a promise nobody will settle. All of them, not the last one. Their
      // entries follow the chat's state: the host said the stop that ended the
      // turn and took down every entry that no longer stands.
      for (const one of [...ctx.pending.values()]) {
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The turn was stopped' });
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
       * proceed". The model then takes a stop for a person refusing the call.
       * So the reader sends the interrupt once the CLI reports those results.
       * A call the CLI runs itself is stopped only by the interrupt, so with
       * one open the interrupt goes now. A session with no CLI yet has nothing
       * to interrupt, and the stop keeps its prompt from being sent.
       */
      /*
       * The record's `stopEnds` set to `query` stops as VS Code's agent does
       * instead: the query is aborted, so the CLI is closed with every prompt
       * and steering message it has not answered, every worker and task it
       * runs ends with it, the files the turn's edit calls began changing are
       * recorded as the stop leaves them, and the next send starts a CLI that
       * resumes the conversation. A CLI still starting is disposed of once it
       * is up.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
       */
      const aborts = ctx.values['stopEnds'] === 'query';
      const running = ctx.query;
      if (aborts) {
        ctx.editsStopped();
        ctx.abandonStart();
        if (running !== undefined) {
          ctx.rebind = running;
          try { running.close(); }
          catch { /* A CLI already closing is stopped all the same. */ }
        }
        ctx.yielded.clear();
        ctx.parentSdkUuid = undefined;
        ctx.noteBackgroundTasks({ tasks: [] });
      }
      else if (running !== undefined && ctx.active !== undefined) {
        if (answered.size === 0 || open.some((id) => !answered.has(id))) void running.interrupt().catch(() => {});
        else ctx.stopAnswers = answered;
        ctx.interrupted = true;
      }
      /*
       * And the workers that turn spawned, foreground or background.
       *
       * A worker's turn is a turn of its own, and a main turn stopped halfway
       * leaves the workers it spawned with nothing left to answer them. A
       * background worker spawned by an earlier turn is not this turn's, keeps
       * running and ends on its own `task_notification`, unless the stop
       * aborted the query it runs in. A worker whose chat was never announced
       * has nothing to end, and one whose spawn was never seen has no turn on
       * record and ends with this one.
       */
      const stopping = str(ctx.active?.id);
      for (const scope of [...ctx.scopes.values()]) {
        if (scope.waiting !== undefined) ctx.scopes.delete(scope.parent);
        else if (scope.parent !== '' && scope.chat !== undefined) {
          const made = ctx.spawning.get(scope.parent)?.turn;
          if (aborts || made === undefined || made === stopping) ctx.endSubagent(scope.parent, 'cancelled');
        }
      }
      // What the CLI was not handed goes with the stop.
      ctx.toYield.length = 0;
      ctx.steering = undefined;
      ctx.preparingTurn = undefined;
      const turn = ctx.active;
      if (turn) {
        turn.state = 'cancelled';
        const attempt = Date.now() - ctx.startedAt;
        turn.duration = (ctx.resumedFrom?.duration ?? 0) + attempt;
        ctx.resumedFrom = undefined;
        ctx.clearPendingToolCalls(turn);
        ctx.turns.push(turn);
        ctx.active = undefined;
        ctx.endedAt(turn);
        ctx.emit('chat', { type: 'chat/turnCancelled', turnId: turn.id, duration: attempt });
        /*
         * The steering messages the CLI holds and had not taken into the
         * stopped turn, which the CLI the stop keeps runs once the interrupt is
         * through: answered in a turn of their own, as VS Code's agents promote
         * a steering message their runtime runs into a protocol turn, whose
         * `chat/turnStarted` names the message in `queuedMessageId` and which
         * VS Code's host takes as a turn its provider began. Opened now, so a
         * turn sent meanwhile waits behind it. The turn goes under the uuid
         * the first went to the CLI with, which the CLI writes it under and a
         * read back gives, and the others join it. A stop that aborts the
         * query let every one of them go with the CLI.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L2606-L2636
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L907-L916
         */
        const left = [...ctx.yielded.values()]
          .filter((one) => one.steeringPendingId !== undefined && one.turnId === stopping && one.lifecycle !== 'started');
        const [held] = left;
        if (held !== undefined) {
          const queuedMessageId = held.steeringPendingId;
          for (const one of left) one.turnId = held.sdkUuid;
          // From here it is the prompt of the turn it opens.
          delete held.steeringPendingId;
          const attachments = attachedTo(held.message);
          prompt = { turn: held.sdkUuid, text: str(held.message.text) ?? '', ...(attachments === undefined ? {} : { attachments }) };
          const promoted = { id: held.sdkUuid, startedAt: new Date().toISOString(), message: held.message, responseParts: [], usage: undefined } as Bag;
          ctx.active = promoted;
          ctx.setModifiedAt(String(promoted.startedAt));
          ctx.newTurn();
          ctx.startedAt = Date.now();
          ctx.failed = undefined;
          ctx.emit('chat', {
            type: 'chat/turnStarted',
            turnId: held.sdkUuid,
            startedAt: promoted.startedAt,
            message: held.message,
            ...(queuedMessageId === undefined ? {} : { queuedMessageId }),
          });
        }
      }
    },
  };

  return { sendNext, again, methods };
}
