# What is left

Open scopes only. A row comes out when the work lands, and git keeps what was here before.

## Decided

### A session store

The host keeps two things that belong to it rather than to any backend, and keeps them in memory: `flags`, the `IsRead` and `IsArchived` bits every client shares, and `chosen`, the configuration values in force for a session. A restart returns every archived session to the catalogue and marks every read one unread, for everybody, with nothing said about it. See [docs/AHP.md](docs/AHP.md) under Restarts.

The shape is the one `automations` already has: a port with a memory implementation and a file implementation, passed to `createHost` rather than reached for, and selected in `@ahpd/server` with a flag beside `--automations`. Sessions themselves keep coming from the backend's transcripts; only what this host adds on top is persisted.

### An MCP server

An MCP server so an agent somewhere else can list sessions, send a turn and read a transcript as tools. Not the MCP that `@ahpd/agent-claude` already speaks, which is servers offered *to* a session; this is the other direction, a host driven as a server.

It lives in `ahpc` rather than here, and no new package: MCP is a client of a host, `ahpc` already is one, and its `HostConnection` is the backend the tools call. One table of declarations behind three surfaces - stdio for a client that owns the process, streamable HTTP for a shared one, and a plain HTTP API for anything that is not an MCP client.

## Deliberate duplication

`resourceWrite` is symmetrical, so `ahpd` and `ahpc` each implement the whole of it: the same flags, the same order of preconditions, the same append and insert arithmetic. `ahpc` does not depend on `@ahpd/sdk` and is not going to. Both copies carry a comment naming the other. A defect in one is a defect in both, and fixing only one is the failure mode to watch for.

One place where they have already drifted, pinned by a test in `ahpc`'s `publish.test.ts`: writing to a path whose final component is a symbolic link. `writable` here resolves only the parent, so `O_NOFOLLOW` refuses the write. `ahpc` resolves the whole path, so a link whose destination is still published is written *through*. Reading follows links at both ends and that is not in question - only which of the two the write half should be.
