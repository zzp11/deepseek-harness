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

import { NodeId, type BodyId, type SourceId } from './brand.ts'
import {
  GLOBAL_CONSTRAINT_ROOT_ID, MATURITY_LABELS, NUMERIC_CELL, SKELETON_FIELD_NAMES, SKELETON_ITEM_ID,
  type AuthoredBody, type ChartPoint, type DependencyItem, type DerivedView, type DerivedViewKind, type NodeGraph,
  type NodeSource, type PendingProposal, type RelationEdge, type Shape, type SubmoduleMapItem, type WorkbenchMeta,
  type WorkbenchNode,
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
    content: renderSkeletonIndex(graph, nodeId),
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
    { kind: 'skeleton', id: SKELETON_ITEM_ID, rev: graph.meta.rev, content: renderSkeletonIndex(graph, null) },
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
 * The idea-area roots enclosing a node, outermost first, including the node itself
 * when it is a root. A node in the main region encloses none.
 * @param graph - the read model.
 * @param nodeId - the node to locate.
 * @returns the enclosing idea roots.
 */
export function ideaRoots(graph: NodeGraph, nodeId: NodeId): NodeId[] {
  const chain = [...ancestors(graph, nodeId), requireNode(graph, nodeId)]
  return chain.filter(node => node.region === 'idea').map(node => node.id)
}

/**
 * Whether a node is visible while working from another one.
 *
 * One rule, no exceptions: a node is visible when every idea area enclosing it
 * also encloses the vantage point. So an idea is invisible to the module it hangs
 * under, to that module's siblings, and — the case worth stating because it is the
 * one people expect to differ — to the module's own submodules. Adoption is what
 * makes an idea visible, by moving its content into the main region.
 *
 * `from` of `null` is the cold-start vantage: nothing is focused, so only the main
 * region is visible.
 * @param graph - the read model.
 * @param from - the node being worked from, or `null` at cold start.
 * @param nodeId - the node whose visibility is asked about.
 * @returns true when the node may be read from that vantage.
 */
export function visibleFrom(graph: NodeGraph, from: NodeId | null, nodeId: NodeId): boolean {
  const enclosing = ideaRoots(graph, nodeId)
  if (enclosing.length === 0) return true
  if (from === null) return false
  const vantage = new Set(ideaRoots(graph, from))
  return enclosing.every(root => vantage.has(root))
}

/**
 * Every node readable from a vantage point, in graph order.
 * @param graph - the read model.
 * @param from - the node being worked from, or `null` at cold start.
 * @returns the visible nodes.
 */
export function visibleNodes(graph: NodeGraph, from: NodeId | null): WorkbenchNode[] {
  return [...graph.nodes.values()].filter(node => visibleFrom(graph, from, node.id))
}

/**
 * Descendants of a node, excluding it, parents before children.
 * @param graph - the read model.
 * @param nodeId - the node to walk below.
 * @returns the descendant nodes.
 */
export function descendants(graph: NodeGraph, nodeId: NodeId): WorkbenchNode[] {
  const below: WorkbenchNode[] = []
  const frontier: NodeId[] = [nodeId]
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    for (const child of children(graph, next)) {
      below.push(child)
      frontier.push(child.id)
    }
  }
  return below
}

/**
 * Unruled proposals at or below a node — the reminder count a card shows, and the
 * count that bubbles up the parent chain.
 *
 * It needs no event of its own. A finished subtask lands as a `workbench/proposal`
 * and a person reading it lands a `workbench/verdict`, so "how many results are
 * waiting for me" is already the difference between the two.
 * @param graph - the read model.
 * @param proposals - the proposal records of the projection.
 * @param nodeId - the node to count at.
 * @returns how many unruled proposals target this node or anything below it.
 */
export function pendingProposals(
  graph: NodeGraph,
  proposals: Iterable<PendingProposal>,
  nodeId: NodeId,
): number {
  const below = new Set<NodeId>([nodeId, ...descendants(graph, nodeId).map(node => node.id)])
  let waiting = 0
  for (const record of proposals) {
    if (record.verdict !== undefined) continue
    const target = record.proposal.targetNode
    if (target !== null && below.has(target)) waiting += 1
  }
  return waiting
}

/**
 * The nodes most recently committed to, newest first — what the left column pins
 * as 最近在弄.
 *
 * The cap has a reason rather than a taste behind it: working memory holds about
 * four chunks, so a longer list would be a list nobody reads. Idea areas are left
 * out because the left column is main-region navigation; ideas are reached through
 * their card's tag.
 * @param graph - the read model.
 * @param limit - how many to keep.
 * @returns the most recently committed main-region nodes, newest first.
 */
export function workingSet(graph: NodeGraph, limit: number): WorkbenchNode[] {
  return visibleNodes(graph, null)
    .filter(node => node.id !== GLOBAL_CONSTRAINT_ROOT_ID)
    .sort((left, right) => right.lastRev - left.lastRev)
    .slice(0, limit)
}

/**
 * The authored bodies of a card that may no longer agree with their siblings —
 * every body older than the newest one on the same card.
 *
 * It answers "which is older", never "do these actually contradict". The real
 * check is a sweep the model runs, which this stage does not have; a mark that
 * over-reports is visible, while a missing check is silent.
 * @param node - the card to measure.
 * @returns the ids of the bodies that may be stale.
 */
export function staleBodies(node: WorkbenchNode): BodyId[] {
  const bodies = node.bodies ?? []
  const newest = Math.max(...bodies.map(body => body.lastRev), 0)
  return bodies.filter(body => body.lastRev < newest).map(body => body.id)
}

/**
 * The strictly numeric columns of a table body, by column index.
 *
 * Strict on purpose: every cell must be a bare number, so a unit, a currency mark,
 * or a hedge disqualifies the column. That is what keeps a mis-read cell from
 * becoming a bar that looks entirely normal — the chart does not become available
 * at all.
 * @param body - the table body to inspect.
 * @returns the indexes of columns whose every cell is a bare number.
 */
export function numericColumns(body: AuthoredBody): number[] {
  if (body.kind !== 'table' || body.rows.length === 0) return []
  return body.columns.flatMap((_, column) =>
    body.rows.every(row => NUMERIC_CELL.test(row.cells[column] ?? '')) ? [column] : [])
}

/**
 * The chart a table body affords, or `null` when no column qualifies. The first
 * column supplies the labels, and the first strictly numeric column after it
 * supplies the values.
 * @param body - the table body to plot.
 * @returns the derived chart, or `null`.
 */
export function chartOf(body: AuthoredBody): Extract<DerivedView, { kind: 'chart' }> | null {
  if (body.kind !== 'table') return null
  const numeric = new Set(numericColumns(body))
  const plotted = [...body.columns.entries()].find(([index]) => index > 0 && numeric.has(index))
  if (plotted === undefined) return null
  const [column, axis] = plotted
  const points: ChartPoint[] = body.rows.map((row) => {
    const label = row.cells[0]
    const value = row.cells[column]
    /* v8 ignore next -- numericColumns already refused any column with a missing cell, so both reads resolve here */
    if (label === undefined || value === undefined) throw new Error(`workbench: table ${body.id} has a short row`)
    return { label, value: Number(value) }
  })
  return { kind: 'chart', source: body.id, axis, points }
}

/**
 * The submodule map of a card: its children, one level only, each with how much it
 * contains and how many results wait below it.
 *
 * One level is a screen budget, not a simplification. Nesting three levels of card
 * inside one column leaves the third too narrow to read, so depth is reached by
 * descending rather than by drawing.
 * @param graph - the read model.
 * @param proposals - the proposal records, for the reminder counts.
 * @param nodeId - the card to map under.
 * @returns one item per child.
 */
export function submoduleMap(
  graph: NodeGraph,
  proposals: Iterable<PendingProposal>,
  nodeId: NodeId,
): SubmoduleMapItem[] {
  const records = [...proposals]
  return children(graph, nodeId)
    .filter(child => child.region !== 'idea')
    .map(child => ({
      nodeId: child.id,
      title: child.title,
      maturity: child.maturity,
      contains: descendants(graph, child.id).length,
      reminders: pendingProposals(graph, records, child.id),
    }))
}

/**
 * The idea area of a card: the cards under its `idea` root, one level, same shape
 * as the submodule map.
 * @param graph - the read model.
 * @param proposals - the proposal records, for the reminder counts.
 * @param nodeId - the card whose idea area is wanted.
 * @returns one item per idea card, empty when the card has no idea root yet.
 */
export function ideaArea(
  graph: NodeGraph,
  proposals: Iterable<PendingProposal>,
  nodeId: NodeId,
): SubmoduleMapItem[] {
  const root = children(graph, nodeId).find(child => child.region === 'idea')
  return root === undefined ? [] : submoduleMap(graph, proposals, root.id)
}

/**
 * The relation edges leaving a card: every open field whose value names another
 * node that exists.
 *
 * A value naming a node that does not exist is not an edge and not an error here —
 * the dangling-reference gate owns that judgement, and drawing a half edge would
 * report the same defect twice in two vocabularies.
 * @param graph - the read model.
 * @param nodeId - the card to draw from.
 * @returns the edges, in field order.
 */
export function relationEdges(graph: NodeGraph, nodeId: NodeId): RelationEdge[] {
  const node = requireNode(graph, nodeId)
  return Object.entries(node.fields).flatMap(([via, field]) => {
    const target = NodeId(field.value)
    return graph.nodes.has(target) ? [{ from: node.id, to: target, via }] : []
  })
}

/**
 * Which derived views a card affords right now, in tag-strip order.
 *
 * A view that would draw nothing is absent rather than disabled. A disabled tag
 * reads as "this card could show a chart, you just have not unlocked it", which is
 * the wrong signal: the honest statement is that nothing on this card supports one.
 * @param graph - the read model.
 * @param nodeId - the card to inspect.
 * @returns the available derived-view kinds.
 */
export function derivedViews(graph: NodeGraph, nodeId: NodeId): DerivedViewKind[] {
  const node = requireNode(graph, nodeId)
  const kinds: DerivedViewKind[] = []
  if (children(graph, nodeId).some(child => child.region !== 'idea')) kinds.push('submodule-map')
  if (relationEdges(graph, nodeId).length > 0) kinds.push('relation')
  if ((node.bodies ?? []).some(body => chartOf(body) !== null)) kinds.push('chart')
  if (node.parent === null) kinds.push('constraints')
  kinds.push('ideas')
  return kinds
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
 *
 * Filtered by vantage, which is the one place idea areas must not leak: an idea
 * listed in the index would tell the model a card exists that the person has not
 * confirmed, and the index reaches every dependency set.
 * @param graph - the read model.
 * @param from - the node being worked from, or `null` at cold start.
 * @returns the rendered index.
 */
export function renderSkeletonIndex(graph: NodeGraph, from: NodeId | null): string {
  return visibleNodes(graph, from)
    .map(node => `${node.id} ${node.title} ${MATURITY_LABELS[node.maturity]}`)
    .join('\n')
}
