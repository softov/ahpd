import type { ContentBlock, StopReason, Usage } from '@agentclientprotocol/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, TurnOptions } from '@ahpd/sdk';
import { endedParts, partsOf, titleFrom } from '@ahpd/sdk';
import type { AcpConnection } from '../types.js';
import { bag, messageOf, UNTITLED } from './common.js';
import type { SessionContext } from './context.js';

/** One prompted turn, from its opening to its ending, and the turns handed behind it. */
export interface Turn {
  /**
   * Send a turn the host said: prompted now when the server runs nothing, and
   * once the turn in front of it is over when it runs another.
   */
  begin(
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ): void;
  finish(
    turnId: string,
    ending: 'complete' | 'cancelled' | 'error',
    failure?: { errorType: string; message: string },
  ): void;
}

export function createTurn(ctx: SessionContext): Turn {
  const { emit, provider, start, inside, turns, doing } = ctx;

  /**
   * The first message titles a session nobody has named, and replaces a title
   * a local command suggested, as VS Code's title controller seeds one.
   *
   * A message of nothing but blanks names nothing, so the title held stays
   * and nothing is said about it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L189-L229
   */
  const titled = (text: string): void => {
    if (ctx.title !== UNTITLED && !ctx.provisional) return;
    const said = titleFrom(text, '');
    if (said === '') return;
    ctx.provisional = false;
    if (said === ctx.title) return;
    ctx.title = said;
    if (ctx.record !== undefined) ctx.record.title = said;
    // Said, because a client that opened the session holds the old one.
    emit('session', { type: 'session/titleChanged', title: said });
  };

  /** Hold a turn the host said as the one running, before the prompt is sent. */
  const openTurn = (turnId: string, text: string, from: MessageFrom | undefined): void => {
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
    ctx.setModifiedAt(String(ctx.active.startedAt));
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
    doing('Thinking');
  };

  /**
   * The first turn handed while another ran, once nothing runs: a session runs
   * one prompt at a time, as the reference agent runs each send after the one
   * before it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
   */
  const sendNext = (): void => {
    if (ctx.closed || ctx.active !== undefined) return;
    const next = ctx.waiting.shift();
    if (next === undefined) return;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    titled(next.text);
    openTurn(next.turnId, next.text, next.from);
    // What the host has to say on this turn, asked now that the turn exists.
    const instructions = (next.options?.instructions?.() ?? []).filter((one) => one.trim() !== '');
    void run(next.turnId, next.text, next.model, next.attachments, instructions);
  };

  /*
   * A turn handed while the server runs another takes its place in every
   * client's state, so the one it replaced runs on and ends in no history; a
   * turn the server still runs after a stop already ended there.
   */
  const begin: Turn['begin'] = (turnId, text, model, from, attachments, options) => {
    if (ctx.closed) return;
    const shown = ctx.waiting.at(-1)?.turnId ?? (ctx.cancelRequested || ctx.active === undefined ? undefined : String(ctx.active.id));
    if (shown !== undefined) ctx.replaced.add(shown);
    ctx.waiting.push({ turnId, text, model, from, attachments, options });
    sendNext();
  };

  /**
   * End the running turn, whoever ended it.
   *
   * How it ended is the server's to say: `stopReasonFor` reads the stop reason
   * into an ending. A send that failed before a stop reason arrived is an
   * error typed by the stage VS Code's host names for it, `sendFailed`, with
   * the failure's own words.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2574
   */
  const finish = (
    turnId: string,
    ending: 'complete' | 'cancelled' | 'error',
    failure: { errorType: string; message: string } = {
      errorType: 'sendFailed',
      message: 'The ACP server did not answer',
    },
  ): void => {
    const turn = ctx.active;
    if (turn === undefined || String(turn.id) !== turnId) return;
    doing(undefined);
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    turn.state = ending;
    turn.duration = duration;
    // A turn a later one took the place of is in no history, as the reducer
    // keeps none of it, and its failure is not the chat's.
    const gone = ctx.replaced.delete(turnId);
    if (!gone) turns.push(turn);
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
    // A terminal still running when the turn ends is background work, which
    // the turn's end names.
    if (ctx.mapping !== undefined) ctx.settleTerminals();
    // Held as the reducer holds it once the ending is reduced, so a chat first
    // opened after this turn draws what one that watched it end does.
    turn.responseParts = endedParts(Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : []);
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
      if (!gone) ctx.failed = message;
      emit('chat', {
        type: 'chat/error',
        turnId,
        duration,
        part: { kind: 'error', error: { errorType: failure.errorType, message } },
      });
    }
    // A turn's end moves the stamp to its start plus its duration, as the
    // reducer's does; a turn a later one took the place of ends in no state.
    if (!gone) ctx.setModifiedAt(new Date(Date.parse(String(turn.startedAt)) + duration).toISOString());
    // The turn handed behind this one runs whatever the ending: each send is its own.
    sendNext();
  };

  /**
   * End the turn the way the server's stop reason says to.
   *
   * A stop is the end of what the agent did, so every reason but `cancelled`
   * completes the turn: a turn the model ended at its token or request limit,
   * or by declining, is one VS Code's agents complete, an error being a turn
   * whose send or execution failed.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L568-L576
   */
  const stopReasonFor = (turnId: string, reason: StopReason): void => {
    finish(turnId, reason === 'cancelled' ? 'cancelled' : 'complete');
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
   * Whether the session's instructions have gone out.
   *
   * ACP gives a prompt rather than a system prompt, so what the host wants the
   * model told rides in front of the first turn's text - the only place a
   * server is told anything before the work starts. Said once, because they are
   * the session's rather than the turn's: repeating them every turn would spend
   * context on what the conversation already holds. A failed prompt has sent
   * nothing, so it leaves the flag down and the next turn opens with them.
   */
  let told = false;

  /**
   * The blocks one turn is prompted with: what was said, then the message's
   * attachments as the parts the shared helper made of them.
   *
   * The instructions open the first prompt of the session, before anything the
   * person said, because they are what the agent is to keep in mind while it
   * reads the rest. What the host has to say on this turn comes next, in this
   * turn's prompt, as every reference agent puts the instructions its host
   * contributes for a send.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2281-L2288
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L668
   *
   * The helper decides which of the three an attachment is, and within which
   * limits, so nothing here reads a file: a part is what the message already
   * holds. What is left to this bridge is what ACP asks a server to opt into -
   * an image block only where `promptCapabilities.image` says so, which the
   * helper is told, and a file named as a resource only where
   * `embeddedContext` does. A file the helper could not inline is named by its
   * path in the text, which the agent opens with its own tools if it has them.
   */
  const blocksFor = async (
    text: string,
    attachments: MessageAttachment[] | undefined,
    instructions: string[],
  ): Promise<ContentBlock[]> => {
    const parts = await partsOf(text, attachments, { images: ctx.takes?.image === true });
    const blocks: ContentBlock[] = [];
    if (!told && start.instructions !== undefined && start.instructions.length > 0) {
      blocks.push({ type: 'text', text: start.instructions.join('\n\n') });
    }
    if (instructions.length > 0) blocks.push({ type: 'text', text: instructions.join('\n\n') });
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
   * A stop that arrived while the turn was prepared, the server opened, its
   * model chosen and the attachments read, ends the turn without a prompt at
   * all, as the reference host checks for a stop before it hands a turn to its
   * agent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2307-L2316
   */
  const run = async (
    turnId: string,
    text: string,
    chosen: Chosen | undefined,
    attachments: MessageAttachment[] | undefined,
    instructions: string[],
  ): Promise<void> => {
    /** The connection this turn opened, which outlives `live` once it dies. */
    let connection: AcpConnection | undefined;
    try {
      // Before anything is spawned: a record edited since the last turn is
      // what this turn runs on, and one that can no longer be used refuses it.
      const refused = ctx.refreshOptions();
      if (refused !== undefined) {
        finish(turnId, 'error', { errorType: 'sendFailed', message: refused });
        return;
      }
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
        opening: [],
        reach: {
          within: inside,
          changed: (path, before) => {
            if (before !== undefined) start.onFileEdit?.(turnId, path, 'before', before);
            start.onFileEdit?.(turnId, path, 'after');
          },
          completed: (toolCallId, path, before, after) => {
            const edit = start.onEditCompleted?.(toolCallId, path, before, after);
            return edit === undefined ? undefined : { type: 'fileEdit', ...edit };
          },
          // A server's terminal id is the host's name for it, which the
          // session holds its handle under.
          isPty: (uri) => ctx.terminals.get(uri)?.handle.isPty,
        },
        // The clients' tools, read off what the host last said this session may
        // offer: a call the agent reports for one is held for the client that
        // owns it, and asks that client to run it.
        ownerOf: ctx.ownerOf,
        ...(ctx.cumulative !== undefined ? { costAtStart: ctx.cumulative } : {}),
      };
      /*
       * A model the server would not take ends the turn as a failed model
       * selection, the stage VS Code's host names for it, and leaves the
       * server running for the next turn.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2232-L2235
       */
      try { await ctx.chooseModel(held, chosen); }
      catch (why: unknown) {
        finish(turnId, 'error', { errorType: 'modelSelectionFailed', message: messageOf(why) });
        return;
      }
      const blocks = await blocksFor(text, attachments, instructions);
      if (ctx.active !== turn) return;
      if (ctx.cancelRequested) {
        finish(turnId, 'cancelled');
        return;
      }
      ctx.mapping.prompted = true;
      const response = await held.connection.prompt(held.sessionId, blocks);
      told = true;
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
      // The failure's own words: what the server wrote on stderr went to the
      // log as it arrived, as VS Code's agents log a runtime's stderr.
      finish(turnId, 'error', { errorType: 'sendFailed', message: messageOf(why) });
    }
  };

  return { begin, finish };
}