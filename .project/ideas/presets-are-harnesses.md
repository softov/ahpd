---
title: Presets are harnesses
created: 2026-10-02
---

Today a second Claude endpoint is agent-claude loaded a second time with its own `provider` and `displayName` (claude/12), and a set of options tried in some sessions is a preset picked on the new-session screen (claude/10).
The proposal joins them: agent-claude is loaded once, and every preset is its own harness, so a preset carries `provider` and `displayName` beside its options and the `preset` session key goes away.
"Claude Code" and "Claude Code (OpenRouter)" are then two presets of one load, a person picks a harness rather than a harness and then a preset, and there is one picker instead of two.

| | |
| --- | --- |
| What a preset holds | Its options as today (`sandbox`, `thinking`, `outputStyle`, `env`, `extraArgs`), plus `provider` and `displayName`. A preset with neither keeps the plugin's own, so one preset is today's install unchanged. |
| What the plugin registers | One `Agent` per preset, sharing the probe, the catalogue and the transcript reader, so the transcripts are read once rather than once per harness. |
| Which harness a transcript is | The provider the host recorded for the session ([a-listed-session-belongs-to-the-provider-the-host-recorded](../decisions/a-listed-session-belongs-to-the-provider-the-host-recorded.md)), the same answer the host dedupe gives; the plugin cannot tell from the transcript. |
| What goes | The `preset` session key and its schema, the stored `preset` a session resumes with (its provider says the same), and the second `plugins` entry in `config.json`. |
| Supersedes | claude/10's "two or more presets offer a `preset` key", and claude/12's "a second harness is a second load". |
| Migration | A config with two agent-claude entries keeps working, each a load with one preset; a session stored with a `preset` moves to that preset's provider when the preset names one. |

Open before it is a plan: whether ACP's presets (acp/05) take the same shape, and whether a preset that names no `provider` but sits beside ones that do is an error or the default harness.
