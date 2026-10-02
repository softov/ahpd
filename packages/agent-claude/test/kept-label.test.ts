import { expect, it } from 'vitest';

import { keptLabel } from '../src/session.js';

/*
 * The label of the "always" choice on a tool confirmation.
 *
 * The SDK suggests a rule per command of a compound one, so the same rule, or
 * rules kept in the same place, can arrive as several suggestions; the label
 * says each once.
 */

const rule = (ruleContent: string, destination = 'localSettings') => ({
  type: 'addRules', behavior: 'allow', destination, rules: [{ toolName: 'Bash', ruleContent }],
});

it('says one rule once', () => {
  expect(keptLabel([rule('npm test:*')])).toBe('Always allow Bash(npm test:*), kept in local settings');
});

it('says a rule suggested twice once', () => {
  expect(keptLabel([rule('npm test:*'), rule('npm test:*')])).toBe('Always allow Bash(npm test:*), kept in local settings');
});

it('joins rules kept in the same place into one phrase', () => {
  expect(keptLabel([rule('git add:*'), rule('git commit:*'), rule('git add:*')]))
    .toBe('Always allow Bash(git add:*), Bash(git commit:*), kept in local settings');
});

it('keeps rules kept in different places apart', () => {
  expect(keptLabel([rule('ls:*', 'session'), rule('ls:*')]))
    .toBe('Always allow Bash(ls:*) for the rest of the session; Always allow Bash(ls:*), kept in local settings');
});

it('says a repeated mode once', () => {
  const mode = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };
  expect(keptLabel([mode, mode])).toBe('Allow edits for the rest of the session');
});
