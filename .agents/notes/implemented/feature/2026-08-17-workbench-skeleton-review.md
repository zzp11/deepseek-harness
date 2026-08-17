# Agent Note: a cold-start skeleton is a tree, and the person rules on it

Status: implemented

English | [中文](2026-08-17-workbench-skeleton-review.zh.md)

## Problem

Driving the assembled page against the real model exposed two defects that together made the model's single most valuable output unusable.

Said to a blank workbench: `想在十月办一场 200 人的线下技术沙龙，预算 8 万左右`. The model called `workbench_read_nodes`, then `workbench_propose` with a nine-card skeleton, a flow chart on the root, and a budget table. The 工作台 tab then showed: an empty directory, the `说一句就行` empty state, and one line of text reading `草稿待裁决 / 冷启动骨架：…`. Every control in the whole view was `＋ 加一张卡` plus a question panel's own buttons.

**The draft was unreachable.** Accept and discard rendered only inside a focused card, filtered to drafts whose `targetNode` was that card. A cold-start draft targets nothing, on a tree with no card to focus, so it matched nothing and could be neither taken nor refused. Everything downstream was blocked, because nothing could be committed at all.

**A cold-start skeleton could not describe a tree.** `ProposedNode.parent` is an existing `NodeId`, and on a cold start nothing exists. The model described "总纲牵头，下面挂八条线" in prose, and `parent: proposed.parent ?? proposal.targetNode` resolved every entry to the root — nine sibling roots. The model had already worked out the structure and the accept path threw it away.

The host was not the limitation for the first defect: `accept-proposal` already carried `keptNodes?: {index, title?}[]`, documented as "an index left out is pruned, and pruning happens before the commit, so a dropped node never entered the tree" — exactly what 幕 3.2/3.3 of the scenario asks for. Only the browser surface was missing.

## Decision

### `parentIndex` names a parent by position in the same draft

`ProposedNode` gains `parentIndex?: number`, which must point at an EARLIER entry in the same `newNodes` list. Pointing strictly backwards rules out cycles by construction, and a model writing a tree top-down satisfies it without trying. It takes precedence over `parent` when both are present.

`planProposal` refuses a draft that breaks the rule, because the model is the only writer of the field and a draft whose shape cannot be built is worth refusing while the model can still fix it. The gates run against a graph that contains the draft's own placeholder nodes, so an index-parent is not read as a dangling reference and a loop lying entirely inside one draft is visible to the cycle gate.

Accepting mints ids for the whole kept set BEFORE resolving parents, so a card can hang under a sibling being created in the same commit. Pruning a card whose children were kept is **refused**, not silently re-rooted: 门票 under 预算 is a budget line, 门票 at the root is a concern of its own, and the refusal lets the person cut the subtree deliberately.

### The skeleton review is its own surface, above the card

`SkeletonReview` renders the draft as an indented list of proposed cards, each with an editable title and a cut, plus accept and discard. Renaming and cutting happen here, before the accept, because the host's contract is that a cut card never entered the tree — pruning afterwards would be a weaker claim about a node that had existed and been deleted.

It renders **above** the focused card rather than instead of it. Gating on "no card focused" would reproduce the original bug one step later: the model can propose more top-level structure onto a tree that already has cards, and the person would never see it.

Cutting a card cuts its subtree in the surface too, so the state the host refuses is never offered. Restoring puts back only the card restored — a parent coming back cannot know whether the whole subtree was meant to come with it.

## Alternatives considered

**Accept the flat list and let the person reparent afterwards.** Rejected: the model already knows the structure, and dropping it is precisely the loss this tool exists to prevent. It also costs the person N drag operations to recover information that was already computed.

**Let `parentIndex` point anywhere in the list.** Rejected: forward references and self-references are how a cycle gets in, and the check would then need a real graph walk. Backwards-only is one comparison and is what a top-down writer produces anyway.

**Re-root orphans when their parent is cut.** Rejected: it changes what the surviving card means without saying so. A refusal is louder and leaves the decision with the person.

**Render the review inside the directory column.** Rejected: the left column is a directory of what IS in the tree. A draft is not in the tree, and putting candidates there makes the one column that answers "what exists" stop answering it.

## Testing

Host: `edit.spec.ts` covers hanging a skeleton into the described shape and the refusal when a kept card's parent was cut; `propose.spec.ts` covers refusing a forward or out-of-range `parentIndex` and keeping a valid one.

Client: `tab.client.spec.tsx` covers the draft appearing where the empty state was, staying visible while a card is selected, accepting unchanged, carrying only the titles actually renamed, cutting a subtree, restoring one card of it, refusing to accept nothing, asking for a discard reason, and not inheriting a previous draft's edits.

Assembled: `workbench-salon.e2e.ts` appends a shaped draft host-side and drives the review in a real browser — indentation `['0px','18px','36px']` read from live geometry, the subtree cut and restore, the accept landing the kept pair under the person's title with the pruned card absent, and the discard refusing until a reason is given.

The review container carries `data-skeleton-review` because CSS-module hashes are a PREFIX: `[class*="_skeleton"]` matches the container and seven descendants alike and cannot count reviews.

## Consequences

The cold-start path works end to end: on the real page, seven cards landed at ONE `rev` with the hierarchy the model described, the person's rename kept, and the cut card nowhere in the tree.

`parentIndex` is a model-visible schema addition, so the tool catalog and both package READMEs move with it.

Client plugins are served from built `lib/`, so a change to this surface is invisible to both the browser and the `apps/web/tests` lane until `pnpm --filter @deepseek-ai/dsh-client-workbench run bundle` runs. Two rounds of driving the page were spent on a stale bundle before this was understood.
