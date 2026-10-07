---
title: An automation wakes on what a session does - diagrams
---

The diagrams for [plan.md](plan.md).

## From a chat action to a run

```mermaid
flowchart LR
    A["chat action in dispatch<br/>turnComplete, toolCallComplete,<br/>error, pendingMessageSet"] --> E["session event<br/>kind, session, owner,<br/>running, queued, turnToolCalls"]
    I["idle timer<br/>per session"] --> E
    E --> G{"owner may read<br/>the session?<br/>not its own run?"}
    G -- no --> X["dropped"]
    G -- yes --> R["rule engine<br/>one state per<br/>automation and session"]
    P["plugin<br/>fireTrigger"] --> F
    R -- match --> F["fire<br/>origin: trigger + event"]
    F --> C{"under 20<br/>runs an hour?"}
    C -- no --> X
    C -- yes --> O["overlap mode"]
    O --> N["run"]
```

## The shape of a rule

Every rule is one event. The three other parts are optional.

```mermaid
flowchart LR
    ON["on<br/>one event kind<br/>+ filter"] --> WHEN["when<br/>running, queued,<br/>tool calls, turn length"]
    WHEN --> COUNT["count<br/>n, in a row,<br/>within a window,<br/>same input"]
    COUNT --> THEN["then<br/>an event within T,<br/>quiet for T,<br/>or no event for T"]
    THEN --> M["match"]
```

| Softov's example | on | when | count | then |
| --- | --- | --- | --- | --- |
| 3 tool calls failed in a row | `toolFailed` | - | 3, in a row | - |
| A turn failed, then 3 minutes idle | `turnFailed` | - | - | quiet for `3m` |
| A turn finished and no reply within 2 minutes | `turnCompleted` | - | - | no `posted` for `2m` (waits for `post_message`) |
| A message queued while running, after 3 tool calls | `messageQueued` | running, 3 tool calls | - | - |

## One rule's state for one session

```mermaid
stateDiagram-v2
    [*] --> Counting
    Counting --> Counting: a matching event, count below n
    Counting --> Counting: another event resets a count in a row
    Counting --> Waiting: count reached, rule has then
    Counting --> Matched: count reached, no then
    Waiting --> Matched: the then holds
    Waiting --> Counting: the then breaks
    Waiting --> [*]: session ends or rule removed
    Matched --> Counting: count cleared
```

## The presets

```mermaid
flowchart TB
    W["watch trigger type"] --> S1["looks stuck<br/>same tool and input, 3 times"]
    W --> S2["failing tools<br/>3 failures in a row"]
    W --> S3["long silent turn<br/>running 10m, no tool call"]
    W --> S4["idle after failure<br/>failed turn, then 3m quiet"]
    W --> S5["waiting while busy<br/>queued message, 3 tool calls"]
    W -.-> S6["no reply posted<br/>after post_message exists"]
```

Each preset is a `SessionRule` with its numbers open to the person.

## New or pinned

```mermaid
flowchart LR
    subgraph new["session: new"]
        R1["run 1"] --> S1["session A"]
        R2["run 2"] --> S2["session B"]
        R3["run 3"] --> S3["session C"]
    end
    subgraph pinned["session: pinned"]
        Q1["run 1"] --> T1["turn 1"]
        Q2["run 2"] --> T2["turn 2"]
        Q3["run 3"] --> T3["turn 3"]
        T1 & T2 & T3 --> CH["one chat in session P"]
    end
```

## An event while a run runs

```mermaid
sequenceDiagram
    participant E as event
    participant A as automation
    participant R as running run
    E->>A: match
    alt queue
        A->>A: keep one waiting run, fold later events into it
        R-->>A: run ends
        A->>A: start the waiting run
    else steer
        A->>R: send the event as a message into the turn
    else parallel
        A->>A: start another run (refused when pinned)
    else skip
        A->>R: count the dropped event
    end
```

## What the run reads

```mermaid
flowchart LR
    M["message<br/>Review {{sessionTitle}}:<br/>{{event}} x{{count}}"] --> F["filled"]
    F --> B["+ summary block<br/>event, session title and URI,<br/>count, time"]
    B --> T["first message of the run"]
```

## Where this sits in the bot study

```mermaid
flowchart LR
    W1["host/71<br/>automations wake on events"] --> W3["post_message<br/>+ mention event"]
    W2["channel provider"] --> W3
    W3 --> W4["bot record"]
    W1 -.->|"enables"| S6["no reply posted preset"]
    W3 -.-> S6
```
