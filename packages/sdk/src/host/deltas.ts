/**
 * The window a streamed delta waits in, and the merge that comes out of it.
 *
 * A turn that streams sends one action per token, and every action is an
 * envelope: a sequence number, a broadcast to everyone watching the channel
 * and a copy kept for a client that comes back. For a client that is a redraw
 * per token, and for this host it is a replay buffer holding a few seconds of
 * streaming where a few minutes would fit.
 *
 * What a client reads is the text, and the text is the same whether it
 * arrives in one envelope or in fifty. So the deltas naming one part are
 * gathered for a short window and sent as one action, and the answer reaches
 * a client as the words it would have read anyway.
 *
 * Only the three kinds that stream text are gathered. Everything else is sent
 * as it is dispatched, because it is the order between a delta and what sits
 * beside it that a client reads: `chat/responsePart` opens the part a delta
 * fills, `chat/toolCallComplete` closes the call a delta was filling, and
 * `chat/turnComplete` ends the turn the text belongs to.
 */

import type { Bag } from '../types/common.js';
import type { Origin } from './state.js';

/**
 * How long a held delta waits for the next one, in milliseconds.
 *
 * A tenth of a second is under the point at which a person reading a reply
 * notices the words arrive in lumps, and it is long enough to gather a
 * token-by-token stream into a handful of envelopes per second.
 */
export const DELTA_WINDOW_MS = 75;

/**
 * How much text one held entry may gather before it is sent, in bytes.
 *
 * The window is a delay, not a licence to hold a whole answer. A turn that
 * streams faster than the timer fires - a burst of tool output, a long
 * preamble - would otherwise grow one entry for as long as it ran, and a
 * client that asked for what it missed would be handed all of it at once.
 */
export const DELTA_CAP_BYTES = 16 * 1024;

/** One encoder, for every size this file measures. */
const ENCODER = new TextEncoder();

/** How many bytes of JSON one piece of text is. */
const bytes = (text: string): number => ENCODER.encode(text).length;

/** Whether two attributions are the same one. */
const same = (one: unknown, other: unknown): boolean =>
  one === other || JSON.stringify(one) === JSON.stringify(other);

/** One action, with the next one's `content` added to its own. */
const appended = (held: Bag, next: Bag): Bag =>
  ({ ...held, content: `${String(held.content ?? '')}${String(next.content ?? '')}` });

/**
 * How one delta joins the one held before it, by kind.
 *
 * The three that stream text all append their `content`, which is what the
 * protocol's own reducer does with each of them. A tool call's
 * `invocationMessage` is the last one sent rather than an accumulation - the
 * same rule that reducer applies - so a later one wins and a delta carrying
 * none leaves the held one standing.
 */
const MERGING: Record<string, (held: Bag, next: Bag) => Bag> = {
  'chat/delta': appended,
  'chat/reasoning': appended,
  'chat/toolCallDelta': (held, next) => (next.invocationMessage === undefined
    ? appended(held, next)
    : { ...appended(held, next), invocationMessage: next.invocationMessage }),
};

/** One delta action, and who it is for. */
interface Held {
  channel: string;
  action: Bag;
  origin: Origin | undefined;
  /** How many bytes of `content` have been gathered into `action` so far. */
  bytes: number;
}

/** The window, as the one caller that has actions to give it sees it. */
export interface DeltaWindow {
  /**
   * Hold one action, when it is a mergeable delta.
   *
   * Answers whether it was held. False means the caller sends it itself,
   * which is every action that is not a mergeable delta and every action at
   * all once the window is zero. Whatever was held goes out first, so the
   * order the actions arrived in is the order they are sent in.
   */
  push(channel: string, action: Bag, origin: Origin | undefined): boolean;
  /** Send everything held now, oldest first. */
  flush(): void;
  /**
   * Send everything held and hold nothing after this.
   *
   * The timer is the last thing a host has running, so the moment a host
   * begins to close is the moment this stops: a delta a session emits as it
   * goes would otherwise wait out the window and be broadcast by a timer that
   * outlives the host it belongs to.
   */
  stop(): void;
}

/**
 * A window over streamed deltas, and the `send` each of them leaves by.
 *
 * `flush` is what everything else in the host is held to: a snapshot read
 * while text is held would carry that text and then be handed the delta that
 * wrote it, and a turn's ending would arrive before the words it ended.
 */
export function merger(options: {
  windowMs: number;
  capBytes?: number;
  send: (channel: string, action: Bag, origin: Origin | undefined) => void;
}): DeltaWindow {
  const { windowMs, send } = options;
  const cap = options.capBytes ?? DELTA_CAP_BYTES;

  /** What is held, by the channel, kind, turn and part each entry belongs to, oldest first. */
  const pending = new Map<string, Held>();
  /** The one timer, running while anything is held. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the window has been let go of, after which nothing is held. */
  let stopped = false;

  /** Send what one key holds, and let it go. */
  const sendOne = (key: string): void => {
    const held = pending.get(key);
    if (held === undefined) return;
    pending.delete(key);
    send(held.channel, held.action, held.origin);
  };

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const key of [...pending.keys()]) sendOne(key);
  };

  const push = (channel: string, action: Bag, origin: Origin | undefined): boolean => {
    const merge = MERGING[String(action.type ?? '')];
    if (stopped || windowMs <= 0 || merge === undefined) {
      flush();
      return false;
    }
    /*
     * What makes two deltas one action. The kind and the part are the text's
     * own identity, and the turn is kept beside them so a part id a later
     * turn reuses is not a part this one is still filling.
     */
    const key = [channel, action.type, action.turnId, action.partId ?? action.toolCallId]
      .map((one) => String(one)).join('\u0000');
    const held = pending.get(key);
    /*
     * A delta that is not the one already held goes after it.
     *
     * The same text under a different `_meta` is not the same event: a
     * backend attributes a delta to a subagent there, and a client reading it
     * draws it as that agent's words. Held together, the attribution of the
     * first would be the only one that ever arrived.
     */
    if (held !== undefined && !(same(held.origin, origin) && same(held.action._meta, action._meta))) flush();
    const now = pending.get(key);
    if (now === undefined) {
      pending.set(key, { channel, action, origin, bytes: bytes(String(action.content ?? '')) });
      if (timer === undefined) timer = setTimeout(() => { timer = undefined; flush(); }, windowMs);
      return true;
    }
    now.action = merge(now.action, action);
    now.bytes += bytes(String(action.content ?? ''));
    if (now.bytes > cap) sendOne(key);
    return true;
  };

  const stop = (): void => {
    stopped = true;
    flush();
  };

  return { push, flush, stop };
}
