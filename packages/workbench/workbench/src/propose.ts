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
import type { ProposedField, ProposedNode, WorkbenchProposal } from './events.ts'
import { blockingFindings, runNodeGates, type GateFinding } from './gates.ts'
import type { NodeField, WorkbenchNode } from './model.ts'
import type { WorkbenchEvent, WorkbenchState } from './store.ts'

/** What the model offers. The shape a tool call arrives in, before an id or a timestamp. */
export interface ProposalDraft {
  /** The node this is about; `null` proposes a fresh skeleton. */
  readonly targetNode: NodeId | null
  readonly title: string
  readonly summary?: string
  readonly body?: string
  readonly fields?: readonly ProposedField[]
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
  draft.newNodes?.forEach((proposed, index) => {
    candidates.push(placeholderNode(proposed, draft.targetNode, index))
  })
  return candidates.flatMap(candidate => runNodeGates(state, candidate, { promoting: false }))
}

/** A proposed node under an id that cannot collide with the tree, for gating only. */
function placeholderNode(proposed: ProposedNode, targetNode: NodeId | null, index: number): WorkbenchNode {
  return {
    id: `draft:${String(index)}` as NodeId,
    title: proposed.title,
    parent: proposed.parent ?? targetNode,
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
