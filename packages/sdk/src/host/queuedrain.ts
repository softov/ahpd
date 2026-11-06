/**
 * The queue drain: a chat's pending messages are this host's, as the
 * reference host's are its own.
 *
 * A pending message is said when a client sets it and held in the chat's
 * state. Steering is handed to the chat's backend while a turn is active, at
 * the turn's start and on every later action of it until the backend takes
 * it; the queue's head becomes a turn of this host's once a turn ends well or
 * a local command ends, steering first, and never while the latest turn is a
 * failure a client can resume. A stop takes the pending steering out and
 * starts nothing. The pending messages of a chat whose session runs on another
 * host are that host's to drain.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L29-L326
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md?plain=1#L623-L625
 */

import { holdsTheQueue, idOf } from '../sessions/catalog.js';
import { withSenderOn } from './common.js';
import type { Bag } from '../types/common.js';
import type { Connection } from '../types/host.js';
import type { MessageAttachment, MessageFrom } from '../types/session.js';
import type { Owner } from '../types/usage.js';
import type { Origin } from './state.js';
import type { HostContext } from './context.js';

/**
 * Who sent a pending message, kept by this host beside the chat's state and
 * put in no action: the window that set it, and the owner a message of this
 * host's is for.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L77-L83
 */
interface Sender {
  connection?: Connection | undefined;
  owner?: Owner | undefined;
}

/** What the drain keeps of one chat. */
interface Kept {
  /** Who sent each pending message, by its id. */
  senders: Map<string, Sender>;
  /** The steering messages the chat's backend was handed and has not given back. */
  submitted: Set<string>;
  /** The queued message each turn the drain admitted took up, by the turn's id, until it ends. */
  admitted: Map<string, string>;
}

export interface QueueDrain {
  /** A pending message a client set, said already, kept with who sent it and then handed on or drained. */
  pendingSet(chat: string, id: string, connection: Connection | undefined): void;
  /** A pending message a client took back, said already: steering the backend holds is withdrawn. */
  pendingRemoved(chat: string, id: string, kind: 'queued' | 'steering'): void;
  /** The queue reordered by a client, said already. */
  queueReordered(chat: string): void;
  /** A message this host queues itself, said as the host's, sent by `by` where it names one. */
  enqueue(chat: string, id: string, text: string, from: MessageFrom | undefined, by?: { owner?: Owner | undefined; connection?: Connection | undefined }): void;
  /** The queued message the drain admitted as `turnId`, while that turn runs. */
  takenUp(chat: string, turnId: string): string | undefined;
  /** A chat's active turn ended with `action`, said already. */
  turnEnded(chat: string, action: Bag): void;
  /** Any other action said on a chat. */
  observed(chat: string, action: Bag, origin: Origin | undefined): void;
  /** Let go of what the drain keeps of a chat whose state is let go. */
  forgetChatQueue(chat: string): void;
}

export function createQueueDrain(ctx: HostContext): QueueDrain {
  const { byChat, sessions, dispatch, log } = ctx;
  const chats = new Map<string, Kept>();
  const keptOf = (chat: string): Kept => {
    const one = chats.get(chat) ?? { senders: new Map<string, Sender>(), submitted: new Set<string>(), admitted: new Map<string, string>() };
    chats.set(chat, one);
    return one;
  };
  /**
   * Whether the chat's session runs on another host, whose drain runs the
   * chat's pending messages: a client's reach it through the session's relay,
   * and a message this host queues is carried there too.
   */
  const relayed = (chat: string): boolean => byChat.get(chat)?.chat.relay !== undefined;
  /** The chat's state still holds a pending message by this id. */
  const pending = (chat: string, id: string): boolean => {
    const state = ctx.stateOf(chat);
    return (state?.steeringMessage as Bag | undefined)?.id === id
      || (Array.isArray(state?.queuedMessages) && (state.queuedMessages as Bag[]).some((one) => one.id === id));
  };

  /**
   * The chat's pending steering handed to its backend while a turn is active:
   * taken, not yet, or handed back unsent, which steers the turn that runs
   * then or runs next once the chat is idle. A handoff settled while the chat
   * is idle and steering still waits drains again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L175-L243
   */
  const handSteering = (chat: string): void => {
    if (relayed(chat)) return;
    const state = ctx.stateOf(chat);
    const steering = state?.steeringMessage as Bag | undefined;
    const kept = chats.get(chat);
    if (kept !== undefined) for (const id of [...kept.submitted]) if (steering?.id !== id) kept.submitted.delete(id);
    const session = byChat.get(chat)?.chat;
    if (state?.activeTurn === undefined || steering === undefined || session?.sendSteeringMessage === undefined) return;
    const id = String(steering.id ?? '');
    const { submitted, senders } = keptOf(chat);
    if (submitted.has(id)) return;
    submitted.add(id);
    const message = (steering.message ?? {}) as Bag;
    const from = ctx.messageFrom(message);
    // The message as the chat holds it, as the reference host hands steering on.
    const attachments = Array.isArray(message.attachments) ? message.attachments as MessageAttachment[] : undefined;
    const handoff = session.sendSteeringMessage({
      id,
      text: String(message.text ?? ''),
      ...(attachments === undefined ? {} : { attachments }),
      ...(from === undefined ? {} : { from }),
    });
    if (handoff === false) submitted.delete(id);
    else if (handoff instanceof Promise) {
      handoff.then(
        (sent) => {
          const now = ctx.stateOf(chat);
          if (sent) {
            if (now !== undefined && now.activeTurn === undefined && now.steeringMessage !== undefined) tryConsume(chat);
            return;
          }
          if ((now?.steeringMessage as Bag | undefined)?.id !== id) return;
          chats.get(chat)?.submitted.delete(id);
          if (now?.activeTurn !== undefined) handSteering(chat);
          else tryConsume(chat);
        },
        (error: unknown) => { log(`${chat}: steering ${id} was not handed on: ${error instanceof Error ? error.message : String(error)}`); },
      );
    }
  };

  /**
   * The head of the queue as a turn of this host's, once the chat runs
   * nothing: steering first, nothing while the backend holds steering it has
   * not started, and nothing behind a failure a client can resume. The start
   * is said with the message as the chat holds it and the queued message's
   * id, and the turn is then admitted and sent as a client's start is.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L326
   */
  const tryConsume = (chat: string): void => {
    if (relayed(chat)) return;
    const state = ctx.stateOf(chat);
    const owner = byChat.get(chat);
    if (state === undefined || owner === undefined || state.activeTurn !== undefined) return;
    const steering = state.steeringMessage as Bag | undefined;
    const kept = keptOf(chat);
    if (steering !== undefined && kept.submitted.has(String(steering.id ?? ''))) return;
    if (holdsTheQueue(Array.isArray(state.turns) ? (state.turns as Bag[]).at(-1) : undefined)) return;
    const head = steering ?? (Array.isArray(state.queuedMessages) ? (state.queuedMessages as Bag[])[0] : undefined);
    if (head === undefined) return;
    const id = String(head.id ?? '');
    const message = (head.message ?? {}) as Bag;
    const sender = kept.senders.get(id);
    kept.senders.delete(id);
    const turnId = crypto.randomUUID();
    const since = Date.now();
    kept.admitted.set(turnId, id);
    /*
     * The turn of whoever queued the message: the owner it was queued for, a
     * message of this host's, or the person on the connection that sent it.
     * Who that is goes on the turn's start and into the store, as every start
     * this host says carries its sender.
     */
    const start: Bag = { type: 'chat/turnStarted', turnId, startedAt: new Date(since).toISOString(), message, queuedMessageId: id };
    const by = sender?.owner ?? (sender?.connection === undefined ? undefined : ctx.ownerFor(sender.connection));
    if (by !== undefined) {
      ctx.senders.set(turnId, by);
      ctx.kept.setSender(idOf(owner.uri), turnId, by);
    }
    dispatch(chat, by === undefined ? start : withSenderOn(start, by));
    // Ended by this host, so nothing held against the turn is let go by anything else.
    const ended = (errorType: string, why: string): void => {
      ctx.forgetSender(turnId);
      ctx.forgetKeys(turnId);
      dispatch(chat, {
        type: 'chat/error',
        turnId,
        duration: Math.max(0, Date.now() - since),
        part: { kind: 'error', error: { errorType, message: why } },
      });
    };
    const lead = sessions.get(owner.uri);
    const provider = lead === undefined ? 'This provider' : ctx.chatAgent(lead, chat).provider;
    /*
     * The chats the message attaches, read out as the turn is sent, as a
     * client's start's are: one that cannot be read ends the turn, as the
     * reference host's send resolves a turn's attachments.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2380-L2409
     */
    const attached = ctx.messageAttachments(message, sender?.connection);
    if (attached.refusal !== undefined) {
      ended('sendFailed', attached.refusal);
      return;
    }
    // Its start is the drain's, said above, so nothing more is said for it.
    ctx.beginTurn(
      () => ctx.beginOrRun(owner.chat, provider, turnId, String(message.text ?? ''), ctx.modelIn(message.model), ctx.messageFrom(message),
        sender?.connection, attached.attachments, () => undefined, () => ctx.cancelledTurns.get(chat)?.has(turnId) === true),
      (why) => { ended('rejected', why); },
      (why) => { ended('sendFailed', why); },
    );
  };

  return {
    pendingSet: (chat, id, connection) => {
      keptOf(chat).senders.set(id, { connection });
      handSteering(chat);
      tryConsume(chat);
    },
    pendingRemoved: (chat, id, kind) => {
      const kept = keptOf(chat);
      if (!pending(chat, id)) kept.senders.delete(id);
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L165-L173
      if (kind === 'steering' && kept.submitted.delete(id)) byChat.get(chat)?.chat.withdrawSteeringMessage?.(id);
      handSteering(chat);
      tryConsume(chat);
    },
    queueReordered: (chat) => {
      handSteering(chat);
      tryConsume(chat);
    },
    enqueue: (chat, id, text, from, by) => {
      keptOf(chat).senders.set(id, { connection: by?.connection, owner: by?.owner });
      const action = { type: 'chat/pendingMessageSet', kind: 'queued', id, message: ctx.messageOf(text, undefined, from) };
      dispatch(chat, action);
      if (relayed(chat)) byChat.get(chat)?.chat.relay?.('chat', action);
    },
    takenUp: (chat, turnId) => chats.get(chat)?.admitted.get(turnId),
    /*
     * A stop takes every pending steering message out, the steering the
     * backend was handed among them, and starts nothing: stopping means stop.
     * A turn that ended well, a local command's among them, starts the head,
     * once the backend that ended it has finished saying so.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69
     */
    turnEnded: (chat, action) => {
      if (relayed(chat)) return;
      const kept = chats.get(chat);
      kept?.admitted.delete(String(action.turnId ?? ''));
      if (action.type === 'chat/turnCancelled') {
        kept?.submitted.clear();
        const steering = (ctx.stateOf(chat)?.steeringMessage as Bag | undefined)?.id;
        if (typeof steering !== 'string') return;
        kept?.senders.delete(steering);
        dispatch(chat, { type: 'chat/pendingMessageRemoved', kind: 'steering', id: steering });
        return;
      }
      if (action.type === 'chat/turnComplete') queueMicrotask(() => { tryConsume(chat); });
    },
    /*
     * A start hands the chat's pending steering to the turn, and so does each
     * of this host's actions while a turn is active; a message this host
     * queues starts the head of an idle chat. A client's pending actions are
     * answered where they are taken.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L152
     */
    observed: (chat, action, origin) => {
      const type = String(action.type ?? '');
      if (type === 'chat/turnStarted' && typeof action.queuedMessageId === 'string') chats.get(chat)?.senders.delete(action.queuedMessageId);
      if (origin !== undefined && type !== 'chat/turnStarted') return;
      handSteering(chat);
      if (origin === undefined && type === 'chat/pendingMessageSet' && action.kind === 'queued') tryConsume(chat);
    },
    forgetChatQueue: (chat) => {
      chats.delete(chat);
    },
  };
}
