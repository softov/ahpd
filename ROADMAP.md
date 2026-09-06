# What is left

Open scopes only. A row comes out when the work lands, and git keeps what was here before.

## Deliberate duplication

`resourceWrite` is symmetrical, so `ahpd` and `ahpc` each implement the whole of it: the same flags, the same order of preconditions, the same append and insert arithmetic. `ahpc` does not depend on `@ahpd/sdk` and is not going to. Both copies carry a comment naming the other. A defect in one is a defect in both, and fixing only one is the failure mode to watch for.
