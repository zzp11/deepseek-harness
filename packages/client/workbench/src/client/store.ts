/**
 * Per-session viewing and drafting state of the workbench tab. Which node is in
 * focus, what a person has typed into a proposal card before accepting, and the
 * last refusal the host answered with — all of it interaction state, none of it
 * business data. The tree itself lives in the fold.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** One proposal card's edited copy: field name to the value the person typed. */
export type ProposalEdits = Record<string, string>

/** What the person decided about one proposed node: the title they settled on, and whether they pruned it. */
export interface NodeChoice {
  readonly title?: string
  readonly dropped?: boolean
}

/** One proposal card's per-node decisions, keyed by the node's index in the draft. */
export type NodeChoices = Record<string, NodeChoice>

/** What the tab remembers between renders. */
export interface WorkbenchStoreState {
  /** The node in the focus pane; null before anything is selected. */
  selected: string | null
  /** Edited copies of proposal cards, keyed by proposal id. Editing costs nothing and writes nothing. */
  drafts: Record<string, ProposalEdits>
  /** Which proposed nodes the person kept and what they renamed them to, keyed by proposal id. */
  nodeChoices: Record<string, NodeChoices>
  /** The last refusal, shown until the next action. */
  refusal: string | null
}

/** Declared action shape, giving the exported factory a stable return type. */
type WorkbenchActions = {
  select: (draft: WorkbenchStoreState, nodeId: string | null) => void
  editProposal: (draft: WorkbenchStoreState, proposalId: string, field: string, value: string) => void
  renameProposed: (draft: WorkbenchStoreState, proposalId: string, index: number, title: string) => void
  toggleProposed: (draft: WorkbenchStoreState, proposalId: string, index: number) => void
  clearProposal: (draft: WorkbenchStoreState, proposalId: string) => void
  setRefusal: (draft: WorkbenchStoreState, message: string | null) => void
}

/**
 * Declare the tab's viewing state and its write surface.
 * @returns the store handle.
 */
export function createWorkbenchStore(): EngineStoreHandle<WorkbenchStoreState, WorkbenchActions> {
  return defineStore({
    init: (): WorkbenchStoreState => ({ selected: null, drafts: {}, nodeChoices: {}, refusal: null }),
    actions: {
      select: (state, nodeId: string | null) => { state.selected = nodeId },
      editProposal: (state, proposalId: string, field: string, value: string) => {
        state.drafts[proposalId] = { ...state.drafts[proposalId], [field]: value }
      },
      renameProposed: (state, proposalId: string, index: number, title: string) => {
        const choices = state.nodeChoices[proposalId] ?? {}
        state.nodeChoices[proposalId] = { ...choices, [index]: { ...choices[String(index)], title } }
      },
      toggleProposed: (state, proposalId: string, index: number) => {
        const choices = state.nodeChoices[proposalId] ?? {}
        const current = choices[String(index)]
        state.nodeChoices[proposalId] = {
          ...choices,
          [index]: { ...current, dropped: current?.dropped !== true },
        }
      },
      clearProposal: (state, proposalId: string) => {
        const { [proposalId]: _edits, ...drafts } = state.drafts
        const { [proposalId]: _choices, ...nodeChoices } = state.nodeChoices
        state.drafts = drafts
        state.nodeChoices = nodeChoices
      },
      setRefusal: (state, message: string | null) => { state.refusal = message },
    },
  })
}
