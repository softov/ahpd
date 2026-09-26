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
 * declarations rather than from this file. What is left here is the entry and
 * the one word bare `ahpd` has always had.
 */

import { optionTable, optionsOf, tokenize } from '@cofold/commands';
import type { Runner } from '@cofold/commands';
import { helpForCommand, Program, runEntry } from '@cofold/terminal';
import { cliRegistry, remoteRegistry } from './commands/registry.js';
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
const argv0 = process.argv.slice(2).map((one) => (one === '-v' ? '--version' : one));
const remoteUrl = readGlobal(argv0, '--remote');
const remoteToken = readGlobal(argv0, '--token') ?? process.env['AHPD_TOKEN'];
const refresh = argv0.includes('--refresh');

let registry: Runner;
if (remoteUrl === undefined) {
  registry = cliRegistry();
}
else {
  try {
    registry = await remoteRegistry({
      url: remoteUrl,
      ...(remoteToken === undefined ? {} : { token: remoteToken }),
      refresh,
    });
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
   * reached by typing nothing. Appending its own help here is what keeps those
   * flags on the one screen they have always been on, without a command word
   * that would have to be typed.
   */
  liveHelp: (_command, prefix) => {
    if (prefix.length > 0) return Promise.resolve('');
    const run = registry.find('daemon.run');
    if (run === undefined) return Promise.resolve('');
    return Promise.resolve(`\n${helpForCommand(run, {
      name: 'ahpd',
      version: version(),
      commands: program.commands,
      globals: program.globals,
      groups: registry.groups,
    })}`);
  },
  /*
   * The three words that decide where a command runs.
   *
   * `--remote` is the whole switch, `--token` is the credential the API checks
   * and falls back to `AHPD_TOKEN` so it need not be on the line, and
   * `--refresh` re-reads a command surface that is otherwise cached on disk.
   */
  globals: [
    { name: '--remote', value: 'URL', description: 'Run the administration commands against a daemon over its HTTP API, rather than here.' },
    { name: '--token', value: 'SECRET', description: 'The credential --remote presents. Defaults to AHPD_TOKEN.', env: 'AHPD_TOKEN' },
    { name: '--refresh', description: 'Fetch the command surface --remote cached again.' },
  ],
});

/*
 * `ahpd [options]` runs it here, in this terminal, and has always been what no
 * verb means. The program has no word those words match, so the run gets its
 * word before the program sees the line - `run` is registered and hidden, and
 * `--help` and `--version` are questions about the program rather than a run,
 * so they are left to answer themselves.
 *
 * The count of command words is taken with the same grammar the program parses
 * with, so a value that belongs to a flag is never mistaken for a command.
 */
const argv = argv0;
const asked = argv.some((one) => one === '--help' || one === '-h' || one === '--version');
const words = tokenize(
  optionTable([...program.globals, ...program.commands.flatMap((command) => optionsOf(command))], true),
  argv,
  { permissive: true },
).words.length;

await runEntry(program, words === 0 && !asked ? ['run', ...argv] : argv);
