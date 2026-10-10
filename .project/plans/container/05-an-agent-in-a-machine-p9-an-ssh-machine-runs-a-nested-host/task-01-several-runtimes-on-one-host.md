---
title: The plugin serves several runtimes, and a machine's id says which
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L59](../../../../packages/computer/src/plugin.ts#L59) - the `runtime` enum"
  - "[code://packages/computer/src/plugin.ts#L227](../../../../packages/computer/src/plugin.ts#L227) - the `'docker'` cast"
  - "[code://packages/computer/src/plugin.ts#L320-L326](../../../../packages/computer/src/plugin.ts#L320-L326) - the one `dockerRuntime`"
  - "[code://packages/computer/src/plugin.ts#L410-L454](../../../../packages/computer/src/plugin.ts#L410-L454) - `made`, which wraps it"
  - "[code://packages/computer/src/plugin.ts#L562-L646](../../../../packages/computer/src/plugin.ts#L562-L646) - `reach` and `nestedHost`, docker's argv in the plugin"
  - "[code://packages/computer/src/manifest.ts#L430-L433](../../../../packages/computer/src/manifest.ts#L430-L433) - the runtime check"
  - "[code://packages/computer/src/runtime.ts#L194-L212](../../../../packages/computer/src/runtime.ts#L194-L212) - `ComputerRuntime`"
  - "[code://packages/computer/src/runtime.ts#L600](../../../../packages/computer/src/runtime.ts#L600) - `kind: 'docker'`"
  - "[code://packages/computer/src/runtime.ts#L827-L831](../../../../packages/computer/src/runtime.ts#L827-L831) - `capabilities`"
  - "[code://packages/computer/src/provider.ts#L293-L294](../../../../packages/computer/src/provider.ts#L293-L294) - a create's default runtime is `runtime.kind`"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, which inspects through `dockered` today"
  - "[code://packages/computer/src/plugin.ts#L504-L506](../../../../packages/computer/src/plugin.ts#L504-L506) - the `stopping` loop that closes every open stretch, one `await` after another"
---

## Objective

The plugin holds one runtime per value it serves and routes every call by the machine id, so a later runtime is a module and an id prefix, and nothing a docker machine does today changes.

## Files

- `UPDATE: packages/computer/src/runtime.ts:194-212` - `ComputerRuntime` gains `how(id, asked: SpawnOptions): Promise<Spawn | undefined>`, `hostCommand(id): Promise<string[] | undefined>` (the profile's `host` or the default) and `remote: boolean`.
- `UPDATE: packages/computer/src/runtime.ts:569-833` - `dockerRuntime` implements `how` and `hostCommand` with the argv now at `plugin.ts:576-619` and `:635-638`; `within` moves with it.
- `CREATE: packages/computer/src/router.ts` - `spellMachineId(runtime, name)` and `parseMachineId(id): { runtime, name }`, the one place an id is spelled and read; and `routed(runtimes, fallback)`: a `ComputerRuntime` that lists every runtime's machines with ids from `spellMachineId`, and sends every other call to the runtime `parseMachineId` names, with the name alone. `list` asks every runtime with `Promise.allSettled`, each bounded by a per-runtime timeout, keeps the rows of every runtime that answered, and reports each that threw or timed out with one log line naming it.
- `UPDATE: packages/computer/src/plugin.ts:56-91, 227, 320-326, 410-454, 562-646` - the enum lists the values built (`docker`, and `ssh` once task 02 lands); the cast goes; `made` wraps the router; `reach` and `nestedHost` ask the routed runtime; `claimOf` (`:403-412`) inspects through the router, so a machine on any runtime has its owner read; the `stopping` loop (`:504-506`) closes each stretch in its own `try`, so one runtime that fails does not stop the others' stretches from closing.
- `UPDATE: packages/computer/src/manifest.ts:430-433` - a body's `runtime` must be one this host serves, and a body may not make a machine with a runtime that only lists (ssh).
- `UPDATE: packages/computer/test/computer-plugin.test.ts`, `packages/computer/test/computer-spawn.test.ts`.

## Steps

1. For now an id is `<runtime>.<name>` (`ssh.dev86`, `libvirt.<name>`, `node.<name>`, `docker-<profile>.<name>`), and the local Docker keeps a bare name so no machine made today changes id; a local docker name that holds a dot is refused at create. Only `spellMachineId` and `parseMachineId` know this, so a later spelling changes those two functions; nothing else splits an id on a dot.
2. Move docker's `how` argv and `within` into `dockerRuntime` unchanged; the plugin's `reach` keeps the dev container branch until decision `a-dev-container-is-reached-by-docker-exec` changes it elsewhere.
3. `routed().kind` is the plugin's `runtime` option, which stays the default for a create that names none; `capabilities()` answers the default runtime's, and a machine's own `capabilities` leaf answers its runtime's.
4. `made` meters every runtime: one that makes machines opens and closes a stretch on start and stop as today; one that only lists (ssh) opens a stretch when a listing sees a machine reachable and closes it when one sees it unreachable or the daemon stops, charged to the host (`root:<host>`). The rule for a listing runtime is one function in `made`, so it can change; it takes reachability events (`reachable(id)`, `unreachable(id)`), and a listing is one source of them, so p10's node registry can feed the same function from its connect and drop events.
5. The router's `list` never throws because one runtime did: Docker's `list` throws by design when Docker does not answer, and that must not empty a listing that ssh machines answered.

## Validation

- `computer-plugin.test.ts`: with only docker configured, every existing case passes with the same ids and argv.
- A router with two fake runtimes lists both sets, prefixed, and `inspect('fake.x')` reaches the second with `x`.
- A body asking for a runtime this host does not serve is refused naming the ones it does.
- `parseMachineId(spellMachineId(r, n))` answers `{ r, n }` for every runtime, a bare name answers the local Docker, and `docker-far.box` answers the `docker-far` runtime.
- A fake listing runtime whose machine turns reachable then unreachable writes one stretch charged to the host.
- A router with one runtime whose `list` throws and one that answers lists the second's rows and logs one line naming the first; a runtime that never answers is cut off by the timeout the same way.
- `claimOf` for `fake.x` reads the owner through the second runtime.
- With one runtime's `inspect` throwing at `stopping`, every other machine's stretch is still written.
- `pnpm --filter @ahpd/computer test` and `pnpm typecheck` pass.

## Resume

- **Implemented** 2026-10-10 on `build/agents/1676a492`.
- `router.ts` is new: `BARE`, `spellMachineId`, `parseMachineId`, `routed`, `Routed` and `RoutedOptions`, with `list` asking every runtime, bounding each by a timeout, keeping the rows that answered and logging one line for each runtime that did not.
- `ComputerRuntime` gains `remote`, `how` and `hostCommand`; `dockerRuntime` answers all three with today's argv, and `within` moved into `runtime.ts` unchanged.
- `plugin.ts` holds the runtimes, wraps the router in `made`, routes `claimOf`, `reach` and `nestedHost` through it, and closes each stretch in its own `try` at `stopping`.
- `listingMeter` and `makesMachines` are exported from `plugin.ts`; `manifest.ts` and `provider.ts` take the served runtime values, and `DockerOptions` takes the profiles' `host` map.
- Tests: `computer-runtimes.test.ts` is new and covers the id spelling, the routing, a listing that survives a throwing and a hanging runtime, the listing meter and `makesMachines`; `computer-plugin.test.ts` gains the refusal of a body naming a runtime this host does not serve; the fake runtime in `computer.test.ts` gained the three new members.
- `pnpm typecheck` and `npx vitest run packages/computer/test --maxWorkers=2 --testTimeout=10000` pass.
- Validation bullets 5, 7 and 8 need a second runtime inside the plugin, so they wait for task 02; bullet 5's rule is covered directly by `listingMeter`.
- Files the Files list did not name: `index.ts` exports the router; `computer-runtimes.test.ts` is a new test file; `manifest.ts`, `provider.ts` and `runtime.ts` carry the served runtime values.
- A dot anywhere in a name on the bare runtime is refused, not only a name that starts with a served runtime value and a dot, because `docker-far.box` must answer the `docker-far` runtime.
