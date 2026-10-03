---
title: The versions file and its reader
status: todo
depends: []
layer: "computer"
refs:
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the entry shape
  - "[code://packages/computer/package.json](../../../../packages/computer/package.json) - `files`"
---

## Objective

`packages/computer/images/versions.json` lists every part, and `parts.ts` reads it into typed entries with a tag and the file's hash.

## Files

- `CREATE: packages/computer/images/versions.json` - entries `node`, `ahpd`, `claude`, `codex`, `gemini`, `copilot`, `opencode`, `kilo`, `goose`, `pi`, `dsh`, `devin`, `cursor`, `amp`, `qwen`.
- `CREATE: packages/computer/src/parts.ts` - `readParts()`, `tagOf(part)`, `hashOf()`.
- `UPDATE: packages/computer/package.json` - `images` in `files`.
- `CREATE: packages/computer/test/computer-parts.test.ts` - reading and refusing.

## Steps

1. An entry is `{ id, name, version, kind: 'npm' | 'archive' | 'ahpd' | 'node', packages?: string[], archives?: { linux-x64, linux-arm64: { url, sha256 } }, bin: string[], requires?: string[], updates?: Record<string,string>, plugins?: string[] }`; `plugins` is only on the `ahpd` entry and names the backends that run nested, `@ahpd/agent-cofold` and `@ahpd/agent-pi`; `updates` is the env or file that turns the CLI's own update off.
2. `tagOf(part)` is `ahpd-part/<id>:<version>`. For the `ahpd` part it is `ahpd-part/ahpd:<version>-<source hash>`, where the source hash is the first twelve hex of the sha256 of what `ahpdSourceOf()` (task 02) answers: the packed tarballs' bytes from a checkout, or the npm version from an installed package. `tagOf` is the one place a part's tag is spelled; task 02 and task 04 read it.
3. `hashOf` is the sha256 of the file's bytes and the `ahpd` part's tag from `tagOf`, first twelve hex, so a code change in a checkout changes the joined image's hash too.
4. Refuse at read: a duplicate id, a range instead of an exact version, an archive without sha256, a `requires` naming no entry.

## Validation

- The shipped file reads clean.
- Each refusal above has a case.
- `tagOf` for the `ahpd` part changes when the source hash changes and the version does not, and `hashOf` changes with it.

## Resume
