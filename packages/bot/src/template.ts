import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fillWords } from '@ahpd/sdk';
import type { BotRecord } from './record.js';

/**
 * The text a bot is made from: the `AGENTS.md` its folder holds, the bot maker.
 *
 * A template is a record in the `templates` collection, whose body is the text
 * and whose frontmatter holds its `title`, or the default file. A bot names one
 * with `template`; a bot that names none, or names one since removed, gets the
 * default. Its words are `name`, `description` and `instructions`, and the text
 * ahpd ships tells the bot to ask what it is for and then write the answers in
 * its Instructions section. The frontmatter and that section are the parts the
 * UI owns (see `agents.ts`); everything else in the file is the bot's.
 *
 * The default lives in a file a person edits, at
 * `<configDir>/templates/bots/AGENTS.md`, so it can be changed for every bot a
 * daemon makes without changing what each bot already has: the filled result
 * is copied into the bot's folder when the bot is made, or at its first wake
 * where the folder has none, and is the bot's own from then on.
 */

/** What reads a named template. */
export interface BotTemplates {
  /** The text of the template with this name, or nothing when there is none. */
  text(name: string): Promise<string | undefined>;
}

/**
 * The text ahpd ships as the default `AGENTS.md` template.
 *
 * This is what is written to the default file at load, and what is used when
 * that file cannot be read. A bot's first wake copies the filled text into its
 * own folder, so an update to this text does not reach a bot that exists.
 */
export const DEFAULT_AGENTS_TEMPLATE = `---
version: 1
name: {{name}}
description: {{description}}
---

## Instructions

{{instructions}}

## How you work

This file is your rules. You are {{name}}, a persistent bot assistant on \`ahpd\`, and this folder is yours. Answer as {{name}}, not as the model or the program that runs you. The frontmatter and the Instructions section are your owner's. You may change them only when your owner asks.

If the Instructions section does not say what you are for, ask the person who talks to you. Ask what work you do, for whom, and what you must never do. Then write their answers in the Instructions section.
`;

/** The folder, under the daemon's configuration folder, that the default `AGENTS.md` template ships in. */
export const AGENTS_TEMPLATE_FOLDER = join('templates', 'bots');

/** The name of the default `AGENTS.md` template file. */
export const AGENTS_TEMPLATE_FILE = 'AGENTS.md';

/** Where the default `AGENTS.md` template sits, under the daemon's configuration folder. */
export const agentsTemplatePath = (configDir: string): string => join(configDir, AGENTS_TEMPLATE_FOLDER, AGENTS_TEMPLATE_FILE);

/**
 * The text of the default `AGENTS.md` template.
 *
 * The file a person may edit, or the text ahpd ships where the file cannot be
 * read - a daemon whose configuration folder was never given the file still
 * makes bots with rules. Read when it is asked for rather than kept, so an
 * edit is what the next bot gets.
 */
export function defaultAgentsTemplate(configDir: string): string {
  try {
    return readFileSync(agentsTemplatePath(configDir), 'utf8');
  }
  catch {
    return DEFAULT_AGENTS_TEMPLATE;
  }
}

/** A bot's `AGENTS.md` from one template, with its three words filled. */
export function agentsFilled(bot: BotRecord, template: string): string {
  return fillWords(template, {
    name: bot.name,
    description: bot.description ?? '',
    instructions: bot.instructions ?? '',
  });
}

/**
 * The `AGENTS.md` one bot gets on a first wake.
 *
 * The `templates` record the bot names, or the default file when it names none
 * or what it names has gone; and the text ahpd ships where that file cannot be
 * read. Filled, so the folder holds the bot's own words rather than the words a
 * template stands them in for.
 */
export const agentsTextOf = async (
  bot: BotRecord,
  templates: Pick<BotTemplates, 'text'>,
  configDir: string,
): Promise<string> => {
  const named = bot.template === undefined ? undefined : await templates.text(bot.template);
  return agentsFilled(bot, named ?? defaultAgentsTemplate(configDir));
};
