---
title: "Release run toward 0.15.0, started 2026-11-11"
---

# Release run toward 0.15.0

Softov is away. This run reviews, tests the agents, writes problems, plans, builds and opens PRs, and never merges. This file is the notepad: what is in hand now, the queue, and links.

## Now

- Stopped. *Report* holds the end of the run.

## Queue

1. ~~Review HANDOFF, pending/release.md and pending/triage.md.~~ Read; the edits go in with the plan commit.
2. ~~Test the agents on a test daemon on port 39200.~~ Done, see *Agent tests*.
3. ~~Problem files and the ranked report.~~ [problems-report-20261111.md](problems-report-20261111.md).
4. ~~Plans for the problems worth fixing now.~~ Three, in *Written*.
5. ~~Builds in worktrees, PRs, CI.~~ Five PRs, all green.
6. ~~Ideas.~~ Five, in *Written*.

## Agent tests

Test daemon from `pending-check` at `7cf919e4b` (origin/main), port 39200, `XDG_*_HOME`, `PI_CODING_AGENT_DIR` and `COFOLD_HOME` under `~/ahpd-check`. Keys only in the daemon's environment, records name them with `fromEnv`. The launcher is in the session scratchpad, not in the repository. Stopped by pid after each phase. Ports 5180 and 37537 untouched.

| Agent | Configuration | Result |
| --- | --- | --- |
| claude | Anthropic key, `haiku` | pass |
| claude-or | OpenRouter through `ANTHROPIC_BASE_URL`, `haiku` mapped to `anthropic/claude-haiku-4.5` | pass |
| dsh | ACP preset, DeepSeek key | pass |
| codex | ACP, OpenAI key | OpenAI answers "Quota exceeded": the key has no credit. ahpd shows the vendor's sentence |
| gemini | ACP, Gemini key, default model `auto` | the turn shows nothing for 4 minutes: Google answers 503 and the CLI retries. Same 503 from `gemini -p` by hand |
| gemini | `gemini-3-flash-preview` | pass |
| qwen-or | ACP, `OPENAI_BASE_URL` on OpenRouter | pass |
| opencode-or | ACP, OpenRouter key, default and `openrouter/deepseek/deepseek-chat` | pass |
| kilo-or | ACP, default model | "You need to sign in to use this model": Kilo's own model |
| kilo-or | `openrouter/deepseek/deepseek-chat` | pass |
| pi-ds | record `deepseek/deepseek-chat`, DeepSeek key | ran on `openrouter/deepseek/deepseek-chat`: wrong provider, see the pi problem |
| pi-bad | record `deepseek/deepseek-chat`, bad DeepSeek key | answered on OpenRouter, so the bad key was never used |
| pi-ds | record `deepseek/deepseek-flash` | pass |
| pi-bad | record `deepseek/deepseek-flash`, bad key | clear 401 |
| pi-or, pi-orurl | record on OpenRouter, by provider and by `baseUrl` | pass |
| pi-none | harness `deepseek/deepseek-chat`, not in pi's list | pi fell back to `anthropic/claude-opus-4-8`, pi's own fallback |
| pi-none | harness `deepseek/deepseek-flash` | pass |
| pi-none | plugin option `openrouter/deepseek/deepseek-chat` over the harness | pass |
| cf-ds | record on DeepSeek `deepseek-chat` | pass |
| cf-or | record on OpenRouter `deepseek/deepseek-chat` | 400: cofold sent `deepseek-chat`, see the cofold problem |
| cf-or | picker id `cf-or/deepseek/deepseek-chat` | pass, 41 s |
| cf-none | harness copapo file and `COFOLD_*` | pass |
| cf-none | plugin option `default/deepseek-flash` | pass |
| cf-bad | bad key | clear 401 |
| cofold | plugin option `apiKey` as `fromEnv` | plugin skipped: "options.apiKey must be text" |

Not run: Copilot, Cursor and Devin, which need their own accounts. Codex on OpenRouter, which needs a `config.toml` provider. Any machine or container path.

Seen and not a fault of ahpd:

- A record file edited by hand applies at the next start, as the channel has no watch.
- dsh's model ids are JSON arrays as strings, such as `["deepseek-official","deepseek-v4-flash"]`, as dsh sends them.
- The daemon's PATH has no `rg`, so Gemini falls back to its own grep, as [briefs/at-lists-files-without-rg-on-the-path.md](../briefs/at-lists-files-without-rg-on-the-path.md) covers.

## Decisions taken in this run

- The test daemon is run by hand from a launcher, not with `source test-daemon.sh`: the classifier refused the script's `ahpd stop`. The launcher stops nothing; the daemon is stopped by pid.
- Three problems are planned now. The two from the tests hurt any user of pi or cofold on a common setup.
- The install problem is small, and on the first path a new user runs. The rest wait, as the report ranks them.
- PR bodies are written here and opened without showing them first, as the run's brief says to work without asking.
- #296, #297 and #298 all add a line to `docs/updates/v0_15.md`. Each later branch has the earlier ones merged in, and CI ran on it, so they merge in that order.
- No key goes in the test vault. The cofold plugin option test names a model only, and the harness variables give the endpoint and key.

## Written

- Problems, new: [a-plugin-option-key-cannot-come-from-the-environment.md](../problems/a-plugin-option-key-cannot-come-from-the-environment.md). The pi and cofold problems were planned and deleted; they are in `git://af15608ab`.
- Ideas: [a-quiet-turn-says-it-is-waiting.md](../ideas/a-quiet-turn-says-it-is-waiting.md), [a-pi-fallback-model-shows-on-the-agent.md](../ideas/a-pi-fallback-model-shows-on-the-agent.md), [a-cofold-picker-lists-the-configured-model-once.md](../ideas/a-cofold-picker-lists-the-configured-model-once.md), [dsh-names-its-models-as-json.md](../ideas/dsh-names-its-models-as-json.md), [the-test-daemon-script-stops-by-pid.md](../ideas/the-test-daemon-script-stops-by-pid.md).
- Plans, ranked 1 to 3 in the report:
  - [pi/20261111-1444-a-qualified-pi-model-keeps-its-provider](../plans/pi/20261111-1444-a-qualified-pi-model-keeps-its-provider/plan.md)
  - [cofold/20261111-1445-a-cofold-model-keeps-its-slashes](../plans/cofold/20261111-1445-a-cofold-model-keeps-its-slashes/plan.md)
  - [daemon/20261111-1447-a-second-install-finds-the-first](../plans/daemon/20261111-1447-a-second-install-finds-the-first/plan.md)
- Plans, second round, small and clear: report rows 43 and 22.
  - [container/20261111-1507-a-parts-file-names-itself](../plans/container/20261111-1507-a-parts-file-names-itself/plan.md)
  - [plugin/20261111-1507-a-plugin-that-fails-to-start-says-so](../plans/plugin/20261111-1507-a-plugin-that-fails-to-start-says-so/plan.md)

## PRs

| PR | Branch | Worktree | CI |
| --- | --- | --- | --- |
| [#296](https://github.com/ahpio/ahpd/pull/296) | `pi/20261111-1444-a-qualified-pi-model-keeps-its-provider` | `pi-qualified-model` | green, run 43043230880 |
| [#297](https://github.com/ahpio/ahpd/pull/297) | `cofold/20261111-1445-a-cofold-model-keeps-its-slashes`, with #296 merged in | `cofold-model-slashes` | green, run 43044470675 on `4a19a7a39` |
| [#298](https://github.com/ahpio/ahpd/pull/298) | `daemon/20261111-1447-a-second-install-finds-the-first`, with #297 merged in | `install-second-run` | green, run 43045027771 on `292cfff1d` |
| [#299](https://github.com/ahpio/ahpd/pull/299) | `container/20261111-1507-a-parts-file-names-itself` | `parts-file-names-itself` | green, run 43046232481 on `9b36ae2d9` |
| [#300](https://github.com/ahpio/ahpd/pull/300) | `plugin/20261111-1507-a-plugin-that-fails-to-start-says-so` | `plugin-fails-to-start` | green, run 43046938162 on `cc879cc42` |

## Report

The run stopped on 2026-11-11 after five PRs. Nothing was merged.

### PRs and CI

*PRs* lists the five, with their branch, worktree and CI run. `check` and `check-windows` are green on #296, #297 and #298, each on its current head. #299 and #300 are green too, with every job passing.

### Problems

- Fixed in a PR, five:
  - #296: the pi model that ran on another provider.
  - #297: the cofold model that lost its first segment.
  - #298: the second install that reinstalled.
  - #299: the parts file errors that named the shipped file.
  - #300: the plugin alert that named the daemon's start.
- New and left: [a-plugin-option-key-cannot-come-from-the-environment.md](../problems/a-plugin-option-key-cannot-come-from-the-environment.md). It needs a choice between reading `fromEnv` in plugin options and saying in the docs that they take `$secret` only.
- Left: 41 more, ranked in [problems-report-20261111.md](problems-report-20261111.md). The next group in the report is majors that a person meets, such as the lost Claude turn. Each needs a cause found or a design chosen, and none fit this run.

### Plans and ideas

*Written* lists the five plans and five ideas.

### What needs Softov's word

- Merges: #296, then #297, then #298, in that order. #299 and #300 stand alone.
- Closing plans as `built`: the five of this run after review, and the 13 that HANDOFF lists with every task `implemented`.
- The problem on plugin option keys: which of its two fixes.
- Checks by hand: unchanged, as [pending/triage.md](../pending/triage.md) orders them. No check by hand was run in this run.
- The OpenAI key has no credit, so Codex cannot be tested. The keys in the private env file were already due for rotation, as HANDOFF says.

### Softov's daemon

It was not touched: ports 5180 and 37537 stayed as they were. It needs no restart for this run, because nothing merged. A restart after #296, #297, #299 and #300 merge wires in all four.
That is the pi provider rule, the cofold model ids, the parts file errors and the plugin alert text.
It also wires in #292 to #295, which HANDOFF already lists. #298 changes only `install.sh`.

### Left on this machine

- Worktrees in `/github/ahpd.worktrees/`: `pi-qualified-model`, `cofold-model-slashes`, `install-second-run`, `parts-file-names-itself` and `plugin-fails-to-start`, one per PR. `pending-check` moved to `7cf919e4b` and was built.
- `~/ahpd-check` holds the test daemon's config, its agent records, a pi settings file and a copapo file, none with a key. The test daemon is stopped.

### Not run

- Copilot, Cursor and Devin, which need their own accounts, and Codex on OpenRouter.
- Any machine, container or remote path, and anything on Windows or macOS except through CI.
- The sdk suite: no branch touched `packages/sdk`.
