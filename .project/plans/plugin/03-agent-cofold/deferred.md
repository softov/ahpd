---
title: Deferred from the agent backend over cofold
---

Three of the four things this plan set aside were built by [plan 04](../04-agent-cofold-extras/plan.md); the fourth is a reading this backend keeps deliberately, and the release step is the only thing still outside this repository.

## Closed since

- **A host tool declaring what it does.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 01; the fork it settled is decision [host-tool-declares-what-it-does](../../../decisions/host-tool-declares-what-it-does.md).
- **Fork and rewind.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 02, bundled there rather than with the ACP plan because it is the runtime's own run history that has to be cut.
- **A client's own tool.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 03.
- **A key that was never a credential.** The session's `apiKey` setting was removed after the protocol was read: a bearer token belongs to `authenticate` against the advertised protected resource, which the package now does.

## What waits

- **A browsed awaiting turn reads as complete.** `transcript(id)` has no AHP word for a run that is waiting, so a catalogue-only browse draws the open turn as finished while its pending-confirmation call carries the rest.
  It is cosmetic, the live session owns the real state, and the reading is deliberate: `transcript.ts` says so where it maps the run's status. It goes nowhere unless AHP grows a fourth turn state.

## What is not deferred, because it was refused

- **`alwaysApprove`.** AHP's `confirm` is two-valued, so "always allow this tool" is a protocol and window addition rather than a bridge one.
- **An invocation sentence on an approval.** The runtime carries an optional prompt and no invocation message, and the prompt is the half a person reads; inventing a second string would be words nobody wrote.

## What is a release task and not a plan

- **Publishing `@ahpd/agent-cofold`.** The runtime is published now: the three dependencies are `@cofold/*` ranges and no `link:` to a checkout remains, so a fresh checkout of this repository builds without a sibling. The bridge itself is still `private: true` at `0.0.1`, so un-privating it, choosing its version and pointing the prose at the installed package is the release step and not work in this repository.
