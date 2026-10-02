/*
 * The questions `ahpd configure` asks, over streams that are not a terminal.
 *
 * Every case is about what one question makes of what was typed: the default it
 * shows, what Enter keeps, and when it gives up rather than waiting for an
 * answer nobody is there to give. The two streams are faked so nothing here
 * reads this process's own terminal.
 */

import { PassThrough, Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { ask, choose, confirm } from '../src/ask.js';

/**
 * A terminal nobody is sitting at: one answer per prompt, and everything the
 * questions wrote kept in one string.
 *
 * The answer is written only once a prompt has been printed, which is what a
 * person does. A fake that wrote them all up front would not do: `readline`
 * takes one line out of a buffer and drops the rest of it.
 */
const terminal = (...answers: string[]) => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const pending = [...answers];
  let said = '';
  const output = Object.assign(new Writable({
    write(chunk, _encoding, done) {
      said += String(chunk);
      done();
      if (!said.endsWith(': ')) return;
      const answer = pending.shift();
      if (answer !== undefined) setImmediate(() => { input.write(`${answer}\n`); });
    },
  }), { isTTY: true });
  // `readline` draws around the cursor and echoes what was typed; a reader of
  // this file wants the words, so those are what is kept.
  return {
    term: { input, output },
    said: () => said.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '').replace(/\r/gu, ''),
  };
};

/** The backends `configure` offers, which is the list the choice is asked over. */
const BACKENDS = ['Claude', 'cofold', 'pi'];

it('keeps the default on Enter and takes what was typed instead', async () => {
  const kept = terminal('');
  expect(await ask('Port', '9187', kept.term)).toBe('9187');
  expect(kept.said()).toContain('Port [9187]: ');

  const typed = terminal('  9000  ');
  expect(await ask('Port', '9187', typed.term)).toBe('9000');
});

it('takes a choice by its number and by its name, and keeps the current one on Enter', async () => {
  const numbered = terminal('2');
  expect(await choose('Backends', BACKENDS, 'Claude', numbered.term)).toBe('cofold');
  expect(numbered.said()).toContain('Backends\n  1) Claude\n  2) cofold\n  3) pi\n');
  expect(numbered.said()).toContain('Backends [Claude]: ');

  const named = terminal('pi');
  expect(await choose('Backends', BACKENDS, 'Claude', named.term)).toBe('pi');

  const kept = terminal('');
  expect(await choose('Backends', BACKENDS, 'pi', kept.term)).toBe('pi');
});

it('asks again after a choice that is not one of them', async () => {
  const asked = terminal('ACP', 'Claude');
  expect(await choose('Backends', BACKENDS, 'cofold', asked.term)).toBe('Claude');
  expect(asked.said()).toContain('ACP is not one of them.');
  // The same question twice, with the same default both times.
  expect(asked.said().match(/Backends \[cofold\]: /gu)).toHaveLength(2);
});

it('answers a yes and a no, and keeps the one it was given on Enter', async () => {
  const yes = terminal('y');
  expect(await confirm('Serve /tmp/new?', true, yes.term)).toBe(true);
  expect(yes.said()).toContain('Serve /tmp/new? [Y/n]: ');

  const no = terminal('no');
  expect(await confirm('Serve /tmp/new?', true, no.term)).toBe(false);

  const kept = terminal('');
  expect(await confirm('Serve /tmp/new?', true, kept.term)).toBe(true);
  const keptOff = terminal('');
  expect(await confirm('Serve /tmp/new?', false, keptOff.term)).toBe(false);
  expect(keptOff.said()).toContain('Serve /tmp/new? [y/N]: ');
});

it('asks again after a yes or no that is neither', async () => {
  const asked = terminal('maybe', 'y');
  expect(await confirm('Serve /tmp/new?', false, asked.term)).toBe(true);
  expect(asked.said()).toContain('maybe is not yes or no.');
});

it('refuses a question there is no terminal to ask, rather than waiting', async () => {
  const piped = terminal('');
  piped.term.input.isTTY = false;
  await expect(ask('Port', '9187', piped.term)).rejects.toThrow(/no terminal/i);
  await expect(choose('Backends', BACKENDS, 'Claude', piped.term)).rejects.toThrow(/no terminal/i);
  await expect(confirm('Serve it?', true, piped.term)).rejects.toThrow(/no terminal/i);
});

it('refuses a question whose terminal closed before it was answered', async () => {
  const shut = terminal('');
  shut.term.input.end();
  await expect(ask('Port', '9187', shut.term)).rejects.toThrow(/closed/i);
});