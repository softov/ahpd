---
title: The docs say how a host joins a hub
status: done
depends: [task-05-a-restart-leaves-node-sessions-to-resume.md]
layer: "docs"
refs:
  - "[code://docs/plugins/COMPUTERS.md](../../../../docs/plugins/COMPUTERS.md) - the operator's page"
  - "[code://docs/server/REFERENCE.md](../../../../docs/server/REFERENCE.md) - the daemon's commands"
---

## Objective

The docs say how to add a node, run `ahpd join`, what the node trusts the hub with, and what happens on a restart of either.

## Files

- `UPDATE: docs/plugins/COMPUTERS.md` - a *Joined nodes* section, with the worked example.
- `UPDATE: docs/server/REFERENCE.md` - nothing: the page is generated from the registry.
- `UPDATE: docs/sdk/USERS.md` - the `node` subject, and the count of host subjects.
- `UPDATE: packages/sdk/test/users-host.test.ts` - the two lists of host subjects, which `node` was missing from.

## Steps

1. One worked example from `ahpd node add` to a session on the node.

## Validation

- Every command named exists in the registry.

## Resume

*Joined nodes* in `docs/plugins/COMPUTERS.md` comes after the ssh machines, as the second way a host reaches a machine somebody else runs.
It opens with the worked example: `ahpd node add box` on the hub, `ahpd join ws://hub.example:7331 --token <the token> --workdir /srv/box` on the box, and a session with `computer: "computer://node.box"`.
It lists the four commands, the grants that gate them, and where the nodes file sits.
Three subsections follow: what runs there, what a node trusts the hub with, and a restart of either side with `nodeRestart`.
A fourth says what a node cannot do.
The page's opening line names three runtimes, where it said Docker was the only one.

`docs/server/REFERENCE.md` is generated at build time from `reference.data.ts`, which reads the built server.
`ahpd join`, `ahpd node add|list|rm` and the `nodeRestart` daemon option are on the page with no edit.

`docs/sdk/USERS.md` already had the `node` row from task 03, and its two counts said fourteen where the table has fifteen.
Both now say fifteen, which is what `users-host.test.ts` asserts the host advertises.

Two cases in `packages/sdk/test/users-host.test.ts` failed on the branch for that reason, which task 03 left behind.
Both lists of host subjects left `node` out, and both now carry it after `container`.
They pass, with the other sixteen cases in the file.

Validation: every command named in the new text is in the registry.
The four are `node.add`, `node.list`, `node.rm` and `node.join`, and the options are `--token`, `--token-file`, `--workdir` and `AHPD_TOKEN`.