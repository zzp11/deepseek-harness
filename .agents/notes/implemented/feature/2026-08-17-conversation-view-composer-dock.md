# Agent Note: a conversation view can take the composer into itself

Status: implemented

English | [中文](2026-08-17-conversation-view-composer-dock.zh.md)

## Problem

The resident composer's sticky seat at the foot of the scrollport is right for a transcript and wrong for a view that is not one. The workbench view is three columns — a directory, a card, and one module's exchange. A composer floating below all three belongs to none of them, and it covers the last row of whichever column is tallest. The previous answer was to have every view reserve bottom clearance for it, which makes each view pay for a seat it did not ask for and cannot use.

The obvious fix — let the view render its own input — is worse than the problem. The resident composer carries the session draft, the browser-owned image previews, the `conversation.composer` chain election (approval and question takeovers), the submit-mode resolution, and the slash-command menu. A second implementation reproduces none of that, and it turns "how does a person send a message" into a question with two answers that will drift apart.

## Decision

`ui-conversation` declares one child slot, `conversation.view.composer` (`kind: 'single'`, `scope: 'session'`). A view that declares it receives the resident composer inside itself; a view that does not is unaffected and keeps the sticky seat.

There is exactly **one** composer. This package registers `ComposerDockHost` into the seat the view declares, and `ConversationRoot` renders its one existing composer subtree into that host with `createPortal` instead of rendering a second one.

### The seat is offered from a callback ref, not an effect

`ComposerDockHost` hands its element to the registry through a callback ref, so mounting offers the seat and unmounting releases it in the same commit as the DOM change. An effect runs a frame later, which is long enough to portal the composer into a node that has already left the document.

### The registry is a subscribable, and holds one seat

`ComposerDockRegistry` (`src/client/input/dock.ts`) exposes `subscribe`/`version`/`host`, read through `useSyncExternalStore` — the same ledger shape this package already uses for the view ring. It holds a single seat rather than one per session: the shell shows one conversation at a time, the seat is offered by a mounted view and released when that view unmounts, and the resident composer deliberately lives above the session boundary so it survives session switches.

### What the move preserves, and what it does not

Changing a portal's container **re-creates** the DOM subtree — the textarea is not the same node before and after. The draft, the attached images, and the submit-mode preference survive anyway, because they live in the session input machine *above* this tree rather than in the DOM or in component state; the chain election survives because it is recomputed from the same pending list.

Anything held only in the DOM — the caret offset, an in-flight IME composition — does not survive a dock change, and nothing may be built on element identity across one.

The `ResizeObserver` publishing `--dsh-composer-height` is attached only in the default position. That property exists to clear a seat at the foot of the scroll body, and there is nothing to clear once the composer sits inside a column.

## Alternatives considered

**A `SnapshotStore` for the seat.** Tried twice — once per-session, once single — and both failed for the same two reasons: `createSnapshotStore` deep-freezes state in development, and freezing a DOM element freezes everything reachable from it; and `update()` ignores its mutator's return value, so the assignment was silently discarded. The subscribable ledger is what this package already uses for non-serializable reactive state.

**Let the workbench render its own composer.** Rejected: it duplicates none of the machinery listed under Problem and creates a second answer to sending a message.

**Keep the floating composer and have the workbench reserve clearance.** This is what stage 0 did. It leaves the input outside all three columns, so it reads as belonging to the page rather than to the conversation it continues, and every future view keeps paying the clearance tax.

**A configuration flag on `ui-conversation` deciding where the composer goes.** Impossible as designed: browser-half plugins receive no config from `cordis.yml`. Declaring the slot is the switch.

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` covers both directions — offering a seat moves the composer into it with exactly one seat on screen, releasing it returns the composer to the default position — and pins the preservation contract: the draft survives the move while the element identity does not.

`apps/web/tests/workbench-salon.e2e.ts` asserts over the assembled browser that exactly one `[data-composer-seat]` exists, that it sits inside the workbench's conversation column, and that typing into it works there.

`src/client/**` of this package is under a standing GUI-debt coverage exemption (`vitest.config.ts`), so these tests are not enforced by the per-file coverage gate.

## Consequences

A view now has a supported way to place the composer, and the workbench reserves no bottom clearance because nothing floats over its last row.

Whether a view docks the composer is decided by whether it declares the slot, and cannot be composed from `cordis.yml` — browser-half plugins have no config channel (the client boot graph entry carries only `id`/`url`/`rev`/`inject`). The same root cause keeps the conversation tab itself from being composed out; recorded as D-47 in `my_docs/04`.

Docking or undocking loses DOM-only state, so a view must not offer or withdraw the seat while someone could be mid-composition. In practice the seat changes only on a view switch, which is already a deliberate click.
