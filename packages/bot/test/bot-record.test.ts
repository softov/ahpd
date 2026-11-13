import { expect, it } from 'vitest';
import {
  BOT_BODIES, BOT_COLORS, checkRecord, isSlug,
} from '../src/record.js';
import type { BotRecord } from '../src/record.js';

/*
 * What a bot is, before anything stores one.
 *
 * A bot is made by a write to `bot://<slug>`, so the slug is the URI path and
 * the record's own `id`, and a body is what a person chose about it. Everything
 * a body is allowed to say is decided here: what it may name, what it may not,
 * and what is filled in for it.
 */

/** One bot as it would have been stored, for the cases about editing one. */
const WAS: BotRecord = {
  id: 'motion',
  name: 'Motion',
  labels: ['mascot'],
  body: 'robot',
  color: 'red',
  workspace: '/home/softov/.bots/motion',
  owner: 'user:soft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

it('draws a bot in one of fifteen bodies and one of eleven colours', () => {
  // The bodies and the palette a client draws a bot from. A list this host does
  // not have is a bot a client could not render, so the set is closed.
  expect(BOT_BODIES).toHaveLength(15);
  expect(BOT_COLORS).toHaveLength(11);
  expect(BOT_BODIES).toContain('robot');
  expect(BOT_BODIES).toContain('ghost');
  expect(BOT_COLORS).toContain('red');
  expect(BOT_COLORS).toContain('black');
});

it('takes a slug of lowercase letters, digits and dashes', () => {
  expect(isSlug('motion')).toBe(true);
  expect(isSlug('a')).toBe(true);
  expect(isSlug('bot-2')).toBe(true);
  expect(isSlug('a'.repeat(40))).toBe(true);

  expect(isSlug('')).toBe(false);
  expect(isSlug('Motion')).toBe(false);
  expect(isSlug('two words')).toBe(false);
  expect(isSlug('a/b')).toBe(false);
  expect(isSlug('-motion')).toBe(false);
  expect(isSlug('2motion')).toBe(false);
  expect(isSlug('a'.repeat(41))).toBe(false);
});

it('makes a bot from a name, filling what the body left out', () => {
  const draft = checkRecord('motion', { name: 'Motion' });

  expect(draft.name).toBe('Motion');
  // Empty rather than absent, because a bot with no labels and a bot whose
  // labels nobody has read are the same bot.
  expect(draft.labels).toEqual([]);
  expect(BOT_BODIES).toContain(draft.body);
  expect(BOT_COLORS).toContain(draft.color);
  // The owner, the folder and the times are the host's rather than the body's.
  expect(draft.owner).toBeUndefined();
  expect(draft.workspace).toBeUndefined();
});

it('refuses a body that is not a bot, or that names a field a bot does not have', () => {
  expect(() => checkRecord('motion', 'a string')).toThrow(/object/);
  expect(() => checkRecord('motion', [])).toThrow(/object/);
  expect(() => checkRecord('motion', null)).toThrow(/object/);
  expect(() => checkRecord('motion', {})).toThrow(/name/);
  expect(() => checkRecord('motion', { name: '   ' })).toThrow(/name/);
  expect(() => checkRecord('motion', { name: 'Motion', colour: 'red' })).toThrow(/colour/);
});

it('keeps any word as a body, and refuses a colour outside the list', () => {
  expect(checkRecord('motion', { name: 'Motion', body: 'flame' })).toMatchObject({ body: 'flame' });
  expect(checkRecord('motion', { name: 'Motion', body: ' flame ' })).toMatchObject({ body: 'flame' });
  expect(() => checkRecord('motion', { name: 'Motion', body: '' })).toThrow(/body/);
  expect(() => checkRecord('motion', { name: 'Motion', body: 7 })).toThrow(/body/);
  expect(() => checkRecord('motion', { name: 'Motion', color: 'chartreuse' })).toThrow(/chartreuse/);
  expect(() => checkRecord('motion', { name: 'Motion', labels: [1] })).toThrow(/labels/);

  // And takes the two it was given, rather than filling them.
  expect(checkRecord('motion', { name: 'Motion', body: 'ghost', color: 'black', labels: ['mascot'] }))
    .toMatchObject({ body: 'ghost', color: 'black', labels: ['mascot'] });
});

it('takes a hex colour, kept in lowercase, and refuses any other form', () => {
  expect(checkRecord('motion', { name: 'Motion', color: '#2F6FDF' })).toMatchObject({ color: '#2f6fdf' });
  expect(() => checkRecord('motion', { name: 'Motion', color: '#fff' })).toThrow(/#fff/);
  expect(() => checkRecord('motion', { name: 'Motion', color: '2f6fdf' })).toThrow(/2f6fdf/);
  expect(() => checkRecord('motion', { name: 'Motion', color: '#2f6fdg' })).toThrow(/#2f6fdg/);
});

it('refuses a body that names another bot', () => {
  expect(() => checkRecord('motion', { name: 'Motion', id: 'other' })).toThrow(/other/);
  // The same id is what a client that read the bot and wrote it back sends.
  expect(checkRecord('motion', { name: 'Motion', id: 'motion' }).name).toBe('Motion');
});

it('keeps what an edit did not name, and refuses what an edit may not move', () => {
  const draft = checkRecord('motion', { name: 'Moved' }, WAS);
  expect(draft).toMatchObject({ name: 'Moved', labels: ['mascot'], body: 'robot', color: 'red' });

  // A client that read the bot and wrote the whole record back is naming the
  // host's own values, which is not an edit of them.
  expect(checkRecord('motion', { ...WAS, name: 'Moved' }, WAS).owner).toBe('user:soft');
  expect(checkRecord('motion', { ...WAS, name: 'Moved' }, WAS).workspace).toBe(WAS.workspace);

  expect(() => checkRecord('motion', { name: 'Moved', id: 'other' }, WAS)).toThrow(/other/);
  expect(() => checkRecord('motion', { name: 'Moved', owner: 'user:ana' }, WAS)).toThrow(/user:ana/);
  expect(() => checkRecord('motion', { name: 'Moved', workspace: '/elsewhere' }, WAS)).toThrow(/elsewhere/);
});

it('keeps no back session name, and takes a body that still carries one', () => {
  // A bot's Back is a chat of each person's own session, so the record names no
  // session, and a body an older client wrote back, or a read's own `session`,
  // is taken without one.
  expect(checkRecord('motion', { name: 'Motion' })).not.toHaveProperty('session');
  expect(checkRecord('motion', { name: 'Motion', session: 'reviews' })).not.toHaveProperty('session');
  expect(checkRecord('motion', { name: 'Calm' }, WAS)).not.toHaveProperty('session');
});

it('takes a template by name, refuses one that is not a slug, and keeps it on an edit', () => {
  expect(checkRecord('motion', { name: 'Motion', template: 'short' }).template).toBe('short');
  expect(() => checkRecord('motion', { name: 'Motion', template: '../x' })).toThrow(expect.objectContaining({ code: -32602 }) as Error);
  expect(checkRecord('motion', { name: 'Calm' }, { ...WAS, template: 'short' }).template).toBe('short');
  expect(checkRecord('motion', { name: 'Calm' }, WAS).template).toBeUndefined();
});

it('takes a map of connector aliases, and refuses one the host would not read', () => {
  const map = { work: 'connectors://ap-resend/account-123' };
  expect(checkRecord('motion', { name: 'Motion', connectors: map }).connectors).toEqual(map);

  // What an edit does not name is kept, and a map it names - empty included -
  // is the bot's, because a bot with no connectors is a bot that binds none.
  expect(checkRecord('motion', { name: 'Calm' }, { ...WAS, connectors: map }).connectors).toEqual(map);
  expect(checkRecord('motion', { name: 'Calm', connectors: {} }, { ...WAS, connectors: map }).connectors).toEqual({});
  expect(checkRecord('motion', { name: 'Calm' }, WAS).connectors).toBeUndefined();

  // A bot is written once and read on every message, so what `bindingsOf`
  // would skip is refused here: an alias the model cannot say, and a value
  // that names no connector.
  expect(() => checkRecord('motion', { name: 'Motion', connectors: 'work' })).toThrow(/connectors/);
  expect(() => checkRecord('motion', { name: 'Motion', connectors: ['work'] })).toThrow(/connectors/);
  expect(() => checkRecord('motion', { name: 'Motion', connectors: { Work: 'connectors://ap-resend/account-123' } })).toThrow(/Work/);
  expect(() => checkRecord('motion', { name: 'Motion', connectors: { work: 'account-123' } })).toThrow(/account-123/);
  expect(() => checkRecord('motion', { name: 'Motion', connectors: { work: 'connectors://ap-resend/account-123/extra' } })).toThrow(/ap-resend/);
  expect(() => checkRecord('motion', { name: 'Motion', connectors: { work: 7 } })).toThrow(/7/);
});
