/**
 * The workbench event family — the only persistence the tree has. A node exists
 * because a `workbench/node-change` says so; the first-hand layer exists because
 * `workbench/utterance` events do. Both write paths, a person editing and the
 * model proposing, end in an append here, which is what makes the tree free to
 * persist, free to broadcast, and reconstructable by replay.
 *
 * Every payload is JSON-serializable, as `session.append` enforces.
 * @module @deepseek-ai/dsh-workbench/events
 */

// Loads the session package so the SessionEventMap augmentation below resolves
// through its project reference rather than its built declarations.
import type {} from '@deepseek-ai/dsh-session'
import type { BodyId, NodeId, ProposalId, SourceId } from './brand.ts'
import type { BodyPayload, FirstLayerEntry, NodeTmp, WorkbenchMeta, WorkbenchNode } from './model.ts'

/**
 * A whole-value checkpoint. Cold start replays from the newest one plus the
 * events after it, so a long session does not pay for its whole history.
 *
 * It is complete on purpose — the node tree, the first-hand layer, and the
 * proposals. A checkpoint missing the first-hand layer would let a cold start
 * skip the prefix that holds the entries the tree's fields cite, and every
 * dependency set drawing on one of them would then fail to build. The cost is
 * that a checkpoint grows with the first-hand layer, which is what caps the
 * usable session length until a projection backend replaces this.
 *
 * It carries no `rev` of its own: `meta.rev` is the tree's `rev`, and a second
 * copy could disagree with it.
 */
export interface WorkbenchSnapshot {
  readonly nodes: readonly WorkbenchNode[]
  readonly firstLayer: readonly FirstLayerEntry[]
  readonly proposals: readonly CheckpointedProposal[]
  /**
   * Uncommitted edit state, so a checkpoint does not discard what a person has
   * typed but not yet committed. Absent in a checkpoint written before edit state
   * existed, which reads as "no card is in edit state".
   */
  readonly tmp?: readonly CheckpointedTmp[]
  readonly meta: WorkbenchMeta
}

/** One proposal and its ruling, as a checkpoint carries them. */
export interface CheckpointedProposal {
  readonly proposal: WorkbenchProposal
  readonly verdict?: WorkbenchVerdict
}

/** One card's uncommitted edit state, as a checkpoint carries it. */
export interface CheckpointedTmp {
  readonly nodeId: NodeId
  readonly tmp: NodeTmp
}

/** Who wrote a change. `system` is reserved for projections repairing their own bookkeeping. */
export type ChangeActor = 'human' | 'ai' | 'system'

/** What a change did to the node it carries. */
export type ChangeOp = 'create' | 'update' | 'move' | 'delete' | 'promote' | 'reject'

/**
 * One commit against one node — the single write event; the human edit channel
 * and the accepted-proposal path both land here.
 *
 * A commit writing several nodes emits several of these sharing one `rev`:
 * atomicity lives in the commit, so the projection and the browser apply a batch
 * of equal-`rev` events as one step.
 */
export interface WorkbenchNodeChange {
  /** The `rev` after this commit; every event of one commit repeats it. */
  readonly rev: number
  readonly actor: ChangeActor
  readonly op: ChangeOp
  /** The node after the change, whole-value, so a reader needs no prior state. On `delete`, the node as it last stood. */
  readonly node: WorkbenchNode
  /** Nodes this change puts in doubt, one hop. Stage 0 shows it to the editor; the scheduler consumes it later. */
  readonly invalidation?: readonly NodeId[]
}

/**
 * One first-hand entry: the person's words, carried in unchanged. Append-only,
 * never edited, never checkpointed.
 */
export interface WorkbenchUtterance {
  readonly entryId: SourceId
  readonly text: string
  /** The global `rev` current when this was appended, so a dependency item drawn from it can report a `rev`. */
  readonly rev: number
  readonly createdAt: number
}

/** One field a proposal offers, with the first-hand entry it was distilled from. */
export interface ProposedField {
  readonly name: string
  readonly value: string
  readonly sourceId?: SourceId
}

/** One node a proposal offers to create — the cold-start skeleton arrives as a list of these. */
export interface ProposedNode {
  readonly title: string
  readonly parent?: NodeId
  readonly duty?: string
  readonly body?: string
  readonly fields?: readonly ProposedField[]
  /**
   * Content bodies to create with the node. A card usually needs more than one
   * form to say what it is, so one proposal offers them together rather than
   * costing a round each.
   */
  readonly bodies?: readonly ProposedBody[]
}

/**
 * One content body a proposal offers. `replaces` names an existing body this one
 * supersedes: a request to draw a flow chart usually also revises the brief, and
 * without this the model could only ever add, never bring an existing body along.
 */
export interface ProposedBody {
  readonly label: string
  /**
   * The body's content. This is exactly {@link BodyPayload} — the id, the source,
   * and the `rev` are what the commit adds, never what the model supplies.
   */
  readonly payload: BodyPayload
  readonly replaces?: BodyId
}

/**
 * A model draft. The model's only write path, and it does not reach the tree: a
 * proposal waits for a human verdict, and the person may rewrite it first.
 */
export interface WorkbenchProposal {
  readonly proposalId: ProposalId
  /** The node this is about; `null` when it proposes a fresh skeleton. */
  readonly targetNode: NodeId | null
  readonly title: string
  readonly summary?: string
  readonly body?: string
  readonly fields?: readonly ProposedField[]
  readonly newNodes?: readonly ProposedNode[]
  /**
   * Content bodies for the target card — added, or replacing one it already has.
   * This is what lets one request revise the brief and draw a flow chart in the
   * same round instead of costing one round each.
   */
  readonly bodies?: readonly ProposedBody[]
  readonly createdAt: number
}

/** How a person ruled on a proposal. `edited` records that they rewrote it before accepting. */
export type VerdictOutcome = 'accepted' | 'rejected' | 'edited'

/**
 * A person's ruling. Accepting also emits the `workbench/node-change` events that
 * carry the content into the tree; this event records the decision itself, so a
 * rejection leaves a trace rather than nothing.
 */
export interface WorkbenchVerdict {
  readonly proposalId: ProposalId
  readonly outcome: VerdictOutcome
  /** The tree's `rev` at the moment of the ruling. */
  readonly rev: number
  readonly note?: string
}

/**
 * A card's uncommitted edit state, written to the log so it survives a reload and
 * a change of machine.
 *
 * It does NOT move `rev`. `rev` means "one commit landed", and the whole staleness
 * design reads it that way: were a keystroke to advance it, "one commit, one
 * `rev`" would stop holding and the later invalidation pass would compute an
 * impact set per keystroke.
 *
 * `tmp: null` clears the state — pressing 确定, pressing 丢弃, and committing the
 * node all end in the same clearing write.
 */
export interface WorkbenchScratch {
  readonly nodeId: NodeId
  readonly tmp: NodeTmp | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-value checkpoint of the workbench tree, appended on promotion and every configured number of changes. */
    'workbench/snapshot': WorkbenchSnapshot
    /** One committed change to one workbench node; events of one commit share a `rev`. */
    'workbench/node-change': WorkbenchNodeChange
    /** One verbatim first-hand utterance, mirrored from the person's message. */
    'workbench/utterance': WorkbenchUtterance
    /** One model draft awaiting a human verdict; it does not reach the tree. */
    'workbench/proposal': WorkbenchProposal
    /** A person's ruling on one proposal. */
    'workbench/verdict': WorkbenchVerdict
    /**
     * One card's uncommitted edit state, or its clearing. Never moves `rev`.
     *
     * Required-on-read like every other member, NOT marked `ignorable`: the
     * envelope defines that marker but `Session.append` exposes no way to set it,
     * so no producer in this repository writes one. Being required is the safe
     * default anyway — a reader that does not know this type refuses the log
     * instead of silently resuming without it.
     *
     * It would nonetheless QUALIFY as ignorable, and that is a standing constraint
     * rather than an observation: skipping these rebuilds the committed tree byte
     * for byte, because the `workbench/node-change` a commit emits carries the
     * whole committed node instead of citing the edit state it came from. A commit
     * that recorded only a reference to the edit state would break that property.
     */
    'workbench/scratch': WorkbenchScratch
  }
}
