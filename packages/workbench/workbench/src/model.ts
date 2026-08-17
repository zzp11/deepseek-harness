/**
 * The workbench content model: the node tree (statements about the world), the
 * first-hand layer (traces, append-only), and the read model the pure derivations
 * in `./core.ts` consume. Types plus the domain constants they are defined
 * against; no behavior.
 * @module @deepseek-ai/dsh-workbench/model
 */

import type { BodyId, BodyObjectId, NodeId, ProposalId, SourceId } from './brand.ts'

/**
 * How settled a node is. The value set is closed: adding a rung is a data
 * migration, so v1 does not.
 *
 * `thought` 念头 and `idea` 想法 are the working region where gates stay quiet;
 * `committed` 已承诺 is the region gates guard, and reaching it is the one point
 * where friction is charged; `rejected` 已否决 keeps a decision and its reason
 * instead of deleting it.
 */
export type Maturity = 'thought' | 'idea' | 'committed' | 'rejected'

/** Whether a node's content came from a person, from the model, or was distilled from a first-hand entry. */
export type NodeSource = 'human' | 'ai' | { readonly sourceId: SourceId }

/**
 * Whether a criterion or an action is absent, stated only as prose, or written
 * so a machine can check it. The distinction decides who can judge it: prose is
 * the model's job and costs a request, structured is a gate's job and is free.
 * v1 stores the mark and nothing reads it yet.
 */
export type Executability = 'none' | 'wish' | 'executable'

/** One open field: a value plus the first-hand entry it was distilled from. */
export interface NodeField {
  readonly value: string
  readonly sourceId?: SourceId
}

/**
 * Which region of the tree a node belongs to. `idea` marks the root of one card's
 * idea area — unconfirmed thoughts that may nest freely and are invisible outside
 * that area, including to the card's own submodules. Descendants of an `idea` root
 * are inside it by ancestry and carry `main` themselves; membership is decided by
 * walking the parent chain, never by copying the mark down.
 */
export type NodeRegion = 'main' | 'idea'

/**
 * A body kind whose content is written down by a person or the model. It has its
 * own truth, so it is stored, it carries a `lastRev`, and it can go stale against
 * its siblings.
 */
export type AuthoredBodyKind = 'brief' | 'table' | 'flow' | 'argument'

/**
 * A body kind computed from the tree. It has no truth of its own — every fact in
 * it is already somewhere else — so it is never stored and can never disagree
 * with the content it is drawn from.
 */
export type DerivedViewKind = 'submodule-map' | 'relation' | 'constraints' | 'ideas' | 'chart'

/** Every body kind a card's tag strip can offer. */
export type ContentBodyKind = AuthoredBodyKind | DerivedViewKind

/** One step of a flow, addressable so the conversation anchor can cite it. */
export interface FlowStep {
  readonly stepId: BodyObjectId
  readonly text: string
  /** Steps this one leads to; absent means it leads to the next in order. */
  readonly next?: readonly BodyObjectId[]
}

/** One row of a table, addressable for the same reason as {@link FlowStep}. */
export interface TableRow {
  readonly rowId: BodyObjectId
  readonly cells: readonly string[]
}

/** One ground supporting or opposing a stance. */
export interface ArgumentGround {
  readonly groundId: BodyObjectId
  readonly text: string
  readonly opposes?: true
}

/** One plotted value, drawn from a strictly numeric table column. */
export interface ChartPoint {
  readonly label: string
  readonly value: number
}

/**
 * What an authored body holds, discriminated by `kind`.
 *
 * The discriminant lives here rather than beside it on {@link AuthoredBody} so a
 * body cannot carry a `kind` that disagrees with its payload. Note that no
 * variant exists for a {@link DerivedViewKind}: a derived view is not
 * representable as stored content, which is what keeps §2.1's split from
 * depending on a test.
 */
export type BodyPayload =
  | { readonly kind: 'brief'; readonly duty: string; readonly body: string }
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly TableRow[] }
  | { readonly kind: 'flow'; readonly steps: readonly FlowStep[] }
  | { readonly kind: 'argument'; readonly stance: string; readonly grounds: readonly ArgumentGround[] }

/**
 * One authored content body: what the tag strip selects and the card renders.
 *
 * `lastRev` is what makes staleness decidable without fingerprints: a body older
 * than the newest authored body on the same card may no longer agree with it.
 */
export type AuthoredBody = {
  readonly id: BodyId
  /** What the tag strip shows. */
  readonly label: string
  readonly source: NodeSource
  /** The global `rev` this body was last committed at. */
  readonly lastRev: number
} & BodyPayload

/**
 * A card's uncommitted edit state — what the person has typed, or what the model
 * has offered, before anyone pressed 确定.
 *
 * It is kept OUT of {@link WorkbenchNode} on purpose. A node reaches the model
 * through the dependency set, and a `tmp` field hanging off the node would ride
 * along on every rendering path that walks a node; separated, the type the
 * injection path receives has no such field, so the leak cannot be written. That
 * is a stronger guarantee than a test asserting it does not leak.
 */
export interface NodeTmp {
  readonly title?: string
  readonly duty?: string
  readonly body?: string
  /** The card's bodies as they stand uncommitted, whole-value. */
  readonly bodies?: readonly AuthoredBody[]
  /** The proposal that opened this edit state, when the model opened it. */
  readonly fromProposal?: ProposalId
  /** When this edit state was last written. */
  readonly at: number
}

/**
 * Whether a `user/message` is a person speaking.
 *
 * A `user/message` is not always a person: the prompt and context plugins inject
 * runtime snapshots through the same event, carrying `source.kind: 'plugin'`. The
 * first-hand layer is the person's own words and nothing else — one machine-written
 * paragraph in it makes every citation drawn from the layer unreliable, and the
 * conversation column shows it back to them as something they said.
 *
 * Read structurally because the message is durable data another package wrote. This
 * is the ONE home for the rule: the mirror decides what to carry with it, and the
 * package invariant decides what the mirror owes with it, so the two cannot drift.
 * @param data - the `user/message` event's payload.
 * @returns true when a person authored it.
 */
export function isPersonSaid(data: unknown): boolean {
  const { source } = data as { source?: { kind?: unknown } }
  return source?.kind === 'user'
}

/**
 * An edit-state write as it crosses a wire. `at` is absent because it is the
 * receiving process's stamp: a browser clock that is wrong, or lying, must not be
 * able to put a time into the log.
 */
export type TmpDraft = Omit<NodeTmp, 'at'>

/** The skeleton fields every node carries, independent of its open fields. */
export interface NodeFields {
  /** Says the point in one line. */
  readonly title: string
  /** Where the node hangs; `null` at a root. */
  readonly parent: NodeId | null
  /** What this node is answerable for. Required once it has children. */
  readonly duty?: string
  readonly maturity: Maturity
  readonly source: NodeSource
  /** Prose body. */
  readonly body?: string
  readonly verifyCriteria?: Executability
  readonly action?: Executability
  /** Which region this node belongs to; absent means {@link NodeRegion} `main`. */
  readonly region?: NodeRegion
  /**
   * The card's authored content bodies, in tag-strip order. Derived views are not
   * here — they are computed per read.
   */
  readonly bodies?: readonly AuthoredBody[]
  /** Fields beyond the skeleton, keyed by name. A name absent from the dictionary is unregistered. */
  readonly fields: Readonly<Record<string, NodeField>>
}

/** A node of the tree, as projected from the session log. */
export interface WorkbenchNode extends NodeFields {
  readonly id: NodeId
  /** The global `rev` this node was last written at. */
  readonly lastRev: number
  readonly createdAt: number
}

/**
 * One first-hand entry. Append-only and never edited, so it can never go stale.
 * The union is open: v1 records utterances, and execution records join later
 * without migrating what is already on disk.
 */
export type FirstLayerEntry = {
  readonly kind: 'utterance'
  readonly entryId: SourceId
  /** The person's words, carried in unchanged. */
  readonly text: string
  /** The card that was focused when they said it; absent when nothing was. */
  readonly moduleId?: NodeId
  /** The global `rev` current when this entry was appended. */
  readonly rev: number
  readonly createdAt: number
}

/** Tree-wide state that is not a node. */
export interface WorkbenchMeta {
  /** Monotonic, one step per commit; a commit writing N nodes gives all of them the same value. */
  readonly rev: number
  /** Registered open-field names and what each one means. */
  readonly fieldDictionary: Readonly<Record<string, FieldDictionaryEntry>>
}

/** What a registered open field means and what shape its value takes. */
export interface FieldDictionaryEntry {
  readonly semantic: string
  readonly shape: string
}

/**
 * One proposal and whether it has been ruled on — only what a derivation reads.
 *
 * It lives here rather than in the projection store because a derivation needs it:
 * the reminder count a card shows is "unruled proposals at or below me", and
 * `./core.ts` must not import the store it is consumed by.
 */
export interface PendingProposal {
  readonly proposal: { readonly proposalId: ProposalId; readonly targetNode: NodeId | null }
  readonly verdict?: unknown
}

/** One entry of a card's submodule map: a child, and how much it contains. */
export interface SubmoduleMapItem {
  readonly nodeId: NodeId
  readonly title: string
  readonly maturity: Maturity
  /** Descendants below this child. The map draws one level; this says what is deeper. */
  readonly contains: number
  /** Unruled proposals at or below this child. */
  readonly reminders: number
}

/** One edge of a relation graph: an open field on `from` whose value names `to`. */
export interface RelationEdge {
  readonly from: NodeId
  readonly to: NodeId
  /** The open field whose value named the target. */
  readonly via: string
}

/**
 * A view computed from the tree rather than stored. Discriminated by `kind`, with
 * no variant reachable from {@link BodyPayload} — the two are disjoint by
 * construction.
 */
export type DerivedView =
  | { readonly kind: 'submodule-map'; readonly items: readonly SubmoduleMapItem[] }
  | { readonly kind: 'relation'; readonly edges: readonly RelationEdge[] }
  | { readonly kind: 'constraints'; readonly items: readonly WorkbenchNode[] }
  | { readonly kind: 'ideas'; readonly items: readonly SubmoduleMapItem[] }
  | { readonly kind: 'chart'; readonly source: BodyId; readonly axis: string; readonly points: readonly ChartPoint[] }

/**
 * The whole read model one derivation runs against. Passing it explicitly is
 * what keeps `./core.ts` free of I/O and of any DSH dependency: the projection
 * store builds this, and the tools, the edit channel, and the browser all
 * consume the derivations rather than recomputing them.
 */
export interface NodeGraph {
  readonly nodes: ReadonlyMap<NodeId, WorkbenchNode>
  readonly firstLayer: ReadonlyMap<SourceId, FirstLayerEntry>
  /**
   * Uncommitted edit state per node. Present in the read model because the card
   * restores its edit state from it, and deliberately absent from every
   * derivation that feeds the model — see {@link NodeTmp}.
   */
  readonly tmp: ReadonlyMap<NodeId, NodeTmp>
  readonly meta: WorkbenchMeta
}

/** Which part of the read model a dependency item was drawn from. */
export type DependencyKind = 'self' | 'ancestor' | 'constraint' | 'source' | 'skeleton'

/**
 * One entry of a node's dependency set: what it is, where it came from, and the
 * `rev` it was last true at. The `rev` is what makes staleness decidable — a
 * draft computed against a set is invalid once any item's `rev` has moved.
 */
export interface DependencyItem {
  readonly kind: DependencyKind
  /** A {@link NodeId} for tree items, a {@link SourceId} for first-hand items, {@link SKELETON_ITEM_ID} for the index. */
  readonly id: string
  readonly rev: number
  readonly content: string
}

/**
 * How a node can be drawn. v1 renders the first two; the rest are declared here
 * so that adding a renderer later is not a data migration.
 */
export type Shape = 'paragraph-card' | 'child-list' | 'table' | 'relation-graph' | 'argument-graph' | 'flow'

/**
 * Root of the global-constraint area. A node under this root constrains every
 * node outside it, and every dependency set carries the whole area. Stage 0 has
 * no operation that puts a node here, so the area is reliably empty rather than
 * absent.
 */
export const GLOBAL_CONSTRAINT_ROOT_ID: NodeId = 'G-' as NodeId

/** Stands in for the tree index, which is one dependency item rather than one per node. */
export const SKELETON_ITEM_ID = 'skeleton'

/**
 * The skeleton field names, which are registered by construction. An open field
 * is registered only by the dictionary.
 */
export const SKELETON_FIELD_NAMES: readonly string[] = [
  'title', 'parent', 'duty', 'maturity', 'source', 'body', 'verifyCriteria', 'action', 'region', 'bodies',
]

/**
 * The body kind every card carries, first in the tag strip and never removable.
 * It is the `duty` carrier, and `duty` is what stands in for a module's body in
 * the global skeleton — a card without it is invisible to every other module's
 * dependency set.
 */
export const REQUIRED_BODY_KIND = 'brief' satisfies AuthoredBodyKind

/** Body kinds computed per read rather than stored; a card never owns one of these. */
export const DERIVED_VIEW_KINDS: readonly DerivedViewKind[] = [
  'submodule-map', 'relation', 'constraints', 'ideas', 'chart',
]

/**
 * A table cell that counts as a number.
 *
 * Deliberately total and deliberately narrow: a unit suffix, a currency mark, or
 * a hedge (`8万`, `$0.4`, `约 200`, `100元`) is REFUSED rather than coerced. The
 * failure being designed out is silent — a mis-parsed cell draws a bar that looks
 * entirely normal — so the criterion refuses instead of guessing, and the chart
 * simply does not become available.
 */
export const NUMERIC_CELL = /^-?\d+(?:\.\d+)?$/

/** Model-visible label per maturity rung; the model and the person read the same words. */
export const MATURITY_LABELS: Readonly<Record<Maturity, string>> = {
  thought: '念头',
  idea: '想法',
  committed: '已承诺',
  rejected: '已否决',
}
