# Where these cases came from

The files in this folder are the protocol's own conformance suite, copied unchanged from the repository that publishes `@microsoft/agent-host-protocol`.

- Repository: <https://github.com/microsoft/agent-host-protocol.git>
- Tag: `v1.0.0`
- Commit: `5f16d81bb7045b66d7bc768d244feab75002d943`
- Copied: `types/test-cases/reducers/` (308 files), `types/test-cases/round-trips/` (67 cases and `KNOWN-FIDELITY-GAPS.md`) and `types/test-cases/version-negotiation.json` (22 rows).

Nothing was edited on the way in. A case that this host cannot run is named in `packages/sdk/test/ahp-test-cases.test.ts` with the reason it cannot; the case file itself stays as the protocol wrote it.

The installed package is `@microsoft/agent-host-protocol@1.0.0`, which is the version this tag publishes. The test reads both and refuses to run a case while they disagree, so a bump that leaves this folder behind fails instead of passing quietly.

To refresh the copy after a protocol bump, run `node tools/ahp-test-cases.mjs <tag>` against a checkout of the protocol repository. The script reads every file under `types/test-cases` out of that tag and rewrites this file with the tag and the commit it read. The suite never fetches anything itself: the cases are on disk, and a run that reaches the network is not the same run twice.
