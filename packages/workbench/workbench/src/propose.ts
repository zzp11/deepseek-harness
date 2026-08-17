/**
 * The model write path, as a pure plan — and it is the only one the model has.
 * A proposal does not reach the tree: it is recorded as a draft and waits for a
 * person to rule on it, who may rewrite it first.
 *
 * The gates run here too, before the draft is even recorded. A draft that could
 * never land is not worth a person's attention, and telling the model now is
 * cheaper than telling it after someone reads it.
 * @module @deepseek-ai/dsh-workbench/propose
 */

import type { NodeId, ProposalId } from './brand.ts'
import type { ProposedBody, ProposedField, ProposedNode, WorkbenchProposal } from './events.ts'
import { blockingFindings, runNodeGates, type GateFinding } from './gates.ts'
import type { NodeField, NodeGraph, WorkbenchNode } from './model.ts'
import type { WorkbenchEvent, WorkbenchState } from './store.ts'

/** What the model offers. The shape a tool call arrives in, before an id or a timestamp. */
export interface ProposalDraft {
  /** The node this is about; `null` proposes a fresh skeleton. */
  readonly targetNode: NodeId | null
  readonly title: string
  readonly summary?: string
  readonly body?: string
  readonly fields?: readonly ProposedField[]
  /**
   * Content bodies for the target card — added, or replacing one it already has. Absent
   * from this type, the tool's reader still produced them (a spread carries an undeclared
   * property) while `planProposal` had nothing to copy, so a model's flow chart or table
   * was dropped and the call still answered `已记下`.
   */
  readonly bodies?: readonly ProposedBody[]
  readonly newNodes?: readonly ProposedNode[]
}

/** The nondeterminism a proposal plan needs, injected so planning stays pure. */
export interface ProposalClock {
  proposalId: () => ProposalId
  now: () => number
}

/** What a draft becomes: the event to append, or the gates' refusal. */
export type ProposePlan =
  | { readonly ok: true; readonly proposalId: ProposalId; readonly events: readonly WorkbenchEvent[] }
  | { readonly ok: false; readonly findings: readonly GateFinding[] }

/**
 * Plan one proposal against the current projection.
 * @param state - the projection the draft is about; never mutated.
 * @param draft - what the model offered.
 * @param clock - id and time source.
 * @returns the draft to append, or the findings that refuse it.
 */
export function planProposal(state: WorkbenchState, draft: ProposalDraft, clock: ProposalClock): ProposePlan {
  const findings = blockingFindings(gateDraft(state, draft))
  if (findings.length > 0) return { ok: false, findings }
  const proposalId = clock.proposalId()
  const proposal: WorkbenchProposal = {
    proposalId,
    targetNode: draft.targetNode,
    title: draft.title,
    createdAt: clock.now(),
    ...draft.summary === undefined ? {} : { summary: draft.summary },
    ...draft.body === undefined ? {} : { body: draft.body },
    ...draft.fields === undefined ? {} : { fields: draft.fields },
    // The target's content bodies. Omitting these was how a model that drew a flow chart
    // on an existing card got `草稿 … 已记下` back with the chart gone: the tool read them,
    // the type carried them, and `planAcceptProposal` already consumed `proposal.bodies`,
    // so the accept side was waiting on a field this event never wrote.
    ...draft.bodies === undefined ? {} : { bodies: draft.bodies },
    ...draft.newNodes === undefined ? {} : { newNodes: draft.newNodes },
  }
  return { ok: true, proposalId, events: [{ type: 'workbench/proposal', data: proposal }] }
}

/**
 * Run the gates over what the draft would become. The nodes it offers to create
 * do not exist yet, so each is gated under a placeholder id: what is checkable
 * now is that its parent resolves and its citations resolve, which is exactly
 * what a draft can get wrong.
 * @param state - the projection the draft is about.
 * @param draft - what the model offered.
 * @returns every finding, blocking and advisory together.
 */
export function gateDraft(state: WorkbenchState, draft: ProposalDraft): GateFinding[] {
  const candidates: WorkbenchNode[] = []
  if (draft.targetNode !== null) {
    const target = state.nodes.get(draft.targetNode)
    if (target === undefined) {
      return [{
        code: 'GATE_DANGLING_REF',
        blocking: true,
        message: `节点 ${draft.targetNode} 不存在；先调 workbench_read_nodes 看骨架里有什么`,
      }]
    }
    candidates.push({
      ...target,
      fields: { ...target.fields, ...fieldMap(draft.fields ?? []) },
      ...draft.body === undefined ? {} : { body: draft.body },
    })
  }
  const offered = draft.newNodes ?? []
  // `parentIndex` must point at an EARLIER entry. Checking it here rather than on accept
  // is the earliest resolvable point — the model is the only writer, and a draft whose
  // shape cannot be built is worth refusing while the model can still fix it.
  for (const [index, proposed] of offered.entries()) {
    if (proposed.parentIndex === undefined) continue
    if (proposed.parentIndex >= index || offered[proposed.parentIndex] === undefined) {
      return [{
        code: 'GATE_DANGLING_REF',
        blocking: true,
        message:
          `第 ${String(index)} 个节点「${proposed.title}」的 parentIndex=${String(proposed.parentIndex)} 不可用；`
          + '它必须指向 newNodes 里更靠前的一项（按从上到下的顺序写这棵树就自然满足）',
      }]
    }
  }
  const placeholders = offered.map((proposed, index) => placeholderNode(proposed, draft.targetNode, index))
  candidates.push(...placeholders)
  // The draft's own nodes reference each other, so the gates run against a graph that
  // contains them: without this an index-parent reads as a dangling reference, and the
  // cycle gate could not see a loop that lies entirely inside one draft.
  const graph: NodeGraph = {
    ...state,
    nodes: new Map([...state.nodes, ...placeholders.map(node => [node.id, node] as const)]),
  }
  return candidates.flatMap(candidate => runNodeGates(graph, candidate, { promoting: false }))
}

/** A proposed node under an id that cannot collide with the tree, for gating only. */
function placeholderNode(proposed: ProposedNode, targetNode: NodeId | null, index: number): WorkbenchNode {
  return {
    id: `draft:${String(index)}` as NodeId,
    title: proposed.title,
    // An index-parent resolves to that placeholder's id, so the gates run against the
    // shape the draft actually describes rather than a flat list of roots.
    parent: proposed.parentIndex === undefined
      ? proposed.parent ?? targetNode
      : `draft:${String(proposed.parentIndex)}` as NodeId,
    maturity: 'thought',
    source: 'ai',
    fields: fieldMap(proposed.fields ?? []),
    lastRev: 0,
    createdAt: 0,
    ...proposed.duty === undefined ? {} : { duty: proposed.duty },
    ...proposed.body === undefined ? {} : { body: proposed.body },
  }
}

/** Fold proposed fields into a node's field map. */
function fieldMap(fields: readonly ProposedField[]): Record<string, NodeField> {
  const merged: Record<string, NodeField> = {}
  for (const field of fields) {
    merged[field.name] = {
      value: field.value,
      ...field.sourceId === undefined ? {} : { sourceId: field.sourceId },
    }
  }
  return merged
}
