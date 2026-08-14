/** Shared view types of the workbench tab: what the fold publishes and what the tab is handed. */

import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AuthoredBody, BodyId, ContentBodyKind, DependencyItem, DerivedView, DerivedViewKind, FirstLayerEntry, GateFinding,
  NodeId, NodeTmp, ProposalId, SubmoduleMapItem, TmpDraft, WorkbenchNode, WorkbenchProposal, WorkbenchState,
} from '@deepseek-ai/dsh-workbench/projection'
import type { createWorkbenchStore } from './store.ts'

/** One node as a tree row reads it, with the derived facts the row shows attached. */
export interface TreeRow {
  readonly node: WorkbenchNode
  /** Nesting depth, root at 0. */
  readonly depth: number
  /** Descendants below this node. */
  readonly contains: number
  /** Unruled proposals at or below it — the reminder count that bubbles. */
  readonly reminders: number
  /** Whether it sits in the global-constraint area. */
  readonly constraint: boolean
}

/**
 * One entry of a card's tag strip, carrying the content it opens.
 *
 * A tag carries its own body rather than a key into a second table: the strip and the
 * body area would otherwise be able to disagree about what the open tag shows, and
 * the mismatch has no correct answer to fall back on.
 *
 * An authored tag can go stale and can be removed; a derived one is computed per
 * read, so it does neither.
 */
export type TagEntry =
  | {
    readonly kind: 'authored'
    /** The body's own id, which is also this tag's key. */
    readonly key: BodyId
    readonly label: string
    /** Set when this body is older than the newest authored body on the same card. */
    readonly stale: boolean
    readonly body: AuthoredBody
  }
  | {
    readonly kind: 'derived'
    readonly key: string
    readonly label: string
    readonly view: DerivedView
  }

/** Everything the focused card renders from, already folded. */
export interface CardView {
  readonly node: WorkbenchNode
  /** Root-first ancestors, for the breadcrumb. */
  readonly trail: readonly WorkbenchNode[]
  readonly tags: readonly TagEntry[]
  /** Uncommitted edit state, when the card is in edit state. */
  readonly tmp: NodeTmp | undefined
  /** Findings that would block promotion right now. */
  readonly blocking: readonly GateFinding[]
  readonly reminders: number
}

/** One draft awaiting a person, and whether they have already ruled on it. */
export interface ProposalRow {
  readonly proposal: WorkbenchProposal
  readonly ruled: boolean
}

/** What the fold publishes for the tab to render. */
export interface WorkbenchTreeView {
  readonly rows: readonly TreeRow[]
  /** The global-constraint entries, pinned above everything else. */
  readonly constraints: readonly WorkbenchNode[]
  /** The most recently committed nodes, newest first, capped at the working-set size. */
  readonly working: readonly TreeRow[]
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
  /** How many results are waiting anywhere in the tree. */
  readonly reminders: number
  /** The whole projection, for the derivations the card runs against it. */
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
  /**
   * Write a card's edit state. Costs no `rev`. An empty draft opens edit state on a
   * card that is already committed, which is how a person starts editing by hand.
   * `at` is the host's stamp, so it is not part of what crosses the wire.
   */
  setTmp: (nodeId: NodeId, tmp: TmpDraft) => Promise<EditOutcome>
  /** 确定: fold the edit state into the card as one commit. */
  commitTmp: (nodeId: NodeId) => Promise<EditOutcome>
  /** 丢弃: drop the edit state. */
  discardTmp: (nodeId: NodeId) => Promise<EditOutcome>
  /** Remove one authored body. */
  deleteBody: (nodeId: NodeId, bodyId: BodyId) => Promise<EditOutcome>
  /** Open a card's idea area, creating its root the first time. */
  openIdeas: (nodeId: NodeId) => Promise<EditOutcome>
  /**
   * Move a card into the global-constraint area, where it governs everything
   * outside it. The area's root is created on the first promotion.
   */
  promoteToConstraint: (nodeId: NodeId) => Promise<EditOutcome>
  /**
   * Record which card the person is on, so the host can stamp what they say next
   * with the module it was said in.
   */
  focusNode: (nodeId: NodeId | null) => Promise<EditOutcome>
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
export type {
  AuthoredBody, BodyId, ContentBodyKind, DependencyItem, DerivedView, DerivedViewKind, FirstLayerEntry, GateFinding,
  NodeId, NodeTmp, ProposalId, SubmoduleMapItem, TmpDraft, WorkbenchNode, WorkbenchProposal,
}
