/**
 * The projection: the workbench event family folded into an in-memory tree. It
 * owns no second copy on disk — the session log is the tree, and this is the
 * readable form of it, rebuilt by replay.
 *
 * The fold mutates a projection it owns rather than rebuilding one per event, so
 * a cold start over a long log stays linear. Reads go through `./core.ts` over
 * the projection, which satisfies {@link NodeGraph}: this module deliberately
 * exposes no `dependencySet` or `children` of its own, because a derived quantity
 * with two implementations is how the same fact ends up with two values.
 * @module @deepseek-ai/dsh-workbench/store
 */

import type { NodeId, ProposalId, SourceId } from './brand.ts'
import type {
  CheckpointedProposal, WorkbenchNodeChange, WorkbenchProposal, WorkbenchSnapshot, WorkbenchUtterance,
  WorkbenchVerdict,
} from './events.ts'
import type { FirstLayerEntry, NodeGraph, WorkbenchMeta, WorkbenchNode } from './model.ts'

/** One proposal and its ruling, if a person has already ruled. */
export interface ProposalRecord {
  readonly proposal: WorkbenchProposal
  readonly verdict?: WorkbenchVerdict
}

/**
 * The projected workbench. Assignable to {@link NodeGraph}, which is what lets
 * every derivation in `./core.ts` run directly against it.
 */
export interface WorkbenchState extends NodeGraph {
  readonly nodes: Map<NodeId, WorkbenchNode>
  readonly firstLayer: Map<SourceId, FirstLayerEntry>
  readonly proposals: Map<ProposalId, ProposalRecord>
  meta: WorkbenchMeta
  /** `workbench/node-change` events folded since the last checkpoint; the checkpoint trigger reads it. */
  changesSinceSnapshot: number
}

/** One workbench event as the fold consumes it. */
export type WorkbenchEvent =
  | { readonly type: 'workbench/snapshot'; readonly data: WorkbenchSnapshot }
  | { readonly type: 'workbench/node-change'; readonly data: WorkbenchNodeChange }
  | { readonly type: 'workbench/utterance'; readonly data: WorkbenchUtterance }
  | { readonly type: 'workbench/proposal'; readonly data: WorkbenchProposal }
  | { readonly type: 'workbench/verdict'; readonly data: WorkbenchVerdict }

/** The event types this projection folds; the session-stream listener filters on it. */
export const WORKBENCH_EVENT_TYPES: ReadonlySet<string> = new Set<WorkbenchEvent['type']>([
  'workbench/snapshot', 'workbench/node-change', 'workbench/utterance', 'workbench/proposal', 'workbench/verdict',
])

/**
 * An empty projection: no nodes, no first-hand entries, `rev` 0, and an empty
 * field dictionary, so every open field starts out unregistered.
 * @returns the initial projection.
 */
export function emptyWorkbenchState(): WorkbenchState {
  return {
    nodes: new Map(),
    firstLayer: new Map(),
    proposals: new Map(),
    meta: { rev: 0, fieldDictionary: {} },
    changesSinceSnapshot: 0,
  }
}

/**
 * Copy a projection so a caller can fold into the copy without disturbing the
 * original. The browser half needs this: its fold must return a new State per
 * update for the engine to publish, while {@link applyWorkbenchEvent} advances a
 * projection in place.
 * @param state - the projection to copy.
 * @returns an independent projection with the same contents.
 */
export function cloneWorkbenchState(state: WorkbenchState): WorkbenchState {
  return {
    nodes: new Map(state.nodes),
    firstLayer: new Map(state.firstLayer),
    proposals: new Map(state.proposals),
    meta: state.meta,
    changesSinceSnapshot: state.changesSinceSnapshot,
  }
}

/**
 * Fold one event into the projection.
 *
 * The refusals below are not defensive noise about a typed caller: this reads a
 * durable log, and each one names a corruption that would otherwise reconstruct a
 * plausible wrong tree — a promotion that did not promote, an utterance rewritten
 * under an id already used, a ruling on a proposal nobody made.
 * @param state - the projection to advance, mutated in place.
 * @param event - the event to fold.
 */
export function applyWorkbenchEvent(state: WorkbenchState, event: WorkbenchEvent): void {
  switch (event.type) {
    case 'workbench/snapshot':
      applySnapshot(state, event.data)
      return
    case 'workbench/node-change':
      applyNodeChange(state, event.data)
      return
    case 'workbench/utterance':
      applyUtterance(state, event.data)
      return
    case 'workbench/proposal':
      applyProposal(state, event.data)
      return
    case 'workbench/verdict':
      applyVerdict(state, event.data)
      return
    default:
      // Reachable only from a log carrying a `workbench/*` type this build does
      // not know, which is exactly the case the persistence read path refuses
      // rather than interpreting.
      throw new Error(`workbench: cannot fold event ${(event as WorkbenchEvent).type}`)
  }
}

/**
 * Replay a log into a projection. A checkpoint replaces the whole projection, so
 * starting from the newest one and folding what follows gives the same result as
 * folding everything — which is what makes {@link latestSnapshotIndex} a
 * shortcut rather than a different answer.
 * @param events - the workbench events, in log order.
 * @returns the projection after the last event.
 */
export function projectWorkbench(events: readonly WorkbenchEvent[]): WorkbenchState {
  const state = emptyWorkbenchState()
  for (const event of events.slice(latestSnapshotIndex(events))) applyWorkbenchEvent(state, event)
  return state
}

/**
 * Index of the newest checkpoint in a log, or 0 when it holds none.
 * @param events - the workbench events, in log order.
 * @returns the index to start folding from.
 */
export function latestSnapshotIndex(events: readonly WorkbenchEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'workbench/snapshot') return index
  }
  return 0
}

/**
 * Whether a checkpoint should follow the change just folded: always after a
 * promotion, because that is the moment the tree gained a commitment worth
 * restarting from, and otherwise once the configured number of changes have
 * accumulated.
 * @param state - the projection after folding the change.
 * @param change - the change just folded.
 * @param everyChanges - the owning plugin's configured checkpoint interval.
 * @returns true when a `workbench/snapshot` should be appended.
 */
export function shouldSnapshot(state: WorkbenchState, change: WorkbenchNodeChange, everyChanges: number): boolean {
  return change.op === 'promote' || state.changesSinceSnapshot >= everyChanges
}

/**
 * The checkpoint payload for the current projection.
 * @param state - the projection to check point.
 * @returns the snapshot payload to append.
 */
export function snapshotOf(state: WorkbenchState): WorkbenchSnapshot {
  return {
    nodes: [...state.nodes.values()],
    firstLayer: [...state.firstLayer.values()],
    proposals: [...state.proposals.values()].map(toCheckpointedProposal),
    meta: state.meta,
  }
}

/** Drop the record's projection identity, keeping only what a checkpoint carries. */
function toCheckpointedProposal(record: ProposalRecord): CheckpointedProposal {
  return record.verdict === undefined
    ? { proposal: record.proposal }
    : { proposal: record.proposal, verdict: record.verdict }
}

/** Replace the whole projection from a checkpoint and restart the change count. */
function applySnapshot(state: WorkbenchState, data: WorkbenchSnapshot): void {
  state.nodes.clear()
  for (const node of data.nodes) state.nodes.set(node.id, node)
  state.firstLayer.clear()
  for (const entry of data.firstLayer) state.firstLayer.set(entry.entryId, entry)
  state.proposals.clear()
  for (const record of data.proposals) state.proposals.set(record.proposal.proposalId, record)
  state.meta = data.meta
  state.changesSinceSnapshot = 0
}

/** Apply one commit: the whole-value node, the tree's new `rev`, and the change count. */
function applyNodeChange(state: WorkbenchState, data: WorkbenchNodeChange): void {
  if (data.rev < state.meta.rev) {
    throw new Error(`workbench: node-change rev ${String(data.rev)} moves backwards from ${String(state.meta.rev)}`)
  }
  if (data.op === 'promote') {
    if (data.node.maturity !== 'committed') {
      throw new Error(`workbench: promote left ${data.node.id} at ${data.node.maturity}`)
    }
    if (state.nodes.get(data.node.id)?.maturity === 'committed') {
      throw new Error(`workbench: promote of already committed ${data.node.id}`)
    }
  }
  if (data.op === 'delete') state.nodes.delete(data.node.id)
  else state.nodes.set(data.node.id, data.node)
  state.meta = { ...state.meta, rev: data.rev }
  state.changesSinceSnapshot += 1
}

/** Append one first-hand entry, refusing to overwrite an id the layer already holds. */
function applyUtterance(state: WorkbenchState, data: WorkbenchUtterance): void {
  if (state.firstLayer.has(data.entryId)) {
    throw new Error(`workbench: first-hand entry ${data.entryId} appended twice`)
  }
  state.firstLayer.set(data.entryId, {
    kind: 'utterance',
    entryId: data.entryId,
    text: data.text,
    rev: data.rev,
    createdAt: data.createdAt,
  })
}

/** Record one draft, refusing a proposal id already in flight. */
function applyProposal(state: WorkbenchState, data: WorkbenchProposal): void {
  if (state.proposals.has(data.proposalId)) {
    throw new Error(`workbench: proposal ${data.proposalId} declared twice`)
  }
  state.proposals.set(data.proposalId, { proposal: data })
}

/** Attach one ruling, refusing a second ruling and a ruling on an unknown draft. */
function applyVerdict(state: WorkbenchState, data: WorkbenchVerdict): void {
  const record = state.proposals.get(data.proposalId)
  if (record === undefined) throw new Error(`workbench: verdict on unknown proposal ${data.proposalId}`)
  if (record.verdict !== undefined) throw new Error(`workbench: proposal ${data.proposalId} ruled twice`)
  state.proposals.set(data.proposalId, { proposal: record.proposal, verdict: data })
}
