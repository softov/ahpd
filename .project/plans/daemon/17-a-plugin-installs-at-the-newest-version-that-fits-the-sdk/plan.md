---
title: A plugin installs at the newest version whose sdk range admits the daemon
domain: daemon
status: built
priority: high
created: 2026-10-09
revalidated: 2026-10-09
requires:
  - plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md
refs:
  - "[code://packages/server/src/install.ts#L108-L122](../../../../packages/server/src/install.ts#L108-L122) - `pinned`: a bare `@ahpd/*` name becomes `@<daemon version>`, whatever the package's own versions are"
  - "[code://packages/server/src/install.ts#L393-L414](../../../../packages/server/src/install.ts#L393-L414) - `refuseNonPlugins`, which asks the registry for the manifest at the pinned version"
  - "[code://packages/server/src/install.ts#L436-L455](../../../../packages/server/src/install.ts#L436-L455) - `installPlugins`, which runs npm with the pinned names"
  - "[code://packages/server/src/install.ts#L508-L540](../../../../packages/server/src/install.ts#L508-L540) - `updatePlugins`: `@ahpd/*` to the daemon's version, any other to `latest`"
  - "[code://packages/server/src/install.ts#L356-L372](../../../../packages/server/src/install.ts#L356-L372) - `daemonsSdk`: the sdk at the daemon's version, which stays"
  - "[code://packages/server/src/compat.ts#L88](../../../../packages/server/src/compat.ts#L88) - `satisfies`, the range check the loader uses"
  - "[code://packages/server/src/plugins.ts#L460-L475](../../../../packages/server/src/plugins.ts#L460-L475) - the loader: no range loads unchecked, a range that leaves out the daemon is refused"
  - "[code://packages/server/src/update.ts#L80-L90](../../../../packages/server/src/update.ts#L80-L90) - `askRegistry`, the one registry reader"
  - "[code://packages/server/test/plugin-install.test.ts](../../../../packages/server/test/plugin-install.test.ts) - the install and update tests, with a fake registry"
  - "[code://packages/server/src/commands/plugin.ts#L145](../../../../packages/server/src/commands/plugin.ts#L145) - `plugin update`'s description, which names the daemon's version"
  - https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md - the abbreviated packument: `dist-tags` and each version's `peerDependencies`
---

## Goal

`ahpd plugin install <name>` and `ahpd plugin update` choose a plugin's version by what the plugin declares it works with, its `peerDependencies["@ahpd/sdk"]`, and not by its own version number.
Today a bare `@ahpd/*` name is installed at the daemon's version, so `ahpd plugin install @ahpd/web` asks npm for `@ahpd/web@0.10.0`, which does not exist, and fails.
A plugin released on its own schedule then installs, and no plugin has to publish a release at each daemon version.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `npm view @ahpd/web versions peerDependencies` - `0.0.0-stage` and `0.1.0`; `@ahpd/sdk: >=0.9`.
- `rg -n "pinned\(" packages/server/src` - `refuseNonPlugins`, `installPlugins`, `updatePlugins` and `daemonsSdk`.
- `rg -n "daemon's version" docs packages/server/README.md packages/server/src/commands/plugin.ts` - `docs/DAEMON.md` L55-L75, `packages/server/README.md` L34 and L67, `plugin update`'s description.
- `rg -ln "daemon's version" .project/decisions` - no accepted decision holds the plugin pin; daemon 09's plan defaulted it from `pinned`.

### Runtime path

```
ahpd plugin install <name> -> installPlugins -> refuseNonPlugins (registry) -> npm install --prefix <root> @ahpd/sdk@<daemon> <name>@<version>
  -> next start: the loader checks the plugin's @ahpd/sdk range
```

### Gaps

- The version npm is asked for comes from the daemon's version, not from the plugin's sdk range.
- A plugin whose range leaves out the daemon's sdk is installed, then refused by the loader at the next start.

## Decisions locked in

No decision file: every row below is Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| A plugin's version is chosen by its `@ahpd/sdk` peer range, checked with the loader's `satisfies` against the daemon's version; the plugin's own version number is not a compatibility check | Softov, 2026-10-09, after `ahpd plugin install @ahpd/web` failed with `ETARGET` for `0.10.0`: "what the own package version has to do with checking compatibility... I think you made a wrong check" | 01, 02, 03 |
| The chosen version is the newest that admits the daemon, no newer than `dist-tags.latest`, and not a prerelease | (defaulted: npm's own `latest` is the publisher's choice of newest, and a prerelease is installed only when named) | 01 |
| A version with no `@ahpd/sdk` peer range is admitted | (defaulted: the loader loads such a plugin unchecked, [`code://packages/server/src/plugins.ts#L464`](../../../../packages/server/src/plugins.ts#L464)) | 01 |
| A name with a version or a tag is passed to npm as written | `pinned` today, [`code://packages/server/src/install.ts#L120-L121`](../../../../packages/server/src/install.ts#L120-L121) | 02, 03 |
| When no version admits the daemon, install and update refuse before npm runs, and name the newest version's range and the daemon's version | (defaulted: the loader would refuse it at the next start; refusing first leaves nothing installed that cannot load) | 02, 03 |
| When the registry cannot be asked, or the daemon's version is `unknown`, the bare name goes to npm as written | (defaulted: `refuseNonPlugins` leaves an unreachable registry to npm today, and the loader still checks the range) | 02, 03 |
| `@ahpd/sdk` stays at the daemon's version with every install and update | [decision the-daemon-installs-its-own-sdk-beside-the-plugins](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) | 02 |

## Proposed architecture

- **Data flow** - a bare registry name -> one request for its abbreviated packument -> the newest admitted version -> `<name>@<version>` to the manifest check and to npm.
- **Event flow** - unchanged.
- **State flow** - unchanged: `package.json` in the plugin root records what npm installed.
- **Layer responsibilities** - server `install.ts`: choose the version, and use it in install and update · server `compat.ts`: unchanged · docs: say the new rule.
- **Source-of-truth files** - [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The version that fits the daemon's sdk is chosen from the registry](task-01-the-version-that-fits-is-chosen.md) | done | - |
| [02 - Install asks npm for the version that fits](task-02-install-asks-for-the-version-that-fits.md) | done | 01 |
| [03 - Update moves every plugin to the version that fits](task-03-update-moves-to-the-version-that-fits.md) | done | 01 |
| [04 - The docs say a plugin installs at the version that fits](task-04-docs.md) | done | 02, 03 |

## Risks and tradeoffs

- One more registry request per name - the abbreviated packument is small, and the names are asked at once, as `refuseNonPlugins` does today.
- A range `satisfies` cannot read - the version is skipped, as the loader would refuse it.

## Resume state

- **Done so far:** every task, 01 to 04. `fittingVersion` chooses a registry package's version from its `@ahpd/sdk` peer range; install and update use it; the docs say the rule.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `daemonsSdk` still uses `pinned` for `@ahpd/sdk`; that pin is correct and stays. `commands/configure.ts` installs its backends through `installPlugins`, so it follows the same rule, and `packages/server/test/server-configure.test.ts` now holds a packument for `@ahpd/agent-claude`.

## Final verification checklist

- [x] With a fake registry holding `@ahpd/web` `0.1.0` with `@ahpd/sdk: >=0.9`, `ahpd plugin install @ahpd/web` on daemon `0.10.0` runs npm with `@ahpd/web@0.1.0`.
- [x] A package whose newest version asks `>=0.11` installs the newest older version that admits `0.10.0`.
- [x] A package with no version that admits the daemon is refused before npm runs.
- [x] `ahpd plugin update all` moves a plugin that is not `@ahpd/*` by the same rule.
- [x] `plans/index.md` updated.
