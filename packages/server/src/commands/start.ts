/**
 * `ahpd start`: the same daemon, let go of.
 *
 * The background one is this program run again with the rest of the line, which
 * is why the child's words are forwarded as they were typed rather than
 * rebuilt from the parsed input: `start` cannot drift from what it starts.
 */

import { isFlag, optionTable, optionsOf, output, tokenize } from '@cofold/commands';
import type { Command, OptionTableEntry, Registry } from '@cofold/commands';
import { globalOptions } from '@cofold/terminal';
import { start } from '../daemon.js';
import { checkingUpdates, updateLine } from '../update.js';
import { manifest } from '../version.js';
import { optionsFrom, programGlobals, secret, flagFields, stop, conflict } from './options.js';

/** The options that belong to the process typing the line, never to the child. */
const PARENT_OPTIONS = new Set(
  [...globalOptions, ...programGlobals].flatMap((one) => [one.name, ...(one.short === undefined ? [] : [one.short])]),
);

/**
 * Where the `start` word sits in the line.
 *
 * The table is the union the program parses with, so an option's value is never
 * read as a word: a `--path start` consumes its `start`, and the word is the one
 * that leaves `start` as the only word before it.
 */
function wordAt(table: Map<string, OptionTableEntry>, argv: readonly string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== 'start') continue;
    const before = tokenize(table, argv.slice(0, index + 1), { permissive: true });
    if (before.words.length === 1 && before.words[0] === 'start') return index;
  }
  return -1;
}

/**
 * The line the child is given: the typed one without the word that named the
 * command and without the options that belong to the parent.
 *
 * Walked with the table rather than sliced, so a value that spells a word or an
 * option stays the value it was typed as: `--path start` forwards its `start`
 * as the path, and `--connection-token=--port` forwards its `--port` as the
 * token.
 */
function forwardedLine(
  argv: readonly string[],
  at: number,
  table: Map<string, OptionTableEntry>,
): string[] {
  const kept: string[] = [];
  const isOption = (one: string): boolean =>
    one.startsWith('--') || (one.startsWith('-') && one.length > 1 && !/^-\d/u.test(one));
  for (let index = 0; index < argv.length; index += 1) {
    if (index === at) continue;
    const argument = argv[index] as string;
    const name = isOption(argument) ? argument.split('=')[0] : undefined;
    const entry = name === undefined ? undefined : table.get(name);
    const takesValue = entry !== undefined && !isFlag(entry.spec) && !argument.includes('=');
    if (name !== undefined && PARENT_OPTIONS.has(name)) {
      if (takesValue) index += 1;
      continue;
    }
    kept.push(argument);
    if (takesValue) {
      const value = argv[index + 1];
      if (value !== undefined) {
        kept.push(value);
        index += 1;
      }
    }
  }
  return kept;
}

export const declareStart = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.start',
  summary: 'Run it in the background and let go of it',
  description: 'Detached, with its output in the daemon log and a record of where it is listening.',
  surfaces: { cli: { pattern: ['start'] } },
  input: flagFields,
  run: async (context) => {
    const options = optionsFrom(context.input as Readonly<Record<string, unknown>>);
    // A detached process has no pipe to answer on, so it would read an
    // immediate end and exit having served nobody.
    if (options.stdio) stop('--stdio cannot be detached: it serves the process that started it.');
    // Derived here too, so the record the parent writes carries the ready URL
    // and the child is told nothing it did not already know.
    const { token } = secret(options);
    /*
     * The child is this program run again with the typed line: every option and
     * value, wherever it was typed, minus the word that named this command and
     * minus the globals, which name things about the process typing them - a
     * `--remote` forwarded to the child would make the daemon a client of
     * somebody else.
     */
    const argv = process.argv.slice(2);
    const table = optionTable([
      ...globalOptions,
      ...programGlobals,
      ...context.commands.flatMap((command) => optionsOf(command)),
    ], true);
    const at = wordAt(table, argv);
    const rest = forwardedLine(argv, at, table);
    try {
      const begun = await start(rest, process.argv[1] as string, token);
      let text = options.warnings.map((warning) => `${warning}\n`).join('');
      text += `ahpd on ${begun.url} (pid ${String(begun.pid)}), sessions in ${begun.paths.join(', ') || process.cwd()}\n`;
      if (begun.automations !== undefined) text += `automations ${begun.automations}\n`;
      if (checkingUpdates(options.updateCheck)) text += updateLine(manifest()) ?? '';
      return output({
        url: begun.url,
        pid: begun.pid,
        paths: begun.paths,
        ...(begun.automations === undefined ? {} : { automations: begun.automations }),
      }, text);
    }
    catch (error) {
      conflict(`Could not start it: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
