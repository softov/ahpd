---
title: A pi agent shows the model pi fell back to
created: 2026-11-11
refs:
  - "[code://packages/agent-pi/src/session.ts#L1074-L1076](../../packages/agent-pi/src/session.ts#L1074-L1076) - the configured model, set at a session's start"
---

On 2026-11-11 a pi settings file named `deepseek/deepseek-chat`, which pi 1.3.0 does not list.
pi then ran the turn on `anthropic/claude-opus-4-8`, its own first keyed model, with no word to the person.
That is pi's own rule, and the most expensive model on the host answered a one-word test.
The agent's row could carry an alert when pi does not list the model that the record, an option or the settings file names.
A missing key gets one the same way.
Plan pi/20261111-1444 logs it at a session's start; the alert would show it before any session.
