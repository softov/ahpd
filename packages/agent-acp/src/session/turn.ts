import type { ContentBlock, StopReason, Usage } from '@agentclientprotocol/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom } from '@ahpd/sdk';
import { partsOf } from '@ahpd/sdk';
import { closePlan } from '../mapping.js';
import type { AcpConnection } from '../types.js';
import { bag, messageOf } from './common.js';
import type { SessionContext } from './context.js';

/** One prompted turn, from its opening to its ending. */
export interface Turn {
  openTurn(turnId: string, text: string, from: MessageFrom | undefined, queuedMessageId: string | undefined): void;
  finish(
    turnId: string,
    ending: 'complete' | 'cancelled' | 'error',
    failure?: { errorType: string; message: string },
  ): void;
  run(
    turnId: string,
    text: string,
    chosen: Chosen | undefined,
    attachments: MessageAttachment[] | undefined,
  ): Promise<void>;
}

/**
 * What each stop reason that is not an answer says, by name.
 *
 * `end_turn` is absent because it is the server saying it is done and the turn is
 * what the client asked for. The other three are the server saying it stopped
 * early, and a turn that stopped early is not an answer: the model ran out of
 * room, the session used up the requests it was allowed, or the agent declined.
 *
 * A reason absent here - `end_turn`, and anything a later version of the
 * protocol names and this bridge has not heard of - ends the turn complete,
 * because a stop this code cannot describe is better read as an answer than
 * reported as a failure with no reason.
 */
const NOT_AN_ANSWER: Partial<Record<StopReason, string>> = {
  max_tokens: 'The agent ran out of tokens before it answered',
  max_turn_requests: 'The agent used every turn request this session allowed',
  refusal: 'The agent declined to answer this prompt',
};

export function createTurn(ctx: SessionContext): Turn {
  const { emit, provider, start, inside, turns, doing, touch } = ctx;

  /** Open a turn on the wire, before the prompt is sent. */
  const openTurn = (
    turnId: string,
    text: string,
    from: MessageFrom | undefined,
    queuedMessageId: string | undefined,
  ): void => {
    ctx.active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      },
      responseParts: [],
    };
    ctx.watchedTurn = {
      turnId,
      startedAt: String(ctx.active.startedAt),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
      },
      state: 'complete',
      updates: [],
    };
    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: ctx.active.startedAt,
      message: ctx.active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    doing('Thinking');
  };

  /**
   * End the running turn, whoever ended it.
   *
   * How it ended is the server's to say: `stopReasonFor` reads the stop reason
   * into one of the three endings. A connection that failed before a stop reason
   * arrived is an error, with the reason on the turn and the type this bridge
   * uses for a failure of its own.
   */
  const finish = (
    turnId: string,
    ending: 'complete' | 'cancelled' | 'error',
    failure: { errorType: string; message: string } = {
      errorType: 'turnFailed',
      message: 'The ACP server did not answer',
    },
  ): void => {
    const turn = ctx.active;
    if (turn === undefined || String(turn.id) !== turnId) return;
    doing(undefined);
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    turn.state = ending;
    turn.duration = duration;
    turns.push(turn);
    // The watched turn is sealed here, which is what makes a transcript a
    // record of turns rather than of one long stream of updates.
    if (ctx.watchedTurn !== undefined && ctx.watchedTurn.turnId === turnId) {
      ctx.watchedTurn.state = ending;
      ctx.watchedTurn.duration = Number.isFinite(duration) ? duration : 0;
      /*
       * What the turn last said it had spent, which the updates alone cannot
       * say: the token counts arrive with the prompt's answer, and a cost is
       * reported for the whole session, so what this turn spent is its share
       * of a total it opened at a number the replay never knew.
       */
      if (turn.usage !== undefined) ctx.watchedTurn.usage = bag(turn.usage);
      // Every turn after the first is sealed here rather than at the open that
      // precedes it, because the open already happened for it.
      if (ctx.record !== undefined && !ctx.record.turns.includes(ctx.watchedTurn)) ctx.record.turns.push(ctx.watchedTurn);
      ctx.watchedTurn = undefined;
    }
    // Nothing in the protocol says when the agent has finished writing a plan,
    // so the turn ending is what closes the call it is held in.
    if (ctx.mapping !== undefined) for (const action of closePlan(ctx.mapping)) emit('chat', action);
    // Before the ending action, not after: the host reads `status()` as it
    // passes that action on, and a turn still active there reads as running.
    ctx.active = undefined;
    if (ctx.mapping?.cost !== undefined) ctx.cumulative = ctx.mapping.cost.amount;
    ctx.mapping = undefined;
    ctx.cancelRequested = false;
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration });
    else {
      const message = failure.message === '' ? 'The ACP server did not answer' : failure.message;
      ctx.failed = message;
      emit('chat', {
        type: 'chat/error',
        turnId,
        duration,
        part: { kind: 'error', error: { errorType: failure.errorType, message } },
      });
    }
    touch();
    // Somebody stopping a turn is stopping this conversation; a queued message
    // behind it is the opposite of what they asked for.
    if (ending !== 'cancelled') ctx.startNext();
  };

  /**
   * End the turn the way the server's stop reason says to.
   *
   * The reason is the error's type as well as its sentence, so a client can tell
   * a refusal from a ceiling reached without reading prose, and the sentence
   * says the agent declined rather than that something broke - a refusal is
   * something the agent did.
   */
  const stopReasonFor = (turnId: string, reason: StopReason): void => {
    if (reason === 'cancelled') return finish(turnId, 'cancelled');
    const said = NOT_AN_ANSWER[reason];
    if (said === undefined) return finish(turnId, 'complete');
    finish(turnId, 'error', { errorType: reason, message: said });
  };

  /**
   * What the prompt response said the turn used, as its last report.
   *
   * ACP counts no tokens per call, so the response is the only place a turn's
   * counts appear, and they arrive with the turn already over - which is why
   * this goes out before the ending action, the way the reports during the
   * turn did: the host reads `status()` as that action passes, and a usage is
   * hung on the turn that is still running.
   *
   * The cost the updates carried is kept rather than replaced, because tokens
   * are one measurement and the price of them another and this response names
   * no price at all. A response with no usage therefore says the cost on its
   * own, and one that reported neither says nothing, because what the updates
   * already sent stands.
   */
  const saidUsage = (usage: Usage | null | undefined): void => {
    const turn = ctx.active;
    const held = ctx.mapping;
    if (turn === undefined || held === undefined) return;
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const wrote = num(usage?.cachedWriteTokens);
    const thought = num(usage?.thoughtTokens);
    const price = held.cost === undefined
      ? undefined
      : { amount: held.cost.amount - (held.costAtStart ?? 0), currency: held.cost.currency };
    const filled = bag(bag(held.usage)._meta)['ahpd.context'];
    const said: Bag = {
      ...(num(usage?.inputTokens) !== undefined ? { inputTokens: num(usage?.inputTokens) } : {}),
      ...(num(usage?.outputTokens) !== undefined ? { outputTokens: num(usage?.outputTokens) } : {}),
      ...(num(usage?.cachedReadTokens) !== undefined ? { cacheReadTokens: num(usage?.cachedReadTokens) } : {}),
      /*
       * Cache writes, thinking and the context window ride `_meta`, which is
       * where the protocol carries a measurement it names no field for, and
       * where the other backends already put them. The context is the one the
       * updates already reported and this response knows nothing about, so it
       * is kept rather than dropped at the turn's last word.
       */
      ...(wrote !== undefined || thought !== undefined || price !== undefined || filled !== undefined
        ? {
            _meta: {
              ...(wrote !== undefined ? { 'ahpd.cacheWriteTokens': wrote } : {}),
              ...(thought !== undefined ? { 'ahpd.reasoningTokens': thought } : {}),
              ...(price !== undefined ? { 'ahpd.cost': price } : {}),
              ...(filled === undefined ? {} : { 'ahpd.context': filled }),
            },
          }
        : {}),
    };
    if (Object.keys(said).length === 0) return;
    turn.usage = said;
    emit('chat', { type: 'chat/usage', turnId: String(turn.id), usage: said });
  };

  /**
   * The URI an attachment with no URI of its own is sent under.
   *
   * A pasted image is bytes with a name and nothing to point at, and ACP's
   * blocks name what they carry. The scheme is this bridge's own, as the one a
   * command leaf uses: nothing reads it, so it has to be honest rather than
   * resolve.
   */
  const attachmentUri = (label: string): string => `acp-attachment:${provider}/${label}`;

  /**
   * The blocks one turn is prompted with: what was said, then the message's
   * attachments as the parts the shared helper made of them.
   *
   * The helper decides which of the three an attachment is, and within which
   * limits, so nothing here reads a file: a part is what the message already
   * holds. What is left to this bridge is what ACP asks a server to opt into -
   * an image block only where `promptCapabilities.image` says so, which the
   * helper is told, and a file named as a resource only where
   * `embeddedContext` does. A file the helper could not inline is named by its
   * path in the text, which the agent opens with its own tools if it has them.
   */
  const blocksFor = async (text: string, attachments: MessageAttachment[] | undefined): Promise<ContentBlock[]> => {
    const parts = await partsOf(text, attachments, { images: ctx.takes?.image === true });
    const blocks: ContentBlock[] = [];
    for (const part of parts) {
      if (part.type === 'image') {
        blocks.push({
          type: 'image',
          data: part.data,
          mimeType: part.mimeType,
          uri: attachmentUri(part.source?.label ?? 'attachment'),
        });
        continue;
      }
      /*
       * A text part with a file behind it goes as the resource it is, to a
       * server that takes embedded context: the file's own words under the URI
       * they came from, because a resource block is the file rather than a copy
       * of it with a label on top. A text part read out of no file - an
       * attachment named rather than read, or bytes that never reached a file -
       * names nothing to point at and stays text.
       */
      const source = part.source;
      if (ctx.takes?.embeddedContext === true && source?.uri !== undefined && source.text !== undefined) {
        blocks.push({ type: 'resource', resource: { uri: source.uri, text: source.text } });
        continue;
      }
      blocks.push({ type: 'text', text: part.text });
    }
    return blocks;
  };

  /**
   * One turn: the prompt is sent, and what comes back ends it.
   *
   * A cancel that arrived while the server was still being opened ends the
   * turn without a prompt at all, because there is nothing running to stop.
   */
  const run = async (
    turnId: string,
    text: string,
    chosen: Chosen | undefined,
    attachments: MessageAttachment[] | undefined,
  ): Promise<void> => {
    /** The connection this turn opened, which outlives `live` once it dies. */
    let connection: AcpConnection | undefined;
    try {
      const held = await ctx.open();
      connection = held.connection;
      const turn = ctx.active;
      if (ctx.closed || turn === undefined || String(turn.id) !== turnId) return;
      if (ctx.cancelRequested) {
        finish(turnId, 'cancelled');
        return;
      }
      /*
       * The turn's mapping, opened only now that the server has answered.
       *
       * Set after the open rather than before it, because everything the
       * server sends while it is opening is the load's replay and belongs to no
       * turn this bridge began. The cost baseline is read here too, so a turn
       * counts from what the session had spent once the replay was counted in
       * and not from what it had spent before.
       */
      ctx.mapping = {
        turnId,
        parts: turn.responseParts as Bag[],
        calls: new Map(),
        reach: {
          within: inside,
          changed: (path, before) => {
            if (before !== undefined) start.onFileEdit?.(turnId, path, 'before', before);
            start.onFileEdit?.(turnId, path, 'after');
          },
        },
        // The clients' tools, read off what the host last said this session may
        // offer: a call the agent reports for one is held for the client that
        // owns it, and asks that client to run it.
        ownerOf: ctx.ownerOf,
        onRunning: (call) => ctx.openCall(call, turnId),
        ...(ctx.cumulative !== undefined ? { costAtStart: ctx.cumulative } : {}),
      };
      await ctx.chooseModel(held, chosen);
      ctx.mapping.prompted = true;
      const response = await held.connection.prompt(held.sessionId, await blocksFor(text, attachments));
      saidUsage(response.usage);
      stopReasonFor(turnId, response.stopReason);
    }
    catch (why: unknown) {
      // The opening is cleared so the next turn spawns a server again rather
      // than awaiting a promise that will never resolve, and the connection is
      // closed so the failed attempt does not leave a subprocess behind.
      ctx.opening = undefined;
      ctx.live = undefined;
      connection?.close();
      /*
       * A server that wants to be signed in says so with its own error, and
       * the turn ends as that rather than as a failure nobody can act on: the
       * sentence names the methods the handshake offered, because a client is
       * not sent back to the server for them and `authenticate` takes an id
       * out of that list.
       */
      const signIn = ctx.signInFailure(why);
      if (signIn !== undefined) {
        finish(turnId, 'error', signIn);
        return;
      }
      /*
       * Whatever the server said on stderr rides on the failure, because an
       * exit code is rarely why and the trace under it is. Read from the
       * connection this turn prompted: a server that died is already off
       * `live`, which is exactly the case a person most wants the trace for.
       */
      const said = messageOf(why);
      const tail = connection === undefined ? '' : await connection.stderrTail();
      finish(turnId, 'error', {
        errorType: 'turnFailed',
        message: tail === '' ? said : `${said}\n${tail}`,
      });
    }
  };

  return { openTurn, finish, run };
}