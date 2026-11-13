import { reason } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { TurnHandle } from './chat.js';
import type { Answering } from './wake.js';

/**
 * Another session's question, asked where the person is talking.
 *
 * A back session works on a harness, and a harness asks: a tool call waits on
 * an approval, a question tool waits on an answer. The person who woke the
 * session is in the main chat, not in the back session's own chat, so the
 * request is copied there - the turn handle draws it, `chat.ts` - and the
 * answer given there is sent back to the chat that asked, on the plugin's
 * connection.
 *
 * The copy is what this file keeps: the entry a back session raised, by every
 * id some later action may name it with. The entry's own id is what its removal
 * names, while a question's answer names the request inside it and an approval
 * names the call inside it, and the two are not always the same string.
 *
 * Only the two kinds a person answers are copied. A `toolClientExecution` is a
 * tool a client of the back session runs, and a `toolAuthentication` is a
 * token the back session's own client gives: neither is a question for the
 * person in the main chat, and neither can be answered from there.
 *
 * Seams rather than calls: which main turn waits on a session is the wake's
 * (`wake.ts`), the back session's state is read through the plugin's
 * connection, and what is sent back goes the same way. Nothing here knows a
 * host.
 */

/** What the copy reads and sends through. */
export interface AskSeams {
  /** The Front turn one Back chat is answering, or nothing where none is. */
  main(backChat: string): Answering | undefined;
  /**
   * One entry of a session's `inputNeeded`, or nothing where it is not there.
   *
   * Read rather than taken from the event, which names the entry but not what
   * it asks. A session that dropped the request between the event and the read
   * answers nothing, and nothing is copied.
   */
  request(session: string, id: string): Promise<Bag | undefined>;
  /** Send one action on a chat, and give the host's reason where it refused it. */
  send(chat: string, action: Bag): Promise<string | undefined>;
  /**
   * The Front turn a chat of a talk reaches, opened by the bot where none
   * waits, and the Back chat it answers: the wake's `reach`. A subagent of a
   * Back asks in a worker chat of its own, under the Back. Without it, only a
   * Back chat with a Front turn waiting is copied.
   */
  reach?(session: string, chat: string): Promise<{ back: string; held: Answering } | undefined>;
  /** End the Front turn the bot opened for a Back chat where nothing holds it any more: the wake's `settle`. */
  settle?(backChat: string): Promise<void>;
  /** Say what went wrong, for the operator to read. */
  problem(line: string): void;
}

/** The copy of one back session's request, as the main chat showed it. */
interface Copy {
  /** The main chat's session, which is where the answer is given. */
  session: string;
  /** The session that asked, which its removal names. */
  back: string;
  /** The chat that asked, which is where the answer is sent: the Back, or a worker chat under it. */
  chat: string;
  /** The Back chat the Front turn waits on, which is what a withdrawal takes the copy out of. */
  backChat: string;
  /** The entry's own id, which is what its removal names. */
  id: string;
  /** Which of the two answers this copy takes. */
  kind: 'chatInput' | 'toolConfirmation';
  /** The back session's turn the call waits in, which a confirmation names. */
  turnId?: string;
}

/** What the plugin holds of the asking: the requests that are up, and the answers back. */
export interface Ask {
  /**
   * Show one request a back session raised in its main turn, and hold on to it.
   *
   * A session with no main turn waiting is left alone: a request raised after
   * the person's turn ended has nobody to ask. A read that fails is reported,
   * and the request stays in the back session, where its own client still sees
   * it.
   */
  asked(session: string, chat: string, id: string): Promise<void>;
  /**
   * Take one request's copy out of the main turn because the back session no
   * longer waits on it.
   *
   * Called for every removal the host raises, including the ones this plugin
   * never copied: forgetting an unknown id costs nothing.
   */
  withdrawn(session: string, id: string): void;
}

/** Whether a value is a JSON object, which is what every entry here is. */
const bagOf = (value: unknown): Bag | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Bag : undefined
);

/** The string a field holds, or nothing where it holds none. */
const textOf = (value: unknown): string | undefined => (
  typeof value === 'string' && value !== '' ? value : undefined
);

/**
 * Where a back session's request is shown, as the option `askIn` says.
 *
 * `main` copies it into the main turn, where the person answers it and the
 * answer is sent back to the chat that asked. `own` leaves it in the back
 * session's chat and lists it among the main chat's blockers, its
 * `inputNeeded`, where a client answers it in the back chat it names, as VS
 * Code's host aggregates a subagent's requests on the session its clients read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L19-L25
 */
export type AskIn = 'main' | 'own';

/**
 * The asking over one daemon: its copies, and the answers that go back.
 *
 * One copy per request, by the main chat it is shown in and each id an answer
 * or a removal may name it with. A handle's two callbacks are set when the
 * copy is made, so a confirmation the main chat takes is sent to the chat that
 * asked rather than to the main chat, and a request this plugin never copied is
 * refused - `answer` false - rather than echoed as an answer to nothing.
 *
 * With `askIn` at `own` nothing is copied: the request is listed on the main
 * chat by the handle that listed it, until the back session lets it go.
 */
export function botAsk(seams: AskSeams, askIn: AskIn = 'main'): Ask {
  /** Every copy shown, by main chat and by each id that names it. */
  const copies = new Map<string, Copy>();
  /** The handle each listed request was listed on, by its back session and id. */
  const listings = new Map<string, TurnHandle>();

  const key = (session: string, id: string): string => `${session}\n${id}`;

  /** The copy a main chat's action names, or nothing when it names none of this plugin's. */
  const copyOf = (session: string, id: string): Copy | undefined => copies.get(key(session, id));

  /** Say an answer could not be sent, in the words the operator needs. */
  const failed = (copy: Copy, what: string, why: string): void => {
    seams.problem(`the ${what} for ${copy.id} in ${copy.back} was not sent: ${why}`);
  };

  /**
   * Send one answer to the chat the request was asked in.
   *
   * Not awaited by the callback the host calls, which is synchronous: the send
   * is the plugin's connection, and a failure is the operator's to read while
   * the person's answer stands in the main chat.
   */
  const sendBack = (copy: Copy, action: Bag, what: string): void => {
    (async (): Promise<void> => {
      const refused = await seams.send(copy.chat, action);
      if (refused !== undefined) failed(copy, what, refused);
    })().catch((error: unknown) => { failed(copy, what, reason(error)); });
    answeredIn(copy.backChat);
  };

  /** One question of a Back's is answered or withdrawn, and a Front turn the bot opened for it may end. */
  const answeredIn = (backChat: string): void => {
    const held = seams.main(backChat);
    if (held === undefined) return;
    held.questions = Math.max(0, (held.questions ?? 1) - 1);
    seams.settle?.(backChat).catch((error: unknown) => { seams.problem(`the turn ${held.turnId} was not ended: ${reason(error)}`); });
  };

  return {
    asked: async (back, asked, id) => {
      /*
       * The Back chat the asking chat is, or is under, and the Front turn it
       * reaches: a subagent's question is asked in its worker chat, and a
       * question that comes while no turn of the person's waits opens one of
       * the bot's own.
       */
      const found = seams.reach !== undefined
        ? await seams.reach(back, asked)
        : (() => { const one = seams.main(asked); return one === undefined ? undefined : { back: asked, held: one }; })();
      if (found === undefined) return;
      const asker = found.back;
      const held = found.held;
      let entry: Bag | undefined;
      try { entry = await seams.request(back, id); }
      catch (error) {
        seams.problem(`a request in ${back} was not read: ${reason(error)}`);
        return;
      }
      if (entry === undefined) return;
      /*
       * The main turn may have been answered while the read was out - the back
       * session can post and end in between - and a copy for a turn that is
       * over has nobody to ask. The handle is the chat's and outlives its
       * turns, so the turn is compared too.
       */
      const now = seams.main(asker);
      if (now === undefined || now.handle !== held.handle || now.turnId !== held.turnId) return;
      const kind = textOf(entry['kind']);
      const chat = textOf(entry['chat']);
      if (chat === undefined) return;
      if (kind !== 'chatInput' && kind !== 'toolConfirmation') return;
      if (askIn === 'own') {
        // A Back chat of the Front's own session is on that session's
        // `inputNeeded` already, so it is not listed a second time.
        if (held.session === back) return;
        listings.set(key(back, id), held.handle);
        held.handle.listed?.(entry);
        return;
      }
      const turnId = textOf(entry['turnId']);
      const copy: Copy = { session: held.session, back, chat, backChat: asker, id, kind, ...(turnId === undefined ? {} : { turnId }) };
      // Every id an answer may name it with: the entry's own, and the request
      // or the call inside it.
      const names = [id];
      const request = bagOf(kind === 'chatInput' ? entry['request'] : undefined);
      const requestId = textOf(request?.['id']);
      if (requestId !== undefined) names.push(requestId);
      const call = bagOf(kind === 'toolConfirmation' ? entry['toolCall'] : undefined);
      const toolCallId = textOf(call?.['toolCallId']);
      if (toolCallId !== undefined) names.push(toolCallId);
      for (const name of names) copies.set(key(held.session, name), copy);
      held.questions = (held.questions ?? 0) + 1;
      held.handle.asking?.(entry);
      held.handle.onConfirm = (id_, approved, optionId) => {
        const found = copyOf(held.session, id_);
        if (found === undefined || found.kind !== 'toolConfirmation') return;
        /*
         * The protocol's two confirmations, in the spelling the host reads: an
         * approval says how it was confirmed, and a denial says why it was
         * cancelled. The option the person picked travels either way.
         */
        sendBack(found, {
          type: 'chat/toolCallConfirmed',
          ...(found.turnId === undefined ? {} : { turnId: found.turnId }),
          toolCallId: id_,
          approved,
          ...(approved ? { confirmed: 'user-action' } : { reason: 'denied' }),
          ...(optionId === undefined ? {} : { selectedOptionId: optionId }),
        }, approved ? 'approval' : 'denial');
      };
      held.handle.onAnswer = (requestId_, accepted, answers, response) => {
        const found = copyOf(held.session, requestId_);
        if (found === undefined || found.kind !== 'chatInput') return false;
        sendBack(found, {
          type: 'chat/inputCompleted',
          requestId: requestId_,
          response: response ?? (accepted ? 'accept' : 'decline'),
          ...(Object.keys(answers).length === 0 ? {} : { answers }),
        }, 'answer');
        return true;
      };
    },

    withdrawn: (back, id) => {
      // A listed request comes off the chat it was listed on, whether or not
      // its turn is still the one the main chat waits on.
      const listing = listings.get(key(back, id));
      if (listing !== undefined) {
        listings.delete(key(back, id));
        listing.unlisted?.(id);
        return;
      }
      // Every alias goes: they are one copy, and the entry's removal names one
      // of them.
      let asker: string | undefined;
      for (const [at, copy] of copies) {
        if (copy.back === back && copy.id === id) {
          asker = copy.backChat;
          copies.delete(at);
        }
      }
      if (asker !== undefined) {
        seams.main(asker)?.handle.withdrawn?.(id);
        answeredIn(asker);
      }
    },
  };
}
