/**
 * The fold: the host's `workbench/*` event family folded into the tree the tab
 * renders, and the view target that publishes it.
 *
 * The projection and every derived fact come from `dsh-workbench/projection` —
 * the same code the host runs. Nothing here recomputes a dependency set, a shape
 * candidate, or a maturity mark.
 */

import type {
  ClientContext, ConversationNodeContext, ConversationNodeDefinition, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyWorkbenchEvent, children, cloneWorkbenchState, emptyWorkbenchState, shapeCandidates, structuralHealth,
  WORKBENCH_EVENT_TYPES, type NodeId, type WorkbenchEvent, type WorkbenchState,
} from '@deepseek-ai/dsh-workbench/projection'
import type { TreeRow, WorkbenchSnapshot, WorkbenchTreeView } from './contract.ts'

/** Definition kind, also the view-node kind. */
export const WORKBENCH_KIND = 'workbench-tree'
/** View target this definition owns. */
export const WORKBENCH_TARGET = 'workbench'

/**
 * One Context per session. The tree is session-wide state, not a per-turn row, so
 * there is exactly one business identity and it is constant.
 */
const TREE_ID = 'tree'

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    /** The folded workbench tree consumed by the 工作台 tab. */
    workbench: WorkbenchSnapshot
  }
}

/** State the fold carries: the projection plus what the meter counts. */
export interface WorkbenchTreeState {
  readonly projection: WorkbenchState
  readonly commits: number
}

/** Fold one event into a copy of the projection. */
function advance(state: WorkbenchTreeState, event: SessionEvent): WorkbenchTreeState {
  const projection = cloneWorkbenchState(state.projection)
  applyWorkbenchEvent(projection, event as unknown as WorkbenchEvent)
  return {
    projection,
    commits: state.commits + (event.type === 'workbench/node-change' ? 1 : 0),
  }
}

/**
 * Walk the tree depth-first from the roots, so a row's depth is its nesting.
 * @param projection - the folded projection.
 * @returns one row per node, parents before their children.
 */
export function treeRows(projection: WorkbenchState): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (parent: NodeId | null, depth: number): void => {
    for (const node of [...projection.nodes.values()].filter(candidate => candidate.parent === parent)) {
      rows.push({ node, depth, shapes: shapeCandidates(projection, node.id) })
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  // A node whose parent is absent would otherwise vanish from the tree; the
  // gates keep that out of the log, but a partial window can still show it.
  const shown = new Set(rows.map(row => row.node.id))
  for (const node of projection.nodes.values()) {
    if (!shown.has(node.id)) rows.push({ node, depth: 0, shapes: shapeCandidates(projection, node.id) })
  }
  return rows
}

/**
 * Project the fold's state into what the tab renders.
 * @param state - the state this Context has folded so far.
 * @returns the tree, the drafts, and the meter's counters.
 */
export function treeView(state: WorkbenchTreeState): WorkbenchTreeView {
  const nodes = [...state.projection.nodes.values()]
  const health = structuralHealth(nodes)
  return {
    rows: treeRows(state.projection),
    proposals: [...state.projection.proposals.values()].map(record => ({
      proposal: record.proposal,
      ruled: record.verdict !== undefined,
    })),
    rev: state.projection.meta.rev,
    commits: state.commits,
    untouchedModelNodes: nodes.filter(node => node.source === 'ai').length,
    meanBodyChars: health.meanBodyChars,
    distinctOpenFields: health.distinctOpenFields,
    projection: state.projection,
  }
}

/**
 * The tree definition. Every workbench event belongs to the one Context; a
 * checkpoint is its start, which is why the host appends one before the first
 * change of a session — without it the fold would have updates and no state.
 */
export const workbenchTreeDefinition: ConversationNodeDefinition<WorkbenchTreeState> = {
  kind: WORKBENCH_KIND,
  target: WORKBENCH_TARGET,
  match: (event: SessionEvent) => {
    if (!WORKBENCH_EVENT_TYPES.has(event.type)) return null
    return { id: TREE_ID, role: event.type === 'workbench/snapshot' ? 'start' : 'update' }
  },
  start: (_context, match) => advance({ projection: emptyWorkbenchState(), commits: 0 }, match.event),
  update: (context, match) => advance(context.state, match.event),
  buildViewNode: (context: ConversationNodeContext<WorkbenchTreeState>) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: WORKBENCH_KIND,
      id: context.id,
      target: WORKBENCH_TARGET,
      data: treeView(context.state),
    }
  },
}

/** Keeps the single tree node this target ever carries. */
class WorkbenchSnapshotBuilder implements ConversationViewBuilder<ConversationViewNode, WorkbenchSnapshot> {
  readonly empty: WorkbenchSnapshot = { tree: undefined }
  private current: WorkbenchSnapshot = { tree: undefined }

  /**
   * Adopt the complete node set.
   * @param input - the materialized nodes.
   * @returns the snapshot the tab reads.
   */
  replace(input: { readonly nodes: readonly ConversationViewNode[] }): WorkbenchSnapshot {
    this.current = { tree: input.nodes.at(-1)?.data as WorkbenchTreeView | undefined }
    return this.current
  }

  /**
   * Adopt the changed node set. There is only ever one node, so an upsert is a
   * replacement — and a transaction that changed nothing must leave the tree as
   * it stood rather than clearing it.
   * @param input - the changed nodes.
   * @returns the snapshot the tab reads.
   */
  apply(input: { readonly upserts: readonly ConversationViewNode[] }): WorkbenchSnapshot {
    const latest = input.upserts.at(-1)
    if (latest === undefined) return this.current
    this.current = { tree: latest.data as WorkbenchTreeView }
    return this.current
  }
}

/** Target factory for the workbench view. */
export const workbenchViewDefinition: ConversationViewDefinition<ConversationViewNode, WorkbenchSnapshot> = {
  target: WORKBENCH_TARGET,
  create: () => new WorkbenchSnapshotBuilder(),
}

/**
 * Register the fold and its view target.
 * @param ctx - client root context.
 */
export function registerWorkbenchFold(ctx: ClientContext): void {
  ctx.conversationEvents.register(workbenchTreeDefinition)
  ctx.conversationViews.register(workbenchViewDefinition)
}

/** Direct children of a node, for the child-list shape. */
export { children }
