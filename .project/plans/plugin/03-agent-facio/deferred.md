---
title: Deferred from the agent backend over facio
---

## What waits

- **A host tool declaring what it does.** A destructive tool cannot be gated by facio's default policy while a `HostTool` carries no effects, so a daemon configured only from a file raises no approval for one.
  It is [plan 04](04-agent-cofold-extras/plan.md) task 01, and the fork it settled is decision [host-tool-declares-what-it-does](../../decisions/host-tool-declares-what-it-does.md).
- **Fork and rewind.** `Start.forkAt` and `Start.rewindAt` are unmapped, so the window's fork and rewind controls do nothing on a facio session.
  It is [plan 04](04-agent-cofold-extras/plan.md) task 02, bundled there rather than with the ACP plan because it is facio's own run history that has to be cut.
- **A client's own tool.** A `BoundTool` with an `owner` is left out of what the model is offered, because the round trip that reports the call against its client and waits for the result is not built.
  It is [plan 04](04-agent-cofold-extras/plan.md) task 03.
- **A browsed awaiting turn reads complete.** `transcript(id)` has no way to say a run is waiting, so a catalogue-only browse draws the open turn as finished with a pending-confirmation call in it.
  It is cosmetic and the live session owns the real state; it goes with task 02 if that work touches the transcript, and nowhere otherwise.
- **A key that was never a credential.** The session's `apiKey` setting was removed after the fact once the protocol was read: a bearer token belongs to `authenticate` against the advertised protected resource, which the package now does.
  Nothing waits here; it is recorded so a reader of the built plan knows the schema changed.

## What is not deferred, because it was refused

- **`alwaysApprove`.** AHP's `confirm` is two-valued, so "always allow this tool" is a protocol and window addition rather than a bridge one.
- **An invocation sentence on an approval.** facio carries an optional prompt and no invocation message, and the prompt is the half a person reads; inventing a second string would be words nobody wrote.

## What is a release task and not a plan

- **Publishing facio, then this package.** `@facio/agents` is `0.0.1` and unpublished, so the bridge is `link:`ed to a checkout, its packages are built by hand, and `@ahpd/agent-cofold` is `private: true`.
  When facio publishes, the links become ranges, the `private` flag goes, and the version joins the docs; that is a checklist on the release, not work in this repository.
