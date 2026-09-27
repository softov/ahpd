#!/usr/bin/env node
/**
 * The daemon, as a terminal sees it.
 *
 * One host, one working directory, one port. A second directory is a second
 * daemon rather than a flag, because the working directory is what the
 * catalogue *is* - a host that served several would have to answer "which
 * sessions" before it could answer anything, and the protocol has no place to
 * ask.
 *
 * Every verb and every flag is one declaration under `commands/`, and the
 * program below is the same rendering `@cofold/terminal` gives any program:
 * help, completion, `--json` and the exit codes all come from those
 * declarations rather than from this file. What is left here is the entry: the
 * registry, the program's own globals, and the `run` word a line with no
 * command gets.
 */

import { readFileSync } from 'node:fs';
import { fullyNamed, isFlag, literalPrefix, matchCommand, optionNotes, optionTable, optionsOf, tokenize, visible } from '@cofold/commands';
import type { Command, OptionSpec, Runner } from '@cofold/commands';
import { Program, renderDefinitions, runEntry, styleFor } from '@cofold/terminal';
import { cliRegistry, remoteRegistry } from './commands/registry.js';
import { programGlobals } from './commands/options.js';
import { version } from './version.js';

/*
 * Where the commands come from.
 *
 * Locally they are this binary's own declarations. `--remote` reads the
 * declaration a daemon publishes and registers those instead, so the words are
 * the same and the work happens there; `start` and `stop` stay here, because
 * they are about the daemon this process is not. The global is read before the
 * program exists, because the program is built out of what it names.
 */
/** The line `loopbackUrl` in the SDK draws: a URL that keeps the token on this machine. */
const ON_MACHINE = /^https?:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?(?:[/?#]|$)/iu;

const argv0 = process.argv.slice(2);
const remoteUrl = readGlobal(argv0, '--remote');
const refresh = argv0.includes('--refresh');

let registry: Runner;
if (remoteUrl === undefined) {
  registry = cliRegistry();
}
else {
  const token = tokenFor(argv0, remoteUrl);
  warnCleartext(remoteUrl);
  try {
    registry = await remoteRegistry({ url: remoteUrl, token, refresh });
  }
  catch (error: unknown) {
    process.stderr.write(`ahpd: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

/** One global read before the program exists, because the program depends on it. */
function readGlobal(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at !== -1 && argv[at + 1] !== undefined) return argv[at + 1];
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

/**
 * The credential `--remote` presents.
 *
 * `--token` and `--token-file` are two spellings of the one secret and are
 * refused together; `AHPD_TOKEN` is read only when neither flag is given, so a
 * file wins over an environment a child process inherited, and a missing or
 * empty file is refused rather than tried. A remote call with no credential at
 * all is refused here, before anything is fetched, because every daemon that
 * serves the API requires one - decision `remote-needs-a-token`.
 */
function tokenFor(argv: readonly string[], url: string): string {
  const inline = readGlobal(argv, '--token');
  const file = readGlobal(argv, '--token-file');
  if (inline !== undefined && file !== undefined) {
    process.stderr.write('ahpd: pass --token or --token-file, not both.\n');
    process.exit(2);
  }
  if (file !== undefined) {
    let held = '';
    try { held = readFileSync(file, 'utf8').trim(); }
    catch {
      process.stderr.write(`ahpd: no token file at ${file}.\n`);
      process.exit(2);
    }
    if (held === '') {
      process.stderr.write(`ahpd: ${file} is empty.\n`);
      process.exit(2);
    }
    return held;
  }
  if (inline !== undefined) return inline;
  const fromEnv = process.env['AHPD_TOKEN'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  process.stderr.write(`ahpd: ${url} needs a token: pass --token, --token-file or AHPD_TOKEN.\n`);
  process.exit(2);
}

/**
 * One line when the token would cross a network in the clear.
 *
 * `--remote` to plain http anywhere but loopback sends `Authorization: Bearer`
 * readable by anything on the path. The request still goes, because a daemon on
 * a trusted network or behind a tunnel that terminates TLS elsewhere is worth
 * reaching - decision `remote-warns-when-its-token-travels-in-cleartext`.
 */
function warnCleartext(url: string): void {
  if (!/^http:\/\//iu.test(url) || ON_MACHINE.test(url)) return;
  process.stderr.write(`ahpd: the token travels in cleartext to ${url}.\n`);
}

/*
 * The type is on the variable because the help hook below reads the program it
 * belongs to: the words a help screen is rendered from live on the program, and
 * the hook is the only place that needs both.
 */
const program: Program = new Program({
  name: 'ahpd',
  version: version(),
  description: 'An Agent Host Protocol server, with a Claude backend',
  registry,
  /*
   * `ahpd --help` is a question about the program, and the flags a person
   * typing `ahpd --port 9000` needs belong to the foreground run, which is
   * reached by typing nothing. They are rendered here as a section of their
   * own, without a `run` word and without a second global options list.
   */
  liveHelp: (_command, prefix) => {
    if (prefix.length > 0) return Promise.resolve('');
    const run = registry.find('daemon.run');
    if (run === undefined) return Promise.resolve('');
    return Promise.resolve(runHelp(run));
  },
  /*
   * Where a command runs, declared with the other options: `--remote` is the
   * whole switch, `--token` is the credential the API checks, and `--refresh`
   * re-reads a command surface that is otherwise cached on disk.
   */
  globals: programGlobals,
});

/*
 * `ahpd [options]` runs it here, in this terminal, and is what no verb means.
 * The program has no word those words match, so the run gets its word before
 * the program sees the line - `run` is registered and hidden, and `--help` and
 * `--version` are questions about the program rather than a run, so they are
 * left to answer themselves.
 *
 * The words are read with the same grammar the program parses with, so a value
 * that belongs to a flag is never mistaken for a command or for a question.
 */
const table = optionTable([...program.globals, ...program.commands.flatMap((command) => optionsOf(command))], true);
const tokens = tokenize(table, argv0, { permissive: true });
const asked = tokens.options['--help'] === true || tokens.options['--version'] === true || tokens.options['-v'] === true;
/*
 * A verb that heads a group says which sub-commands it has.
 *
 * `ahpd plugin` is a person asking what `plugin` does, and the program would
 * answer `unknown command "plugin"`, naming the word they already typed. The
 * list is read off the visible commands under that word, so it says what exists
 * rather than repeating a sentence kept by hand.
 */
const first = tokens.words[0];
if (!asked && first !== undefined && matchCommand(program.commands, tokens.words) === null) {
  const subs = visible(program.commands)
    .filter((command) => literalPrefix(command)[0] === first)
    .map((command) => literalPrefix(command)[1])
    .filter((word): word is string => word !== undefined);
  if (subs.length > 0 && !subs.includes(tokens.words[1] ?? '')) {
    process.stderr.write(`${first} takes ${subs.slice(0, -1).join(', ')}${subs.length > 1 ? ' or ' : ''}${subs.at(-1) ?? ''}.\n`);
    process.exit(2);
  }
}
/*
 * `-v` is the version shorthand only where the line holds it as an option: a
 * `--connection-token -v` gave it as that flag's value, and it is forwarded as
 * one.
 */
const argv = asked && tokens.options['-v'] === true
  ? argv0.map((one) => (one === '-v' ? '--version' : one))
  : argv0;
const line = completionLine(program.commands, argv)
  ?? (tokens.words.length === 0 && !asked ? ['run', ...argv] : argv);

await runEntry(program, line);

/**
 * A completion request, with the foreground run named when that is its subject.
 *
 * `ahpd --po<TAB>` names no command, and the flags that line takes are the
 * run's: naming `run` before the word puts them in scope. A word that already
 * names a command, or an empty word where somebody is choosing one, is left to
 * the program.
 */
function completionLine(commands: readonly Command[], words: readonly string[]): string[] | undefined {
  if (words[0] !== '__complete') return undefined;
  const at = words.indexOf('--');
  if (at === -1) return undefined;
  const typed = words.slice(at + 1);
  const current = typed[typed.length - 1] ?? '';
  if (!current.startsWith('-')) return undefined;
  const before = typed.slice(0, -1);
  const plain = before.filter((word) => !word.startsWith('-'));
  if (matchCommand(commands, plain) !== null || commands.some((command) => fullyNamed(command, plain))) return undefined;
  return [...words.slice(0, at + 1), 'run', ...typed];
}

/** One option as help shows it: its spelling on the left, what it is on the right. */
function optionLine(option: OptionSpec): [string, string] {
  const short = option.short === undefined ? '    ' : `${option.short}, `;
  const value = isFlag(option) ? '' : ` ${option.value ?? ''}`;
  const notes = optionNotes(option).map((note) => {
    if (note.kind === 'env') return `env ${note.name}`;
    if (note.kind === 'default') return `default ${JSON.stringify(note.value)}`;
    if (note.kind === 'candidates') return note.values.join('|');
    return note.kind;
  });
  const suffix = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
  return [`${short}${option.name}${value}`, `${option.description}${suffix}`];
}

/**
 * The foreground run's flags, and the two things a client reads.
 *
 * `ahpd [options]` is reached by typing no verb, so this section is what tells
 * a person which options that line takes; the paragraphs after it are the
 * configuration keys and the two spellings of the token.
 */
function runHelp(run: Command): string {
  const style = styleFor();
  return `\n${style.heading('ahpd [options]:')}\n${renderDefinitions(optionsOf(run).map(optionLine))}`
    + '\nEvery option above can be a key in the configuration file instead, spelled the way it is here without the dashes: port, host, paths, connectionToken, connectionTokenFile, withoutConnectionToken, automations, sessions, wire, updateCheck, plugins, users, resource, issuer, trustToken, advancedTools.\n'
    + 'A flag beats the file, because a flag is this run and a file is every run until somebody edits it.\n'
    + '"plugins" is a list of the same specs --plugin takes, and --no-plugins is the one flag with no key: leaving plugins out is already the off.\n'
    + '\nClients present the token as ?tkn=<secret> on the URL, or as an Authorization: Bearer <secret> header.\n';
}
