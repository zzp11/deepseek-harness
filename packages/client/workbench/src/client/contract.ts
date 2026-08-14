/** Shared view types of the workbench tab: what the fold publishes and what the tab is handed. */

import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  DependencyItem, GateFinding, NodeId, ProposalId, Shape, WorkbenchNode, WorkbenchProposal, WorkbenchState,
} from '@deepseek-ai/dsh-workbench/projection'
import type { createWorkbenchStore } from './store.ts'

/** One node as the tree row and the focus pane read it, with its derived facts attached. */
export interface TreeRow {
  readonly node: WorkbenchNode
  /** Nesting depth, root at 0. */
  readonly depth: number
  /** How this node can be drawn; empty for a node carrying only a title. */
  readonly shapes: readonly Shape[]
}

/** One draft awaiting a person, and whether they have already ruled on it. */
export interface ProposalRow {
  readonly proposal: WorkbenchProposal
  readonly ruled: boolean
}

/** What the fold publishes for the tab to render. */
export interface WorkbenchTreeView {
  readonly rows: readonly TreeRow[]
  readonly proposals: readonly ProposalRow[]
  /** The tree's current `rev` — the count of commits it has taken. */
  readonly rev: number
  /** Commits folded since the tab loaded; the meter's round counter. */
  readonly commits: number
  /** Nodes whose content came from the model and has not been rewritten by a person. */
  readonly untouchedModelNodes: number
  /** Mean body length and distinct field vocabulary, the structuring trend. */
  readonly meanBodyChars: number
  readonly distinctOpenFields: number
  /** The whole projection, for the derivations the focus pane runs against it. */
  readonly projection: WorkbenchState
}

/** The snapshot the workbench view target publishes per session. */
export interface WorkbenchSnapshot {
  readonly tree: WorkbenchTreeView | undefined
}

/** One edit outcome as the tab shows it: nothing to say, or the line the host refused with. */
export type EditOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Business callbacks the plugin injects into the tab. */
export interface WorkbenchInjected {
  /** Create a child under `parentId`, or at the root when null. */
  createChild: (parentId: NodeId | null, title: string) => Promise<EditOutcome>
  /** Write one field: `body` or `duty`, otherwise an open field. */
  updateField: (nodeId: NodeId, field: string, value: string) => Promise<EditOutcome>
  /** Commit to a node, or reject it with a reason. */
  promote: (nodeId: NodeId, maturity: 'committed' | 'rejected', note?: string) => Promise<EditOutcome>
  /**
   * Accept a draft with the person's own version applied: the field values they
   * settled on, and the proposed nodes they kept, each under the title they
   * settled on. `keptNodes` omitted accepts the draft as proposed.
   */
  acceptProposal: (
    proposalId: ProposalId,
    edits: readonly { name: string; value: string }[],
    keptNodes?: readonly { index: number; title?: string }[],
  ) => Promise<EditOutcome>
  /** Turn a draft down, keeping the reason. */
  rejectProposal: (proposalId: ProposalId, reason: string) => Promise<EditOutcome>
}

/** The tab's own props: the session-scope runtime kit, its store, its copy, and the injected face. */
export type WorkbenchTabProps =
  & ConvViewProps
  & PropsStore<ReturnType<typeof createWorkbenchStore>>
  & PropsLocale<'workbench'>
  & WorkbenchInjected

/** Props of a component rendered inside the tab, which reads the same store. */
export type WorkbenchPaneProps = PropsStore<ReturnType<typeof createWorkbenchStore>>

/** Re-exported so components need no second import path for the projection types. */
export type { DependencyItem, GateFinding, NodeId, ProposalId, Shape, WorkbenchNode, WorkbenchProposal }
