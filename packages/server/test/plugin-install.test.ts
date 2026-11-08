import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { fittingVersion, installPlugins, isPackageName, launch, packageOf, pinned, removePlugins, run as realRun, updatePlugins } from '../src/install.js';
import type { Ran, Runner } from '../src/install.js';
import { registry } from '../src/update.js';
import type { Fetch } from '../src/update.js';

/*
 * `ahpd plugin install` and `ahpd plugin remove`, without npm.
 *
 * Every case here is about the two things this command owns: the argument
 * list npm is given, and the edit `config.json` gets. The runner is a fake, so
 * no case needs a registry, a network or a package, and the configuration is a
 * temporary directory rather than the one this machine would write.
 */

let root: string;
let configDir: string;
let configFile: string;
let hadRoot: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-install-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
  hadRoot = process.env.AHPD_PLUGIN_ROOT;
  delete process.env.AHPD_PLUGIN_ROOT;
});
afterEach(() => {
  if (hadRoot === undefined) delete process.env.AHPD_PLUGIN_ROOT; else process.env.AHPD_PLUGIN_ROOT = hadRoot;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A package name the registry has, as `installPlugins` recognises one, so the
 * fake lands a manifest only for the sources npm resolves that way. A path, a
 * URL or a git spec is named by what `added` says it became.
 */
const registryName = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/**
 * A runner that records every call and lets a verb fail. `lands` is what an
 * install leaves in `node_modules`, as a package name and its version.
 *
 * `answers` is keyed by the program's verb, or by the last argument, so a case
 * can fail the one package of an update, which gets a call of its own. The
 * packages land where the call's own `--prefix` says, which is what npm does: a
 * case that moves the root sees them under the root.
 *
 * `added` is what npm writes into the root's `package.json` dependencies, which
 * is how an install of a source learns what npm called the package; `manifests`
 * is what each landed `package.json` says besides its name and version, so a
 * case can land one with an `ahpd` field and one without.
 *
 * An install's own sources land too, as npm leaves them: every registry name
 * after the `--` gets a manifest with an `ahpd` field, because npm really does
 * put one in `node_modules`. An update's argv has no `--`, so its cases land
 * only what `lands` names and a package npm did not move stays where it was.
 */
const fake = (
  answers: Record<string, Ran> = {},
  lands: Record<string, string> = {},
  options: { added?: Record<string, string>; manifests?: Record<string, Record<string, unknown>> } = {},
) => {
  const calls: { program: string; argv: string[] }[] = [];
  const runner: Runner = async (program, argv) => {
    calls.push({ program, argv: [...argv] });
    const answer = answers[argv[0] ?? ''] ?? answers[argv.at(-1) ?? ''] ?? { code: 0, stdout: '', stderr: '' };
    const at = argv.indexOf('--prefix');
    if (argv[0] === 'install' && answer.code === 0 && at !== -1) {
      const into = argv[at + 1] as string;
      const landed = new Map(Object.entries(lands));
      const sources = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
      for (const source of sources) {
        const name = packageOf(source);
        if (!registryName.test(name) || landed.has(name)) continue;
        landed.set(name, source.slice(name.length + 1) || '0.1.0');
      }
      for (const [name, version] of landed) {
        mkdirSync(join(into, 'node_modules', name), { recursive: true });
        // A manifest this case names is written as it is; one the fake lands on
        // its own is a plugin, which is what a registry install leaves behind.
        const said = options.manifests?.[name];
        writeFileSync(join(into, 'node_modules', name, 'package.json'), JSON.stringify({
          name,
          version,
          ...(said === undefined ? { ahpd: { entry: './index.js' } } : said),
        }));
      }
      if (options.added !== undefined) {
        const file = join(into, 'package.json');
        const held = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
        const dependencies = typeof held.dependencies === 'object' && held.dependencies !== null
          ? held.dependencies as Record<string, string>
          : {};
        held.dependencies = { ...dependencies, ...options.added };
        writeFileSync(file, `${JSON.stringify(held, null, 2)}\n`);
      }
    }
    return answer;
  };
  return { runner, calls };
};

/**
 * A registry that has every name it is asked about, at one version, `0.1.0`,
 * whose manifest carries an `ahpd` field and declares no `@ahpd/sdk` range, so
 * every daemon is admitted. A path that names a version or a tag is that
 * version's manifest; a path that is only a name is the package's metadata.
 */
const aPlugin: Fetch = async (url) => {
  const path = String(url).slice(registry().length + 1);
  return path.includes('/')
    ? Response.json({ version: '0.1.0', ahpd: { entry: './dist/index.js' } })
    : Response.json(packument(['0.1.0']));
};

/**
 * A registry with the manifests given, by the path after the registry's base:
 * an object is a manifest, `404` is a missing version, and an `Error` is a
 * request that never answered. Every path asked is recorded.
 */
const fakeRegistry = (answers: Record<string, object | 404 | Error>) => {
  const asked: string[] = [];
  const fetch: Fetch = async (url) => {
    const path = String(url).slice(registry().length + 1);
    asked.push(path);
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    if (answer === undefined || answer === 404) return new Response('{"error":"Not found"}', { status: 404 });
    return Response.json(answer);
  };
  return { fetch, asked };
};

/**
 * A package's abbreviated metadata for `fakeRegistry`: each version written as
 * `<version>` or `<version> <@ahpd/sdk peer range>`, and `latest` naming the
 * version the publisher calls current, which is the last one given.
 */
const packument = (versions: string[], latest: string = versions.at(-1) as string): object => ({
  'dist-tags': { latest },
  versions: Object.fromEntries(versions.map((held) => {
    const [version, range] = held.split(' ');
    return [version as string, range === undefined ? {} : { peerDependencies: { '@ahpd/sdk': range } }];
  })),
});

const said: string[] = [];
const say = (line: string): void => { said.push(line); };

const write = (held: unknown): void => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`);
};
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;

/*
 * Starting npm as the Node the daemon runs under, which on Windows is also how
 * npm's `.cmd` is avoided.
 *
 * The cases drive the pure function with the platform, the environment and the
 * paths a machine would have, because the build runs on Linux and the spawn
 * itself is the one part of this that a machine here cannot hold.
 */

it('starts a program other than npm by its name with the arguments unchanged', () => {
  // Only npm is a `.cmd` on Windows; `git`, `gh` and `ssh` are `.exe` files, and
  // a shell would only be one more thing between the daemon and the program.
  const env = { npm_execpath: 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' };
  expect(launch('git', ['status'], 'win32', env, 'C:\\nodejs\\node.exe', () => false))
    .toEqual({ command: 'git', args: ['status'], shell: false });
  expect(launch('git', ['status'], 'linux', {}, '/usr/bin/node', () => true))
    .toEqual({ command: 'git', args: ['status'], shell: false });
});

it('starts npm as node with the npm-cli.js beside it, on Linux', () => {
  // A Node from a version manager keeps its npm beside it, and that npm is the
  // one to run, not the first `npm` on the PATH.
  const node = '/home/softov/.nvm/versions/node/v22.18.0/bin/node';
  const cli = '/home/softov/.nvm/versions/node/v22.18.0/lib/node_modules/npm/bin/npm-cli.js';
  expect(launch('npm', ['install', '--prefix', '/tmp/ahpd'], 'linux', {}, node, (at) => at === cli))
    .toEqual({ command: node, args: [cli, 'install', '--prefix', '/tmp/ahpd'], shell: false });
});

it('takes the npm-cli.js beside node when npm named another program, on macOS', () => {
  const node = '/opt/homebrew/Cellar/node/22.18.0/bin/node';
  const cli = '/opt/homebrew/Cellar/node/22.18.0/lib/node_modules/npm/bin/npm-cli.js';
  const env = { npm_execpath: '/Users/softov/Library/pnpm/pnpm.cjs' };
  expect(launch('npm', ['install'], 'darwin', env, node, (at) => at === cli))
    .toEqual({ command: node, args: [cli, 'install'], shell: false });
});

it('starts npm by its name, with no shell, when no npm-cli.js is there, on Linux', () => {
  // A distribution's Node keeps npm in a folder of its own.
  expect(launch('npm', ['install', '--prefix', '/tmp/ahpd'], 'linux', {}, '/usr/bin/node', () => false))
    .toEqual({ command: 'npm', args: ['install', '--prefix', '/tmp/ahpd'], shell: false });
});

it('starts npm by its name when the daemon runs under Bun, on Linux', () => {
  // Bun beside a Node install would find that Node's npm-cli.js, which Bun is
  // not the Node to run.
  expect(launch('npm', ['install'], 'linux', {}, '/usr/local/bin/bun', () => true))
    .toEqual({ command: 'npm', args: ['install'], shell: false });
});

it('starts npm as node with the npm-cli.js npm names, on Windows', () => {
  const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  // The script is where npm says it is, so nothing is looked for beside node.
  expect(launch('npm', ['install', 'left-pad'], 'win32', { npm_execpath: cli }, 'C:\\Program Files\\nodejs\\node.exe', (at) => at === cli))
    .toEqual({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [cli, 'install', 'left-pad'], shell: false });
});

it('takes the npm-cli.js beside node when npm named another program, on Windows', () => {
  // A daemon started by pnpm is told pnpm's own script, which is not npm's.
  const beside = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const env = { npm_execpath: 'C:\\Users\\softov\\AppData\\Roaming\\npm\\pnpm.cjs' };
  expect(launch('npm', ['install'], 'win32', env, 'C:\\Program Files\\nodejs\\node.exe', (at) => at === beside))
    .toEqual({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [beside, 'install'], shell: false });
});

it('runs npm through the shell, with each argument in double quotes, when no npm-cli.js is there', () => {
  // A version manager's Node keeps npm in its own folder, so neither path is
  // there: `npm` goes to the shell, and the shell is what splits the line.
  const env = { npm_execpath: 'C:\\Users\\softov\\AppData\\Roaming\\npm\\pnpm.cjs' };
  expect(launch('npm', ['install', '--prefix', 'C:\\Program Files\\ahpd'], 'win32', env, 'C:\\nodejs\\node.exe', () => false))
    .toEqual({ command: 'npm', args: ['"install"', '"--prefix"', '"C:\\Program Files\\ahpd"'], shell: true });
});

it('pins the sdk to the daemon\'s version, which is the one name ahpd pins', () => {
  // The daemon owns `@ahpd/sdk` and installs it beside every plugin, whatever
  // range a plugin declares; a version or tag written on it is the writer's.
  expect(pinned('@ahpd/sdk', '9.9.9')).toBe('@ahpd/sdk@9.9.9');
  expect(pinned('@ahpd/sdk@1', '9.9.9')).toBe('@ahpd/sdk@1');
  // An unknown version is left for npm's own `latest` rather than becoming
  // `@unknown`.
  expect(pinned('@ahpd/sdk', 'unknown')).toBe('@ahpd/sdk');
});

/*
 * Choosing a plugin's version: what the package declares it works with decides
 * it, not the version number it carries and not the daemon's own version.
 */
it('chooses the version whose sdk range admits this daemon', async () => {
  const { fetch, asked } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
  // One request, for the package's own metadata, at the registry's own path
  // for a scoped name.
  expect(asked).toEqual(['@ahpd%2fweb']);
});

it('asks for the abbreviated packument, not the whole one', async () => {
  const accepts: string[] = [];
  const fetch: Fetch = async (_url, init) => {
    accepts.push((init?.headers as Record<string, string> | undefined)?.accept ?? '');
    return Response.json(packument(['0.1.0 >=0.9']));
  };
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
  expect(accepts).toEqual(['application/vnd.npm.install-v1+json']);
});

it('takes the newest version that admits the daemon, over one published ahead of it', async () => {
  // The newest version asks for an sdk this daemon is not yet, so the newest
  // one that does not is the one to install.
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 >=0.10', '0.3.0 >=0.11']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.2.0');
});

it('never chooses a prerelease', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.2.0-beta.1 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

it('never chooses a version above the one the publisher calls latest', async () => {
  // A publisher who moved `latest` back chose the newest version to install.
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.3.0 >=0.9'], '0.1.0') });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

it('chooses a version that declares no sdk range, which the loader loads unchecked', async () => {
  const { fetch } = fakeRegistry({ 'left-pad': packument(['1.3.0']) });
  expect(await fittingVersion('left-pad', '0.10.0', { fetch })).toBe('1.3.0');
});

it('skips a version whose range this daemon cannot read, as the loader would refuse it', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 ~>0.9', '0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

it('chooses no version when the registry does not answer', async () => {
  const { fetch, asked } = fakeRegistry({
    'offline': new TypeError('fetch failed'),
    'missing': 404,
    'not-a-packument': { name: 'not-a-packument', 'dist-tags': { latest: '1.0.0' } },
  });
  expect(await fittingVersion('offline', '0.10.0', { fetch })).toBeUndefined();
  expect(await fittingVersion('missing', '0.10.0', { fetch })).toBeUndefined();
  expect(await fittingVersion('not-a-packument', '0.10.0', { fetch })).toBeUndefined();
  expect(asked).toEqual(['offline', 'missing', 'not-a-packument']);
});

it('chooses no version when the daemon\'s own version is unknown, and asks nothing', async () => {
  // Nothing can be compared against `unknown`, so npm's own `latest` decides.
  const { fetch, asked } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', 'unknown', { fetch })).toBeUndefined();
  expect(asked).toEqual([]);
});

it('refuses a package with no version that admits the daemon, naming the newest range', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 >=0.11', '0.3.0 >=0.11']) });
  await expect(fittingVersion('@ahpd/web', '0.10.0', { fetch }))
    .rejects.toThrow('@ahpd/web has no version that admits @ahpd/sdk 0.10.0: its newest, 0.3.0, needs >=0.11.');
});

it('recognises the specs it can install and refuses the rest', () => {
  expect(isPackageName('@ahpd/agent-claude')).toBe(true);
  expect(isPackageName({ name: '@ahpd/agent-claude', enabled: false })).toBe(true);
  // A path is used as written and a scheme is the runtime's to resolve.
  expect(isPackageName('./my-plugin')).toBe(false);
  expect(isPackageName('../my-plugin')).toBe(false);
  expect(isPackageName('/opt/my-plugin')).toBe(false);
  expect(isPackageName('npm:@ahpd/agent-claude')).toBe(false);
  expect(isPackageName('https://example.test/plugin.js')).toBe(false);
});

it('installs into the configuration directory and names the packages there', async () => {
  // Nothing sets the root outside the ahpd part, so this is the one place a
  // plugin lands when the variable is absent.
  expect(process.env.AHPD_PLUGIN_ROOT).toBeUndefined();
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-claude', 'left-pad@1'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  });

  const install = calls.find((one) => one.argv[0] === 'install');
  expect(install?.program).toBe('npm');
  // No `--allow-scripts`: npm 12 refuses that flag on a project-scoped
  // install, and the only thing it would have built here is the SDK's
  // optional node-pty, which the daemon gets from its own global install.
  expect(install?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@9.9.9',
    '--', '@ahpd/agent-claude@0.1.0', 'left-pad@1',
  ]);
  // The list holds package names, which is what the loader resolves: a
  // version or tag belongs to the install and would read back as missing.
  expect(read().plugins).toEqual(['@ahpd/agent-claude', 'left-pad']);
  expect(said.join('\n')).toContain(configDir);
});

it('installs into the plugin root when the variable is set, and still configures the daemon', async () => {
  // Inside the ahpd part the config dir is not writable and every plugin has to
  // be somewhere the part's launcher will point `ahpd plugin install` at.
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-cofold'], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  });

  expect(calls.find((one) => one.argv[0] === 'install')?.argv)
    .toEqual(['install', '--prefix', pluginRoot, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '--', '@ahpd/agent-cofold@0.1.0']);
  expect(existsSync(pluginRoot)).toBe(true);
  expect(said.join('\n')).toContain(pluginRoot);
  // The root moves where the packages land and nothing else: the configuration
  // file is still the daemon's own, in its own directory.
  expect(read().plugins).toEqual(['@ahpd/agent-cofold']);
  expect(configFile.startsWith(configDir)).toBe(true);
});

it('names a scoped package without the version it was installed at', async () => {
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, version: '9.9.9', enable: true, run: runner, fetch: aPlugin, say });
  expect(calls.find((one) => one.argv[0] === 'install')?.argv.at(-1)).toBe('@ahpd/agent-acp@0.7.0');
  expect(read().plugins).toEqual(['@ahpd/agent-acp']);
});

it('removes a name given with a version', async () => {
  write({ plugins: ['@ahpd/agent-acp'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv.at(-1)).toBe('@ahpd/agent-acp');
});

it('installs a source npm resolves, and names it by the package npm wrote', async () => {
  // A `github:` spec is npm's to resolve, so nothing asks the registry and npm
  // is handed the source as it was written. What `plugins` names is the
  // dependency npm added for it, which is the name the loader resolves.
  const { runner, calls } = fake({}, { demo: '0.1.0' }, {
    added: { demo: 'github:someone/demo' },
    manifests: { demo: { ahpd: { entry: './index.js' } } },
  });
  expect(await installPlugins(['github:someone/demo'], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(calls.find((one) => one.argv[0] === 'install')?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '--', 'github:someone/demo',
  ]);
  expect(read().plugins).toEqual(['demo']);
});

it('takes a path and a tarball URL the same way, naming each by what npm added', async () => {
  // npm writes a path as a `file:` spec beside the root, which is resolved
  // back to the path it was given; a URL is written as it was given.
  const plugin = join(root, 'my-plugin');
  const tarball = 'https://example.test/tools/demo.tgz';
  const { runner, calls } = fake({}, { demo: '0.1.0', other: '0.2.0' }, {
    added: { demo: 'file:../my-plugin', other: tarball },
    manifests: { demo: { ahpd: {} }, other: { ahpd: {} } },
  });
  expect(await installPlugins([plugin, tarball], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo', 'other']);
  expect(calls.find((one) => one.argv[0] === 'install')?.argv.slice(-2)).toEqual([plugin, tarball]);
  expect(read().plugins).toEqual(['demo', 'other']);
});

it('names a path by what npm added when the root is reached through a symbolic link', async () => {
  // npm writes the `file:` spec from the root's real path, so it climbs out of
  // the folder the link points at. The sdk pin is added beside it, as npm adds
  // it on a first install, so the path is named by its spec and not by being
  // the one dependency added.
  const real = join(root, 'deep', 'er', 'ahpd');
  mkdirSync(real, { recursive: true });
  // A junction on Windows, which links a folder with no privilege and resolves as a link does.
  symlinkSync(real, configDir, posix ? 'dir' : 'junction');
  const plugin = join(root, 'my-plugin');
  mkdirSync(plugin);
  const { runner } = fake({}, { demo: '0.1.0' }, {
    added: { '@ahpd/sdk': '^0.8.0', demo: 'file:../../../my-plugin' },
    manifests: { demo: { ahpd: {} } },
  });
  expect(await installPlugins([plugin], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(read().plugins).toEqual(['demo']);
});

it('names a path by what npm added when the path goes through a symbolic link', async () => {
  // npm takes a folder's real path before it writes the spec, so a path given
  // through a link is written as the folder the link points at.
  const away = join(root, 'deep', 'er');
  mkdirSync(join(away, 'my-plugin'), { recursive: true });
  symlinkSync(away, join(root, 'link'), posix ? 'dir' : 'junction');
  const { runner } = fake({}, { demo: '0.1.0' }, {
    added: { '@ahpd/sdk': '^0.8.0', demo: 'file:../deep/er/my-plugin' },
    manifests: { demo: { ahpd: {} } },
  });
  expect(await installPlugins([join(root, 'link', 'my-plugin')], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(read().plugins).toEqual(['demo']);
});

it('uninstalls and refuses a source whose package has no ahpd field', async () => {
  // The registry cannot be asked about a source, so what npm landed is what
  // decides: a package that is not an ahpd plugin goes out again, and nothing
  // is written into `plugins`.
  const { runner, calls } = fake({}, { demo: '0.1.0' }, {
    added: { demo: 'github:someone/demo' },
    manifests: { demo: { bin: { demo: './dist/main.js' } } },
  });
  await expect(installPlugins(['github:someone/demo'], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('demo is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls.map((one) => one.argv[0])).toEqual(['install', 'uninstall']);
  expect(calls[1]?.argv).toEqual(['uninstall', '--prefix', configDir, '--', 'demo']);
  expect(existsSync(configFile)).toBe(false);
});

it('uninstalls and refuses a source whose package landed no manifest at all', async () => {
  // npm succeeded and wrote a dependency, but no `node_modules/<name>/package.json`
  // is there: nothing was landed, or npm could not write what it landed. There
  // is no `ahpd` field to read either, so the source is refused as the one with
  // no field is, and the package npm named is taken out again.
  const { runner, calls } = fake({}, {}, { added: { demo: 'github:someone/demo' } });
  await expect(installPlugins(['github:someone/demo'], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('demo is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls.map((one) => one.argv[0])).toEqual(['install', 'uninstall']);
  expect(calls[1]?.argv).toEqual(['uninstall', '--prefix', configDir, '--', 'demo']);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses a source that would be read by npm as an option, before npm runs', async () => {
  // `--prefix=/x` is a source only in appearance: npm would take it as an
  // option, so it never reaches npm, and nothing is written anywhere.
  const { runner, calls } = fake();
  await expect(installPlugins(['--prefix=/x'], {
    configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('--prefix=/x is not a source to install: a source that starts with "-" would be read by npm as an option.');
  expect(calls).toEqual([]);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses to remove a name that would be read by npm as an option, before npm runs', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await expect(removePlugins(['--prefix=/x'], { configDir, configFile, uninstall: true, run: runner, say }))
    .rejects.toThrow('--prefix=/x is not a plugin to remove: a name that starts with "-" would be read by npm as an option.');
  expect(calls).toEqual([]);
  expect(read().plugins).toEqual(['@ahpd/a']);
});

it('adds a name once, and keeps every other key and entry', async () => {
  write({ port: 1234, plugins: ['@ahpd/existing', { name: '@ahpd/configured', options: { token: 'shh' } }] });
  const { runner } = fake();
  await installPlugins(['@ahpd/existing', '@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  });

  const held = read();
  expect(held.port).toBe(1234);
  // The object entry keeps its options, and the name already there is not
  // replaced by a bare string.
  expect(held.plugins).toEqual([
    '@ahpd/existing',
    { name: '@ahpd/configured', options: { token: 'shh' } },
    '@ahpd/agent-claude',
  ]);
  // Two-space JSON with a trailing newline, the shape every other writer uses.
  const text = readFileSync(configFile, 'utf8');
  expect(text).toContain('\n  "port": 1234');
  expect(text.endsWith('\n')).toBe(true);

  // A second install of the same name changes nothing, file included.
  await installPlugins(['@ahpd/agent-claude'], { configDir, configFile, version: '9.9.9', enable: true, run: runner, fetch: aPlugin, say });
  expect(readFileSync(configFile, 'utf8')).toBe(text);
});

it('leaves the configuration alone with --no-enable', async () => {
  write({ plugins: ['@ahpd/other'] });
  const before = readFileSync(configFile, 'utf8');
  const { runner } = fake();
  await installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(readFileSync(configFile, 'utf8')).toBe(before);
  // And one that is not there is not created, which is what the container
  // install relies on.
  rmSync(configFile);
  await installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(existsSync(configFile)).toBe(false);
});

it('removes a string entry and an object entry, then uninstalls them', async () => {
  write({ port: 1234, plugins: ['@ahpd/a', { name: '@ahpd/b', options: { x: 1 } }, '@ahpd/c'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a', '@ahpd/b'], { configDir, configFile, uninstall: true, run: runner, say });

  expect(read().plugins).toEqual(['@ahpd/c']);
  expect(read().port).toBe(1234);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv)
    .toEqual(['uninstall', '--prefix', configDir, '--', '@ahpd/a', '@ahpd/b']);
});

it('drops the name with --keep but leaves the package installed', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a'], { configDir, configFile, uninstall: false, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls).toEqual([]);
});

it('refuses with npm\'s own words when the install fails', async () => {
  const { runner } = fake({ install: { code: 1, stdout: '', stderr: 'E404 no such package' } });
  await expect(installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow(/@ahpd\/agent-claude: E404 no such package/);
  // Nothing was named, because nothing was installed.
  expect(existsSync(configFile)).toBe(false);
});

/*
 * npm can be loud, and what it says is the reason a person is reading the line
 * it is on. The copy the caller gets is the whole of it, whatever its size.
 */
it('streams more from npm than one buffer holds', async () => {
  const real = process.stderr.write;
  let heard = '';
  process.stderr.write = ((chunk: string | Uint8Array) => { heard += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    const done = await realRun('node', ['-e', 'process.stderr.write("x".repeat(2 * 1024 * 1024))']);
    expect(done.code).toBe(0);
    expect(done.stderr.length).toBe(2 * 1024 * 1024);
    expect(heard.length).toBe(2 * 1024 * 1024);
  }
  finally {
    process.stderr.write = real;
  }
}, 30000);

/** A plugin root as npm leaves it: `package.json` and each package's own. */
const installed = (packages: Record<string, string>, dir: string = configDir): void => {
  mkdirSync(dir, { recursive: true });
  const dependencies = Object.fromEntries(Object.entries(packages).map(([name, version]) => [name, `^${version}`]));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`);
  for (const [name, version] of Object.entries(packages)) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
};

/**
 * A registry that holds one version of each package named, written as
 * `<version> <@ahpd/sdk range>`; a package left out is one it does not have.
 * That one version is the only one there is, so it is also `latest`.
 */
const registryHolding = (packages: Record<string, string>): Fetch => fakeRegistry(Object.fromEntries(
  Object.entries(packages).map(([name, held]) => [name.replace('/', '%2f'), packument([held])]),
)).fetch;

// VS Code's update of every extension answers each on its own
// (extensionsWorkbenchService.ts L2088-L2105, abstractExtensionManagementService.ts
// L193-L215 at 6b68d3fe).
it('updates every installed package in an npm call of its own, each to the newest version that fits it', async () => {
  installed({
    '@ahpd/agent-acp': '0.7.0',
    '@ahpd/agent-claude': '0.7.0',
    '@ahpd/agent-cofold': '0.7.0',
    '@ahpd/computer': '0.7.0',
    'left-pad': '1.0.0',
  });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-acp': '0.8.0', 'left-pad': '1.3.0' });
  await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say,
    fetch: registryHolding({
      '@ahpd/agent-acp': '0.8.0 >=0.8',
      '@ahpd/agent-claude': '0.8.0 >=0.8',
      '@ahpd/agent-cofold': '0.8.0 >=0.8',
      '@ahpd/computer': '0.8.0 >=0.8',
      // A package outside this project is chosen by the same rule, its range
      // included, and one that declares none is admitted as it is.
      'left-pad': '1.3.0',
    }),
  });

  const each = ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0'];
  expect(calls).toEqual([
    { program: 'npm', argv: [...each, '@ahpd/agent-acp@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/agent-claude@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/agent-cofold@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/computer@0.8.0'] },
    { program: 'npm', argv: [...each, 'left-pad@1.3.0'] },
  ]);
  // Each move, from the version that was installed to the one npm left, and
  // nothing for a package npm did not move.
  expect(said).toContain('@ahpd/agent-acp: 0.7.0 to 0.8.0');
  expect(said).toContain('left-pad: 1.0.0 to 1.3.0');
  expect(said.filter((line) => line.startsWith('@ahpd/agent-claude:'))).toEqual([]);
});

it('moves a plugin published on its own schedule to the version its own range admits', async () => {
  // The case this rule comes from: `@ahpd/web` is released on its own, at a
  // version that asks for an sdk the daemon already is.
  installed({ '@ahpd/web': '0.1.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/web': '0.2.0', 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', {
    configDir, version: '0.10.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/web': '0.2.0 >=0.9', 'left-pad': '1.3.0' }),
  })).toEqual([{ name: '@ahpd/web', from: '0.1.0', to: '0.2.0' }, { name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['@ahpd/web@0.2.0', 'left-pad@1.3.0']);
  expect(calls[0]?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.10.0', '@ahpd/web@0.2.0',
  ]);
});

it('says a package with no version that fits, leaves it, and moves the others', async () => {
  installed({ '@ahpd/web': '0.1.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', {
    configDir, version: '0.10.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/web': '0.3.0 >=0.11', 'left-pad': '1.3.0' }),
  })).toEqual([{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(said).toEqual([
    '@ahpd/web has no version that admits @ahpd/sdk 0.10.0: its newest, 0.3.0, needs >=0.11.',
    'Updating left-pad@1.3.0 with npm.',
    'left-pad: 1.0.0 to 1.3.0',
  ]);
  // Only the package that can move is asked of npm.
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad@1.3.0']);
});

it('moves a package to latest when the registry cannot say which version fits', async () => {
  installed({ 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', { configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .toEqual([{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad@latest']);
});

it('runs no npm when nothing is installed', async () => {
  said.length = 0;
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({});
  await updatePlugins('all', { configDir, version: '0.8.0', run: runner, say, fetch });
  installed({});
  await updatePlugins('all', { configDir, version: '0.8.0', run: runner, say, fetch });
  expect(calls).toEqual([]);
  expect(asked).toEqual([]);
  expect(said).toEqual([`No plugin is installed in ${configDir}.`, `No plugin is installed in ${configDir}.`]);
});

it('fails an update with npm\'s reason, once, naming the package npm refused', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner } = fake({ install: { code: 1, stdout: '', stderr: 'E404 no such package' } });
  const failed = await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  }).catch((error: unknown) => error as Error);
  expect(failed).toBeInstanceOf(Error);
  expect((failed as Error).message).toBe('npm could not update @ahpd/agent-claude: E404 no such package');
});

it('moves the others, and names the one npm cannot install', async () => {
  installed({ '@ahpd/agent-acme': '0.7.0', '@ahpd/agent-claude': '0.7.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake(
    { '@ahpd/agent-acme@0.8.0': { code: 1, stdout: '', stderr: 'E404 no such package' } },
    { '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' },
  );
  const failed = await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say,
    fetch: registryHolding({
      '@ahpd/agent-acme': '0.8.0 >=0.8',
      '@ahpd/agent-claude': '0.8.0 >=0.8',
      'left-pad': '1.3.0',
    }),
  }).catch((error: unknown) => error as Error);
  // One npm call each, so the one npm cannot install is the only one left
  // where it was, and the rest moved and were said.
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-acme@0.8.0'],
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', 'left-pad@1.3.0'],
  ]);
  expect(said).toEqual([
    'Updating @ahpd/agent-acme@0.8.0 with npm.',
    'Updating @ahpd/agent-claude@0.8.0 with npm.',
    'Updating left-pad@1.3.0 with npm.',
    '@ahpd/agent-claude: 0.7.0 to 0.8.0',
    'left-pad: 1.0.0 to 1.3.0',
  ]);
  expect((failed as Error).message).toBe('npm could not update @ahpd/agent-acme: E404 no such package');
});

it('leaves a package installed from outside the registry as it is, and says so', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const dependencies = {
    '@ahpd/agent-claude': '^0.7.0',
    'mine-path': '../mine',
    'mine-file': 'file:../mine',
    'mine-link': 'link:../mine',
    'mine-git': 'git+https://example.test/mine.git',
    'mine-github': 'github:someone/mine',
    'mine-git-plain': 'git://example.test/mine.git',
    'mine-tarball': 'https://example.test/mine.tgz',
  };
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies }));
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  const moved = await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  });
  expect(calls.map((one) => one.argv)).toEqual([['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0']]);
  expect(moved).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  for (const [name, spec] of Object.entries(dependencies).slice(1)) {
    expect(said).toContain(`${name}: ${spec}, left as installed`);
  }
});

it('runs no npm when every package came from outside the registry, and says there was nothing to update', async () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: { mine: 'file:../mine' } }));
  said.length = 0;
  const { runner, calls } = fake();
  expect(await updatePlugins('all', { configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({}) })).toEqual([]);
  expect(calls).toEqual([]);
  expect(said).toEqual(['mine: file:../mine, left as installed', 'Nothing to update.']);
});

it('reports an sdk the update moved while no plugin did', async () => {
  // Every update installs the daemon's sdk beside the plugins, so an sdk one
  // minor behind moves on a call that moves no plugin at all: the daemon has
  // to be restarted for the plugins to load the new one.
  installed({ '@ahpd/agent-claude': '0.8.0', '@ahpd/sdk': '0.7.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/sdk': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/sdk', from: '0.7.0', to: '0.8.0' }]);
  expect(calls).toHaveLength(1);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/sdk: 0.7.0 to 0.8.0']);
});

it('updates from the plugin root when the variable is set', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  installed({ '@ahpd/agent-claude': '0.7.0' }, pluginRoot);
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', pluginRoot, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
  ]);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/agent-claude: 0.7.0 to 0.8.0']);
});

it('names the plugin root, not the configuration directory, when a name is not installed there', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  installed({ '@ahpd/agent-claude': '0.8.0' }, pluginRoot);
  const { runner, calls } = fake();
  await expect(updatePlugins(['left-pad'], { configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .rejects.toThrow(`left-pad is not installed in ${pluginRoot}`);
  expect(calls).toEqual([]);
});

it('removes from the plugin root when the variable is set, and configures the daemon itself', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls.map((one) => one.argv)).toEqual([['uninstall', '--prefix', pluginRoot, '--', '@ahpd/a']]);
  expect(read().plugins).toEqual([]);
  expect(said.join('\n')).toContain(pluginRoot);
});

it('asks the registry about every name at once, before any of them answers', async () => {
  const asked: string[] = [];
  let asking = 0;
  let atOnce = 0;
  const { runner, calls } = fake();
  const fetch: Fetch = async (url) => {
    asked.push(String(url).slice(registry().length + 1));
    asking += 1;
    atOnce = Math.max(atOnce, asking);
    // One turn of the event loop, so a registry asked one name at a time
    // answers the first before the second is asked and `atOnce` stays one.
    await new Promise((wait) => setTimeout(wait, 5));
    asking -= 1;
    return Response.json({ ahpd: {} });
  };
  await installPlugins(['one', 'two', 'three'], { configDir, configFile, version: '0.8.0', enable: false, run: runner, fetch, say });
  // Each name's own metadata is asked for, and then the manifest of the
  // version it named, which here is `latest` because that answer held none.
  expect(asked).toEqual(['one', 'two', 'three', 'one/latest', 'two/latest', 'three/latest']);
  expect(atOnce).toBe(3);
  expect(calls).toHaveLength(1);
});

it('updates only the packages it is named', async () => {
  installed({
    '@ahpd/agent-acp': '0.8.0',
    '@ahpd/agent-claude': '0.7.0',
    'left-pad': '1.0.0',
  });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins(['@ahpd/agent-claude'], {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0']]);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/agent-claude: 0.7.0 to 0.8.0']);
});

it('refuses to update a name that is not installed, before npm runs', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner, calls } = fake();
  await expect(updatePlugins(['@ahpd/agent-claude', 'left-pad'], { configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .rejects.toThrow(`left-pad is not installed in ${configDir}`);
  expect(calls).toEqual([]);
});

it('updates a named plugin beside another on an older minor, with the daemon\'s sdk and no peer check', async () => {
  installed({ '@ahpd/agent-acp': '0.7.0', '@ahpd/agent-claude': '0.7.0', '@ahpd/sdk': '0.7.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-acp': '0.8.0' });
  expect(await updatePlugins(['@ahpd/agent-acp'], {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-acp': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-acp', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-acp@0.8.0'],
  ]);
  expect(said).toEqual(['Updating @ahpd/agent-acp@0.8.0 with npm.', '@ahpd/agent-acp: 0.7.0 to 0.8.0']);
});

it('moves the sdk with update all without calling it a plugin', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0', '@ahpd/sdk': '0.7.0', 'mine': '1.0.0' });
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({
    dependencies: { '@ahpd/agent-claude': '^0.7.0', '@ahpd/sdk': 'file:../sdk', mine: 'file:../mine' },
  }));
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
  ]);
  expect(said).toEqual([
    'mine: file:../mine, left as installed',
    'Updating @ahpd/agent-claude@0.8.0 with npm.',
    '@ahpd/agent-claude: 0.7.0 to 0.8.0',
  ]);
});

it('names the sdk unpinned when the daemon\'s version is unknown', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner, calls } = fake();
  await installPlugins(['left-pad'], { configDir, configFile, version: 'unknown', enable: false, run: runner, fetch: aPlugin, say });
  await updatePlugins('all', { configDir, version: 'unknown', run: runner, say, fetch: registryHolding({}) });
  expect(calls.map((one) => one.argv.slice(3, 5))).toEqual([
    ['--legacy-peer-deps', '@ahpd/sdk'],
    ['--legacy-peer-deps', '@ahpd/sdk'],
  ]);
  // No range can be compared against `unknown`, so nothing is chosen and npm
  // resolves the name itself: an install passes it as written, and an update
  // asks for `latest`.
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad', '@ahpd/agent-claude@latest']);
});

it('refuses to install or update the sdk by name, before npm runs', async () => {
  installed({ '@ahpd/agent-claude': '0.8.0', '@ahpd/sdk': '0.8.0' });
  const { runner, calls } = fake();
  const refusal = "@ahpd/sdk is not a plugin: ahpd installs it at the daemon's version with every install and update.";
  await expect(installPlugins(['@ahpd/sdk'], { configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say })).rejects.toThrow(refusal);
  await expect(installPlugins(['left-pad', '@ahpd/sdk@0.7.0'], { configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch: aPlugin, say })).rejects.toThrow(refusal);
  await expect(updatePlugins(['@ahpd/sdk'], { configDir, version: '0.8.0', run: runner, say, fetch: registryHolding({}) })).rejects.toThrow(refusal);
  expect(calls).toEqual([]);
});

it('never uninstalls the sdk', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a', '@ahpd/sdk'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls.map((one) => one.argv)).toEqual([['uninstall', '--prefix', configDir, '--', '@ahpd/a']]);
  calls.length = 0;
  await removePlugins(['@ahpd/sdk'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls).toEqual([]);
});

it('refuses a registry package with no ahpd field before npm runs, asking at the version it would install', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({
    '@ahpd%2fagent-claude': packument(['0.8.0 >=0.8']),
    '@ahpd%2fagent-claude/0.8.0': { name: '@ahpd/agent-claude', version: '0.8.0', ahpd: { entry: './dist/index.js' } },
    '@softov%2fahpc/latest': { name: '@softov/ahpc', version: '0.3.0', bin: { ahpc: './dist/main.js' } },
  });
  await expect(installPlugins(['@ahpd/agent-claude', '@softov/ahpc'], { configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch, say }))
    .rejects.toThrow('@softov/ahpc is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls).toEqual([]);
  expect(asked).toEqual(['@ahpd%2fagent-claude', '@softov%2fahpc', '@softov%2fahpc/latest', '@ahpd%2fagent-claude/0.8.0']);
  expect(existsSync(configFile)).toBe(false);
});

it('installs a package whose manifest has an ahpd field, asked at the version chosen or written', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({
    '@ahpd%2fagent-claude': packument(['0.1.0 >=0.8']),
    '@ahpd%2fagent-claude/0.1.0': { ahpd: { entry: './dist/index.js' } },
    'mine/1.2.0': { ahpd: {} },
    '@acme%2fagent-mine/next': { ahpd: {} },
  });
  await installPlugins(['@ahpd/agent-claude', 'mine@1.2.0', '@acme/agent-mine@next'], { configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch, say });
  expect(asked).toEqual(['@ahpd%2fagent-claude', 'mine/1.2.0', '@acme%2fagent-mine/next', '@ahpd%2fagent-claude/0.1.0']);
  expect(calls).toHaveLength(1);
  // The bare name is installed at the version its own range admits; a version
  // and a tag the writer named go to npm as written.
  expect(calls[0]?.argv.slice(-3)).toEqual(['@ahpd/agent-claude@0.1.0', 'mine@1.2.0', '@acme/agent-mine@next']);
  expect(read().plugins).toEqual(['@ahpd/agent-claude', 'mine', '@acme/agent-mine']);
});

it('never asks the registry about a source, and passes it to npm as written', async () => {
  // `owner/repo` is GitHub's shorthand to npm, and npm resolves it. npm writes
  // it back as a `github:` spec, which is not the text it was given: the one
  // dependency npm added is still the package it landed.
  const { runner, calls } = fake({}, { 'my-plugin': '0.1.0' }, {
    added: { 'my-plugin': 'github:someone/my-plugin' },
    manifests: { 'my-plugin': { ahpd: {} } },
  });
  const { fetch, asked } = fakeRegistry({});
  await installPlugins(['someone/my-plugin'], { configDir, configFile, version: '0.8.0', enable: true, run: runner, fetch, say });
  expect(asked).toEqual([]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['someone/my-plugin']);
  expect(read().plugins).toEqual(['my-plugin']);
});

it('leaves the install to npm when the registry cannot be asked or has no such version', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({ 'offline/latest': new TypeError('fetch failed'), 'missing/latest': 404 });
  await installPlugins(['offline', 'missing'], { configDir, configFile, version: '0.8.0', enable: false, run: runner, fetch, say });
  expect(asked).toEqual(['offline', 'missing', 'offline/latest', 'missing/latest']);
  expect(calls.map((one) => one.argv.slice(-2))).toEqual([['offline', 'missing']]);
});

it('says each update from the version on disk before npm to the one on disk after, and nothing for one that did not move', async () => {
  installed({ '@ahpd/agent-acp': '0.8.0', 'left-pad': '0.6.0' });
  said.length = 0;
  const { runner } = fake({}, { 'left-pad': '0.7.1' });
  expect(await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/agent-acp': '0.8.0 >=0.8', 'left-pad': '0.7.1' }),
  })).toEqual([{ name: 'left-pad', from: '0.6.0', to: '0.7.1' }]);
  expect(said).toEqual(['Updating @ahpd/agent-acp@0.8.0 with npm.', 'Updating left-pad@0.7.1 with npm.', 'left-pad: 0.6.0 to 0.7.1']);
});

it('says there was nothing to update when npm moved no version', async () => {
  installed({ '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' });
  said.length = 0;
  const { runner, calls } = fake();
  const fetch = registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8', 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', { configDir, version: '0.8.0', run: runner, say, fetch })).toEqual([]);
  expect(calls).toHaveLength(2);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', 'Updating left-pad@1.3.0 with npm.', 'Nothing to update.']);
  said.length = 0;
  expect(await updatePlugins(['left-pad'], { configDir, version: '0.8.0', run: runner, say, fetch })).toEqual([]);
  expect(said).toEqual(['Updating left-pad@1.3.0 with npm.', 'Nothing to update.']);
});

/*
 * The line before npm: npm is silent while it works, so each call follows a
 * line that names what it is given.
 */

/** `fake`, with the lines said so far recorded at each npm call. */
const heard = (answers: Record<string, Ran> = {}, lands: Record<string, string> = {}) => {
  const { runner, calls } = fake(answers, lands);
  const before: string[][] = [];
  const run: Runner = async (program, argv) => {
    before.push([...said]);
    return runner(program, argv);
  };
  return { runner: run, calls, before };
};

it('says the Installing line, with every package named, before npm runs', async () => {
  said.length = 0;
  const { runner, before } = heard();
  await installPlugins(['@ahpd/agent-claude', 'left-pad@1'], {
    configDir, configFile, version: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(before).toEqual([['Installing @ahpd/agent-claude@0.1.0, left-pad@1 with npm.']]);
});

it('says one Updating line before each npm call', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, before } = heard({}, { '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' });
  await updatePlugins('all', {
    configDir, version: '0.8.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8', 'left-pad': '1.3.0' }),
  });
  expect(before).toEqual([
    ['Updating @ahpd/agent-claude@0.8.0 with npm.'],
    ['Updating @ahpd/agent-claude@0.8.0 with npm.', 'Updating left-pad@1.3.0 with npm.'],
  ]);
});

it('says the Removing line before npm runs', async () => {
  write({ plugins: ['@ahpd/a', '@ahpd/b'] });
  said.length = 0;
  const { runner, before } = heard();
  await removePlugins(['@ahpd/a', '@ahpd/b'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(before).toEqual([[`plugins -= @ahpd/a, @ahpd/b in ${configFile}.`, 'Removing @ahpd/a, @ahpd/b with npm.']]);
});
