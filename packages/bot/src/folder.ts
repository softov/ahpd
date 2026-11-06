import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAgents, writeAgents } from './agents.js';
import { AGENTS_TEMPLATE_FOLDER, agentsTemplatePath, DEFAULT_AGENTS_TEMPLATE } from './template.js';
import type { AgentsParts, Yaml } from './agents.js';
import type { BotRecord, KeptBot } from './record.js';

/**
 * What a bot's folder holds, and the default template that makes it.
 *
 * `AGENTS.md` is the bot's rules: every harness here reads it itself, and the
 * bot rewrites it when it needs to, which is why this writes one only where
 * there is none. The text comes from the bot's template, already filled with
 * its words - the shipped template is the maker, so a bot with no
 * `instructions` gets a file too, one that tells it to ask what it is for.
 *
 * `CLAUDE.md` is one line, `@AGENTS.md`, because Claude reads that file and not
 * `AGENTS.md`: the import is what makes the two names one document. It is
 * written whether or not there is an `AGENTS.md` yet.
 *
 * Nothing is written over. A file a person, or the bot itself, put there is the
 * one that stays: `prepareFolder` runs before every start of a back session,
 * and a bot that wrote its own rules would otherwise lose them on the next
 * message. The same holds for the default template file: it is written by the
 * plugin at load where it is absent, and a person's edit is what stays.
 *
 * The two writes that do replace something are the ones a person asked for:
 * `makeFolder` is a make, which has no file to keep, and `writeAgentsFile` is
 * an edit in the UI, which changes only the parts the UI owns. What a read
 * answers is `fromAgents`: the file's parts, joined onto the record.
 */

/** The file a bot's rules are in. */
export const AGENTS_FILE = 'AGENTS.md';

/** The file Claude reads, which names `AGENTS.md`. */
export const CLAUDE_FILE = 'CLAUDE.md';

/** Write `text` where `path` is absent, and leave a file that is there alone. */
const written = (path: string, text: string): void => {
  try {
    // `wx` is the check and the write as one step, so two wakes racing for the
    // same folder cannot both find the file absent and both write it.
    writeFileSync(path, text, { flag: 'wx' });
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
};

/**
 * Write the default `AGENTS.md` template under the configuration folder, where
 * it is not there.
 *
 * Called by the plugin at load, so a person has a file to edit before any bot
 * is woken, and so a bot made on a daemon that has one gets the person's text
 * rather than the one ahpd ships.
 */
export function prepareAgentsTemplate(configDir: string): void {
  mkdirSync(join(configDir, AGENTS_TEMPLATE_FOLDER), { recursive: true });
  written(agentsTemplatePath(configDir), DEFAULT_AGENTS_TEMPLATE);
}

/**
 * Make the folder, and give it the two files where they are not there.
 *
 * `agents` is the bot's `AGENTS.md`, already made from its template and filled
 * with its words: once the file exists it is the bot's, and this never asks
 * what the record says again.
 */
export function prepareFolder(folder: string, agents: string): void {
  mkdirSync(folder, { recursive: true });
  written(join(folder, CLAUDE_FILE), '@AGENTS.md\n');
  written(join(folder, AGENTS_FILE), agents.endsWith('\n') ? agents : `${agents}\n`);
}

/**
 * Make the folder a bot was made in, with its `AGENTS.md` from the template.
 *
 * The file is written at the make rather than at the first wake, so a bot has
 * its rules from the moment it exists - and an edit in the UI has a file to
 * edit. The template's text is passed through `writeAgents`, which sets the
 * parts the UI owns: the default template already names them, and a template
 * of a person's own that does not gets a frontmatter and an Instructions
 * section on top, with its text below.
 *
 * Nothing is written over, as `prepareFolder`: a folder that already has a file
 * keeps it, and the make writes the parts into that file with
 * `writeAgentsFile`.
 */
export function makeFolder(folder: string, agents: string, yaml: Yaml, parts: AgentsParts): void {
  mkdirSync(folder, { recursive: true });
  written(join(folder, CLAUDE_FILE), '@AGENTS.md\n');
  const text = agents.endsWith('\n') ? agents : `${agents}\n`;
  written(join(folder, AGENTS_FILE), writeAgents(yaml, text, parts));
}

/**
 * What a read of a bot's `AGENTS.md` found.
 *
 * The three are kept apart because a load that moves an older record's parts
 * into the file may write over a file that is there, and never over one it
 * cannot read: answering nothing for both is how a persona is dropped.
 */
export type AgentsFile =
  | { kind: 'parts'; parts: AgentsParts }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: unknown };

/** The parts one bot's `AGENTS.md` says, which of the three it is, or why it cannot be read. */
export function readAgentsFile(folder: string, yaml: Yaml): AgentsFile {
  let text: string;
  try {
    text = readFileSync(join(folder, AGENTS_FILE), 'utf8');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', error };
  }
  try {
    return { kind: 'parts', parts: readAgents(yaml, text) };
  }
  catch (error) {
    return { kind: 'unreadable', error };
  }
}

/** The parts a file this host could read says, or nothing when there is no such file. */
const partsIn = (file: AgentsFile): AgentsParts | undefined => (file.kind === 'parts' ? file.parts : undefined);

/**
 * Write the parts into a bot's `AGENTS.md`, keeping everything else it says.
 *
 * What an edit in the UI is: the frontmatter keys and the Instructions section
 * are replaced, and the bot's own writing - other sections, other keys -
 * survives. A folder with no file gets one, which is what an edit to a bot
 * whose file was removed does.
 */
export function writeAgentsFile(folder: string, yaml: Yaml, parts: AgentsParts): void {
  mkdirSync(folder, { recursive: true });
  let text = '';
  try { text = readFileSync(join(folder, AGENTS_FILE), 'utf8'); }
  catch {
    // No file yet: the parts are the whole of it.
  }
  writeFileSync(join(folder, AGENTS_FILE), writeAgents(yaml, text, parts));
}

/** The parts a bot answers with, as the writer takes them. A missing line is written empty. */
export const partsOf = (bot: BotRecord): AgentsParts => ({
  name: bot.name,
  description: bot.description ?? '',
  instructions: bot.instructions ?? '',
});

/** The words of the parts, where a file and a record are joined into one bot. */
interface Words {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

/** The words one record carries, which are the older copy a load is moving. */
const saidOf = (bot: KeptBot): Words => ({
  name: bot.name,
  description: bot.description,
  instructions: bot.instructions,
});

/** A line of a file or a record, where it says anything. */
const nonEmpty = (said: string | undefined): string | undefined => {
  if (typeof said !== 'string') return undefined;
  // Only the blank lines at the end go: the indentation of the first line is
  // the text's, and an Instructions section keeps it when it is read back.
  const held = said.replace(/(?:\r?\n[ \t]*)+$/, '');
  return held.trim() === '' ? undefined : held;
};

/**
 * One bot from a record and two sets of words, the first found winning.
 *
 * The kept fields are the record's; the name falls back to the slug, which is
 * the one name a bot always has. A description or an instructions section that
 * neither set has is left out rather than answered empty: a bot whose file
 * dropped its section is a bot with no instructions, not one with an empty
 * sentence.
 */
const joined = (bot: KeptBot, first: Words, second: Words): BotRecord => {
  const { name, description, instructions, ...kept } = bot;
  const line = nonEmpty(first.description) ?? nonEmpty(second.description);
  const rules = nonEmpty(first.instructions) ?? nonEmpty(second.instructions);
  return {
    ...kept,
    name: nonEmpty(first.name) ?? nonEmpty(second.name) ?? bot.id,
    ...(line === undefined ? {} : { description: line }),
    ...(rules === undefined ? {} : { instructions: rules }),
  };
};

/**
 * One record as a bot, with the parts its `AGENTS.md` has where the record
 * says none of its own.
 *
 * The record's parts are the older copy - what a bot made before the file was
 * the one copy has - so they win where they are there, except for the
 * Instructions section: a file that has one is the bot's own writing, and the
 * copy in the record is dropped rather than written over it. A bot on a
 * computer has no folder here, and its record is all this host knows of it.
 */
export function withAgents(yaml: Yaml | undefined, bot: KeptBot): BotRecord {
  if (yaml === undefined || bot.computer !== undefined) return joined(bot, saidOf(bot), {});
  const file = partsIn(readAgentsFile(bot.workspace, yaml));
  const record = file !== undefined && nonEmpty(file.instructions) !== undefined
    ? { ...saidOf(bot), instructions: undefined }
    : saidOf(bot);
  return joined(bot, record, file ?? {});
}

/**
 * One bot as a read answers it now, with the parts its file has today.
 *
 * The file is the one copy, so it wins over what the store last read: an edit
 * the bot made to its own file shows on the next read, without anything having
 * to notice the write. A folder with no file answers the parts the record had.
 */
export function fromAgents(yaml: Yaml, bot: BotRecord): BotRecord {
  if (bot.computer !== undefined) return bot;
  const file = partsIn(readAgentsFile(bot.workspace, yaml));
  return file === undefined ? bot : joined(bot, file, saidOf(bot));
}
