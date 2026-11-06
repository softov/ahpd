/**
 * `ahpd service`: the manager of this machine starts the daemon.
 *
 * `install` writes the one file the manager reads - a systemd user unit on
 * Linux, a LaunchAgent on macOS - and hands it over, so the daemon starts at
 * login and is started again whenever it ends. It is the same foreground daemon as
 * `ahpd` with no command, with the configuration file of this install named in
 * full: the unit sets `AHPD_SERVICE`, which is what makes that daemon record
 * itself as one a manager holds, so `ahpd stop` and `ahpd restart` go through
 * the manager rather than to a signal. `uninstall` takes it out again.
 *
 * Nothing here starts a daemon of its own. The manager owns the process, so
 * this writes, asks, and then waits for the record the daemon writes about
 * itself - the announcement `start` reads out of a log is one a supervised
 * daemon has no log to write.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { configDir, configPath, daemonLog } from '../config.js';
import { READY_TIMEOUT_MS, forget, running, statusLine } from '../daemon.js';
import type { Running } from '../daemon.js';
import { installFile, installStarts, installText, managedAs, ownConfigHome, realManager, serviceOn } from '../service.js';
import { checkingUpdates, updateLine } from '../update.js';
import { manifest } from '../version.js';
import { conflict, namedOptionsFrom, secret, serverFields, stop } from './options.js';

/** What went wrong, as the words of an error already written for a person. */
const wordsOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The record of the daemon the manager started, waited for the way `start`
 * waits: `READY_TIMEOUT_MS`, and then a refusal saying where to look.
 *
 * The wait is on the record rather than on a log, because this process spawned
 * nothing: the manager owns the daemon, and the record the daemon writes about
 * itself is the only thing here that says it is up. `previous` is the pid of a
 * daemon that was already running, whose record does not count - the restart
 * this asked for is a new process, and until it writes a record of its own the
 * file on disk is still the old one's.
 */
const upWithin = async (previous: number | undefined): Promise<Running> => {
  const until = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const now = running();
    if (now !== undefined && now.pid !== previous) return now;
    if (Date.now() > until) break;
    await new Promise((wait) => { setTimeout(wait, 200); });
  }
  return conflict(`It did not come up within ${String(READY_TIMEOUT_MS / 1000)} seconds; run ahpd status.`);
};

export const declareService = (registry: Registry<object>): Command[] => {
  const install = registry.action({
    id: 'service.install',
    summary: 'Let the service manager start it at login and keep it running',
    description: 'Writes the unit or the agent for this install\'s configuration file, hands it to the service manager, and waits for the daemon to say where it is listening. It refuses while a daemon from `ahpd start` runs, and it prints where the token comes from and never the token.',
    surfaces: { cli: { pattern: ['service', 'install'] } },
    // A new service: the file is written whether or not one was there, and an
    // install over a running service replaces what it was started from.
    effect: 'add',
    resource: { kind: 'service' },
    scopes: ['config:write'],
    /*
     * The configuration file alone. The file written below runs
     * `ahpd --config-file <file>` and nothing else, so an option typed here
     * would be one the daemon never sees, and the token line would be read from
     * a file that is not the one the daemon reads.
     */
    input: { configFile: serverFields.configFile },
    run: async (context) => {
      const service = serviceOn(process.platform)
        ?? stop('Installing the service needs systemd or launchd, which this machine has not: a unit is written on Linux and an agent on macOS.');
      const input = context.input as Readonly<Record<string, unknown>>;
      // In full: the unit starts the daemon in the home folder, not in this one.
      const configFile = resolve(context.optional<string>('configFile') ?? configPath());
      /*
       * Before anything is written. A daemon a terminal started is not this
       * service's to replace: the unit would be one nothing reads until the
       * next login, and the daemon already on the port would go on serving it.
       * One word stops it, so it is said rather than done.
       */
      const found = running();
      if (found !== undefined && found.service === undefined) {
        conflict(`A daemon from ahpd start is running: ${found.url} (pid ${String(found.pid)}). Stop it with ahpd stop, then install the service.`);
      }
      /*
       * Where the secret comes from, read out of the same configuration file
       * the daemon will read, so this says what the daemon's own announcement
       * says. The token is not one of these words: this is the one line about
       * the secret, and it is printed rather than the secret itself.
       */
      const options = await namedOptionsFrom(input);
      const { from } = secret(options);
      const name = options.serviceName;
      /*
       * One daemon is held by one service. A daemon of this configuration home
       * that a service of another name already holds would be started twice,
       * so that one is taken out first, which is said rather than done.
       */
      if (found?.service !== undefined && found.serviceName !== name) {
        conflict(`The daemon in ${configDir()} runs under ${found.service} as ${managedAs(found.service, found.serviceName)}. Take that service out with ahpd service uninstall, then install this one.`);
      }
      const file = installFile(service, name);
      const ownHome = ownConfigHome();
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, installText(service, {
          node: process.execPath,
          program: process.argv[1] as string,
          configFile,
          home: homedir(),
          path: process.env['PATH'] ?? '',
          log: daemonLog(),
          ...(name === undefined ? {} : { name }),
          ...(ownHome === undefined ? {} : { configHome: ownHome }),
        }), { mode: 0o644 });
      }
      catch (error) {
        conflict(`Could not write ${file}: ${wordsOf(error)}`);
      }
      const manager = realManager();
      try {
        // A unit under a configuration home of its own is outside the folder
        // systemd reads units from, and is enabled by its path.
        await manager.install(service, file, name, ownHome !== undefined);
        /*
         * A second install, over a daemon already running under the service:
         * the file it was started from has changed, and where the manager's
         * install is not what starts the service from that file again, the
         * restart is. Both managers' own words are in `installStarts`.
         */
        if (found !== undefined && !installStarts(service)) await manager.restart(service, name);
      }
      catch (error) {
        conflict(`Could not install the service: ${wordsOf(error)}. The file it wrote is at ${file}.`);
      }
      const record = await upWithin(found?.pid);
      let text = `${statusLine(record)}\n`;
      if (record.paths.length > 0) text += `sessions in ${record.paths.join(', ')}\n`;
      if (record.automations !== undefined) text += `automations ${record.automations}\n`;
      text += `${from}\n`;
      if (checkingUpdates(options.updateCheck)) text += updateLine(manifest()) ?? '';
      return output({
        url: record.url,
        pid: record.pid,
        paths: record.paths,
        service,
      }, text);
    },
  });

  const uninstall = registry.action({
    id: 'service.uninstall',
    summary: 'Stop the service and take it out',
    description: 'Takes the service out of the list this machine starts at login, and removes the file it was started from and the record of the daemon it held. A daemon from `ahpd start` is another daemon\'s and is left alone.',
    surfaces: { cli: { pattern: ['service', 'uninstall'] } },
    effect: 'remove',
    resource: { kind: 'service' },
    scopes: ['config:write'],
    // The configuration file the service was installed with, which names it.
    input: { configFile: serverFields.configFile },
    run: async (context) => {
      const service = serviceOn(process.platform)
        ?? stop('Taking the service out needs systemd or launchd, which this machine has not: a unit is written on Linux and an agent on macOS.');
      const found = running();
      // The daemon the service holds, which is the one that goes with it. A
      // record of one from `ahpd start` is another daemon's, and the file
      // beside it says nothing about it: it is left running.
      const held = found === undefined || found.service !== service ? undefined : found;
      /*
       * The service that holds the daemon is the one taken out, by the name its
       * record holds: a name changed in the file since is not a service that
       * holds anything. With no daemon running, the file's name is the one.
       */
      const name = held === undefined
        ? (await namedOptionsFrom(context.input as Readonly<Record<string, unknown>>)).serviceName
        : held.serviceName;
      const file = installFile(service, name);
      if (found === undefined && !existsSync(file)) conflict('No service is installed.');
      try {
        await realManager().uninstall(service, name);
      }
      catch (error) {
        conflict(`Could not take the service out: ${wordsOf(error)}`);
      }
      // The record goes with the service it was written under: a manager that
      // has stopped the daemon leaves a record naming a process that is going,
      // which `status` would go on reading as a daemon until it is gone.
      if (held !== undefined) forget([held.pid]);
      if (existsSync(file)) {
        try { unlinkSync(file); }
        catch (error) { conflict(`Could not remove ${file}: ${wordsOf(error)}`); }
      }
      const stopped = held === undefined ? '' : `Stopped ${held.url} (pid ${String(held.pid)}).\n`;
      return output({
        service,
        file,
        ...(held === undefined ? {} : { url: held.url, pid: held.pid }),
      }, `${stopped}Took the service out: ${file}.\n`);
    },
  });

  return [install, uninstall];
};
