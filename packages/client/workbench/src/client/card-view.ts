/**
 * Building the focused card's view from the projection, using the host's own
 * derivations.
 *
 * Nothing here computes a fact: `derivedViews`, `staleBodies`, and the gates all come
 * from `dsh-workbench/projection`. A tag strip that decided for itself which views
 * exist would be a second answer to a question the host already answers.
 */

import {
  ancestors, blockingFindings, derivedViews, pendingProposals, runNodeGates, staleBodies,
  type DerivedViewKind, type NodeId, type WorkbenchState,
} from '@deepseek-ai/dsh-workbench/projection'
import type { CardView, TagEntry } from './contract.ts'
import { DERIVED_PREFIX } from './marks.ts'

/** What the tag strip shows for each derived view. */
const DERIVED_LABELS: Readonly<Record<DerivedViewKind, string>> = {
  'submodule-map': '子模块',
  relation: '关系图',
  constraints: '全局约束',
  ideas: '想法',
  chart: '图表',
}

/** What an authored body of each kind is called when it carries no label of its own. */
const AUTHORED_FALLBACK: Readonly<Record<string, string>> = {
  brief: '简介',
  table: '表格',
  flow: '流程图',
  argument: '论证图',
}

/**
 * Fold everything the focused card renders from.
 * @param projection - the folded projection.
 * @param nodeId - the focused card.
 * @returns the card view, or `undefined` when the projection has no such node.
 */
export function buildCardView(projection: WorkbenchState, nodeId: NodeId): CardView | undefined {
  const node = projection.nodes.get(nodeId)
  if (node === undefined) return undefined
  const records = [...projection.proposals.values()]
  const tmp = projection.tmp.get(nodeId)
  // The tag strip reflects what 确定 would land, so an edit state's bodies are what
  // it shows — otherwise a person adding a body would not see its tag until commit.
  const bodies = tmp?.bodies ?? node.bodies ?? []
  const stale = new Set(staleBodies({ ...node, bodies }))
  const authored: TagEntry[] = bodies.map(body => ({
    kind: 'authored',
    key: body.id,
    label: body.label === '' ? AUTHORED_FALLBACK[body.kind] ?? body.kind : body.label,
    stale: stale.has(body.id),
    // The brief renders the NODE's duty and body. Those are the fields the gates,
    // the dependency sets, and the prompt read; the brief's own copy is written at
    // the commit point for a log reader's benefit and is never read back here, so a
    // desync cannot reach the screen.
    body: body.kind === 'brief'
      ? { ...body, duty: node.duty ?? '', body: node.body ?? '' }
      : body,
  }))
  const derived: TagEntry[] = derivedViews(projection, records, nodeId).map(view => ({
    kind: 'derived',
    key: `derived:${view.kind}`,
    label: `${DERIVED_PREFIX}${DERIVED_LABELS[view.kind]}`,
    view,
  }))
  return {
    node,
    trail: ancestors(projection, nodeId),
    tags: [...authored, ...derived],
    tmp,
    blocking: blockingFindings(runNodeGates(projection, { ...node, maturity: 'committed' }, { promoting: true })),
    reminders: pendingProposals(projection, records, nodeId),
  }
}
