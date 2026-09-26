import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { claude, claudeExecutablePath } from '../packages/agent-claude/src/claude.js';
import { cofoldAgent } from '../packages/agent-cofold/src/agent.js';

/*
 * What the agents that ship say a machine needs.
 *
 * The knowledge used to live in the computer plugin's profiles, as three host
 * paths a person wrote by hand - and the CLI path carried a version, so an
 * update on the host left a mount pointing at nothing and the session exited
 * 127. These are the agents' own answers, and the executable is resolved when
 * it is asked so the version is never pinned.
 */

const temp = (): string => mkdtempSync(join(tmpdir(), 'ahpd-agent-needs-'));

it('Claude declares its configuration directory, its configuration file and its CLI', () => {
  const agent = claude({ paths: [temp()] });
  const needs = agent.machine?.() ?? {};
  expect(Object.keys(needs)).toEqual(['claudeConfigDirectory', 'claudeConfigJson', 'claudeExecutable']);
  // `~` is the agent's default, expanded when a machine is made, so the same
  // declaration works for whoever runs the daemon.
  expect(needs.claudeConfigDirectory).toMatchObject({
    directory: '~/.claude', target: '/ahpd/claude', required: true,
  });
  expect(needs.claudeConfigJson).toMatchObject({
    file: '~/.claude.json', target: '/ahpd/claude/.claude.json', required: true,
  });
  // The CLI goes where the docs always put it, and into the image read-only.
  expect(needs.claudeExecutable).toMatchObject({
    target: '/usr/local/bin/claude', readOnly: true, required: true,
  });
  expect((needs.claudeExecutable as { file: string }).file).toBe(claudeExecutablePath());
});

it('Claude follows the CLI symlink when asked, so a host update is picked up', () => {
  const home = temp();
  const version = join(home, '.local', 'share', 'claude', 'versions', '9.9.9');
  mkdirSync(version, { recursive: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(version, 'claude'), '#!/bin/sh\n');
  symlinkSync(join(version, 'claude'), join(home, '.local', 'bin', 'claude'));

  // What `~/.local/bin/claude` points at, not the link itself: a later update
  // moves the link, and a mount of the link would be a directory in the image.
  expect(claudeExecutablePath(home)).toBe(join(version, 'claude'));

  // A link that is not there answers the path itself, which a machine is then
  // refused over by name rather than made with an empty directory.
  expect(claudeExecutablePath(join(home, 'elsewhere'))).toBe(join(home, 'elsewhere', '.local', 'bin', 'claude'));
});

it('Claude leaves the configuration alone when the image carries it', () => {
  const agent = claude({ paths: [temp()], computerConfigDir: false });
  const needs = agent.machine?.() ?? {};
  expect(Object.keys(needs)).toEqual(['claudeExecutable']);
});

it('cofold declares its harness configuration, wherever it is read from', () => {
  const before = process.env['XDG_CONFIG_HOME'];
  try {
    process.env['XDG_CONFIG_HOME'] = '/srv/config';
    let needs = cofoldAgent({ memory: true }).machine?.() ?? {};
    expect(needs.cofoldConfig).toMatchObject({
      file: '/srv/config/cofold/config.json',
      // Mounted at the same path, so a cofold host inside the machine reads
      // the same file and finds the same provider keys.
      target: '/srv/config/cofold/config.json',
      readOnly: true,
      required: true,
    });
    expect(needs.cofoldConfig?.description).toMatch(/provider/);

    delete process.env['XDG_CONFIG_HOME'];
    needs = cofoldAgent({ memory: true, provider: 'cofold2' }).machine?.() ?? {};
    expect(needs.cofoldConfig).toMatchObject({ file: join(process.env['HOME'] ?? '', '.config', 'cofold', 'config.json') });
  }
  finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = before;
  }
});
