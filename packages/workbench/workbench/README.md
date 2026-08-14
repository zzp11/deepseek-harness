# @deepseek-ai/dsh-workbench

English | [中文](README.zh.md)

Host half of the workbench: a node tree whose only persistence is the session log. A node states something about the world; the first-hand layer (verbatim utterances, later source material) only ever appends. Both write paths — a person editing, and the model proposing — converge on one append that raises a single monotonic `rev`.

The two constraints the design exists to hold: a person's edit lands immediately, with no model call and no wait; and the model can only `propose`, so nothing it produces enters the tree without a human verdict.

The browser half is [dsh-client-workbench](../../client/workbench/README.md); the design record is the [workbench Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-workbench-idea-to-commitment.md).

`core.ts` is where a derived quantity is computed, once. It takes the read model as an argument and touches no I/O, no cordis, and no session log, so it is testable without a running harness — and so that no consumer is tempted to recompute a dependency set slightly differently. `store.ts` deliberately publishes no `children` or `dependencySet` of its own: its projection satisfies `core.ts`'s read model, and callers use that. `edit.ts` is pure the same way: a request and a projection in, the events to append out, so what a person is allowed to do is provable without a harness and `index.ts` is only the glue that appends it.

## The write path is a command, not a gateway method

A person's edit arrives as `workbench-edit`, a registered command the browser dispatches programmatically — nobody types a slash. `commands.execute` is already a Remote, and the registry resolves the name at call time, so this write path needed no new wire method, no generated descriptor, and no change to the API gateway.

The handler answers `{ kind: 'success', sourceEventSeq }` rather than restating the change: the browser reads the real `workbench/node-change` off the event stream it already subscribes to, which is also where the new `rev` and the invalidation list live. A refused edit comes back as `{ kind: 'error', text }` naming the gate that refused it.

## Where the gates apply

The working region (念头 / 想法) is deliberately unguarded — friction there taxes thinking. The committed region is guarded, so the whole cost of rigour falls at one moment, promotion: that is where an unregistered field, an uncited value, or a module that never said what it is answerable for stops being tolerable. Structural gates (every reference resolves, the tree stays a tree) apply everywhere, because a broken tree is not a rough draft.

Accepting a proposal re-runs the gates over what the person edited, not over what the model proposed. The person holds the knife; a hand-corrected draft still has to be a legal tree before it lands.

## The first-hand mirror

Custom session events never reach a model request, so a person's words travel twice: as the `user/message` the model reads, and as the `workbench/utterance` the tree cites. The mirror is the only producer of first-hand entries, which is what lets "every message has exactly one entry" be an invariant instead of a hope — this package's `./invariant` asserts it as each entry lands, so a skipped mirror surfaces at the next one.

## Model Experience

### Tool schema

#### What the model sees

The generated schemas for `workbench_read_nodes`, `workbench_propose`, and `workbench_check_promotion` — see the [generated catalog](../../../docs/tool-catalog.md#deepseek-aidsh-workbench). `workbench_read_nodes` takes an OPTIONAL `nodeId`: called without one it answers with the constraint area and the tree index alone, which is how a cold start gets its first id and how an empty tree reports that it is empty. `workbench_propose` takes the draft — a title, an optional target node, prose, fields, and nodes to create. `workbench_check_promotion` takes one node id.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged.

### System prompt section

#### What the model sees

Every request in this plugin's registration scope carries the section below. Its first instruction is the cold-start read; the rest states the maturity rungs and the two things the model may not do.

##### What it may and may not do

```markdown
- **先不带 `nodeId` 调一次 `workbench_read_nodes`**，看树里现在有什么。树可能是空的——那就直接提骨架。
- 要在某个节点上作业，再带上它的 id 调一次，拿它的**依赖集**。那是机械展开的、完整的、未经取舍的。**不要自己推断还需要什么**：需要别的节点，就再调一次。
- 你唯一的写路径是 `workbench_propose`。它产出**草稿**，不进本体。人会看、可能改、然后采纳或不要。
- 你**不能**晋升节点。晋升是人的动作。`workbench_check_promotion` 只告诉你某个节点现在过不过晋升门、缺什么，好让你用 `workbench_propose` 去补。
```

##### Where the gates apply

```markdown
**只有已承诺区设闸门。**在念头和想法上工作时不要自我审查——那里的摩擦是在给思考收税。已承诺区里，每个开放字段都必须已登记、且指向一手层里它是从哪句话来的。
```

##### The one failure to avoid

```markdown
把新概念写进 `正文` 而不加字段，是这套东西最容易静默失效的方式：闸门恒绿，报告全过，而结构化实际上已经停了。发现自己在正文里反复讲同一类事实时，把它提成一个字段，并指出依据。
```

#### Token effect

Fixed, and small relative to one dependency set.

#### KV Cache effect

Static text at a fixed order, so it stays inside the cached prefix.

### Tool-call history and results

#### What the model sees

A `workbench_read_nodes` result renders as the expansion: a preamble stating the set is complete and unedited, then each item under its heading (`【自己】`, `【父链】`, `【全局约束】`, `【依据】`, `【骨架】`) with its id and `rev`. `workbench_propose` answers either `草稿 <id> 已记下，等人裁决。` or the gate findings that refused it, each as `<CODE>: <message>`. `workbench_check_promotion` answers `<id> 现在过晋升门；晋升要人来点。` or the same finding lines.

#### Token effect

One read result is the size of what it expanded: the node, its ancestors' duty and body, the constraint area, the cited utterances, and one line per node in the index. Nothing is summarized, so the index line count is the term that grows with the tree.

#### KV Cache effect

Append-only; results follow the reusable request prefix.

## Known Limitations and Deferred Work

- **No model-facing surface yet** — the model has no way to read the tree or propose against it, so a proposal can only reach the log from a test or another plugin.
- **A checkpoint grows with the first-hand layer** — `workbench/snapshot` carries the whole projection, first-hand entries included, because a checkpoint without them would let a cold start skip the prefix holding the entries the tree's fields cite. That is what caps the usable session length until a projection backend replaces whole-value checkpoints.
- **One-hop invalidation only, and nobody consumes it** — `invalidate` answers with direct children, or with everything outside the constraint area when a constraint changed. The tree index is deliberately not an edge, so a rename puts nothing in doubt.
- **A node carrying only a title has no shape candidate** — which is the state a freshly proposed node is in, so the browser has to render the empty case.
- **Authorship is per node, not per field** — the model has no place to record that a person rewrote one AI-written field, so a measure of how much untouched model prose the tree carries can only be counted per node. `structuralHealth` measures the related trend (prose growing while the field vocabulary does not) over a checkpoint's nodes; nothing reports it yet.
- **The mirror's trailing entry cannot be asserted at runtime** — an entry is appended in a later microtask because `session.append` refuses to reenter, so the newest message's entry is legitimately absent for a moment. The invariant catches every earlier gap; only a drop on the last message needs a test rather than a check.
- **Nothing consumes an advisory** — a plan reports non-blocking findings and no surface shows them.
- **Patrol flow absent by design in stage 0** — consistency is checked on the write path (gates) and never after the fact. Stage 0 therefore delivers the front half of the design plus the promotion gate, not the whole loop.
- **Export has no owner yet** — the tree lives only in the session log, so a projection out of it (headings from levels, body text carried over verbatim, undecided marked as undecided) is required, not optional, and is not scheduled.
