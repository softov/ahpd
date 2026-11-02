/**
 * `ahpd paths`: the folders this host serves.
 *
 * A folder named here is one this host's agents read, edit and run in, so it is
 * the one setting a client sets on a host it has just reached, and it is set
 * with one command and no question. At the terminal the verbs edit the file
 * `--config-file` names; served they edit the daemon's own file, through the
 * same code, because the daemon's file is the file a restart reads.
 *
 * At the terminal, a write with no `--config-file` is sent to the daemon the
 * record names, when that daemon serves the HTTP API: the change applies at once
 * and that daemon's own file is written, so `ahpd status --json` shows the new
 * folders with no restart.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { output } from '@cofold/commands';
import type { Command, Output, Registry } from '@cofold/commands';
import { configPath, loadConfig } from '../config.js';
import { rewritePaths, running } from '../daemon.js';
import { oneAtATime, readEntry, writeEntry } from '../install.js';
import { under } from './configure.js';
import { serverFields, stop } from './options.js';
import type { ServedFacts } from './served.js';

/**
 * What a change at the terminal says when the running daemon did not take it: a
 * daemon reads the file as it starts, so a restart is what applies it to one
 * already up. A served change is that daemon's own file and its own list, and a
 * forwarded one is applied already, so neither says this.
 */
const restartLine = 'Restart the daemon to apply the change: ahpd restart.';

/**
 * How long a forwarded change waits for the daemon's answer before the write
 * falls back to the file. Generous, because a served `add` stats a folder on a
 * host that may be a network away, and this is the only thing between a person
 * and a command that hangs.
 */
const API_WAIT_MS = 10_000;

/**
 * Where the routes hang off the origin the record names.
 *
 * Written out rather than imported from `http.ts`, which reaches this file
 * through the commands a served request runs.
 */
const API_PREFIX = '/api';

/**
 * The line an add prints: the folder, the start folder before it when the add
 * wrote that too, and where the change was made.
 */
const addedLine = (folder: string, start: string | undefined, where: string): string =>
  `Added ${start === undefined ? '' : `${start}, the folder the daemon was started in, and `}${folder} to "paths" ${where}.`;

/** The folders a configuration entry names, and nothing for one holding anything else. */
const pathsIn = (held: { paths?: unknown }): string[] => (Array.isArray(held.paths)
  ? held.paths.filter((one): one is string => typeof one === 'string')
  : []);

/**
 * The address a change is sent to, when the record names a bind address rather
 * than a machine: the loopback, which is that same daemon.
 *
 * A daemon bound to `0.0.0.0` or `::` announces that address, which names no one
 * machine - a Windows fetch to it fails outright - and a bind of `''` announces
 * `http://:<port>`, which is not a URL at all. The loopback stands in for a
 * wildcard here the way a machine's own name stands in for one in `personalUrl`
 * in `config.ts`. Pure, so every shape a wildcard is announced in is testable
 * without a socket.
 */
const LOOPBACK: Record<string, string> = {
  '': '127.0.0.1',
  '0.0.0.0': '127.0.0.1',
  // Announced bracketed, because a URL writes an IPv6 address that way.
  '[::]': '[::1]',
};

export const reachable = (api: string): string => {
  const start = api.indexOf('//') + 2;
  const at = api.lastIndexOf(':');
  // The colon found is the scheme's own, so there is no port and no host to read.
  if (at < start) return api;
  const loopback = LOOPBACK[api.slice(start, at)];
  return loopback === undefined ? api : `${api.slice(0, start)}${loopback}${api.slice(at)}`;
};

/**
 * The token a recorded daemon's connect URL carries, which is what one call to
 * its API presents. A record an older daemon wrote has none, and the call is
 * made without one: the refusal is then the daemon's own.
 */
const tokenIn = (connectUrl: string): string | undefined => {
  try {
    return new URL(connectUrl).searchParams.get('tkn') ?? undefined;
  }
  catch {
    // A record hand-edited into something that is not a URL.
    return undefined;
  }
};

export const declarePaths = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  const list = registry.action({
    id: 'paths.list',
    summary: 'The folders this host serves',
    description: 'At the terminal, every folder the configuration names, from every file it is read in. Served, the folders the daemon serves now. A daemon that names none serves the folder it is started in.',
    surfaces: { cli: { pattern: ['paths', 'list'] }, http: { method: 'GET', path: '/paths/list' } },
    // No key: this is the list of folders, and each of the other two verbs here
    // takes one of them.
    effect: 'read',
    resource: { kind: 'folder' },
    // Served, the folders are the daemon's own, so no field could name another.
    ...(served === undefined ? { input: { configFile: serverFields.configFile } } : {}),
    scopes: ['config:read'],
    run: (context) => {
      // Served, the answer is the list the daemon serves now.
      const folders = served === undefined
        ? pathsIn(loadConfig(context.optional<string>('configFile')).values)
        : [...served.options.paths];
      return output(folders, folders.length === 0 ? 'paths: none named\n' : `${folders.join('\n')}\n`);
    },
  });

  /** The file a command edits: the daemon's own when served, whatever the request names. */
  const fileOf = (named: string | undefined): string => (served === undefined ? named : served.configFile) ?? configPath();

  /**
   * Whether a change is said to need a restart: at the terminal, when a record
   * says one is up and the change was written to a file rather than sent to it.
   * Served, the daemon serving is the one whose file was just written and whose
   * list was just changed, so it has nothing to apply.
   */
  const restarting = (): boolean => served === undefined && running() !== undefined;

  /**
   * The folder the daemon serves because nothing names one, which a file with
   * no `paths` does not hold.
   *
   * Served, it is this daemon's own. At the terminal it is the recorded
   * daemon's, and only for the file a plain write edits: a named file is one
   * that daemon may not read. Nothing when no daemon is recorded.
   */
  const startFolderOf = (named: string | undefined): string | undefined => {
    if (served !== undefined) return served.options.startFolder;
    return named === undefined ? running()?.startFolder : undefined;
  };

  /**
   * Send one change to the daemon the record names, which applies it and writes
   * its own file.
   *
   * Nothing when there is no daemon to send it to, or when the one recorded did
   * not answer: the caller then writes the file and says what a restart does. A
   * refusal is the daemon's own sentence, raised as this verb's failure, because
   * the check the daemon ran is the check that has to hold before the file is
   * written.
   */
  const forward = async (verb: 'add' | 'remove', folder: string, say: (line: string) => void): Promise<Output | undefined> => {
    const held = running();
    if (held?.api === undefined) return undefined;
    const token = tokenIn(held.connectUrl);
    let answer: Response;
    try {
      answer = await fetch(`${reachable(held.api)}${API_PREFIX}/paths/${verb}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ folder }),
        signal: AbortSignal.timeout(API_WAIT_MS),
      });
    }
    catch {
      // Nothing listening, or nothing answering in time: not this verb's
      // failure, because the file it would have written is still there to write.
      return undefined;
    }
    const body: unknown = await answer.json().catch(() => undefined);
    const said = body as { message?: unknown; paths?: unknown; startFolder?: unknown } | undefined;
    if (!answer.ok) stop(typeof said?.message === 'string' ? said.message : `The daemon refused the change (HTTP ${String(answer.status)}).`);
    // The start folder the daemon wrote beside the new one, said as a file write says it.
    const start = typeof said?.startFolder === 'string' ? said.startFolder : undefined;
    say(verb === 'add' ? addedLine(folder, start, 'on the running daemon') : `Removed ${folder} from "paths" on the running daemon.`);
    return output({ paths: Array.isArray(said?.paths) ? said.paths : [], ...(start === undefined ? {} : { startFolder: start }) }, '');
  };

  const write = (sub: 'add' | 'remove') => registry.action({
    id: `paths.${sub}`,
    summary: sub === 'add' ? 'Serve a folder' : 'Stop serving a folder',
    description: sub === 'add'
      ? 'The folder is added to "paths" in the configuration, so a daemon started from it serves the folder and everything under it. A folder that is already served, or that is under one that is, is left as it is. When the file names no "paths" and the daemon serves the folder it was started in, that folder is written too, so a restart still serves it. With no --config-file given, and with a record naming a daemon that serves the HTTP API, the change is sent to that daemon and applies at once.'
      : 'The folder is taken out of "paths" in the configuration, and every other key in the file is kept. The last folder cannot be removed, because a daemon that names none serves the folder it is started in. With no --config-file given, and with a record naming a daemon that serves the HTTP API, the change is sent to that daemon and applies at once.',
    surfaces: { cli: { pattern: ['paths', sub, ':folder'] }, http: { method: 'POST', path: `/paths/${sub}` } },
    /*
     * An add names a folder this creates; a remove takes one out of a list and
     * takes nothing off the disk, so it changes the row it names. That is also
     * why nothing asks before it runs.
     */
    effect: sub === 'add' ? 'add' : 'change',
    resource: { kind: 'folder', ...(sub === 'add' ? {} : { key: 'folder' }) },
    input: {
      // Served, the file is the daemon's own, so no field could name another.
      ...(served === undefined ? { configFile: serverFields.configFile } : {}),
      folder: { type: 'string', description: 'The folder, by path.' },
    },
    required: ['folder'],
    scopes: ['config:write'],
    // Which folders this host's agents read, edit and run in is a grant over
    // what every one of them can reach, so over HTTP it is the deployment's own
    // token and never a person.
    meta: { deploymentTokenOnly: 'add or remove a served folder' },
    run: async (context) => {
      const folder = resolve(context.value<string>('folder'));
      const named = context.optional<string>('configFile');
      const file = fileOf(named);
      // With a payload asked for, a line is a diagnostic and goes to stderr,
      // because stdout is the answer.
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      /*
       * A plain write meets the daemon where it is.
       *
       * With no `--config-file` the file to edit is this terminal's own, which
       * is the file a daemon started the same way reads - and that daemon serves
       * the change now, so it is sent one rather than a restart asked for. A
       * named file is a file to edit, so nothing is sent anywhere: what naming
       * one means is that this run edits that file and no other.
       *
       * Asked before the one-at-a-time chain is taken, because what that chain
       * orders is this process's writes to a file, and a forwarded change is not
       * one of them: the daemon's own chain orders the file it writes. Taken
       * first, this process's turn would be held while the daemon waits for its
       * own - which is what happens when the daemon is this same code in
       * another process only in name, as it is under a test.
       */
      if (served === undefined && named === undefined) {
        const sent = await forward(sub, folder, say);
        if (sent !== undefined) return sent;
      }
      return oneAtATime(async () => {
        /*
         * The file's own entries, read and written back whole: `paths` is what
         * this changes, and every other key in the file is the person's.
         */
        const held = readEntry(file);
        /*
         * A file with no `paths` and a daemon that serves its start folder: the
         * first add writes that folder too, so the file names what the daemon
         * serves, and a restart serves it still.
         */
        const start = sub === 'add' && pathsIn(held).length === 0 ? startFolderOf(named) : undefined;
        const paths = start === undefined ? pathsIn(held) : [start];
        const said = sub === 'add' ? addedLine(folder, start, `in ${file}`) : `Removed ${folder} from "paths" in ${file}.`;

        if (sub === 'add') {
          if (!existsSync(folder)) stop(`No folder at ${folder}.`);
          if (!statSync(folder).isDirectory()) stop(`${folder} is not a folder.`);
          const same = paths.find((one) => resolve(one) === folder);
          if (same !== undefined) {
            say(`${same} is already served.`);
            return output({ paths }, '');
          }
          const above = paths.find((one) => under(folder, one));
          if (above !== undefined) {
            say(`${folder} is under ${above}, which is served.`);
            return output({ paths }, '');
          }
          held['paths'] = [...paths, folder];
        }
        else {
          const at = paths.findIndex((one) => resolve(one) === folder);
          if (at === -1) stop(`${folder} is not in "paths" in ${file}.`);
          if (paths.length === 1) {
            stop(`The last folder in "paths" cannot be removed, because a daemon with no "paths" serves the folder it is started in.`);
          }
          held['paths'] = paths.filter((_one, index) => index !== at);
        }

        writeEntry(file, held);
        /*
         * Served, this daemon is the one serving now, and the folders it serves
         * are the array it was started with: the change is made in it, so `ahpd
         * status` shows the folder without a restart. The default folder, which
         * is the first of them, and the copy each plugin loaded are what the next
         * start moves. The record on disk is written too, because `ahpd status
         * --json` at the terminal reads the record and never the daemon: without
         * it that terminal would list the folders from before this change.
         */
        const live = served?.options.paths;
        if (live !== undefined) {
          const at = live.findIndex((one) => resolve(one) === folder);
          if (sub === 'remove') {
            if (at !== -1) live.splice(at, 1);
          }
          else if (at === -1) live.push(folder);
          rewritePaths(process.pid, live);
        }
        await served?.valuesMoved?.();
        say(said);
        const restart = restarting();
        if (restart) say(restartLine);
        return output({
          paths: pathsIn(held),
          // The start folder, when this add wrote it beside the new folder.
          ...(start === undefined ? {} : { startFolder: start }),
          ...(restart ? { restart: true } : {}),
        }, '');
      });
    },
  });

  return [list, write('add'), write('remove')];
};
