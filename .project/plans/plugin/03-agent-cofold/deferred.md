---
title: Deferred from the agent backend over cofold
---

One reading this backend keeps deliberately is all that waits.

## What waits

- **A browsed awaiting turn reads as complete.** `transcript(id)` has no AHP word for a run that is waiting, so a catalogue-only browse draws the open turn as finished while its pending-confirmation call carries the rest.
  It is cosmetic, the live session owns the real state, and the reading is deliberate: `transcript.ts` says so where it maps the run's status. It goes nowhere unless AHP grows a fourth turn state.

## Closed since

- **A host tool declaring what it does.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 01; the fork it settled is decision [host-tool-declares-what-it-does](../../../decisions/host-tool-declares-what-it-does.md).
- **Fork and rewind.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 02, bundled there rather than with the ACP plan because it is the runtime's own run history that has to be cut.
- **A client's own tool.** Built by [plan 04](../04-agent-cofold-extras/plan.md) task 03.
- **A key that was never a credential.** The session's `apiKey` setting was removed after the protocol was read: a bearer token belongs to `authenticate` against the advertised protected resource, which the package now does.
- **Publishing `@ahpd/agent-cofold`.** The bridge is `0.6.3`, not private, with `@cofold/*` ranges and no `link:` to a checkout.
