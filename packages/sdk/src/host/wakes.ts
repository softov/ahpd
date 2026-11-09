import { idOf } from '../sessions/catalog.js';
import type { MessageFrom } from '../types/session.js';
import type { StoredChat } from '../types/sessions.js';
import type { Owner } from '../types/usage.js';
import type { HostContext } from './context.js';

/**
 * The wakes agents asked this host for, and the clock that fires them.
 *
 * A wake is held on its chat's record in the store, so it survives the session
 * sleeping and the daemon restarting. One timer is armed for the earliest. A
 * wake that fell due while the daemon was down fires once, when the clock
 * starts. A wake whose turn could not begin stays on the record, and fires
 * again when the clock next starts.
 */
export interface Wakes {
  /**
   * Set one chat's wake, replacing the one it held, or cancel it with
   * `undefined`. Answers whether the chat held a wake before.
   */
  setWake(session: string, chat: string, wake: StoredChat['wake']): boolean;
  /** Load the stored wakes, fire the ones already due, and arm the clock. */
  startWakes(): void;
  /** Stop the clock, for a host that is closing. */
  stopWakes(): void;
  /**
   * Start a turn on a chat as a wake does: held, queued behind a turn that is
   * running, and acting as `sender`.
   *
   * The wake clock is not touched. The end of an async command begins a turn
   * the same way and must leave the chat's wake where the model set it, so
   * this is what a wake and a command's end both call.
   */
  beginWakeTurn(session: string, chat: string, prompt: string, sender: Owner | undefined): Promise<void>;
}

/** `setTimeout` will not wait longer than this, so a longer wait is done in instalments. */
const MAX_DELAY = 2_147_483_647;

export function createWakes(ctx: HostContext): Wakes {
  const { options, kept, byChat, sessions, owners, senders, log } = ctx;
  const now = (): number => (options.now?.() ?? new Date()).getTime();
  const arm = options.timer ?? ((fire, ms): { cancel(): void } => {
    const handle = setTimeout(fire, ms);
    handle.unref?.();
    return { cancel: () => { clearTimeout(handle); } };
  });

  /** The wakes held, by chat URI: the session id and when it is due. */
  const pending = new Map<string, { id: string; at: number }>();
  let timer: { cancel(): void } | undefined;
  let started = false;

  /** Write one chat's wake on its record. Answers the wake the record held before. */
  const record = (id: string, chat: string, wake: StoredChat['wake']): StoredChat['wake'] => {
    const rows = kept.chats(id);
    const at = rows.findIndex((one) => one.uri === chat && one.closed !== true);
    const held = rows[at];
    if (held === undefined) return undefined;
    const moved = rows.map((one) => ({ ...one }));
    const next: StoredChat = { ...held };
    delete next.wake;
    if (wake !== undefined) next.wake = wake;
    moved[at] = next;
    kept.setChats(id, moved);
    return held.wake;
  };

  const disarm = (): void => {
    timer?.cancel();
    timer = undefined;
  };

  /** One timer for the earliest wake held. */
  const rearm = (): void => {
    disarm();
    if (!started || ctx.closed) return;
    let first: number | undefined;
    for (const { at } of pending.values()) if (first === undefined || at < first) first = at;
    if (first === undefined) return;
    timer = arm(() => { timer = undefined; fire(); }, Math.min(Math.max(0, first - now()), MAX_DELAY));
  };

  /** The wake one chat's record holds. */
  const stored = (id: string, chat: string): StoredChat['wake'] =>
    kept.chats(id).find((one) => one.uri === chat && one.closed !== true)?.wake;

  /**
   * One due wake: the session woken, and a turn begun with its prompt through
   * the host's own turn gate, queued behind a turn that is running. Cleared from
   * the record once the turn has begun; a refusal or a failed resume throws and
   * leaves it there.
   */
  const begin = async (id: string, chat: string, wake: NonNullable<StoredChat['wake']>): Promise<void> => {
    await beginWakeTurn(id, chat, wake.prompt, wake.sender);
    // The wake it fired, and not one set again since.
    const still = stored(id, chat);
    if (still?.at === wake.at && still.prompt === wake.prompt) record(id, chat, undefined);
  };

  /**
   * Start a turn on a chat, as a wake does.
   *
   * The body of a wake and of an async command's end, which differ only in
   * whether a stored wake is cleared afterwards.
   */
  const beginWakeTurn = async (id: string, chat: string, prompt: string, sender: Owner | undefined): Promise<void> => {
    const name = byChat.get(chat)?.uri ?? ctx.nameOf(id);
    const release = ctx.hold(name);
    try {
      const woken = await ctx.wake(name, chat);
      const state = (ctx.stateOf(woken.chat.chatUri) ?? woken.chat.chatState()) as { activeTurn?: unknown; queuedMessages?: unknown; steeringMessage?: unknown };
      const busy = state.activeTurn !== undefined || state.steeringMessage !== undefined
        || (Array.isArray(state.queuedMessages) && state.queuedMessages.length > 0);
      /*
       * The host started this turn, so its message is a system notification:
       * a client draws it as the host's line, not as the person's message or
       * one sent from another chat.
       */
      const from: MessageFrom = { origin: { kind: 'systemNotification' } };
      const provider = sessions.get(woken.uri)?.agent.provider ?? owners.get(woken.uri)?.provider ?? '';
      const turnId = crypto.randomUUID();
      /*
       * Whose turn this is, written down before it begins.
       *
       * The person who set the wake asked for this work, and the turn it
       * begins is theirs: the turn carries them so its tools ask their grants,
       * and a person who has since lost one is refused by that turn rather
       * than by the one that set the wake. Written here rather than handed to
       * `beginOrRun` because a wake keeps an owner and not a window - the
       * connection that set it was let go of when its turn ended.
       *
       * Before the turn begins, because a backend is free to run it whole
       * before `beginOrRun` returns, and a tool inside it would then find
       * nobody had sent it.
       */
      const acting = sender;
      // A chat that is busy takes it as a queued message of this host's, which
      // the queue drain starts once the chat runs nothing.
      if (busy) ctx.enqueue(woken.chat.chatUri, turnId, prompt, from, { owner: acting });
      else {
        if (acting !== undefined) senders.set(turnId, acting);
        const refused = await ctx.beginOrRun(woken.chat, provider, turnId, prompt, undefined, from);
        if (refused !== undefined) {
          if (acting !== undefined) senders.delete(turnId);
          throw new Error(refused);
        }
      }
    } finally {
      release();
    }
  };

  /** Begin every wake that is due, then arm for the next. */
  const fire = (): void => {
    if (ctx.closed) return;
    const at = now();
    for (const [chat, held] of [...pending]) {
      if (held.at > at) continue;
      pending.delete(chat);
      // The record is what holds the wake: one that is gone with its chat or
      // its session fires nothing.
      const wake = stored(held.id, chat);
      if (wake === undefined) continue;
      begin(held.id, chat, wake).catch((error: unknown) => {
        log.warn(`wake of ${chat} failed, kept for the next start: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    rearm();
  };

  const setWake = (session: string, chat: string, wake: StoredChat['wake']): boolean => {
    const id = idOf(session);
    if (wake !== undefined && kept.chats(id).every((one) => one.uri !== chat || one.closed === true)) {
      throw new Error(`${chat} is not a chat this host keeps a record of`);
    }
    const was = record(id, chat, wake);
    if (wake === undefined) pending.delete(chat);
    else pending.set(chat, { id, at: wake.at });
    rearm();
    return was !== undefined;
  };

  const startWakes = (): void => {
    if (started) return;
    started = true;
    for (const id of kept.sessions()) {
      for (const one of kept.chats(id)) {
        if (one.wake !== undefined && one.closed !== true) pending.set(one.uri, { id, at: one.wake.at });
      }
    }
    fire();
  };

  const stopWakes = (): void => {
    started = false;
    disarm();
  };

  return { setWake, startWakes, stopWakes, beginWakeTurn };
}
