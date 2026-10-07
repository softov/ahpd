---
title: An automation wakes on what a session does - deferred
date: 2026-10-07
---

These wait on a plugin reload this host does not have, and on an event nothing here emits yet.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Dropping a plugin's trigger types when the plugin goes | Nothing unloads a plugin: the host is built once from every plugin's contributions, and the only teardown a plugin has runs when the host closes. The types are kept keyed by the plugin that registered them, so an unload has one structure to remove. | idea `a-plugin-reloads-without-a-restart`; unplanned |
| The `no reply posted` wake, step 3 of the bot study | The event it watches for does not exist: nothing here posts a message to a session's chat. | `post_message`; this plan's row for it |
