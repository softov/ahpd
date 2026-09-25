import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sdkVersion } from '@ahpd/sdk';
import type { ContainerConnect, ContainerConnectResult, ContainerPort, ContainerSink, PluginSpec } from '@ahpd/sdk';

/**
 * Dev containers, by the CLI that defines them.
 *
 * The launcher the `containers` port is: it makes the container a workspace's
 * own `devcontainer.json` asks for, starts a host inside it, and hands the
 * frames back and forth. Docker is what it reaches through; the file is what it
 * obeys, which is the difference between a dev container and a container -
 * decision `a-dev-container-is-made-by-the-dev-container-cli`.
 *
 * Everything here is a process, and nothing here is protocol: a line that is a
 * frame is handed to the sink, a line that is not is handed over as output, and
 * what a frame means is the SDK's to know.
 */

/** What a launcher can be told. All of it has a default. */
export interface DevContainerOptions {
  /** The CLI program. Default `devcontainer`. */
  command?: string;
  /** Arguments before the CLI's own verb, for a wrapper. */
  args?: string[];
  /** Environment for the CLI, on top of this process's. */
  env?: Record<string, string>;
  /** The Docker program, asked whether it is there. Default `docker`. */
  docker?: string;
  /**
   * How the host inside the container is started.
   *
   * The program and its arguments, before ours: `--stdio`, the workspace path
   * and the generated configuration are appended. It defaults to `ahpd`, which
   * is the command the install step below provides: a program that exists in
   * the container, rather than a resolution through `npx` on every start.
   */
  host?: string[];
  /**
   * How the host inside is installed when the image has not got one.
   *
   * A sentence is the command, and `false` says the image already has it or
   * `host` names something else entirely - a checkout mounted into the
   * container, for instance. Skipping the probe as well as the install is the
   * point: an operator who named `host` should not wait a minute for a package
   * nothing is going to run.
   */
  install?: string | false;
  /**
   * What the host inside loads, and the one option with no useful default.
   *
   * The host inside is an `ahpd` like this one, and it bundles no backend
   * either - decision `the-daemon-bundles-no-agent` - so a list with nothing
   * in it is a host that exits rather than one that serves files and shells.
   * `connect` refuses on an empty list instead of building a container for it.
   *
   * Not defaulted to this daemon's own list, tempting as that is: these
   * specs are resolved inside the container, where this host's configuration
   * directory does not exist and a relative path means a different tree.
   * What runs in there is a deployment fact, and the deployment says it.
   *
   * This is also the whole of cofold's answer: its loop runs in this process
   * and cannot be moved into a machine, so naming it here - where the *host*
   * is the thing inside the container - is the only way it runs in one.
   */
  plugins?: PluginSpec[];
  /** Lines worth keeping. Nothing is logged without one. */
  log?: (line: string) => void;
}

/** One line at a time, with the half of a line that has not arrived yet held. */
const lines = (handle: (line: string) => void): (chunk: string) => void => {
  let tail = '';
  return (chunk) => {
    tail += chunk;
    let at = tail.indexOf('\n');
    while (at !== -1) {
      handle(tail.slice(0, at).replace(/\r$/, ''));
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
  };
};

/** One shell word, quoted so a path with a space or a quote survives. */
const quote = (word: string): string => `'${word.replace(/'/g, `'\\''`)}'`;

/** The CLI's own result, from its last line that is one. */
export const parseUp = (stdout: string): { containerId: string; remoteWorkspaceFolder: string } | undefined => {
  const found = stdout.trim().split('\n').reverse();
  for (const line of found) {
    let held: unknown;
    try { held = JSON.parse(line); }
    catch { continue; }
    if (typeof held !== 'object' || held === null || Array.isArray(held)) continue;
    const one = held as Record<string, unknown>;
    // The CLI logs as it works, so the result is one line among many. What
    // makes it the result is the outcome and the two fields, not its position.
    if (one.outcome !== 'success' || typeof one.containerId !== 'string' || typeof one.remoteWorkspaceFolder !== 'string') continue;
    return { containerId: one.containerId, remoteWorkspaceFolder: one.remoteWorkspaceFolder };
  }
  return undefined;
};

/** Whether a folder is a dev container at all, by the CLI's own two names. */
export const hasDefinition = (folder: string): boolean =>
  existsSync(join(folder, '.devcontainer', 'devcontainer.json')) || existsSync(join(folder, '.devcontainer.json'));

/**
 * The launcher, as the port a host carries.
 *
 * Its per-connection state is one map: the CLI process in stdio mode whose
 * pipes are the relay's. Nothing else is remembered, because nothing else is
 * this host's - the container belongs to the CLI and the workspace.
 */
export const devContainer = (options: DevContainerOptions = {}): ContainerPort => {
  const command = options.command ?? 'devcontainer';
  const base = options.args ?? [];
  const docker = options.docker ?? 'docker';
  const env = options.env;
  const log = options.log ?? ((): void => { /* nothing is kept without one */ });
  const host = options.host ?? ['ahpd'];
  const install = options.install;
  const plugins = options.plugins ?? [];
  const live = new Map<string, ChildProcessWithoutNullStreams>();

  /** The CLI's own environment: this process's, plus whatever the caller named. */
  const where = (): Record<string, string> => ({ ...process.env, ...env }) as Record<string, string>;

  /**
   * Whether one program answers its version flag, asked once.
   *
   * `isDockerAvailable` is ungated - the reference client asks it before it can
   * ask for anything else - so anybody who completes a handshake could reach
   * this, and every call was a process. `available()` is worse: the host asks
   * it on every `initialize`, so two more spawns arrived with every client that
   * connected.
   *
   * Held for the life of the daemon rather than for a while, because the
   * question is whether a program is installed and a program does not appear
   * between two connections. It is not whether the Docker *daemon* is up: that
   * is answered by the command that needs it, which is `up`, and answered in
   * its own words. An operator who installs Docker beside a running daemon
   * restarts the daemon.
   */
  const asked = new Map<string, Promise<boolean>>();
  const there = (program: string, argv: string[]): Promise<boolean> => {
    const key = [program, ...argv].join('\u0000');
    const held = asked.get(key);
    if (held !== undefined) return held;
    const answer = new Promise<boolean>((resolve) => {
      const child = spawn(program, argv, { stdio: 'ignore', env: where() });
      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));
    });
    // Held before it settles, so calls that arrive together are one spawn.
    asked.set(key, answer);
    return answer;
  };

  /** One command, collected and streamed. */
  const run = (argv: string[], sink: ContainerSink): Promise<{ code: number; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      // Echoed first, as the reference does: a person watching a container
      // build should see the command whose output follows.
      sink.output(`$ ${[command, ...argv].map(quote).join(' ')}\n`);
      const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: where() });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); sink.output(String(chunk)); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); sink.output(String(chunk)); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });

  /** One command inside the container, by the CLI's own exec. */
  const inside = (folder: string, said: string, sink: ContainerSink) =>
    run([...base, 'exec', '--log-level', 'debug', '--workspace-folder', folder, '/bin/sh', '-c', said], sink);

  return {
    docker: async () => there(docker, ['--version']),

    /*
     * Whether this host can run a host inside a container at all.
     *
     * The backend list is asked first, and not only because it costs no
     * process: a deployment that named none could never start the host
     * inside, and a capability advertised over that is a flow a client offers
     * and every `connect` refuses. Said on the log rather than silently,
     * because an empty list is a configuration somebody can fix and Docker
     * being absent is not.
     */
    available: async () => {
      if (plugins.length === 0) {
        log('no devcontainer.plugins, so the host inside would have no backend: the capability is not advertised');
        return false;
      }
      return (await there(docker, ['--version'])) && (await there(command, [...base, '--version']));
    },

    connect: async (one: ContainerConnect, sink: ContainerSink): Promise<ContainerConnectResult> => {
      /*
       * Asked before anything is built, because `devcontainer up` is a minute
       * and this failure is knowable at the start: a host with no backend
       * exits on startup, and the relay would report that as a container that
       * closed rather than as a list nobody filled in.
       */
      if (plugins.length === 0) {
        throw new Error('The host inside the container would have no backend and would not start. Name at least one under the computer plugin\'s devcontainer.plugins - "@ahpd/agent-cofold" runs this way and no other');
      }
      if (!hasDefinition(one.workspaceFolder)) {
        throw new Error(`${one.workspaceFolder} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
      }
      const up = await run(
        [...base, 'up', '--log-level', 'debug', '--workspace-folder', one.workspaceFolder],
        sink,
      );
      const made = parseUp(up.stdout);
      if (made === undefined) {
        const said = [up.stdout.trim(), up.stderr.trim()].filter((one) => one !== '').join(' ');
        throw new Error(`The Dev Container CLI reported no container: ${said === '' ? `exit ${String(up.code)}` : said}`);
      }
      const remote = made.remoteWorkspaceFolder;

      /*
       * The host inside, put there if the image has not got one.
       *
       * Probed rather than assumed: an image built for this already has it,
       * and installing over it would be a version nobody chose. The version
       * installed is this build's own, so the two hosts are one build.
       */
      if (install !== false) {
        /*
         * The program that is actually going to run, not the default's name.
         *
         * This asked for `ahpd` however `host` was set, so a deployment that
         * names a checkout mounted into the container - `node /work/main.js` -
         * was told its image had no host and watched a package it will never
         * run being installed. The question is about `host[0]`, because that
         * is the program the line below starts.
         */
        const program = host[0] ?? 'ahpd';
        const present = await inside(one.workspaceFolder, `command -v ${quote(program)}`, sink);
        if (present.code !== 0) {
          /*
           * The published server, pinned to this build where that is knowable.
           *
           * `sdkVersion` reads the version of whatever package encloses it,
           * which is this repository's and moves with the server's. Where it
           * cannot be read it says `unknown`, and `@ahpd/server@unknown` is a
           * registry error about a version rather than about the install, so
           * an unknown version takes the published latest instead.
           */
          const version = sdkVersion();
          const line = install ?? `npm i -g @ahpd/server${version === 'unknown' ? '' : `@${version}`}`;
          const installed = await inside(one.workspaceFolder, line, sink);
          if (installed.code !== 0) {
            throw new Error(`The container has no ${program} and could not install one: ${installed.stderr.trim() || `exit ${String(installed.code)}`}. Give the image Node and npm, build it with @ahpd/server in it, or name the host it already has`);
          }
        }
      }

      /*
       * The configuration the nested host reads.
       *
       * Its own file, written owner-only, and a name nothing chose: the
       * connection's name is the client's, and a client's string in a shell
       * command is not a path. No credential goes in here - the relayed client
       * signs in to the host inside, which is where a credential for the
       * container's models belongs.
       */
      const config = {
        paths: [remote],
        sessions: 'memory',
        automations: 'memory',
        plugins,
      };
      const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
      const at = `/tmp/ahpd-nested-${randomUUID()}.json`;
      const written = await inside(one.workspaceFolder, `printf %s ${encoded} | base64 -d > ${quote(at)} && chmod 600 ${quote(at)}`, sink);
      if (written.code !== 0) {
        throw new Error(`The container could not be given the host's configuration: ${written.stderr.trim() || `exit ${String(written.code)}`}`);
      }

      /*
       * And the host itself, in stdio mode.
       *
       * Not a port and not a token: the CLI's exec carries this process's
       * pipes into the container, and the host inside answers on them -
       * decision `a-nested-host-speaks-stdio`.
       */
      const line = [...host, '--stdio', '--path', remote, '--config-file', at].map(quote).join(' ');
      const child = spawn(
        command,
        [...base, 'exec', '--log-level', 'debug', '--workspace-folder', one.workspaceFolder, '/bin/sh', '-c', line],
        { stdio: ['pipe', 'pipe', 'pipe'], env: where() },
      );
      live.set(one.connectionId, child);

      child.stdout.on('data', lines((said) => {
        if (said.trim() === '') return;
        // A frame is JSON; anything else is the CLI talking, and a person
        // watching the startup should see it rather than a parse error.
        try {
          const held: unknown = JSON.parse(said);
          if (typeof held === 'object' && held !== null && !Array.isArray(held)) { sink.message(said); return; }
        }
        catch { /* not a frame */ }
        sink.output(`${said}\n`);
      }));
      child.stderr.on('data', (chunk: Buffer) => { sink.output(String(chunk)); });
      const ended = (why?: string): void => {
        if (live.get(one.connectionId) !== child) return;
        live.delete(one.connectionId);
        log(`${one.connectionId} ended${why === undefined ? '' : `: ${why}`}`);
        sink.close(why);
      };
      child.once('error', (error) => { ended(error.message); });
      child.once('close', (code) => { ended(code === 0 || code === null ? undefined : `exit ${String(code)}`); });

      return {
        address: `devcontainer:${made.containerId}`,
        remoteWorkspaceFolder: remote,
        hostWorkspaceFolder: one.workspaceFolder,
      };
    },

    send: (connectionId: string, data: string): void => {
      const child = live.get(connectionId);
      // One frame per line, which is the transport the host inside speaks.
      child?.stdin.write(`${data}\n`);
    },

    disconnect: (connectionId: string): void => {
      const child = live.get(connectionId);
      if (child === undefined) return;
      // Asked to stop, and the ending is reported by the same path a crash
      // takes: the map is cleared there, so one end is reported once whether
      // the process was killed or died on its own. What a client is told about
      // it is the host's business, and the host has already forgotten a
      // connection the client itself asked to end.
      child.kill('SIGTERM');
    },
  };
};
