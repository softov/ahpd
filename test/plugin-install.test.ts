import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installPlugins, isPackageName, pinned, removePlugins } from '../packages/server/src/install.js';
import type { Ran, Runner } from '../packages/server/src/install.js';

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
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-install-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A runner that records every call and lets a verb fail. */
const fake = (answers: Record<string, Ran> = {}) => {
  const calls: { program: string; argv: string[] }[] = [];
  const runner: Runner = (program, argv) => {
    calls.push({ program, argv: [...argv] });
    return answers[argv[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
};

const said: string[] = [];
const say = (line: string): void => { said.push(line); };

const write = (held: unknown): void => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`);
};
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;

it('pins a plugin of this project to the daemon, and passes anything else as written', () => {
  expect(pinned('@ahpd/agent-claude', '9.9.9')).toBe('@ahpd/agent-claude@9.9.9');
  // The version or tag the writer chose is theirs, and an unknown version is
  // left for npm's own `latest` rather than becoming `@unknown`.
  expect(pinned('@ahpd/agent-claude@1', '9.9.9')).toBe('@ahpd/agent-claude@1');
  expect(pinned('@ahpd/agent-claude', 'unknown')).toBe('@ahpd/agent-claude');
  expect(pinned('left-pad@1', '9.9.9')).toBe('left-pad@1');
  expect(pinned('@other/thing', '9.9.9')).toBe('@other/thing');
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

it('installs into the configuration directory and names the packages there', () => {
  const { runner, calls } = fake();
  installPlugins(['@ahpd/agent-claude', 'left-pad@1'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, say,
  });

  const install = calls.find((one) => one.argv[0] === 'install');
  expect(install?.program).toBe('npm');
  // No `--allow-scripts`: npm 12 refuses that flag on a project-scoped
  // install, and the only thing it would have built here is the SDK's
  // optional node-pty, which the daemon gets from its own global install.
  expect(install?.argv).toEqual([
    'install', '--prefix', configDir,
    '@ahpd/agent-claude@9.9.9', 'left-pad@1',
  ]);
  // The list holds package names, which is what the loader resolves: a
  // version or tag belongs to the install and would read back as missing.
  expect(read().plugins).toEqual(['@ahpd/agent-claude', 'left-pad']);
  expect(said.join('\n')).toContain(configDir);
});

it('names a scoped package without the version it was installed at', () => {
  const { runner, calls } = fake();
  installPlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, version: '9.9.9', enable: true, run: runner, say });
  expect(calls.find((one) => one.argv[0] === 'install')?.argv.at(-1)).toBe('@ahpd/agent-acp@0.7.0');
  expect(read().plugins).toEqual(['@ahpd/agent-acp']);
});

it('removes a name given with a version', () => {
  write({ plugins: ['@ahpd/agent-acp'] });
  const { runner, calls } = fake();
  removePlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv.at(-1)).toBe('@ahpd/agent-acp');
});

it('refuses a path and a scheme before npm runs', () => {
  const { runner, calls } = fake();
  const options = { configDir, configFile, version: '9.9.9', enable: true, run: runner, say };
  expect(() => installPlugins(['./my-plugin'], options)).toThrow(/not a package name/);
  expect(() => installPlugins(['npm:@ahpd/agent-claude'], options)).toThrow(/not a package name/);
  expect(calls).toEqual([]);
});

it('adds a name once, and keeps every other key and entry', () => {
  write({ port: 1234, plugins: ['@ahpd/existing', { name: '@ahpd/configured', options: { token: 'shh' } }] });
  const { runner } = fake();
  installPlugins(['@ahpd/existing', '@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, say,
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
  installPlugins(['@ahpd/agent-claude'], { configDir, configFile, version: '9.9.9', enable: true, run: runner, say });
  expect(readFileSync(configFile, 'utf8')).toBe(text);
});

it('leaves the configuration alone with --no-enable', () => {
  write({ plugins: ['@ahpd/other'] });
  const before = readFileSync(configFile, 'utf8');
  const { runner } = fake();
  installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: false, run: runner, say,
  });
  expect(readFileSync(configFile, 'utf8')).toBe(before);
  // And one that is not there is not created, which is what the container
  // install relies on.
  rmSync(configFile);
  installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: false, run: runner, say,
  });
  expect(existsSync(configFile)).toBe(false);
});

it('removes a string entry and an object entry, then uninstalls them', () => {
  write({ port: 1234, plugins: ['@ahpd/a', { name: '@ahpd/b', options: { x: 1 } }, '@ahpd/c'] });
  const { runner, calls } = fake();
  removePlugins(['@ahpd/a', '@ahpd/b'], { configDir, configFile, uninstall: true, run: runner, say });

  expect(read().plugins).toEqual(['@ahpd/c']);
  expect(read().port).toBe(1234);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv)
    .toEqual(['uninstall', '--prefix', configDir, '@ahpd/a', '@ahpd/b']);
});

it('drops the name with --keep but leaves the package installed', () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  removePlugins(['@ahpd/a'], { configDir, configFile, uninstall: false, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls).toEqual([]);
});

it('refuses with npm\'s own words when the install fails', () => {
  const { runner } = fake({ install: { code: 1, stdout: '', stderr: 'E404 no such package' } });
  expect(() => installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, version: '9.9.9', enable: true, run: runner, say,
  })).toThrow(/@ahpd\/agent-claude: E404 no such package/);
  // Nothing was named, because nothing was installed.
  expect(existsSync(configFile)).toBe(false);
});
