/**
 * The gates: the checks a write must pass. Pure predicates over the read model,
 * so a gate can be shown to refuse what it claims to refuse without a running
 * harness.
 *
 * Where a gate applies is part of it. The working region (念头 / 想法) stays
 * quiet — friction there would tax thinking — while the committed region is
 * guarded, so the whole cost of being rigorous is charged at one moment:
 * promotion. Structural gates (a reference that resolves, a tree that stays a
 * tree) apply everywhere, because a broken tree is not a rough draft.
 * @module @deepseek-ai/dsh-workbench/gates
 */

import type { NodeId } from './brand.ts'
import { children, isRegisteredField } from './core.ts'
import type { NodeGraph, WorkbenchNode } from './model.ts'

/** Which gate produced a finding. */
export type GateCode =
  | 'GATE_UNREGISTERED_FIELD'
  | 'GATE_NO_EVIDENCE'
  | 'GATE_DANGLING_REF'
  | 'GATE_CYCLE'
  | 'GATE_NO_REASON'
  | 'GATE_MISSING_DUTY'

/** One gate's verdict on one write. */
export interface GateFinding {
  readonly code: GateCode
  /** `false` reports the finding and lets the write through. */
  readonly blocking: boolean
  /** What is wrong, in the words the person or the model reads. */
  readonly message: string
}

/** What the write is, where a gate's answer depends on it. */
export interface GateContext {
  /**
   * Whether this write is the promotion itself. Missing duty is advisory on an
   * ordinary write and blocking here: promotion is the moment the tree is asked
   * to be answerable, and a module nobody is answerable for is exactly what it
   * must not wave through.
   */
  readonly promoting: boolean
}

/**
 * Every reference the node makes must resolve — its parent, the entry its own
 * content was distilled from, and every entry its fields cite. Applies
 * everywhere: a dangling reference is not a rough draft, it is a tree that
 * cannot be read.
 * @param graph - the read model the node is being written into.
 * @param node - the node as it will stand after the write.
 * @returns the findings, empty when every reference resolves.
 */
export function gateDanglingRefs(graph: NodeGraph, node: WorkbenchNode): GateFinding[] {
  const findings: GateFinding[] = []
  if (node.parent !== null && !graph.nodes.has(node.parent)) {
    findings.push(dangling(`父节点 ${node.parent} 不存在`))
  }
  if (typeof node.source !== 'string' && !graph.firstLayer.has(node.source.sourceId)) {
    findings.push(dangling(`来源依据 ${node.source.sourceId} 不在一手层`))
  }
  for (const [name, field] of Object.entries(node.fields)) {
    if (field.sourceId !== undefined && !graph.firstLayer.has(field.sourceId)) {
      findings.push(dangling(`字段「${name}」的依据 ${field.sourceId} 不在一手层`))
    }
  }
  return findings
}

/**
 * The tree must stay a tree. Walks up from the node's new parent; reaching the
 * node itself, or revisiting anything, is a cycle. Applies everywhere.
 * @param graph - the read model the node is being written into.
 * @param node - the node as it will stand after the write.
 * @returns the finding, or an empty list when the chain terminates.
 */
export function gateNoCycle(graph: NodeGraph, node: WorkbenchNode): GateFinding[] {
  const seen = new Set<NodeId>([node.id])
  let parent = node.parent
  while (parent !== null) {
    if (seen.has(parent)) {
      return [{ code: 'GATE_CYCLE', blocking: true, message: `这一步会让 ${node.id} 的父链成环（经过 ${parent}）` }]
    }
    seen.add(parent)
    // A parent outside the graph is gateDanglingRefs' finding, not this gate's.
    const next = graph.nodes.get(parent)
    if (next === undefined) return []
    parent = next.parent
  }
  return []
}

/**
 * In the committed region every open field must be a registered one. The
 * dictionary starts empty, so the first write of a new field name is refused
 * until someone says what it means — which is the point: an unnamed vocabulary
 * is how a tree stops being comparable to itself.
 * @param graph - the read model carrying the dictionary.
 * @param node - the node as it will stand after the write.
 * @returns the findings, empty outside the committed region.
 */
export function gateRegisteredFields(graph: NodeGraph, node: WorkbenchNode): GateFinding[] {
  if (node.maturity !== 'committed') return []
  return Object.keys(node.fields)
    .filter(name => !isRegisteredField(graph.meta, name))
    .map(name => ({
      code: 'GATE_UNREGISTERED_FIELD' as const,
      blocking: true,
      message: `字段「${name}」未登记；先把它写进字段词典，或者别在已承诺区用它`,
    }))
}

/**
 * In the committed region every open field must say where it came from. A
 * distilled value with no citation cannot be checked against the words it came
 * from, which is the one check this design will not give up.
 * @param node - the node as it will stand after the write.
 * @returns the findings, empty outside the committed region.
 */
export function gateEvidence(node: WorkbenchNode): GateFinding[] {
  if (node.maturity !== 'committed') return []
  return Object.entries(node.fields)
    .filter(([, field]) => field.sourceId === undefined)
    .map(([name]) => ({
      code: 'GATE_NO_EVIDENCE' as const,
      blocking: true,
      message: `字段「${name}」没有依据；指向一手层里它是从哪句话来的`,
    }))
}

/**
 * A node with children is a module, and a module states what it is answerable
 * for. Advisory on an ordinary write, blocking at promotion (see
 * {@link GateContext.promoting}).
 * @param graph - the read model the node is being written into.
 * @param node - the node as it will stand after the write.
 * @param context - what the write is.
 * @returns the finding, or an empty list.
 */
export function gateDuty(graph: NodeGraph, node: WorkbenchNode, context: GateContext): GateFinding[] {
  if (node.maturity !== 'committed') return []
  if ((node.duty ?? '') !== '' || children(graph, node.id).length === 0) return []
  return [{
    code: 'GATE_MISSING_DUTY',
    blocking: context.promoting,
    message: `${node.id} 有子节点但没写职责；一句话说清它管什么`,
  }]
}

/**
 * Refusing something keeps its reason. A rejection with no reason is
 * indistinguishable from forgetting, and the whole point of keeping rejected
 * branches is that the reason is what stops the question from coming back.
 * @param note - the reason given, if any.
 * @returns the finding, or an empty list when a reason was given.
 */
export function gateReason(note: string | undefined): GateFinding[] {
  if ((note ?? '').trim() !== '') return []
  return [{ code: 'GATE_NO_REASON', blocking: true, message: '否决要写理由；不然过一阵没人知道为什么不做' }]
}

/**
 * Run every gate that judges a node write.
 * @param graph - the read model the node is being written into.
 * @param node - the node as it will stand after the write.
 * @param context - what the write is.
 * @returns every finding, blocking and advisory together.
 */
export function runNodeGates(graph: NodeGraph, node: WorkbenchNode, context: GateContext): GateFinding[] {
  return [
    ...gateDanglingRefs(graph, node),
    ...gateNoCycle(graph, node),
    ...gateRegisteredFields(graph, node),
    ...gateEvidence(node),
    ...gateDuty(graph, node, context),
  ]
}

/**
 * The findings that stop a write.
 * @param findings - every finding from the gates.
 * @returns the blocking subset.
 */
export function blockingFindings(findings: readonly GateFinding[]): GateFinding[] {
  return findings.filter(finding => finding.blocking)
}

/**
 * Render findings as the one line a refusal carries.
 * @param findings - the findings to render.
 * @returns the joined message.
 */
export function renderFindings(findings: readonly GateFinding[]): string {
  return findings.map(finding => `${finding.code}: ${finding.message}`).join('\n')
}

/** Build a dangling-reference finding. */
function dangling(message: string): GateFinding {
  return { code: 'GATE_DANGLING_REF', blocking: true, message }
}
