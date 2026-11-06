import type { Bag } from '../types/common.js';
import type { AskedAnswers, AskedQuestion } from '../types/host.js';

/**
 * The questions a host tool is waiting on, by the id it asked them under.
 *
 * A `chat/inputRequested` this host sends is one a backend never sees, so the
 * answer to it has to be kept somewhere that both the tool and
 * `chat/inputCompleted` reach. That is this: `ask` holds the wait and puts the
 * request on the chat, `settle` ends the wait with what the person did, and
 * `clearTurn` ends the ones a turn no longer has. The map is per host and
 * lives as long as it does.
 */

/**
 * The prefix every request this host asks carries.
 *
 * The id reaches a client as the request's own, and comes back on
 * `chat/inputCompleted`. A backend picks its own ids, so a bare UUID could in
 * principle be one of its own; a prefix makes the two sets disjoint and the
 * completion unambiguously the host's to settle.
 */
export const HOST_ASK = 'host-ask:';

/** One request waiting on a person. */
interface Held {
  /** The chat the question was asked on. */
  chat: string;
  /** The turn it was asked in. */
  turn: string;
  /** The questions, in the order the caller asked them. */
  questions: AskedQuestion[];
  /** End the wait with the person's answer. */
  settle(answer: AskedAnswers): void;
}

/** What a host's held questions are, and what ends them. */
export interface Asking {
  /** Put a request on `chat` and wait for its answer, Cancel at once with no `turn` running. */
  ask(chat: string, turn: string | undefined, questions: AskedQuestion[]): Promise<AskedAnswers>;
  /**
   * Settle the request `id` with the person's response and answers.
   *
   * `false` when no request by that id is held, which is every request a
   * backend asked: its answer belongs to the backend's own `answer`.
   */
  settle(id: string, response: AskedAnswers['response'], answers: Record<string, unknown>): boolean;
  /** Whether a request by this id is still waiting. */
  holds(id: string): boolean;
  /** Settle every request waiting in `chat` on `turn` as cancelled. */
  clearTurn(chat: string, turn: string): void;
}

/** What `createAsking` says a request with. */
export interface AskingOptions {
  /** Say one of this host's own actions on one channel. */
  dispatch: (channel: string, action: Record<string, unknown>) => void;
}

const object = (value: unknown): Bag =>
  (typeof value === 'object' && value !== null ? value as Bag : {});

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);

/**
 * One question in the protocol's shape, which is what a client draws.
 *
 * The same mapping cofold's own ask tool makes in `mapping.ts`: text where
 * there are no options, one of the two select kinds where there are, the
 * option's label as both its id and its words (the answer names labels), and
 * free text left on unless the question turned it off.
 */
const questionOf = (one: AskedQuestion): Bag => {
  const options = one.options ?? [];
  const title = one.header === undefined || one.header === '' ? {} : { title: one.header };
  if (options.length === 0) {
    return { id: one.id, kind: 'text', message: one.question, required: true, ...title };
  }
  return {
    id: one.id,
    kind: one.multiSelect === true ? 'multi-select' : 'single-select',
    message: one.question,
    required: true,
    options: options.map((option) => ({
      id: option.label,
      label: option.label,
      ...(option.description === undefined ? {} : { description: option.description }),
    })),
    // The protocol's default is the same as cofold's, so only a refusal of
    // free text is said.
    ...(one.allowOther === false ? { allowFreeformInput: false } : {}),
    ...title,
  };
};

/**
 * One answer's value, as the model gets it: a string, or the labels picked.
 *
 * A skipped answer has no value, and a free text the person typed in place of
 * a choice is the value, since the choice and the text are one answer to one
 * question.
 */
const valueOf = (answer: unknown): string | string[] | undefined => {
  const held = object(answer);
  if (held.state === 'skipped') return undefined;
  const value = object(held.value);
  const free = strings(value.freeformValues);
  if (value.kind === 'selected-many') {
    const chosen = strings(value.value);
    const all = [...chosen, ...free];
    return all.length === 0 ? undefined : all;
  }
  const one = typeof value.value === 'string'
    ? value.value
    : typeof value.value === 'number' || typeof value.value === 'boolean'
      ? String(value.value)
      : undefined;
  return one ?? free[0];
};

/** Every answer given, by the question's id, in the questions' own order. */
const answersOf = (
  questions: AskedQuestion[],
  given: Record<string, unknown>,
): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  for (const question of questions) {
    const value = valueOf(given[question.id]);
    if (value !== undefined) out[question.id] = value;
  }
  return out;
};

export function createAsking(options: AskingOptions): Asking {
  const held = new Map<string, Held>();

  /*
   * A question put on the chat whose turn asks it, the request carrying its
   * questions and no message of its own, as VS Code's ask_user puts one; with
   * no turn running in the chat it is answered Cancel at once and put nowhere,
   * as VS Code's host answers a request no turn is there to wait on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8715-L8734
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1346-L1359
   */
  const ask = (chat: string, turn: string | undefined, questions: AskedQuestion[]): Promise<AskedAnswers> => {
    if (turn === undefined) return Promise.resolve({ response: 'cancel', answers: {} });
    return new Promise<AskedAnswers>((resolve, reject) => {
      const id = `${HOST_ASK}${crypto.randomUUID()}`;
      held.set(id, { chat, turn, questions, settle: resolve });
      try {
        options.dispatch(chat, {
          type: 'chat/inputRequested',
          request: { id, questions: questions.map(questionOf) },
        });
      }
      catch (error) {
        held.delete(id);
        reject(error);
      }
    });
  };

  const settle = (
    id: string,
    response: AskedAnswers['response'],
    answers: Record<string, unknown>,
  ): boolean => {
    const one = held.get(id);
    if (one === undefined) return false;
    held.delete(id);
    one.settle({ response, answers: response === 'accept' ? answersOf(one.questions, answers) : {} });
    return true;
  };

  const clearTurn = (chat: string, turn: string): void => {
    for (const [id, one] of held) {
      if (one.chat !== chat || one.turn !== turn) continue;
      held.delete(id);
      one.settle({ response: 'cancel', answers: {} });
    }
  };

  return { ask, settle, holds: (id) => held.has(id), clearTurn };
}
