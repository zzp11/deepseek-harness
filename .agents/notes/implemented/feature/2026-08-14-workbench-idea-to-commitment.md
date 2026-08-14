# Agent Note: workbench — an idea-to-commitment node tree over the session log

Status: implemented

English | [中文](2026-08-14-workbench-idea-to-commitment.zh.md)

## Problem

Turning a rough idea into something a team has committed to leaves its reasoning behind. Notes, chat, and documents each hold part of it: what was decided, what it was decided against, which sentence a claim came from, and what was still undecided. A previous attempt at this in Markdown files showed the failure concretely — the moment editing had any friction, people left the page and edited the files directly, and once they did, the structure and the record diverged silently.

Two constraints follow, and they pull against each other:

- **A person's edit must cost nothing.** Immediate, no model call, no wait. Anything else and they route around the tool.
- **The model must not write into the record.** Its output is a proposal; a person rules on it. Otherwise the record accumulates plausible content nobody committed to.

A harness makes both reachable — the session log is already durable, broadcast, and replayable — but nothing in it models a tree of statements, gates, or a first-hand layer.

## Decision

Two packages: `packages/workbench/workbench` (host) and `packages/client/workbench` (the 工作台 tab). The tree's only persistence is the session log; there is no second copy on disk.

### The write paths, and why they differ

A person writes through the `workbench-edit` **command**, dispatched programmatically by the tab — nobody types a slash. `commands.execute` is already a Remote, and the registry resolves the name at call time, so this needed no new gateway method, no generated descriptor, and no change to `packages/host/apiproxy/src/api/rpc-map.ts`. The handler answers `{ kind: 'success', sourceEventSeq }`; the change itself arrives back through the event stream the tab already folds, which keeps one fact in one place. A refusal comes back as `{ kind: 'error', text }` naming the gate.

The model writes through `workbench_propose` only, and a proposal does not reach the tree. It reads with `workbench_read_nodes` and can ask `workbench_check_promotion` what a node still needs. There is deliberately **no tool that promotes**: promotion is the moment a person commits, so a model-driven promotion would be exactly the thing the second constraint forbids.

### Where derived quantities live

`core.ts` computes every derived quantity once — the dependency set and its expansion, one-hop invalidation, shape candidates, field registration, the `rev` step — as pure functions over an explicit read model, with no cordis and no I/O. `gates.ts` and `edit.ts` are pure the same way: a request and a projection in, the events to append out.

The browser folds the event family with **this same code**, through the `./projection` entry, which is listed in `INLINE_SAFE` in `packages/client/tsdown.client.ts` by exact subpath. The package root reaches cordis and the tool registry and is not browser-safe; that entry is the pure layer. The alternative — reimplementing the fold in the client — is the specific mistake the earlier attempt made, where one fact ended up with two values.

### The event family

`workbench/snapshot` is a complete whole-value checkpoint: nodes, the first-hand layer, and proposals. It carries no `rev` of its own (`meta.rev` is the tree's) and it is complete on purpose — a checkpoint missing the first-hand layer would let a cold start skip the prefix holding the entries the tree's fields cite, and every dependency set drawing on one would then fail to build.

`workbench/node-change` is the single write event; a commit writing N nodes emits N of them sharing one `rev`. `workbench/utterance` is the first-hand layer. `workbench/proposal` and `workbench/verdict` carry the draft and its ruling.

**Every session's first workbench event is a checkpoint.** The browser folds the family into one Context whose start is a checkpoint, so all three append paths — the mirror, the edit command, the propose tool — call `ensureCheckpoint` first. Without it the fold receives an update with no state and the whole Context dies for the session.

### The first-hand mirror

Custom session events never reach a model request, so a person's words travel twice: as the `user/message` the model reads, and as the `workbench/utterance` the tree cites. The mirror is the **only** producer of first-hand entries, which is what lets "every message has exactly one entry" be an invariant rather than a hope — `./invariant` checks it as each entry lands, with no deadline, because an entry is named after the message it mirrors: one arriving entry proves both that its message exists and that no earlier one was skipped.

The append is deferred to a microtask because `session.append` refuses to reenter while an append is being published, and the mirror runs inside that publication.

### Where the gates apply

The working region (念头 / 想法) is unguarded; friction there taxes thinking. The committed region is guarded, so the whole cost of rigour falls at promotion: an unregistered field, an uncited value, or a module that never said what it is answerable for stops being tolerable there. Structural gates — every reference resolves, the tree stays a tree — apply everywhere, because a broken tree is not a rough draft.

Missing duty is advisory on an ordinary write and blocking at promotion. Accepting a proposal re-runs the gates over **what the person edited**, not what the model proposed, and the person may prune and rename proposed nodes before the commit — so a node they dropped never enters the tree at all.

## Alternatives considered

**A gateway RPC method (`workbench.edit`) instead of a command.** The original plan chose this because `RpcMethodMap` is where product methods live. Rejected on evidence: `rpc-map.ts` changed 60 times in 60 days and `web-app/cordis.patch.yml` 88 times, and the command path needs neither. `CommandDefinition.recordInput: false` and `CommandResult.sourceEventSeq` are documented for exactly this shape — a handler that appends a domain event and a client that reads the event stream.

**A second copy of the tree on disk.** Rejected: one fact source, and the log already persists, broadcasts, and replays. The cost is real and named below.

**Reimplementing the fold in the browser.** Rejected — see above.

**A model-facing `workbench_promote`.** Rejected: it contradicts the human-verdict constraint. The model gets the missing list instead and fixes it the only way it can, by proposing.

**Keeping `add-utterance` as an edit op.** Rejected: with a second producer, "every message has exactly one entry" weakens to "at least one", and a weakened version cannot catch the silent drop it exists for.

## Testing

`tests/acceptance.spec.ts` walks both criteria over a real composition — the concrete agent loop, the shipping DeepSeek adapter pointed at a scripted mock provider, the command registry, and this plugin — with no API key. Cold start: one sentence, a model-proposed skeleton, the person pruning it, and a promotion the gate refuses until the tree can answer for itself. A person's own edit: it lands and advances `rev` while the provider's own request record stays empty, which is what makes "no model call" checkable rather than asserted.

Every gate carries a test that injects what it must refuse. The projection carries the log-level refusals — a promotion that did not promote, an entry appended twice, a ruling on a draft nobody made, a `rev` moving backwards — each with its own.

## Consequences

- **A checkpoint grows with the first-hand layer.** That is what caps usable session length until a projection backend replaces whole-value checkpoints.
- **One-hop invalidation, and nobody consumes it.** The tree index is deliberately not an edge: treating it as one would make every rename invalidate every node.
- **Authorship is per node, not per field.** A measure of how much untouched model prose the tree carries can only be counted per node. `structuralHealth` measures the related trend — prose growing while the field vocabulary does not — over a checkpoint's nodes, which is the one defense against the failure where the model writes every new concept as prose and the unregistered-field gate stays green forever.
- **No consistency check after the fact.** Gates run on the write path only. The design argues an asynchronous pass is structurally required for immediate writes and consistency to coexist; this delivers the front half plus the promotion gate, not the whole loop.
- **Export has no owner.** With the tree living only in the log, a projection out of it is required rather than optional.
- **A second view target exposed a typing weakness.** `ConversationViewSnapshotStore.get<Target>` reads `ConversationViewSnapshotMap[Target]` as an intersection for a generic `Target`, which was harmless with one member. Adding `workbench` forced a narrowing cast in ui-trajectory's test stub; a third target will hit it again.
