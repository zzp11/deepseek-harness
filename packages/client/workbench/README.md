# @deepseek-ai/dsh-client-workbench

English | [中文](README.zh.md)

Browser half of the workbench: the 工作台 tab beside the conversation. Three columns — a module tree that says where you are, one card that says what this module is, and a digest of what was said on that module — plus the meter strip along the bottom. [dsh-workbench](../../workbench/workbench/README.md) owns the tree, the gates, and every write; the design record is the [card-model Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-workbench-card-model.md).

The fold, and every derived quantity it renders, come from that package's `./projection` entry — the same code the host runs. Nothing here recomputes a dependency set, a submodule map, or a maturity mark.

## One card, four sections, two states

A card has a title row, a tag strip that chooses the content, one content body, and a foot of auxiliaries. Each section is capped (three metadata entries, two actions, one drawer) and everything past a cap goes behind `⋯`, so "keep it readable" holds without anything becoming unreachable.

A model draft is not a second kind of card: it puts this card into **edit state**, which is also what 改这张卡 does. The state carries a dashed edge and one bar with 确定 and 丢弃, and it lives in the host's log, so it survives a reload and a change of machine.

The strip distinguishes two kinds of content. An **authored** body (brief, table, flow, argument) has its own stored truth, can be removed, and can be marked `⚠` when it is older than a newer body on the same card. A **derived** view (`⁄` prefix: submodule map, relation graph, global constraints, ideas, chart) is computed per read, so it can be neither edited nor stale. A tag carries the body or the view it opens rather than a key into a second table, so the strip and the body area cannot disagree.

Double-clicking an addressable object inside a body — a table row, a flow step, an argument's ground — anchors the conversation to it; double-clicking a card in the submodule map descends into it, and the breadcrumb comes back.

Every question is asked in one row, in place. A dialog would take the caret from whatever the person was typing, which is the one thing the result-arrives path must not do.

## Model Experience

None, as this package renders browser-side views and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`⚠` answers "which is older", not "do these contradict"** — the real check is a model sweep the host does not yet run.
- **An anchor's validity ends when its body is replaced** — a proposal that supersedes a body takes the object ids with it.
- **The conversation digest is per module, but the history is not** — the digest filters by the module an utterance was said in; the session itself remains one thread.
- **Selection, the open tag, and the argument's chosen form are browser-local** — none survives a reload, because none is content and the host owns no event for them.
