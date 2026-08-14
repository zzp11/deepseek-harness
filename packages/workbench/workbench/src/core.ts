/**
 * Every derived quantity of the workbench, computed exactly once here: the
 * dependency set and its expansion, the one-hop invalidation list, the shape
 * candidates, field registration, and the `rev` step. Pure functions over an
 * explicit {@link NodeGraph} — no I/O, no cordis, no session log. The projection
 * store, the edit channel, the tools, and the browser all consume these and none
 * of them recomputes one; the same fact derived twice is how the previous attempt
 * produced two different numbers for one thing.
 * @module @deepseek-ai/dsh-workbench/core
 */

import type { NodeId, SourceId } from './brand.ts'
import {
  GLOBAL_CONSTRAINT_ROOT_ID, MATURITY_LABELS, SKELETON_FIELD_NAMES, SKELETON_ITEM_ID,
  type DependencyItem, type NodeGraph, type NodeSource, type Shape, type WorkbenchMeta, type WorkbenchNode,
} from './model.ts'

/**
 * Resolve a node, refusing an id the graph does not carry. A dangling id reaching
 * a derivation means a gate let it through or a projection dropped a node, and
 * silently returning an empty result would hide both.
 * @param graph - the read model.
 * @param nodeId - the node to resolve.
 * @returns the node.
 */
export function requireNode(graph: NodeGraph, nodeId: NodeId): WorkbenchNode {
  const node = graph.nodes.get(nodeId)
  if (node === undefined) {
    throw new Error(`workbench: no node ${nodeId}; call workbench_read_nodes with no nodeId to see the tree index`)
  }
  return node
}

/**
 * Direct children of a node, in insertion order of the graph.
 * @param graph - the read model.
 * @param nodeId - the parent to list under.
 * @returns the child nodes.
 */
export function children(graph: NodeGraph, nodeId: NodeId): WorkbenchNode[] {
  return [...graph.nodes.values()].filter(node => node.parent === nodeId)
}

/**
 * The parent chain of a node, root first, so that reading the expansion top down
 * follows the same direction as the tree.
 * @param graph - the read model.
 * @param nodeId - the node whose ancestors are wanted.
 * @returns the ancestors, root first, excluding the node itself.
 */
export function ancestors(graph: NodeGraph, nodeId: NodeId): WorkbenchNode[] {
  const chain: WorkbenchNode[] = []
  const seen = new Set<NodeId>([nodeId])
  let parent = requireNode(graph, nodeId).parent
  while (parent !== null) {
    // A cycle is impossible through the write path (the no-cycle gate rejects it
    // on every move) but reachable from a corrupted log, where an unbounded walk
    // would hang instead of naming the defect.
    if (seen.has(parent)) throw new Error(`workbench: parent cycle at ${parent}`)
    seen.add(parent)
    const node = requireNode(graph, parent)
    chain.unshift(node)
    parent = node.parent
  }
  return chain
}

/**
 * Every node of the global-constraint area — the descendants of
 * {@link GLOBAL_CONSTRAINT_ROOT_ID}, excluding the root itself. An absent root
 * gives an empty area, which is stage 0's normal state.
 * @param graph - the read model.
 * @returns the constraint nodes, parents before their children.
 */
export function constraints(graph: NodeGraph): WorkbenchNode[] {
  const area: WorkbenchNode[] = []
  const frontier: NodeId[] = [GLOBAL_CONSTRAINT_ROOT_ID]
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    for (const child of children(graph, next)) {
      area.push(child)
      frontier.push(child.id)
    }
  }
  return area
}

/**
 * Whether a node sits inside the global-constraint area.
 * @param graph - the read model.
 * @param nodeId - the node to test.
 * @returns true when the node is a descendant of {@link GLOBAL_CONSTRAINT_ROOT_ID}.
 */
export function isConstraint(graph: NodeGraph, nodeId: NodeId): boolean {
  return graph.nodes.has(nodeId)
    && ancestors(graph, nodeId).some(node => node.id === GLOBAL_CONSTRAINT_ROOT_ID)
}

/**
 * The dependency set of a node: everything needed to work on it, expanded
 * mechanically rather than selected. Five kinds, in a fixed order — the node's
 * own fields, its parent chain's duty and body, the whole constraint area, the
 * first-hand entries its fields cite, and the tree index.
 *
 * The index is one item, not one per node: it is what the reader needs to know
 * the tree exists, and inlining every node would make an unrelated rename read
 * as a change to this set.
 * @param graph - the read model.
 * @param nodeId - the node to build the set for.
 * @returns the dependency items, in the order above.
 */
export function dependencySet(graph: NodeGraph, nodeId: NodeId): DependencyItem[] {
  const node = requireNode(graph, nodeId)
  const items: DependencyItem[] = [
    { kind: 'self', id: node.id, rev: node.lastRev, content: renderNodeFully(node) },
  ]
  for (const ancestor of ancestors(graph, nodeId)) {
    items.push({ kind: 'ancestor', id: ancestor.id, rev: ancestor.lastRev, content: renderNodeDuty(ancestor) })
  }
  for (const constraint of constraints(graph)) {
    items.push({ kind: 'constraint', id: constraint.id, rev: constraint.lastRev, content: renderNodeFully(constraint) })
  }
  for (const sourceId of citedSourceIds(node)) {
    const entry = graph.firstLayer.get(sourceId)
    if (entry === undefined) throw new Error(`workbench: node ${node.id} cites missing first-hand entry ${sourceId}`)
    items.push({ kind: 'source', id: entry.entryId, rev: entry.rev, content: entry.text })
  }
  items.push({
    kind: 'skeleton',
    id: SKELETON_ITEM_ID,
    rev: graph.meta.rev,
    content: renderSkeletonIndex(graph),
  })
  return items
}

/**
 * What there is to read when no node has been named: the whole constraint area
 * and the tree index.
 *
 * Cold start needs this. Every other dependency set is built around one node, and
 * the index that would tell a reader which nodes exist is inside those sets — so
 * without this, a reader holding no id has no way to get one, and an empty tree
 * has nothing to name at all.
 * @param graph - the read model.
 * @returns the constraint items followed by the index item.
 */
export function treeIndexSet(graph: NodeGraph): DependencyItem[] {
  return [
    ...constraints(graph).map((constraint): DependencyItem => ({
      kind: 'constraint',
      id: constraint.id,
      rev: constraint.lastRev,
      content: renderNodeFully(constraint),
    })),
    { kind: 'skeleton', id: SKELETON_ITEM_ID, rev: graph.meta.rev, content: renderSkeletonIndex(graph) },
  ]
}

/**
 * The first-hand entry ids a node's fields cite, deduplicated, in field order.
 * @param node - the node to read.
 * @returns the cited entry ids.
 */
export function citedSourceIds(node: WorkbenchNode): SourceId[] {
  const cited = new Set<SourceId>()
  if (typeof node.source !== 'string') cited.add(node.source.sourceId)
  for (const field of Object.values(node.fields)) {
    if (field.sourceId !== undefined) cited.add(field.sourceId)
  }
  return [...cited]
}

/** Model-visible heading per dependency kind. */
const KIND_HEADINGS: Readonly<Record<DependencyItem['kind'], string>> = {
  self: '自己',
  ancestor: '父链',
  constraint: '全局约束',
  source: '依据',
  skeleton: '骨架',
}

/**
 * Model-visible preamble of an expansion. It states that the set is complete and
 * unedited, because the failure it guards against is the model inventing its own
 * dependencies instead of asking for another node.
 */
const EXPANSION_PREAMBLE = [
  '以下是这个节点的依赖集，机械展开，未经取舍。',
  '不要自行推断还需要什么：要别的节点就再调 workbench_read_nodes。',
].join('\n')

/**
 * Render a dependency set as the text a model reads. v1 is the preamble plus the
 * items joined under their headings, in the order {@link dependencySet} produced.
 * @param items - the dependency set to render.
 * @returns the expansion text.
 */
export function expand(items: readonly DependencyItem[]): string {
  const blocks = items.map(item => `【${KIND_HEADINGS[item.kind]}】${item.id} rev=${String(item.rev)}\n${item.content}`)
  return [EXPANSION_PREAMBLE, ...blocks].join('\n\n')
}

/**
 * The nodes a change to `nodeId` puts in doubt, one hop only. Two edges carry
 * doubt in v1: a child injects its ancestors' duty and body, and a constraint
 * applies to everything outside the constraint area.
 *
 * The tree index is deliberately not an edge. Every dependency set carries it, so
 * treating it as one would make every rename invalidate every node and leave the
 * scheduler with nothing to schedule.
 * @param graph - the read model.
 * @param nodeId - the node that changed.
 * @returns the ids put in doubt, excluding `nodeId` itself.
 */
export function invalidate(graph: NodeGraph, nodeId: NodeId): NodeId[] {
  if (isConstraint(graph, nodeId)) {
    return [...graph.nodes.values()]
      .filter(node => node.id !== nodeId && node.id !== GLOBAL_CONSTRAINT_ROOT_ID && !isConstraint(graph, node.id))
      .map(node => node.id)
  }
  return children(graph, nodeId).map(node => node.id)
}

/**
 * How this node can be drawn, most specific first. v1 answers with one shape:
 * a node with children is a child list, a childless node with a body is a
 * paragraph card. A node carrying only a title has no candidate — the caller
 * renders the empty case rather than being handed a shape that would show
 * nothing.
 * @param graph - the read model.
 * @param nodeId - the node to classify.
 * @returns the candidate shapes.
 */
export function shapeCandidates(graph: NodeGraph, nodeId: NodeId): Shape[] {
  const node = requireNode(graph, nodeId)
  if (children(graph, nodeId).length > 0) return ['child-list']
  return (node.body ?? '') === '' ? [] : ['paragraph-card']
}

/**
 * Whether a field name may be written in the committed region. The skeleton
 * names are registered by construction; an open field is registered only by the
 * dictionary, which starts empty, so every newly opened field is unregistered
 * until someone registers it.
 * @param meta - the tree-wide state carrying the dictionary.
 * @param name - the field name to check.
 * @returns true when the name is registered.
 */
export function isRegisteredField(meta: WorkbenchMeta, name: string): boolean {
  return SKELETON_FIELD_NAMES.includes(name) || Object.hasOwn(meta.fieldDictionary, name)
}

/**
 * The `rev` a commit about to be written will carry. One step per commit, however
 * many nodes that commit writes: atomicity lives in the commit, so the nodes it
 * writes share the value.
 * @param meta - the tree-wide state carrying the current `rev`.
 * @returns the next `rev`.
 */
export function nextRev(meta: WorkbenchMeta): number {
  return meta.rev + 1
}

/**
 * How structured the tree actually is, as of one set of nodes.
 *
 * It exists to catch one silent failure: the model can add no field at all and
 * write every new concept as prose into `body`. The unregistered-field gate then
 * stays green forever and every report passes while structuring has in fact
 * stopped — formally fine, substantively dead, and with nothing to notice it.
 * Prose growing while the distinct field vocabulary does not is that failure's
 * signature.
 *
 * A series needs no new event: every `workbench/snapshot` carries its nodes, so
 * applying this to each checkpoint in the log yields the trend.
 */
export interface StructuralHealth {
  readonly nodeCount: number
  /** Mean `body` length over all nodes, counting a node without a body as 0. */
  readonly meanBodyChars: number
  /** How many distinct open-field names the tree uses at all. */
  readonly distinctOpenFields: number
}

/**
 * Measure {@link StructuralHealth} over a set of nodes — a projection's current
 * nodes, or the nodes a checkpoint carries.
 * @param nodes - the nodes to measure.
 * @returns the measurement; an empty set reports zeros.
 */
export function structuralHealth(nodes: readonly WorkbenchNode[]): StructuralHealth {
  const names = new Set<string>()
  let bodyChars = 0
  for (const node of nodes) {
    bodyChars += (node.body ?? '').length
    for (const name of Object.keys(node.fields)) names.add(name)
  }
  return {
    nodeCount: nodes.length,
    meanBodyChars: nodes.length === 0 ? 0 : bodyChars / nodes.length,
    distinctOpenFields: names.size,
  }
}

/** Render a node's source as the words a model and a person both read. */
function renderSource(source: NodeSource): string {
  return typeof source === 'string' ? (source === 'human' ? '人' : 'AI') : `依据 ${source.sourceId}`
}

/**
 * Render every field of a node — the skeleton fields it carries plus its open
 * fields with their citations.
 * @param node - the node to render.
 * @returns the rendered block.
 */
export function renderNodeFully(node: WorkbenchNode): string {
  const lines = [
    `标题：${node.title}`,
    `成熟度：${MATURITY_LABELS[node.maturity]}`,
    `来源：${renderSource(node.source)}`,
  ]
  if (node.duty !== undefined) lines.push(`职责：${node.duty}`)
  if (node.body !== undefined) lines.push(`正文：${node.body}`)
  for (const [name, field] of Object.entries(node.fields)) {
    lines.push(`${name}：${field.value}${field.sourceId === undefined ? '' : `（依据 ${field.sourceId}）`}`)
  }
  return lines.join('\n')
}

/**
 * Render what an ancestor contributes: what it is answerable for, and its prose.
 * A parent's open fields are deliberately absent — the chain supplies context,
 * not the parent's own working material.
 * @param node - the ancestor to render.
 * @returns the rendered block.
 */
export function renderNodeDuty(node: WorkbenchNode): string {
  const lines = [`标题：${node.title}`]
  if (node.duty !== undefined) lines.push(`职责：${node.duty}`)
  if (node.body !== undefined) lines.push(`正文：${node.body}`)
  return lines.join('\n')
}

/**
 * Render the tree index: one line per node, id, title, and maturity.
 * @param graph - the read model.
 * @returns the rendered index.
 */
export function renderSkeletonIndex(graph: NodeGraph): string {
  return [...graph.nodes.values()]
    .map(node => `${node.id} ${node.title} ${MATURITY_LABELS[node.maturity]}`)
    .join('\n')
}
