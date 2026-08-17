/**
 * Per-session viewing state of the workbench tab: which card is focused, which tag
 * is open on it, what the conversation is anchored to, and which inline question is
 * showing.
 *
 * None of it reaches the log, and none of it needs to. A card's uncommitted content
 * is the host's edit state — that survives a reload and a change of machine — while
 * everything here is safe to lose.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** What the conversation is anchored to: one addressable object inside one body. */
export interface AnchorState {
  readonly bodyId: string
  readonly objectId: string
  /** What the object says, so the bar names it instead of showing an id. */
  readonly label: string
}

/** Which inline question is open. Exactly one at a time, and never a modal. */
export type AskState =
  | { readonly kind: 'add-child'; readonly parentId: string | null }
  | { readonly kind: 'reject'; readonly nodeId: string }
  | { readonly kind: 'discard-proposal'; readonly proposalId: string }

/** What the tab remembers between renders. */
export interface WorkbenchStoreState {
  /** The focused card; null before anything is selected. */
  selected: string | null
  /** Which tag is open per card, so descending and coming back keeps the choice. */
  openTag: Record<string, string>
  /**
   * Argument bodies the person switched to the diagram form, by body id.
   *
   * The text twin is what opens, because a diagram silently drops every
   * conditional, negation, and quantifier the argument carries; the picture is what
   * you turn to once the words are known to be right.
   */
  asDiagram: Record<string, boolean>
  /** What the conversation is anchored to, if anything. */
  anchor: AnchorState | null
  /** The open inline question, if any. */
  ask: AskState | null
  /** The last refusal, shown until the next action. */
  refusal: string | null
}

/** Declared action shape, giving the exported factory a stable return type. */
type WorkbenchActions = {
  select: (draft: WorkbenchStoreState, nodeId: string | null) => void
  openTag: (draft: WorkbenchStoreState, nodeId: string, key: string) => void
  toggleForm: (draft: WorkbenchStoreState, bodyId: string) => void
  anchorTo: (draft: WorkbenchStoreState, anchor: AnchorState | null) => void
  setAsk: (draft: WorkbenchStoreState, ask: AskState | null) => void
  setRefusal: (draft: WorkbenchStoreState, message: string | null) => void
}

/**
 * Declare the tab's viewing state and its write surface.
 * @returns the store handle.
 */
export function createWorkbenchStore(): EngineStoreHandle<WorkbenchStoreState, WorkbenchActions> {
  return defineStore({
    init: (): WorkbenchStoreState => ({
      selected: null,
      openTag: {},
      asDiagram: {},
      anchor: null,
      ask: null,
      refusal: null,
    }),
    actions: {
      // Focusing a different card drops the anchor and any open question: both
      // belonged to the card being left, and carrying them over would point the
      // next request at an object that is no longer on screen.
      select: (draft, nodeId) => {
        draft.selected = nodeId
        draft.anchor = null
        draft.ask = null
      },
      openTag: (draft, nodeId, key) => { draft.openTag[nodeId] = key },
      toggleForm: (draft, bodyId) => { draft.asDiagram[bodyId] = draft.asDiagram[bodyId] !== true },
      anchorTo: (draft, anchor) => { draft.anchor = anchor },
      setAsk: (draft, ask) => { draft.ask = ask },
      setRefusal: (draft, message) => { draft.refusal = message },
    },
  })
}
