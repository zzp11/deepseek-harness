/**
 * The workbench content model: the node tree (statements about the world), the
 * first-hand layer (traces, append-only), and the read model the pure derivations
 * in `./core.ts` consume. Types plus the domain constants they are defined
 * against; no behavior.
 * @module @deepseek-ai/dsh-workbench/model
 */

import type { NodeId, SourceId } from './brand.ts'

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
 * The whole read model one derivation runs against. Passing it explicitly is
 * what keeps `./core.ts` free of I/O and of any DSH dependency: the projection
 * store builds this, and the tools, the edit channel, and the browser all
 * consume the derivations rather than recomputing them.
 */
export interface NodeGraph {
  readonly nodes: ReadonlyMap<NodeId, WorkbenchNode>
  readonly firstLayer: ReadonlyMap<SourceId, FirstLayerEntry>
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
  'title', 'parent', 'duty', 'maturity', 'source', 'body', 'verifyCriteria', 'action',
]

/** Model-visible label per maturity rung; the model and the person read the same words. */
export const MATURITY_LABELS: Readonly<Record<Maturity, string>> = {
  thought: '念头',
  idea: '想法',
  committed: '已承诺',
  rejected: '已否决',
}
