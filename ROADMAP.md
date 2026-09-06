# What is left

Not a backlog of everything imaginable. Three pieces of work that are decided, and a short list of things found by review that are worth doing but are nobody's emergency.

## Decided

### A session store

The host keeps two things that belong to it rather than to any backend, and keeps them in memory: `flags`, the `IsRead` and `IsArchived` bits every client shares, and `chosen`, the configuration values in force for a session. A restart returns every archived session to the catalogue and marks every read one unread, for everybody, with nothing said about it. See [docs/AHP.md](docs/AHP.md) under Restarts.

The shape is the one `automations` already has: a port with a memory implementation and a file implementation, passed to `createHost` rather than reached for, and selected in `@ahpd/server` with a flag beside `--automations`. Sessions themselves keep coming from the backend's transcripts; only what this host adds on top is persisted.

### An MCP server

`@ahpd/server` speaking MCP, so an agent somewhere else can list sessions, send a turn and read a transcript as tools. Not the MCP that `@ahpd/agent-claude` already speaks, which is servers offered *to* a session; this is the other direction, the daemon as a server.

Open questions: stdio or HTTP or both, whether it drives a running daemon over AHP or embeds a host, and which tools are worth exposing before the surface grows past what anyone can hold.

### Publish the badges

`@ahpd/sdk`, `@ahpd/agent-claude` and `@ahpd/server` are on npm at 0.2.0. The version badges and the CI badge are worth adding once the repository is public.

## Found by review, worth doing

A review on 6 September 2026 found nine defects across this repository and `ahpc`. All nine are fixed and each has a test. What follows is what that review suggested rather than found, kept because the review file itself is not part of this repository.

| | |
| --- | --- |
| a scenario runner | The seams already allow a real host and a real client to run against each other over an in-memory transport with no model and no socket. Built as a reusable harness that can pause a handshake, drop a connection, reattach and compare each reader against host state, it would cover the interleavings that unit tests do not. This is the idea with the most behind it: written once by hand, it is what found the late-reader bug in `ahpc` |
| say whether schedules fire | `--automations memory` accepts a schedule trigger and never fires it. What tells a client is the absent `nextRunAt`, which is subtle for somebody configuring one. Saying it in the startup line and in `ahpd status` costs almost nothing |
| assert effects, not codes | Several boundary tests assert the error code and not what actually happened. That is how two refusal messages regressed to raw errno text without a test noticing. A refusal is worth asserting by its words and by the file being unchanged |

## Deliberate duplication

`resourceWrite` is symmetrical, so `ahpd` and `ahpc` each implement the whole of it: the same flags, the same order of preconditions, the same append and insert arithmetic. `ahpc` does not depend on `@ahpd/sdk` and is not going to. Both copies carry a comment naming the other. A defect in one is a defect in both, and fixing only one is the failure mode to watch for.
