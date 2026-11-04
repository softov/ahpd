import { titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom } from '@ahpd/sdk';
import { bag, UNTITLED } from './common.js';
import type { SessionContext, Waiting } from './context.js';

/** What runs next: a turn, and the turns handed behind the one running. */
export interface Queue {
  begin(turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[]): void;
  startNext(): void;
}

export function createQueue(ctx: SessionContext): Queue {
  const { emit, queued, touch } = ctx;

  /**
   * The first message titles a session nobody has named.
   *
   * A message of nothing but blanks answers the fallback, which is the title
   * already held - so nothing moves and nothing is said about it.
   */
  const titled = (text: string): void => {
    if (ctx.title !== UNTITLED || text === '') return;
    const said = titleFrom(text, UNTITLED);
    if (said === ctx.title) return;
    ctx.title = said;
    if (ctx.record !== undefined) ctx.record.title = said;
    // Said, because a client that opened the session holds the old one.
    emit('session', { type: 'session/titleChanged', title: said });
  };

  /**
   * A turn sent while the server runs another, said now as the chat's turn and
   * prompted once the turn in front of it is over. The turn it takes the place
   * of, the running one or one said before it, runs on and ends in no history;
   * a turn the server still runs after a stop already ended in every client's
   * state.
   */
  const hand = (turnId: string, text: string, rest: Omit<Waiting, 'said'>): void => {
    const shown = ctx.waiting.at(-1)?.said ?? (ctx.cancelRequested ? undefined : ctx.active);
    if (shown !== undefined) ctx.replaced.add(String(shown.id));
    const said: Bag = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        ...(rest.from?.origin !== undefined ? { origin: rest.from.origin } : {}),
        ...(rest.from?._meta !== undefined ? { _meta: rest.from._meta } : {}),
      },
      responseParts: [],
    };
    ctx.waiting.push({ ...rest, said });
    titled(text);
    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: said.startedAt,
      message: said.message,
      ...(rest.queuedMessageId !== undefined ? { queuedMessageId: rest.queuedMessageId } : {}),
    });
    touch();
  };

  /**
   * Begin a turn, once the session is free; one sent while the server runs
   * another is said now and prompted after it. `said` is such a turn, run now.
   */
  const begin = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    attachments: MessageAttachment[] | undefined,
    queuedMessageId?: string,
    said?: Bag,
  ): void => {
    if (ctx.closed) return;
    if (said === undefined && (ctx.active !== undefined || ctx.waiting.length > 0)) {
      hand(turnId, text, { model, from, attachments, queuedMessageId });
      return;
    }
    if (ctx.active !== undefined) return;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    if (said === undefined) titled(text);
    ctx.openTurn(turnId, text, from, queuedMessageId, said);
    void ctx.run(turnId, text, model, attachments);
  };

  /** The head of the queue, once there is nothing running. */
  const startNext = (): void => {
    if (ctx.closed) return;
    /*
     * While a stopped prompt still winds down, every client holds the chat
     * idle, so the head of the queue is said as the chat's turn now, and
     * prompted once the server is free.
     */
    if (ctx.active !== undefined) {
      if (!ctx.cancelRequested || ctx.waiting.length > 0) return;
      const head = queued.shift();
      if (head === undefined) return;
      const message = bag(head.message);
      hand(crypto.randomUUID(), String(message.text ?? ''), {
        queuedMessageId: String(head.id),
        model: head.model as Chosen | undefined,
        from: head.from as MessageFrom | undefined,
        attachments: Array.isArray(message.attachments) ? message.attachments as MessageAttachment[] : undefined,
      });
      return;
    }
    // A turn said while another ran goes first, as it was said.
    const first = ctx.waiting.shift();
    if (first !== undefined) {
      begin(String(first.said.id), String(bag(first.said.message).text ?? ''), first.model, first.from, first.attachments, first.queuedMessageId, first.said);
      return;
    }
    const next = queued.shift();
    if (next === undefined) return;
    const message = bag(next.message);
    begin(
      crypto.randomUUID(),
      String(message.text ?? ''),
      next.model as Chosen | undefined,
      next.from as MessageFrom | undefined,
      // What the message was queued with, which is still its own: a picture
      // pasted into a message that waited its turn is a picture when it comes.
      Array.isArray(message.attachments) ? message.attachments as MessageAttachment[] : undefined,
      String(next.id),
    );
  };

  return { begin, startNext };
}