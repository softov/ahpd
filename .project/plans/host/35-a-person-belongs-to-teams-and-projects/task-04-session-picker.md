---
title: A session picks its scope
status: done
depends: [task-02-resolve.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/host.ts#L218](../../../../packages/sdk/src/types/host.ts#L218) - `sessionConfig`"
---

## Objective

Under a users directory, a session offers a `scope` key whose choices are the asking person's memberships, preset to their primary, fixed after the first turn as [host 18](../18-a-provisional-session-takes-any-key/plan.md) fixes a computer; the resolved scope is kept with the session.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the `scope` key, its completions from the principal, resolved by `scopeFor` at the first turn; a refusal fails the turn with the list.
- `UPDATE: packages/sdk/src/sessions.ts` - the resolved scope persisted beside the owner (host 34).

## Steps

1. `team:*` offers one choice per known project of that team.

## Validation

- A host test: the picker lists the person's memberships, defaults to the primary, refuses a change after the first turn, and survives a reload.
- `pnpm -F @ahpd/sdk test`.

## Resume

- `scope` is a seventh `HOSTS_OWN` key, which is what gives it everything the other six have for nothing: `backendsOwn` strips it before a backend is handed anything, `mineOf` reads it back out of what a client sent, and the `session/configChanged` branch that restarts an unstarted session for a key that moved is already written - so `scope` moves and is refused with `scope is fixed once the session has started`, which is host 18's rule rather than a second one.
- `settle` takes the connection's principal and resolves there, at the moment the session is created. It offers `scope` whether or not there is a `worktrees` port: `isolating` answers nothing without a repository, and a person belongs to a team whether or not the folder is a git checkout, so the two are separate helpers rather than one.
- The picker offers `namesOf(principal)`, so a `team:*` is one choice per project this install names. A project entry in the users file is an id and a title with no team on it, so the membership says which team and the project list says which projects, and there is nothing to filter the latter by the former. That is what task 02 settled, and the picker asks the same question a refusal asks rather than answering it a second way.
- The default is what naming nothing resolves to - `scopeFor(principal)` - so a person who never opens the picker is charged their primary. `resolveSessionConfig` carries the same property and the same default, which is the form a client draws before the session exists, and `sessionConfigCompletions` answers `scope` from the principal for a client that asks rather than draws.
- A refusal fails the turn, in `beginOrRun`, so every road a turn takes - a new chat, a resumed session, a queued message, a scheduled one - is refused the same way. The message is `scopeFor`'s own, which is the one that lists what may be named. A scope that does not resolve is kept in the session's config rather than rolled back, so the picker can be put back before the first turn; the store is cleared of a charge that no longer resolves rather than left holding one the config disagrees with.

Two things the plan does not name, both ports:

- `SessionStore` gained `scope(id)` and `setScope(id, value)`, because the task's file list says the resolved scope is persisted beside the owner and the store is where a session's owner-side state is. `Saved` carries it as `scope?: { team, project? }`, round-tripped by both stores, and `forget` takes it with the rest. A file written by a version that meant something else is ignored rather than guessed at, like the pull request baseline beside it.
- A resumed session reads its charge back out of the store rather than resolving one for whoever is asking now. A session's charge was settled by whoever created it, possibly by a different person in a previous process; re-deciding it would either refuse the first turn of a perfectly well charged session or charge one person's work to another's team.

`packages/sdk/test/session-scope.test.ts` covers the picker against a plain-object directory: the choices and the primary in `resolveSessionConfig` and in the session's own schema, the completions, the scope reaching the store and never the backend, a change before the first turn taking effect, a name that may not be named failing the turn with the list, that name being taken back, a change after the first turn refused with the one it had kept, a person with no memberships offered no picker and refused every turn, a host with no directory offering nothing and refusing nothing, and a session resumed from the catalogue by a second host signed in as somebody who belongs to nowhere. `packages/sdk/test/sessions.test.ts` gained the file round-trip, including a scope taken back and a session forgotten.

Three more from the review of what was built:

- **A `scope` change does not start the backend again.** `scope` is a `HOSTS_OWN` key, so `session/configChanged` treated it as a key that moved and restarted a session the backend was already running, over a word it has never heard of and is not handed. It is settled and refused beside the others, in its own list, and the restart runs only when something else in the action moved. A change to `scope` alone answers the client straight back; a change that moves `scope` and a key the backend does hold is still one decision and still one start.
- **A resume with nothing in the store for it is settled at the turn.** The resume path read the charge back and used it if there was one, and charged nothing at all if there was not, so a session begun before this host charged anything ran its first turn here with no charge and no refusal. It now resolves from the principal the turn arrived on, exactly as a new session is, and the turn is refused when that does not resolve. A session the store does hold a charge for is unchanged: it was decided by whoever created it, and re-deciding would answer for whoever is asking now.
- **The `charged` map is cleared when a session is disposed.** It is keyed by session uri and a name can be reused, so a refusal left behind by a session that went was still on the map for the next one. Every path that creates a session charges it, so nothing observed the stale entry; the delete is there so the map means what it says.
