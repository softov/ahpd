---
title: People, roles and grants
status: current
covers:
  - packages/sdk/src/access/users.ts
  - packages/sdk/src/access/people.ts
  - packages/sdk/src/usage/scopes.ts
  - packages/sdk/src/host/gate.ts
  - packages/sdk/src/host/admission.ts
  - packages/sdk/src/host/actions.ts
  - packages/sdk/src/host/owners.ts
  - packages/sdk/src/access/policies.ts
  - packages/sdk/src/access/policy.ts
  - packages/sdk/src/access/decide.ts
  - packages/server/src/commands/user.ts
  - packages/server/src/commands/teams.ts
decisions:
  - decisions/a-role-refuses-at-the-dispatch-boundary.md
refs:
  - "[code://packages/sdk/src/access/users.ts#L26-L36](../../packages/sdk/src/access/users.ts#L26-L36) - `BUILT_IN`, the `admin`, `member` and `guest` roles"
  - "[code://packages/sdk/src/access/users.ts#L43-L60](../../packages/sdk/src/access/users.ts#L43-L60) - `SUBJECTS`, the subjects the host answers to"
  - "[code://packages/sdk/src/access/users.ts#L107-L185](../../packages/sdk/src/access/users.ts#L107-L185) - `OPERATIONS`, each subject's operations and their groups"
  - "[code://packages/sdk/src/access/users.ts#L222-L239](../../packages/sdk/src/access/users.ts#L222-L239) - `grantProblem`, the shape a grant may have"
  - "[code://packages/sdk/src/access/users.ts#L252](../../packages/sdk/src/access/users.ts#L252) - `LEGACY`, what `users:read` and `users:write` are read as"
  - "[code://packages/sdk/src/access/users.ts#L266-L288](../../packages/sdk/src/access/users.ts#L266-L288) - `holds`, the matching rule"
  - "[code://packages/sdk/src/access/users.ts#L774-L844](../../packages/sdk/src/access/users.ts#L774-L844) - `principalOf`, a frozen principal that re-reads the file"
  - "[code://packages/sdk/src/access/users.ts#L853-L866](../../packages/sdk/src/access/users.ts#L853-L866) - `rolesFromClaim`, the roles an issuer claim may add"
  - "[code://packages/sdk/src/host/gate.ts#L291-L300](../../packages/sdk/src/host/gate.ts#L291-L300) - `dispatchNeeds`, the grant a root config change asks for"
  - "[code://packages/sdk/src/host/gate.ts#L342-L356](../../packages/sdk/src/host/gate.ts#L342-L356) - `PER_CONNECTION` and `seesConfig`"
  - "[code://packages/sdk/src/host/admission.ts#L333-L380](../../packages/sdk/src/host/admission.ts#L333-L380) - `denied` and `admit`, the gate at the dispatch boundary"
  - "[code://packages/sdk/src/host/actions.ts#L122-L153](../../packages/sdk/src/host/actions.ts#L122-L153) - the same gate on a dispatched action"
  - "[code://packages/sdk/src/access/people.ts#L239-L290](../../packages/sdk/src/access/people.ts#L239-L290) - `peopleProviders` and `peopleChannels`"
  - "[code://packages/sdk/src/usage/scopes.ts#L176-L199](../../packages/sdk/src/usage/scopes.ts#L176-L199) - `scopeFor`, the team and project a request is charged to"
  - "[code://packages/sdk/src/utils/values.ts#L64-L65](../../packages/sdk/src/utils/values.ts#L64-L65) - `ownerOfPrincipal`, which reads the `plugin` field"
  - "[code://packages/sdk/src/host/owners.ts#L51-L55](../../packages/sdk/src/host/owners.ts#L51-L55) - `ownerFor`, the owner of a connection's work"
  - "[code://packages/sdk/src/host/owners.ts#L166-L183](../../packages/sdk/src/host/owners.ts#L166-L183) - `checked`, the policy check on a session"
  - "[code://packages/sdk/src/access/decide.ts#L128-L200](../../packages/sdk/src/access/decide.ts#L128-L200) - `matched` and `decide`"
  - "[code://packages/sdk/src/access/policy.ts#L152-L182](../../packages/sdk/src/access/policy.ts#L152-L182) - the `policy:` scheme and its channel"
  - "[code://packages/server/src/config.ts#L62-L79](../../packages/server/src/config.ts#L62-L79) - `PoliciesSetting`, the `policies.check` key"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, the grants a served command holds its caller to"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-caller-gives-only-the-grants-it-holds, a-claim-names-the-roles-this-host-defines, a-grant-is-a-subject-and-a-verb, a-grant-names-an-operation-and-read-and-write-are-its-groups, a-legacy-users-grant-is-the-user-subject-only, a-plugin-principal-is-marked-not-read-from-its-id, a-request-naming-no-scope-uses-the-persons-primary, a-role-is-read-on-every-command, any-root-owner-is-this-host, each-people-scheme-has-its-own-channel, people-are-resource-schemes-with-a-grant-each, shutdown-needs-config-change, status-and-plugin-list-need-config-read, teams-and-projects-are-memberships-in-the-users-file, the-user-commands-need-users-write, work-is-owned-by-a-typed-reference, a-deny-binds-only-what-was-asked, policies-are-a-scheme-clients-edit, policy-checks-are-switched-on-by-a-daemon-option, host-wide-root-settings-need-config-write, pushing-workspace-trust-needs-trust-write
---

A host with a users file knows its people, their roles, their teams and projects, and the grants each role holds.
The file is read again on every question, so a change to a role or a person applies at the next command, with no restart.
Every command and every dispatched action passes one gate, which asks the connection's principal for the grant the command needs.
A grant is `<subject>:<operation>`, and `read` and `write` are the names of groups of operations.
Policies are a second layer: when the checks are on, they decide which agents, models and computers a person may use.
The code is in [`code://packages/sdk/src/access/users.ts`](../../packages/sdk/src/access/users.ts), [`code://packages/sdk/src/host/admission.ts`](../../packages/sdk/src/host/admission.ts) and [`code://packages/sdk/src/access/decide.ts`](../../packages/sdk/src/access/decide.ts).

## Scenarios

### A grant names a subject and an operation

WHEN a role holds a grant
THEN the grant is `<subject>:<operation>`, and either part may be `*`
AND the host subjects are `session`, `chat`, `file`, `automation`, `terminal`, `diagnostics`, `container`, `config`, `user`, `team`, `project`, `role`, `usage`, `policy`, `proxy` and `trust`
AND each host subject has its own operations, each in the `read` or the `write` group
AND a plugin scheme is a subject too, and takes the resource operations `get`, `list`, `resolve`, `watch`, `put`, `delete`, `mkdir`, `move`, `copy` and `request`.

### A group covers its operations, and the operations do not make the group

WHEN the gate asks for a grant
THEN the grant is held when the role holds it exactly, holds `*:*`, or holds a wildcard in either position
AND an operation is held when the role holds the group the operation is in
AND a `chat` operation is also held through the `session` group of the same name
AND a grant that names a group is not held through each operation in it, so `chat:send` does not hold `chat:write`.

### A role with a bad grant

WHEN the users file gives a role a grant with a bad shape, or an operation that its host subject does not have
THEN the host drops that grant and logs it once
AND an unknown subject takes any operation spelled as one lowercase word, because a plugin scheme can be loaded later
AND a write of a role through the `role:` scheme refuses the same grant instead of dropping it.

### A grant written before the subjects were split

WHEN a role holds `users:read` or `users:write`
THEN the host reads it as `user:read` or `user:write`, and logs that once for the role
AND the grant covers no team, project or role, because it never named them.

### The built-in roles

WHEN a person holds `admin`, `member` or `guest` and the file defines no role of that name
THEN `admin` holds `*:*`
AND `member` holds the `read` and `write` groups of `file`, `session`, `terminal` and `proxy`, and `trust:write`
AND `guest` holds `session:read` and `automation:read`
AND a person added with no role is a `guest`.

### A command from a person who is not signed in

WHEN a host with a users file gets a command from a connection that has no principal
AND the command is not one of the ungated ones, such as `initialize`, `ping`, `authenticate` or `subscribe` to the root
THEN the host answers `-32007`, "Sign in to use this host", with the sign-in resource in `data.resources`
AND a connection that is root, such as stdio or the deployment token, passes the gate with every grant
AND a host with no users file has no gate.

### A command that the role does not cover

WHEN a signed-in person sends a command that needs a grant their roles do not hold
THEN the host answers `-32009` with "`<id>` may not `<grant>` here"
AND the error data holds no `request`, because a role is not something a client can negotiate
AND a method that the host has not classified is refused to everybody with `-32009`.

### A resource command is asked by its scheme

WHEN a person reads or writes a resource
THEN the gate asks for `<scheme>:<operation>`, with the URI's scheme as the subject
AND a `file:` URI asks for a `file` grant
AND a provider's `authorize` hook may let a person read one resource without the grant, but it never excuses a write
AND a person reads their own `user://<id>` record with no `user:get`.

### A role changes while a person is connected

WHEN the users file changes a person's roles, or removes the person
THEN the next command from that person is asked against the file as it is now
AND a removed person gets `-32007` on the next command, as if they had never signed in
AND the socket stays open.
The reason: a role is resolved on every command, so revocation does not wait for a reconnect.

### An issuer claim adds roles

WHEN a record names a claim in `rolesFrom` and the person signs in through an issuer
THEN each claim value that names a defined or built-in role is added to the person's roles until the next sign-in
AND a value that names no role is logged once and dropped
AND an absent claim adds nothing and does not fail the sign-in.

### A principal is frozen and a plugin principal is marked

WHEN the host builds a principal for a person
THEN the principal object is frozen, and its roles cannot be changed by a provider that gets it
AND its `can`, `standing`, memberships and primary read the file again on each call
AND only the `plugin` field marks a plugin's principal, and work it starts is owned by `plugin:<name>`.
This is so that a person whose id looks like a plugin name is still a person.

### Commands on people need the people grants

WHEN a caller runs `ahpd user list` through the daemon
THEN the caller needs `user:read` and `role:read`
AND `user add`, `user rm`, `user token` and `user member` need `user:write`
AND the team and project commands need `team:read`, `team:write`, `project:read` or `project:write`
AND a command run at the terminal, with no daemon between, is not bounded by any grant.

### A caller gives only the grants it holds

WHEN a caller who is not root adds a person, removes a person or makes a token for one
THEN each grant of the roles involved is held by the caller, or the command answers `403`
AND `user add` also bounds the grants of the roles it gives
AND a caller with no principal gets `401`.
The reason: otherwise a person with `user:write` could make a person with more grants than they hold.

### People are resource schemes, each with its own channel

WHEN a host has a users file
THEN people, teams, projects and roles are the `user:`, `team:`, `project:` and `role:` schemes
AND each scheme has a channel, `x-ahpd-users`, `x-ahpd-teams`, `x-ahpd-projects` or `x-ahpd-roles`, that needs its `<scheme>:read`
AND a reader of `x-ahpd-users` without the grant sees only their own record
AND `x-ahpd/<domain>/put` needs `<scheme>:put` and `x-ahpd/<domain>/remove` needs `<scheme>:delete`
AND a host with no users file serves none of them.

### Teams and projects are memberships in the users file

WHEN the users file names teams and projects
THEN a person's membership is written `<team>`, `<team>:*` or `<team>:<project>`
AND a team, a project or a role that a person still holds cannot be removed
AND role names and team and project ids cannot hold a space, a colon or a `*`.

### A request that names no scope

WHEN a person who belongs to teams starts work and names no team or project
THEN the work is charged to the person's primary membership, when they have one
AND with no primary, it is charged to their only concrete membership
AND with more than one and no primary, the request is refused
AND a named scope that the person's memberships do not cover, or a `<team>:*` scope, is refused.
The primary is one of the person's own memberships and never a `<team>:*` one.

### Work is owned by a typed reference

WHEN the host records who owns work
THEN the owner is `user:<id>`, `team:<id>`, `project:<id>`, `root:<host>` or `plugin:<name>`
AND work from a signed-in person is `user:<id>`, and work from a root connection is `root:<host name>`
AND every `root:` owner is this host, whatever host name it carries
AND a host with no users file records no owner.

### Shutdown, status and the plugin list

WHEN a person who is not root asks the host to shut down
THEN the gate asks for `config:change`
AND `ahpd status` and `ahpd plugin list` through the daemon need `config:read`
AND the other plugin commands, `config` and `restart` need `config:write`.

### A root config change

WHEN a person who is not root dispatches `root/configChanged`
THEN a change that replaces the config, or names any key but `workspaceTrust`, needs `config:change`, because each key is one value for the whole host
AND a change that names only `workspaceTrust` needs `trust:push`, which the `member` role holds through `trust:write`
AND a change that names no key needs no grant beyond sign-in
AND only root, or a person with `config:settings`, sees the daemon's own settings in the root config.

### A policy is a record clients edit

WHEN a host keeps policies
THEN each policy is a `policy:` resource, kept in `policies.json` in the configuration directory
AND the `x-ahpd-policies` channel needs `policy:read`, and `x-ahpd/policies/put` and `x-ahpd/policies/remove` need `policy:put` and `policy:delete`
AND a plugin can replace the store through the `policies` port with `registerPolicies`.

### The policy checks are switched on in the configuration

WHEN `policies.check` is `true` in the daemon configuration file
THEN the host checks a new session's agent and computer, a turn's agent with its model, and a proxy call's model and proxy
AND when the check is off, which is the default, policies are kept and listed but refuse nothing
AND a daemon started with the check on and no policy logs one line, because it refuses every session and turn except root's.
The check has no command line flag, so that one run cannot turn it on or off by accident.

### A policy decides an agent, a model or a computer

WHEN the policy checks are on and a person asks for an agent, a model or a computer
THEN a person who holds `*:*` is allowed
AND the candidates are the policies of that kind that are active now, whose scope covers the person and that match what was asked
AND any candidate that denies wins, and the first such policy is named in the refusal
AND with no candidate, the request is refused with "no policy allows"
AND a store that cannot be read refuses the request.

### A deny binds only what was asked

WHEN a policy names a value type, such as a model, that the request did not ask about
THEN a deny policy is not a candidate for that request
AND an allow policy skips that value type and matches on the others
AND a policy that matches none of the asked value types is not a candidate
AND a `*` in a value matches any text.
This is so that a deny written for one model does not refuse a turn that named no model.
