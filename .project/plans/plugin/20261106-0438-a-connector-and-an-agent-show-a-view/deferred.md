---
title: What waits after a connector and an agent show a view
---

# What waits

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Surfaces other than `main` | The type leaves room for them, and no user needs one yet | A plan that names the first one |
| A record's view text in the reader's locale | No adapter or engine row is translated today, so a record's view text is sent as the plugin wrote it | The plan that translates the adapter and engine rows |
| Buttons in a record's view that run an adapter's or an engine's actions | A second feature: an operations side for connectors and agents, the scope an operation names, and the grants | A plan of its own |
| `OpenLogins` drops a closed agent | The host gives an engine no hook when an agent closes; the old handle writes nothing, but its entry stays until the plugin reloads | The plan that gives an engine a close hook |
| devtunnel's tunnels in its connector's view | The brief puts them after the account and the last refresh | A later devtunnel plan |
| ahpw draws a record's views and applies `viewData` | A client's work, in its own repository | A plan in ahpw |
