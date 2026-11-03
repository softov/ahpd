import { expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { AGENTS_VERSION, instructionsProblem, readAgents, writeAgents } from '../src/agents.js';
import { agentsFilled, DEFAULT_AGENTS_TEMPLATE } from '../src/template.js';
import type { AgentsParts, Yaml } from '../src/agents.js';
import type { BotRecord } from '../src/record.js';

/*
 * The parts of an AGENTS.md that belong to the bot's owner: the frontmatter
 * keys `version`, `name` and `description`, and the text under
 * `## Instructions`. The rest of the file is the bot's own and is not read or
 * changed here.
 */

/** The parser the daemon hands a plugin, and the one the other plugin tests use. */
const yaml: Yaml = { parseYaml, stringifyYaml };

const parts = (over: Partial<AgentsParts> = {}): AgentsParts => ({
  version: 1,
  name: 'Motion',
  description: 'A careful reviewer.',
  instructions: 'Be calm.',
  ...over,
});

const FULL = `---
version: 1
name: Motion
description: A careful reviewer.
colour: red
---

## Instructions

Be calm.
Be kind.

## How you work

The rest is the bot's.
`;

it('reads the owner parts of a full file', () => {
  expect(readAgents(yaml, FULL)).toEqual({
    version: 1,
    name: 'Motion',
    description: 'A careful reviewer.',
    instructions: 'Be calm.\nBe kind.',
  });
});

it('reads a file with no frontmatter as empty parts and its section', () => {
  expect(readAgents(yaml, '# Motion\n\n## Instructions\n\nBe calm.\n')).toEqual({
    version: undefined,
    name: '',
    description: '',
    instructions: 'Be calm.',
  });
});

it('reads a file with no Instructions section as empty instructions', () => {
  expect(readAgents(yaml, '---\nversion: 1\nname: Motion\n---\n\n# Motion\n')).toEqual({
    version: 1,
    name: 'Motion',
    description: '',
    instructions: '',
  });
});

it('reads the default template filled with a bot as that bot words', () => {
  const bot: BotRecord = {
    id: 'motion',
    name: 'Motion',
    labels: [],
    body: 'robot',
    color: 'red',
    session: 'work',
    workspace: '/bots/motion',
    owner: 'user:soft',
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    description: 'A careful reviewer.',
    instructions: 'Be calm.',
  };
  expect(readAgents(yaml, agentsFilled(bot, DEFAULT_AGENTS_TEMPLATE))).toEqual({
    version: 1,
    name: 'Motion',
    description: 'A careful reviewer.',
    instructions: 'Be calm.',
  });
});

it('changes only the owner parts and keeps every other byte', () => {
  const edited = writeAgents(yaml, FULL, parts({ name: 'Reviewer', description: 'Reads code.', instructions: 'Be kind.\nBe exact.' }));
  expect(edited).toBe(`---
version: 1
name: Reviewer
description: Reads code.
colour: red
---

## Instructions

Be kind.
Be exact.

## How you work

The rest is the bot's.
`);
  expect(edited).toContain('colour: red');
});

it('quotes a description with a colon or a quote so it reads back the same', () => {
  const description = 'Reviews code: carefully, "at times".';
  expect(readAgents(yaml, writeAgents(yaml, FULL, parts({ description }))).description).toBe(description);
});

it('adds the Instructions section after the frontmatter when the file has none', () => {
  const text = '---\nversion: 1\nname: Motion\ndescription: Empty\n---\n\n## Notes\n\nKeep this.\n';
  expect(writeAgents(yaml, text, parts({ description: 'Empty' }))).toBe(`---
version: 1
name: Motion
description: Empty
---

## Instructions

Be calm.

## Notes

Keep this.
`);
});

it('adds the frontmatter to a file with none and keeps its text', () => {
  expect(writeAgents(yaml, '## Notes\n\nKeep this.\n', parts())).toBe(`---
version: 1
name: Motion
description: A careful reviewer.
---

## Instructions

Be calm.

## Notes

Keep this.
`);
});

it('reads a section emptied by an edit as empty', () => {
  expect(readAgents(yaml, writeAgents(yaml, FULL, parts({ instructions: '' }))).instructions).toBe('');
});

it('keeps the layout version a file already names when the parts name none', () => {
  const text = '---\nversion: 2\nname: Motion\n---\n';
  expect(readAgents(yaml, writeAgents(yaml, text, parts({ version: undefined, instructions: '' }))).version).toBe(2);
});

it('writes the layout version when neither the parts nor the file name one', () => {
  const text = writeAgents(yaml, '# Motion\n', parts({ version: undefined, instructions: '' }));
  expect(readAgents(yaml, text).version).toBe(AGENTS_VERSION);
});

it('ends a key at its last value line, so a comment and a blank line after it stay', () => {
  const text = '---\nversion: 1\nname: Old\n# kept\n\nmood: calm\ndescription: A careful reviewer.\n---\n\n## Instructions\n\nBe calm.\n';

  // A comment and a blank line below a key belong to nobody: an edit of the key
  // above them does not take them.
  expect(writeAgents(yaml, text, parts({ name: 'New' }))).toContain('name: New\n# kept\n\nmood: calm');
});

it('replaces a block scalar whole, with the lines it took', () => {
  const text = '---\nversion: 1\nname: Motion\ndescription: |-\n  one\n  two\n# note\nmood: calm\n---\n\n## Instructions\n\nBe calm.\n';

  const written = writeAgents(yaml, text, parts({ description: 'three' }));

  // The old value's indented lines go with it, and the comment below them stays.
  expect(written).not.toContain('  one');
  expect(written).not.toContain('  two');
  expect(written).toContain('# note');
  expect(written).toContain('mood: calm');
  expect(readAgents(yaml, written).description).toBe('three');
});

it('reads a quoted description with a column-0 x: line back whole', () => {
  const text = '---\nversion: 1\nname: Motion\ndescription: "one\nx: two"\n# note\nmood: calm\n---\n\n## Instructions\n\nBe calm.\n';

  const written = writeAgents(yaml, text, parts({ description: 'one\nx: two' }));

  // The x: line is inside the quoted value, so it is not a key and does not end
  // the one above it; what follows the value stays where it was.
  expect(written).toContain('# note');
  expect(written).toContain('mood: calm');
  expect(readAgents(yaml, written).description).toBe('one\nx: two');
});

it('names the line that would end the Instructions section', () => {
  // A `##` line in the instructions reads back as the section's end, so a write
  // that took one is refused rather than cutting the text in silence.
  expect(instructionsProblem('Be calm.\n## Notes\nBe kind.')).toBe('the instructions have a line that starts with "## ": ## Notes');
  expect(instructionsProblem('Be calm.\n# Notes')).toBeUndefined();
});

it('keeps the indentation of a first instruction line', () => {
  const written = writeAgents(yaml, FULL, parts({ instructions: '    Be calm.' }));
  expect(readAgents(yaml, written).instructions).toBe('    Be calm.');
});
