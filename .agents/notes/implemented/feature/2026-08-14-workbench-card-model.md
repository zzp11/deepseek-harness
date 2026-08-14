# Agent Note: the workbench as cards — one card, four sections, two states

Status: implemented

English | [中文](2026-08-14-workbench-card-model.zh.md)

## Problem

Stage 0 shipped the tree, the gates, and both write paths, and the person who asked for it said the result was unusable to look at. Two separate things were wrong.

The visual half was four concrete defects, and one of them explains why the surface looked broken rather than merely plain: the stylesheet read `var(--dsw-*)` names that were never defined. An undefined custom property with no fallback makes the whole declaration invalid at computed-value time, so `border: 1px solid var(--nope)` takes the initial `border-style: none` and `background: var(--nope)` becomes transparent — structure vanishes instead of looking wrong. Beside that: a type scale bypassed with raw `px`, components hand-rolled where `ui-primitives` already had them, and no clearance for the floating composer, which put the tab's own last row underneath it.

The interaction half was a different problem: the tree-plus-detail-pane layout answered "what is in this project" but never "what is this module and what is it answerable for". The person's own model is cards — everything is a card, including the project — and a card has exactly four sections: a title, a strip that chooses which content to show, one content body, and auxiliaries. Content bodies are plural and heterogeneous (a brief, a table, a flow, an argument, a chart, the submodule map) because complex logic needs more than one form to say what it is.

## Decision

Three columns: where you are, what this is, what was said here. One card in the middle, with four sections and two states.

### Authored bodies and derived views are different kinds of thing

A content body either has its own truth or it does not. A table's numbers exist nowhere else — it is **authored**: stored, editable, and able to go stale. A submodule map's every fact comes from `children()` — it is **derived**: computed per read, never stored, and never stale by construction.

The split is enforced in the type system rather than by a test: `BodyPayload` has no variant for any `DerivedViewKind`, so a derived view is not representable as stored content. The tag strip marks a derived view with a `⁄` prefix, and it offers no delete.

`chart` moved from authored to derived during implementation. Letting a model write a chart means the numbers have no checkable source, and one wrong cell draws a bar that looks entirely normal. It is now computed from a table column whose every cell matches `/^-?\d+(?:\.\d+)?$/` — no unit suffix, no currency mark, no hedge, no gap. The silent failure becomes "this view does not appear".

### A tag carries what it opens

The first version gave a tag a `key` and a `kind` and kept bodies and views in separate tables, with a fallback for a kind that could not be built. That fallback was unreachable code hiding a real defect: the strip and the body area could disagree about what the open tag shows, and a disagreement has no correct value to fall back on. `TagEntry` is now a discriminated union carrying its own body or its own view, and the host's `derivedViews()` answers with built views rather than kinds — one call, one answer, no caller obliged to handle "I was told this exists but cannot make it".

### One card, two states

A model draft does not arrive as a second kind of card. It puts this card into **edit state**, which is also what a person's own larger edit does: a dashed edge, a bar with 确定 and 丢弃, and every section editable in place. That collapse is why "the person holds the knife" and "a person's edit costs nothing" are one action sequence rather than two competing ones.

Edit state lives in the log (`workbench/scratch`) so it survives a reload and a change of machine, but it is kept **off the node** — a separate `NodeGraph.tmp` table. The type the model-injection path receives has no such field, so leaking an uncommitted draft into a model request is unwritable rather than merely untested. The event never moves `rev`: `rev` means "one commit landed", and a keystroke advancing it would make the later invalidation pass compute an impact set per keystroke.

`at` is stamped by the host from its own clock; the wire type (`TmpDraft`) omits it, so a browser with a wrong clock cannot write a time into the log. An empty draft is legal and is what "a person opens edit state by hand" sends — before that existed, the only way into edit state was a model draft, which left human editing of a committed card unreachable.

### The brief is the duty carrier, and the duty has one home

Every card has exactly one brief, and it cannot be deleted: `duty` is what stands in for a module's body in the global skeleton, so a card without one is invisible to every other module. Three implementation consequences, all found by running the flow rather than by reading it:

- A card is **born with its brief**. Without one, a new card's strip offered only derived views, so opening edit state gave the person nowhere to write the duty while the gate went on refusing promotion for the missing duty.
- The card renders the **node's** `duty` and `body`. Those are the fields the gates, the dependency sets, and the prompt read. The brief's own copy is written at the commit point by `syncBrief` so a log reader and a model reading `bodies` see the same words, and it is never read back as truth — a desync cannot reach the screen.
- A proposed brief **replaces** the existing one whether or not it says so. Appending would put two 简介 tags on the strip with no way to tell which one the duty came from, and the model has no reason to know the id it must name.

### Ideas are invisible from outside the area that holds them

An idea region is a subtree whose root carries `region: 'idea'`. One rule governs visibility: an idea is visible only from a vantage enclosed by every idea root that encloses it. A parent cannot see it, a sibling cannot, and — the case people expect to differ — neither can the card's own submodules. The skeleton index filters by vantage, which is the one place it could otherwise leak into a model request.

The area is reached through its card's tag, never through the tree, and the tag appears only once the area exists: a tag for something not there yet reads as "there are ideas, you just have not looked".

### Design tokens are now gated

`scripts/verify-design-tokens.ts` scans every `var(--dsw-…)` read in `packages/client/*/src/**/*.css` against the definitions in the theme **and in the consuming stylesheet itself** — a locally declared property resolves fine, so the criterion is "does this read resolve to anything", not "is it a theme token". A read with a fallback is legal. It found 13 pre-existing violations in six other packages, recorded as a `TODO(design-tokens)` allowlist; the gate also fails if an allowlist entry stops occurring, so the list cannot rot.

## Alternatives considered

**A canvas or whiteboard library (React Flow, tldraw, Excalidraw).** Rejected. Those own a scene graph, and the submodule map and relation graph are *derived views*: a diagram the person could drag into a different shape would be a second source for what the content says. The diagrams here are hand-drawn SVG over a layered layout, read-only by construction.

**Two tag slots for an argument's diagram and text forms.** Rejected. A tag's key is its body's id, so two slots would need a composite key, and "remove this body" would appear twice pointing at one thing. Choosing a form is a way of looking, not a second piece of content, so it lives in browser view state keyed by body id and the two forms share one tag with a switch. The text twin opens first: a diagram has no place for a conditional, a negation, a quantifier, or a tense, so what the model dropped is invisible in the picture and obvious in the words.

**Bumping `SESSION_FORMAT_VERSION` for the two new event types.** Rejected against its own contract, which excludes adding an ordinary event type. This overturned an earlier decision to bump it, and the reward was that no core file was touched.

**Marking `workbench/scratch` `ignorable`.** Not available: the envelope defines the marker but `Session.append` exposes no way to set it, and no producer in this repository writes one. Required-on-read is the safe default anyway — a reader that does not know the type refuses the log instead of silently resuming without it. The JSDoc records that it would qualify, and states the standing constraint that keeps it true: a commit carries the whole committed node rather than a reference to the edit state it came from.

**A modal for every question the tab asks.** Rejected. A dialog takes the caret from whatever the person was already typing, which is the one thing the result-arrives path must not do. Every question is asked in one row, in place: Enter submits, Escape abandons.

## Testing

`apps/web/tests/workbench-salon.e2e.ts` walks the human half of the acceptance scenario over the shipped Web bundles, the real Typert wire, the real command, and the real projection — nine acts, keyless, green in record and replay alike. No model row and no replay fixture: a stray stream fails loud on the open llm seam rather than being quietly answered. The opening sentence is appended host-side because the conversation skeleton renders no view tabs at all while a session is blank, so the tab is unreachable until something is said.

That lane found three defects no package test could: the card born without a brief, the brief that could disagree with its node, and the proposed brief that appended a second tag. It also found that `promote-to-constraint` had been accepted by the host since stage 0 with no way for a person to send it.

Both packages are at per-file 100%. The paired checks of the scenario live in unit tests: an idea invisible before adoption and visible after, `⚠` lighting and clearing, the chart criterion refusing four kinds of non-number, the brief surviving a delete-down-to-it, and the reminder count bubbling.

## Consequences

- **`⚠` answers "which is older", never "do these actually contradict".** The real check is a model sweep this stage does not have. A mark that over-reports is visible; a missing check is silent.
- **An anchor's validity ends when its body is replaced.** `replaces` swaps the body that owns the object id.
- **Per-module conversation *history* still accumulates as one thread.** Splitting the injection and filtering the digest gets every observable behaviour of the requirement; the cost slope it was also meant to buy is not delivered under a single session.
- **The idea area's visibility rule is uniform and therefore surprising once.** A card cannot see the ideas hanging under it. This is deliberate — the alternative leaks unconfirmed thoughts downward — but it is the one place where "invisible from outside" reads as stronger than expected.
- **13 token violations in six other packages are recorded, not fixed.** Which token each should read is that package's design decision.
