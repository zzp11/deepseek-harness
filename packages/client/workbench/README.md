# @deepseek-ai/dsh-client-workbench

English | [中文](README.zh.md)

Browser half of the workbench: the 工作台 tab beside the conversation. Three columns — a directory that says where you are, one card that says what this module is, and a column holding what was said on that module with the composer under it. [dsh-workbench](../../workbench/workbench/README.md) owns the tree, the gates, and every write; the design record is the [card-model Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-workbench-card-model.md).

The left column is one flat indented list, not banded groups: a row carries a mark, a title, and a count only when that count is non-zero. Bands are not mutually exclusive, so the same card appeared in two or three of them at once — `⚖` on the row says a card governs the others without giving it a second place to live. There is no meter strip; the accountability figures it carried have no home yet (see Known Limitations).

The composer is the platform's one composer, not a second input. This view declares ui-conversation's `conversation.view.composer` seat, so the existing composer subtree renders into the bottom of the right column and keeps its draft, its images, and its chain election ([decision](../../../.agents/notes/implemented/feature/2026-08-17-conversation-view-composer-dock.md)). Because it sits inside a column, this view reserves no bottom clearance.

The fold, and every derived quantity it renders, come from that package's `./projection` entry — the same code the host runs. Nothing here recomputes a dependency set, a submodule map, or a maturity mark.

## One card, four sections, two states

A card has a title row, a tag strip that chooses the content, one content body, and a foot of auxiliaries. Each section is capped (three metadata entries, two actions, one drawer) and everything past a cap goes behind `⋯`, so "keep it readable" holds without anything becoming unreachable.

## Ruling on a skeleton

A draft that offers whole new cards rather than edits to an existing one gets its own surface, above the card and independent of what is selected. It lists the proposed cards indented by `parentIndex`, each with an editable title and a cut. Accept sends the kept indices with the titles the person settled on; the host prunes before it commits, so a cut card never entered the tree. Cutting a card cuts everything under it, because the host refuses an accept that would re-root an orphan and the surface must not offer a state that gets refused. Discard asks for the reason a rejection is required to carry.

Selection does not gate it: a skeleton is a decision waiting on the person, and hiding it behind "no card focused" was how the model's whole first output became unreachable — accept used to render only inside a focused card, filtered to drafts aimed at that card, and a cold-start draft aims at nothing on a tree that has no card to focus.

A model draft aimed at an existing card is not a second kind of card: it puts that card into **edit state**, which is also what 改这张卡 does. The state carries a dashed edge and one bar with 确定 and 丢弃, and it lives in the host's log, so it survives a reload and a change of machine.

The strip distinguishes two kinds of content. An **authored** body (brief, table, flow, argument) has its own stored truth, can be removed, and can be marked `⚠` when it is older than a newer body on the same card. A **derived** view (`⁄` prefix: submodule map, relation graph, global constraints, ideas, chart) is computed per read, so it can be neither edited nor stale. A tag carries the body or the view it opens rather than a key into a second table, so the strip and the body area cannot disagree.

The `⁄想法` tag is on every card, and a card still opens on its own content: the default view is the first authored body, so a card with none says it has no content body yet rather than opening on an empty idea area. The idea area carries its own empty copy, because it is the one derived view that is empty on a card nobody has touched — it says what the area is for instead of that it drew nothing.

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
- **The accountability figures have no surface** — the meter strip that carried them (model-written nodes nobody edited, mean body length, field vocabulary) was removed because every figure read `0` on an empty project. The need behind them stands: a person's own sense of how much they verified is not reliable, so the count has to come from outside. Where they land is undecided; the candidate is per-card and hidden when empty.
- **Typing is local until the field is left** — an input binds a local draft and autosaves on blur, and 确定 carries that draft with it. Binding the input directly to the host's stored draft raced the round trip and dropped most of what was typed. The cost is that a crash between two blurs loses the keystrokes since the last one.
