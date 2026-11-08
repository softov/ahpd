/**
 * A VM template: a disk with every part at `/opt/ahpd`, which a VM's disk
 * backs onto.
 *
 * The template is named by the joined image's hash, so a `versions.json` or an
 * ahpd checkout that moved is a new template, and a VM made after it backs onto
 * the new one. The parts come out of the joined image this host builds for a
 * runtime that cannot mount parts, so a VM and a container carry the same
 * files. `ensureTemplate` is the one place a template is made: a runtime gives
 * it the steps that boot and keep a VM, and nothing else knows the recipe.
 */

import { spawn } from 'node:child_process';
import { JOINED_PACKAGES } from './parts.js';
import type { SshReach } from './ssh.js';

/** What a template's name starts with; the rest is the joined image's hash. */
export const TEMPLATE_PREFIX = 'ahpd-template-';

/** The template a joined image's tag names. */
export const templateNameOf = (tag: string): string => `${TEMPLATE_PREFIX}${tag.slice(tag.lastIndexOf(':') + 1)}`;

/** What a template's helper VM is booted with beyond its login, so a VM has what a container has. */
export const TEMPLATE_PACKAGES = JOINED_PACKAGES.split(' ');

/** Where the parts come from. */
export interface TemplateParts {
  /** The joined image's tag, built here when it is not. */
  joined(): Promise<string>;
  /** `/opt/ahpd` out of the image at `tag`, written into one reached VM. */
  into(tag: string, reach: SshReach): Promise<void>;
}

/** What one runtime does on one server for a template. */
export interface TemplateSteps {
  /** The templates on the server, by name. */
  templates(): Promise<string[]>;
  /**
   * A helper VM whose disk becomes the template `name`, booted from the cloud
   * image with this host's key, and reached once cloud-init is done.
   */
  boot(name: string): Promise<SshReach>;
  /** The helper shut down and gone, with its disk kept as the template. */
  keep(name: string): Promise<void>;
  /** The helper and its disk removed, whatever of them there is: an older template among them. */
  drop(name: string): Promise<void>;
  /** The templates a VM on the server backs onto. */
  backed(): Promise<string[]>;
}

/**
 * When each older template was first found with no VM backing onto it, by
 * server and name, kept beside the configuration so a restart does not start
 * the week again.
 */
export interface TemplateLedger {
  read(): Record<string, number>;
  write(held: Record<string, number>): void;
}

/**
 * How long an older template no VM backs onto is kept, as VS Code keeps a
 * cached version the product no longer asks for a week after its last use.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkCache.ts#L17-L22
 */
export const TEMPLATE_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** What a VM made from a template must not inherit from the helper: its instance and its logs. */
const SEAL = ['sudo', 'cloud-init', 'clean', '--logs', '--machine-id'];

/**
 * The function that makes a server's template once, by name.
 *
 * Two VMs asked for at once on a server with no template build it once: the
 * second waits for the first one's build. An older template is kept while a
 * VM backs onto it, and removed once none has for `TEMPLATE_KEPT_MS`, swept
 * each time a VM is made on the server, as VS Code removes a cached version
 * unused for a week.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSdkCache.ts#L30-L78
 */
export const templateMaker = (parts: TemplateParts, log?: (line: string) => void, ledger?: TemplateLedger) => {
  const building = new Map<string, Promise<string>>();

  /** The server's older templates, each removed a week after it was first found with no VM. */
  const sweep = async (server: string, steps: TemplateSteps, name: string, there: readonly string[]): Promise<void> => {
    const old = there.filter((one) => one.startsWith(TEMPLATE_PREFIX) && one !== name);
    if (old.length === 0) return;
    const backed = new Set(await steps.backed());
    const held = ledger?.read() ?? {};
    const now = Date.now();
    for (const one of old) {
      const key = `${server}\n${one}`;
      if (backed.has(one)) {
        delete held[key];
        continue;
      }
      held[key] ??= now;
      if (now - (held[key] ?? now) < TEMPLATE_KEPT_MS) continue;
      try {
        await steps.drop(one);
        delete held[key];
        log?.(`${server} removed the template ${one}, which no VM has backed onto for over a week`);
      }
      catch (error) {
        log?.(`${server} did not remove the template ${one}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    ledger?.write(held);
  };

  return async (server: string, steps: TemplateSteps): Promise<string> => {
    const tag = await parts.joined();
    const name = templateNameOf(tag);
    const key = `${server}\n${name}`;
    const held = building.get(key);
    if (held !== undefined) return held;
    const made = (async () => {
      const there = await steps.templates();
      if (there.includes(name)) {
        await sweep(server, steps, name, there).catch(() => { /* swept again with the next VM */ });
        return name;
      }
      try {
        const reach = await steps.boot(name);
        await parts.into(tag, reach);
        const sealed = await reach.ran(SEAL);
        if (sealed.code !== 0) throw new Error(`cloud-init clean exited ${String(sealed.code)}: ${sealed.stderr.trim()}`);
        await steps.keep(name);
      }
      catch (error) {
        await steps.drop(name).catch((gone: unknown) => {
          log?.(`the helper for ${name} on ${server} was not removed: ${gone instanceof Error ? gone.message : String(gone)}`);
        });
        throw new Error(`The template ${name} was not made on ${server}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sweep(server, steps, name, there).catch(() => { /* swept again with the next VM */ });
      return name;
    })();
    building.set(key, made);
    try {
      return await made;
    }
    finally {
      building.delete(key);
    }
  };
};

/** The `docker` program this host builds the joined image with. */
export interface DockerProgram {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** One `docker` call's exit code, stdout and stderr, with nothing on its stdin. */
const docker = (program: DockerProgram, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(program.command, [...program.args ?? [], ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...program.env ?? {} },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => { resolve({ code: code ?? 0, stdout, stderr }); });
  });

/**
 * The parts, out of this host's joined image.
 *
 * `docker cp` writes `/opt/ahpd` as a tar on its stdout, which goes straight
 * onto the stdin of a `tar` in the VM: nothing is written on this host, and a
 * few gigabytes of parts are never held in memory.
 */
export const partsFromDocker = (program: DockerProgram, joined: () => Promise<string>): TemplateParts => ({
  joined,
  into: async (tag, reach) => {
    const created = await docker(program, ['create', tag]);
    if (created.code !== 0) throw new Error(`docker create ${tag} exited ${String(created.code)}: ${created.stderr.trim()}`);
    const id = created.stdout.trim();
    try {
      const copy = spawn(program.command, [...program.args ?? [], 'cp', `${id}:/opt/ahpd`, '-'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...program.env ?? {} },
        windowsHide: true,
      });
      let stderr = '';
      copy.stderr.setEncoding('utf8');
      copy.stderr.on('data', (chunk: string) => { stderr += chunk; });
      const copied = new Promise<number>((resolve, reject) => {
        copy.on('error', reject);
        copy.on('close', (code) => { resolve(code ?? 0); });
      });
      const [written, code] = await Promise.all([reach.ran(['sudo', 'tar', '-x', '-C', '/opt'], copy.stdout), copied]);
      if (code !== 0) throw new Error(`docker cp out of ${tag} exited ${String(code)}: ${stderr.trim()}`);
      if (written.code !== 0) throw new Error(`tar in the VM exited ${String(written.code)}: ${written.stderr.trim()}`);
    }
    finally {
      await docker(program, ['rm', '-f', id]);
    }
  },
});
