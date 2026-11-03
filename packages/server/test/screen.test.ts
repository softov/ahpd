/*
 * The screen a terminal under a pseudoterminal is fed with.
 *
 * A full-screen program is on another buffer, a program that asks for the
 * cursor gets an answer, and a mode it turns on is a fact read from the
 * emulator rather than guessed from its output. The answers are what the
 * screen writes back to the program, so a case here reads them.
 */

import { describe, expect, it } from 'vitest';
import { screen } from '../src/screen.js';

/** One screen, and everything it answered the program. */
const made = () => {
  const answers: string[] = [];
  const one = screen({ cols: 80, rows: 24, write: (data) => { answers.push(data); } });
  return { one, answers };
};

describe('a screen fed a program\'s output', () => {
  it('is on the alternate buffer while a full-screen program is showing', async () => {
    const { one } = made();
    // `ESC[?1049h` is what `vim`, `less` and `tmux` switch with, and `l` is
    // what puts the person's screen back.
    expect(one.isInAltBuffer()).toBe(false);
    await one.write('\u001b[?1049h');
    expect(one.isInAltBuffer()).toBe(true);
    await one.write('\u001b[?1049l');
    expect(one.isInAltBuffer()).toBe(false);
    one.dispose();
  });

  it('says when bracketed paste was turned on, and when it was turned off', async () => {
    const { one } = made();
    expect(one.isBracketedPasteMode()).toBe(false);
    await one.write('\u001b[?2004h');
    expect(one.isBracketedPasteMode()).toBe(true);
    await one.write('\u001b[?2004l');
    expect(one.isBracketedPasteMode()).toBe(false);
    one.dispose();
  });

  it('answers the cursor position a program asks for, and nothing else', async () => {
    const { one, answers } = made();
    // Program output is not an answer, and never reaches the input.
    await one.write('hello\r\n');
    expect(answers).toEqual([]);
    // `ESC[6n` is the query, and the report is a row and a column - here the
    // second row, since that line ended.
    await one.write('\u001b[6n');
    expect(answers).toEqual(['\u001b[2;1R']);
    // From wherever the program put the cursor, and the DEC spelling of the
    // same query, which is answered with the same `?` in front.
    await one.write('\u001b[4;7H');
    answers.length = 0;
    await one.write('\u001b[?6n');
    expect(answers).toEqual(['\u001b[?4;7R']);
    one.dispose();
  });

  it('settles when the alternate screen shows, at once when it already does', async () => {
    const { one } = made();
    await one.write('\u001b[?1049h');
    // Already there: the wait is over before it starts.
    await expect(one.whenAltBuffer()).resolves.toBeUndefined();
    await one.write('\u001b[?1049l');
    const waited = one.whenAltBuffer();
    // Nothing has switched yet, so the wait is a real one - and the chunk
    // that switches settles it.
    let settled = false;
    void waited.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await one.write('\u001b[?1049h');
    await waited;
    one.dispose();
  });
});
