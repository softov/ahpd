import { expect, it } from 'vitest';
import { createCallLinks } from '../src/calllinks.js';

/*
 * The index a worker's link is written from, held only for spawning calls.
 *
 * Every tool call of every session passes through the host's `dispatch`, most
 * of them with their whole output as content. The only calls whose content the
 * host needs are the ones a worker chat is linked from, so a long-running
 * daemon holding the rest is holding every tool output it ever relayed.
 */

const chat = 'ahp-chat://default/c2Vzc2lvbg';
const big = 'x'.repeat(1024 * 1024);

it('holds only the spawning call among a hundred ordinary completions', () => {
  const links = createCallLinks();
  links.observe(chat, { type: 'chat/turnStarted', turnId: 't1' });
  for (let i = 0; i < 100; i++) {
    links.observe(chat, {
      type: 'chat/toolCallComplete', turnId: 't1', toolCallId: `toolu_${i}`,
      result: { success: true, pastTenseMessage: 'Bash', content: [{ type: 'text', text: big }] },
    });
  }
  links.observe(chat, {
    type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'toolu_task', toolName: 'Agent', displayName: 'Agent',
    _meta: { toolKind: 'subagent' },
  });
  expect(links.size).toBe(1);
  links.forget(chat, 'toolu_task');
  expect(links.size).toBe(0);
});

it('keeps a spawning call\'s content as it changes, and forgets a chat whole', () => {
  const links = createCallLinks();
  links.observe(chat, { type: 'chat/turnStarted', turnId: 't1' });
  links.observe(chat, {
    type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'toolu_task', invocationMessage: 'Agent',
    confirmed: 'not-needed', _meta: { toolKind: 'subagent' },
  });
  links.observe(chat, {
    type: 'chat/toolCallContentChanged', turnId: 't1', toolCallId: 'toolu_task',
    content: [{ type: 'text', text: 'launched' }],
  });
  expect(links.contentOf(chat, 'toolu_task')).toEqual([{ type: 'text', text: 'launched' }]);
  expect(links.turnOf(chat)).toBe('t1');
  links.forgetChat(chat);
  expect(links.size).toBe(0);
  expect(links.turnOf(chat)).toBeUndefined();
});
