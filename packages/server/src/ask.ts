/**
 * The questions a first run asks, and the two shapes they take.
 *
 * Every question shows what the value is now and takes Enter to keep it, so a
 * second run edits what is there rather than overwriting it with defaults
 * somebody has already changed. `choose` and `confirm` are the same question
 * with a shorter set of answers.
 *
 * A question is only ever asked at a terminal: `readline` on a pipe would read
 * an immediate end and answer whatever came next, and a service that blocks on
 * a prompt nobody can see is a service that never comes back. Both refusals are
 * here rather than at each call site, so no caller has to remember.
 *
 * The streams are the caller's, so a command can ask over something that is not
 * this process's terminal and a test can answer without one.
 */

import { createInterface } from 'node:readline/promises';
import type { Interface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

/** The two streams a question is asked on, and whether a person is on the other end. */
export interface Term {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
}

/** This process's own terminal, which is what a caller asks on when it names none. */
export const here: Term = { input: process.stdin, output: process.stdout };

/** Why a question was not asked, when there was nobody there to answer it. */
const NO_TERMINAL = 'There is no terminal to ask on. Run it where somebody is, or pass the setting on the command line.';

/** Why a question was not answered, when the terminal went while it was being asked. */
const CLOSED = 'The terminal closed before the question was answered.';

/**
 * Whether a person is on the other end of these streams.
 *
 * What every question needs and what a caller deciding whether to ask one needs
 * to know first: the question refuses rather than returns an answer nobody gave.
 */
export const answering = (term: Term): boolean => term.input.isTTY === true && term.output.isTTY === true;

/** A reader over the terminal, refused when there is nobody to answer. */
const reader = (term: Term): Interface => {
  if (!answering(term)) throw new Error(NO_TERMINAL);
  return createInterface({ input: term.input, output: term.output });
};

/**
 * What was typed at one prompt.
 *
 * `readline` leaves a question pending for ever when the input ends rather than
 * answering it, so the close is raced against the line: a caller that gets here
 * would otherwise wait on a terminal that is not coming back.
 */
const answered = async (rl: Interface, prompt: string): Promise<string> => {
  const typed = rl.question(prompt);
  const shut = new Promise<never>((_done, fail) => { rl.once('close', () => { fail(new Error(CLOSED)); }); });
  return Promise.race([typed, shut]);
};

/**
 * Ask for one value, showing what it is now.
 *
 * Enter keeps what is there and anything else replaces it, so a question can
 * never answer with nothing.
 */
export const ask = async (label: string, current: string, term: Term = here): Promise<string> => {
  const rl = reader(term);
  try {
    const typed = (await answered(rl, `${label} [${current}]: `)).trim();
    return typed === '' ? current : typed;
  }
  finally { rl.close(); }
};

/**
 * Ask which of a list, showing the list and which one is chosen now.
 *
 * Answered by its number or by its name, because a list of three is quick to
 * count and a list of thirty is not; anything else is said and asked again,
 * since a mistyped choice would otherwise become a setting nobody chose.
 */
export const choose = async (
  label: string,
  options: readonly string[],
  current: string,
  term: Term = here,
): Promise<string> => {
  const rl = reader(term);
  try {
    rl.write(`${label}\n`);
    options.forEach((one, at) => { rl.write(`  ${String(at + 1)}) ${one}\n`); });
    for (;;) {
      const typed = (await answered(rl, `${label} [${current}]: `)).trim();
      if (typed === '') return current;
      const at = Number(typed);
      const one = Number.isInteger(at) && at >= 1 && at <= options.length
        ? options[at - 1]
        : options.find((name) => name === typed);
      if (one !== undefined) return one;
      rl.write(`${typed} is not one of them.\n`);
    }
  }
  finally { rl.close(); }
};

/** The answers `confirm` takes, so anything else is asked again rather than guessed at. */
const YES = new Set(['y', 'yes']);
const NO = new Set(['n', 'no']);

/**
 * Ask whether something should happen, showing the answer Enter gives.
 *
 * `yes` is the answer Enter keeps rather than the answer the question defaults
 * towards, so a caller says what the run would do without it.
 */
export const confirm = async (label: string, yes: boolean, term: Term = here): Promise<boolean> => {
  const rl = reader(term);
  try {
    for (;;) {
      const typed = (await answered(rl, `${label} [${yes ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
      if (typed === '') return yes;
      if (YES.has(typed)) return true;
      if (NO.has(typed)) return false;
      rl.write(`${typed} is not yes or no.\n`);
    }
  }
  finally { rl.close(); }
};