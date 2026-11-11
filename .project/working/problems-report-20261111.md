---
title: "Problems report, 2026-11-11"
---

# Problems report, 2026-11-11

Every file in [problems/](../problems/) on 2026-11-11 at `af15608ab`, ranked by how much it hurts 0.15.0 or a user. Three are new from this run's agent tests, marked *new*. The rank reads each file's own symptom and impact; "not reproduced" files were read from the code only.

None of them blocks the tag: each is a fault in one path, with a workaround or a narrow reach. The first group is what a person meets on a common path, so it goes first.

## Fix before 0.15.0

| # | Problem | Severity | Why here |
| --- | --- | --- | --- |
| 1 | A pi model named with its provider runs on another provider *new*, planned as [pi/20261111-1444](../plans/pi/20261111-1444-a-qualified-pi-model-keeps-its-provider/plan.md) | major | A pi record's model runs on another provider's paid account. The README's own example does it |
| 2 | A cofold model with a slash on an explicit endpoint loses its first segment *new*, planned as [cofold/20261111-1445](../plans/cofold/20261111-1445-a-cofold-model-keeps-its-slashes/plan.md) | major | Every OpenRouter model named on a cofold record fails, and the picker's first row is the broken one |
| 3 | An install at the same version says to load a new version, planned as [daemon/20261111-1447](../plans/daemon/20261111-1447-a-second-install-finds-the-first/plan.md) | minor | The install script is the first thing a new user runs; a second run reinstalls and says to restart |

## Major, on a path a person meets

| # | Problem | Severity | Why here |
| --- | --- | --- | --- |
| 4 | [a-running-claude-turn-is-lost-while-the-cli-keeps-working.md](../problems/a-running-claude-turn-is-lost-while-the-cli-keeps-working.md) | major | A prompt vanishes from history while the CLI works on it. Cause unknown, one sighting |
| 5 | [a-claude-session-from-vs-code-has-no-owner.md](../problems/a-claude-session-from-vs-code-has-no-owner.md) | major | The owner's command check never applies to VS Code sessions, so approved commands ask |
| 6 | [an-admins-pushed-terminal-rule-applies-to-every-session.md](../problems/an-admins-pushed-terminal-rule-applies-to-every-session.md) | major | One admin's `rm` rule runs `rm` unasked in another person's session. A safety gap on a shared host |
| 7 | [a-system-tunnel-that-fails-at-start-is-not-retried.md](../problems/a-system-tunnel-that-fails-at-start-is-not-retried.md) | major | Remote access stays down after a start-time 401 until a disable and enable |
| 8 | [a-sessions-changes-are-kept-under-two-keys.md](../problems/a-sessions-changes-are-kept-under-two-keys.md) | major | The Changes view misses files a shell wrote, and a folder with no git shows no counts |
| 9 | [a-worktree-made-after-start-offers-no-changeset.md](../problems/a-worktree-made-after-start-offers-no-changeset.md) | major | A new worktree shows counts on its row and nothing in Changes |
| 10 | [a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md](../problems/a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md) | major | An old plugin that fails to load cannot be updated from a client, only from the terminal |
| 11 | [a-webhook-automation-skips-the-wake-cap.md](../problems/a-webhook-automation-skips-the-wake-cap.md) | major | A webhook sender can wake an automation past its cap and overlap mode. Not reproduced |
| 12 | [a-bot-chat-is-not-a-subagent-of-its-back-session.md](../problems/a-bot-chat-is-not-a-subagent-of-its-back-session.md) | major | Each bot turn path needs its own fix; the shape is the cause |
| 13 | [a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md](../problems/a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md) | major | A hand edit moves a bot's owner at a restart with no log line |

## Major, on machines, nodes and containers

These hurt a user of machines and nodes, a smaller group than the ones above.

| # | Problem | Severity |
| --- | --- | --- |
| 14 | [a-disposed-session-not-held-leaves-its-machine.md](../problems/a-disposed-session-not-held-leaves-its-machine.md) | major |
| 15 | [a-removed-node-keeps-serving-its-running-sessions.md](../problems/a-removed-node-keeps-serving-its-running-sessions.md) | major |
| 16 | [node-rm-at-the-terminal-does-not-drop-a-joined-node.md](../problems/node-rm-at-the-terminal-does-not-drop-a-joined-node.md) | major |
| 17 | [a-dev-container-stop-misses-a-session-placed-by-computer-uri.md](../problems/a-dev-container-stop-misses-a-session-placed-by-computer-uri.md) | major |

## Minor, a person sees it

| # | Problem | Severity | Why here |
| --- | --- | --- | --- |
| 18 | [a-refused-back-turn-stays-working-in-another-window.md](../problems/a-refused-back-turn-stays-working-in-another-window.md) | minor | A spinner that never stops. HANDOFF asks for a check after the restart |
| 19 | [an-absolute-path-after-at-is-read-as-relative.md](../problems/an-absolute-path-after-at-is-read-as-relative.md) | minor | `@/` lists the session folder, not `/` |
| 20 | [a-cofold-title-changes-after-a-restart.md](../problems/a-cofold-title-changes-after-a-restart.md) | minor | A title moves after a restart |
| 21 | [a-plugin-option-key-cannot-come-from-the-environment.md](../problems/a-plugin-option-key-cannot-come-from-the-environment.md) *new* | minor | One `fromEnv` option skips the whole plugin |
| 22 | [a-plugin-enabled-later-that-fails-says-when-ahpd-started.md](../problems/a-plugin-enabled-later-that-fails-says-when-ahpd-started.md) | minor | A wrong time in a failure line |
| 23 | [a-plugin-that-does-not-resolve-has-an-id-with-a-slash.md](../problems/a-plugin-that-does-not-resolve-has-an-id-with-a-slash.md) | minor | A broken plugin a client cannot touch |
| 24 | [the-served-plugin-config-does-not-know-a-plugin-by-its-id.md](../problems/the-served-plugin-config-does-not-know-a-plugin-by-its-id.md) | minor | A plugin listed twice |
| 25 | [a-reopened-claude-session-shows-no-compaction.md](../problems/a-reopened-claude-session-shows-no-compaction.md) | minor | Live and reopened views differ |
| 26 | [pi-replay-drops-compaction-and-branch-summaries.md](../problems/pi-replay-drops-compaction-and-branch-summaries.md) | minor | The same gap for pi |
| 27 | [a-pi-model-row-carries-no-price.md](../problems/a-pi-model-row-carries-no-price.md) | minor | No client draws `_meta.pricing` yet |
| 28 | [a-bot-shows-in-the-session-picker-between-isolation-and-branch.md](../problems/a-bot-shows-in-the-session-picker-between-isolation-and-branch.md) | minor | Client and agent not recorded |
| 29 | [a-branch-with-a-pull-request-offers-none-for-a-later-edit.md](../problems/a-branch-with-a-pull-request-offers-none-for-a-later-edit.md) | minor | A missing button after a second commit |
| 30 | [ahpapp-shows-secret-fields-as-plain-text.md](../problems/ahpapp-shows-secret-fields-as-plain-text.md) | minor | ahpapp's to fix, in its own repository |
| 31 | [claude-picks-its-own-wake-tool-over-the-hosts.md](../problems/claude-picks-its-own-wake-tool-over-the-hosts.md) | minor | A wake lost at a restart |
| 32 | [a-claude-call-confirmed-while-streaming-skips-its-bookkeeping.md](../problems/a-claude-call-confirmed-while-streaming-skips-its-bookkeeping.md) | minor | A status line with no subject |
| 33 | [an-acp-mode-option-never-replaces-the-preset-modes.md](../problems/an-acp-mode-option-never-replaces-the-preset-modes.md) | minor | Not reproduced |
| 34 | [an-acp-preset-and-a-native-agent-share-one-id.md](../problems/an-acp-preset-and-a-native-agent-share-one-id.md) | minor | Only with pi over ACP and native pi both on |
| 35 | [every-machine-reports-the-default-runtimes-capabilities.md](../problems/every-machine-reports-the-default-runtimes-capabilities.md) | minor | A form field that does not apply |
| 36 | [ahpd-join-stops-when-a-proxied-hub-is-down.md](../problems/ahpd-join-stops-when-a-proxied-hub-is-down.md) | minor | A node behind a proxy |
| 37 | [a-nested-chat-hands-on-an-older-inner-cut.md](../problems/a-nested-chat-hands-on-an-older-inner-cut.md) | minor | Only with an inner host older than host/114 |

## Minor, an operator or a caller sees it

| # | Problem | Severity |
| --- | --- | --- |
| 38 | [a-claimed-chat-is-read-as-a-session.md](../problems/a-claimed-chat-is-read-as-a-session.md) | minor, custom roles only |
| 39 | [a-bad-meta-header-from-root-or-a-session-is-ignored.md](../problems/a-bad-meta-header-from-root-or-a-session-is-ignored.md) | minor |
| 40 | [a-minute-limit-reads-nothing-under-a-plugin-usage-store.md](../problems/a-minute-limit-reads-nothing-under-a-plugin-usage-store.md) | minor |
| 41 | [a-restart-refused-late-says-force-to-an-ahp-caller.md](../problems/a-restart-refused-late-says-force-to-an-ahp-caller.md) | minor |
| 42 | [each-chat-action-walks-every-session-and-chat.md](../problems/each-chat-action-walks-every-session-and-chat.md) | minor, a cost at scale |
| 43 | [a-parts-file-read-from-elsewhere-reports-the-shipped-one.md](../problems/a-parts-file-read-from-elsewhere-reports-the-shipped-one.md) | minor |

## Tests and CI

These hurt the release only as a red run to rerun.

| # | Problem | Severity |
| --- | --- | --- |
| 44 | [three-cases-fail-at-random-on-windows.md](../problems/three-cases-fail-at-random-on-windows.md) | minor |
| 45 | [two-attachment-cases-time-out-on-windows.md](../problems/two-attachment-cases-time-out-on-windows.md) | minor |
| 46 | [a-cofold-titling-case-times-out-on-windows.md](../problems/a-cofold-titling-case-times-out-on-windows.md) | minor |
| 47 | [a-test-removes-its-folder-while-a-child-writes-in-it.md](../problems/a-test-removes-its-folder-while-a-child-writes-in-it.md) | minor |
| 48 | [steering-test-cases-exempt-whole-keys.md](../problems/steering-test-cases-exempt-whole-keys.md) | minor |

plugin/20261106-1058, *CI fails only for a real fault*, is the planned home for 44 to 47.

## Seen in the tests and not filed

- Gemini's default model `auto` answered 503 for 4 minutes on 2026-11-11, and the turn showed nothing while the CLI retried. `gemini -p` by hand got the same 503. It is Google's side; a named model such as `gemini-3-flash-preview` ran.
- The OpenAI key has no credit, so Codex ends at "Quota exceeded". After that failed turn, codex-acp answered "Internal error" to the session's delete, and ahpd logged it.
