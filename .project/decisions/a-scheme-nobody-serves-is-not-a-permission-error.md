---
title: A scheme nobody serves is not a permission error
status: accepted
date: 2026-09-23
refs:
  - "[file:///github/externals/agent-host-protocol/types/common/errors.ts#L41-L90](file:///github/externals/agent-host-protocol/types/common/errors.ts#L41-L90) - `NotFound` and `PermissionDenied`, in the protocol's own words"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, which falls back to the file store for a scheme no provider owns"
  - "[code://packages/sdk/src/resources.ts#L45-L60](../../packages/sdk/src/resources.ts#L45-L60) - `why`, the sentence the file store answers with"
  - "[code://test/uri-resources.test.ts#L84-L93](../../test/uri-resources.test.ts#L84-L93) - the case that pins the current code"
  - "[code://.project/research/how-a-host-advertises-a-resource-scheme.md](../../.project/research/how-a-host-advertises-a-resource-scheme.md) - the reading this settles"
---

## Context

A resource command for a scheme no provider owns reaches `storeFor`, finds nothing for the scheme, and is handed to the file store anyway.
The file store sees a URI that is not a `file:` one and refuses it as `-32009` about a subject that is not there to read, with the sentence `notes://local/x is not this host's to read: nothing here serves notes:, and no connected client publishes it`.

That code is a permission answer, and the situation is not a permission question.
The protocol defines `-32008` as "the requested file, folder, or URI does not exist" and `-32009` as "the client is not permitted to access the requested resource".
Nothing about a scheme nobody serves says the client is not permitted: it says the host has nothing that serves it.
The host already says that well in one neighbouring case: a provider that exists but does not implement a method answers `-32601`, which is what it answers for any operation it does not have.

The difference matters to a client, because a capability probe is exactly this request: asking `resourceList` on `computer://` to find out whether this host has computers. Told `-32009`, a client has to read the sentence to tell a missing feature from a refusal, and a person who is genuinely refused gets the same code as a host that has no computers at all.

## Decision

A resource command naming a scheme no provider serves answers `-32601`, with a sentence naming the scheme, and it is refused by the host before the file store is asked.
`-32009` stays for what it means: a person's role not covering the command, which the gate answers, and a store that refuses a path it does not permit.
The sentence stays as it is - `nothing here serves <scheme>:, and no connected client publishes it` - because it is the true one and it already names both the scheme and the case of a client that published one and went away.

## Consequences

A client can tell a missing scheme from a refused one by the code, so a capability probe is a branch rather than a string match and a real refusal is not confused with a host that has no such feature.
The answer is the same one this host already gives for an operation a provider does not implement, so there is one answer for "I cannot do that" rather than two that depend on how far the request got.
A URI whose publishing client has hung up reads as `-32601` rather than `-32009`; it is the same truth in a different code, and the sentence still says which case it was.
One test changes: `test/uri-resources.test.ts` asserts `-32009` for `notes://local/x`, and it becomes `-32601` with the same message.

## Options

- **`-32008` NotFound.** Rejected: closer than `-32009`, but "the URI does not exist" describes a thing that is not there rather than a host that serves no such scheme, and the host's own answer for an operation it does not serve is already `-32601`.
- **Keep `-32009` and let a client read the sentence.** Rejected: it is feature detection through prose, it makes a missing scheme indistinguishable from a refusal by code, and it is the situation this decision exists to remove.
- **Refuse in the file store rather than before it.** Rejected: the file store is a filesystem and a scheme it does not know is not its business to classify; the routing step is the one that knows no provider was found.
