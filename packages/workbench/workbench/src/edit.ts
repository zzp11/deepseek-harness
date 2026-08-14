/**
 * The human write path, as a pure plan. A request in, the events to append out —
 * no session, no cordis, no clock of its own. Everything that decides whether a
 * write is allowed and what it becomes lives here, so it is provable without a
 * running harness, and `./index.ts` is only the glue that appends what this
 * returns.
 *
 * Two properties this shape exists to hold:
 *
 * - **A person's edit costs nothing.** Planning touches no model and waits on
 *   nothing; the request either lands or is refused, synchronously.
 * - **A commit is one `rev`.** Accepting a five-node skeleton emits five
 *   `workbench/node-change` events sharing one `rev`, so a reader never sees
 *   half of it.
 * @module @deepseek-ai/dsh-workbench/edit
 */

import type { BodyId, NodeId, ProposalId, SourceId } from './brand.ts'
import { children, invalidate, nextRev } from './core.ts'
import type { ProposedBody, ProposedField, WorkbenchNodeChange } from './events.ts'
import { blockingFindings, gateReason, runNodeGates, type GateFinding } from './gates.ts'
import {
  GLOBAL_CONSTRAINT_ROOT_ID,
  type AuthoredBody, type Maturity, type NodeField, type NodeTmp, type WorkbenchNode,
} from './model.ts'
import type { WorkbenchEvent, WorkbenchState } from './store.ts'

/**
 * One thing a person asked for. `add-utterance` is deliberately absent: the
 * first-hand layer has exactly one producer, the mirror in `./index.ts`, which is
 * what lets "every message has exactly one utterance" be an invariant rather than
 * a hope.
 */
export type EditRequest =
  | { readonly op: 'create-child'; readonly parentId: NodeId | null; readonly title: string; readonly body?: string }
  | {
    readonly op: 'update-field'
    readonly nodeId: NodeId
    /** `body` or `duty` for a skeleton slot; anything else is an open field. */
    readonly field: string
    readonly value: string
    readonly sourceId?: SourceId
  }
  | { readonly op: 'rename'; readonly nodeId: NodeId; readonly title: string }
  | { readonly op: 'move'; readonly nodeId: NodeId; readonly parentId: NodeId | null }
  | { readonly op: 'delete'; readonly nodeId: NodeId }
  | { readonly op: 'promote'; readonly nodeId: NodeId; readonly maturity: 'committed' | 'rejected'; readonly note?: string }
  | { readonly op: 'promote-to-constraint'; readonly nodeId: NodeId }
  | {
    readonly op: 'accept-proposal'
    readonly proposalId: ProposalId
    /** Field values the person settled on, overriding the draft's. */
    readonly edits?: readonly ProposedField[]
    /**
     * The nodes the person kept, by their index in the draft, each with the title
     * they settled on. Omitted accepts the draft's nodes as proposed; present, it
     * IS the accepted set — an index left out is pruned, and pruning happens
     * before the commit, so a dropped node never entered the tree.
     */
    readonly keptNodes?: readonly { readonly index: number; readonly title?: string }[]
  }
  | { readonly op: 'reject-proposal'; readonly proposalId: ProposalId; readonly reason: string }
  /**
   * Write a card's edit state. Costs no `rev` and touches no node — this is what
   * the person has typed, not what they have committed.
   */
  | { readonly op: 'set-tmp'; readonly nodeId: NodeId; readonly tmp: NodeTmp }
  /** 确定: fold the edit state into the card as one commit, then clear it. */
  | { readonly op: 'commit-tmp'; readonly nodeId: NodeId }
  /** 丢弃: drop the edit state, leaving the committed card untouched. */
  | { readonly op: 'discard-tmp'; readonly nodeId: NodeId }
  /** Remove one authored body. Immediate and free; the brief cannot go. */
  | { readonly op: 'delete-body'; readonly nodeId: NodeId; readonly bodyId: BodyId }
  /** Open a card's idea area, creating its `idea` root the first time. */
  | { readonly op: 'open-ideas'; readonly nodeId: NodeId }

/**
 * Every operation the edit channel accepts. The command handler checks an incoming
 * line against this before planning, which is what makes {@link planEdit}'s final
 * branch unreachable from the wire rather than merely unlikely.
 */
export const EDIT_OPS: readonly EditRequest['op'][] = [
  'create-child', 'update-field', 'rename', 'move', 'delete', 'promote', 'promote-to-constraint',
  'accept-proposal', 'reject-proposal', 'set-tmp', 'commit-tmp', 'discard-tmp', 'delete-body', 'open-ideas',
]

/** The skeleton slots `update-field` may write; the others have their own op. */
export const EDITABLE_SKELETON_FIELDS: readonly string[] = ['body', 'duty']

/** Why a request produced nothing. */
export type EditFailure =
  /** The gates refused it; every blocking finding is here. */
  | { readonly kind: 'gate'; readonly findings: readonly GateFinding[] }
  /** The request itself does not make sense against the current tree. */
  | { readonly kind: 'request'; readonly message: string }

/** What a request becomes: the events to append, or why it was refused. */
export type EditPlan =
  | {
    readonly ok: true
    /** The `rev` every event of this commit carries. */
    readonly rev: number
    readonly events: readonly WorkbenchEvent[]
    /** Nodes this commit puts in doubt, one hop. */
    readonly invalidation: readonly NodeId[]
    /** Findings that did not stop the write; the editor shows them. */
    readonly advisories: readonly GateFinding[]
  }
  | { readonly ok: false; readonly failure: EditFailure }

/**
 * The nondeterminism a plan needs, injected so planning stays pure and a test
 * can pin every id and timestamp.
 */
export interface EditClock {
  /** A fresh node id, unique within the session log. */
  nodeId: () => NodeId
  /** A fresh content-body id, unique within the session log. */
  bodyId: () => BodyId
  /** Wall clock, for a created node's `createdAt`. */
  now: () => number
}

/**
 * Plan one request against the current projection.
 * @param state - the projection to write into; never mutated.
 * @param request - what the person asked for.
 * @param clock - id and time source.
 * @returns the commit to append, or the refusal.
 */
export function planEdit(state: WorkbenchState, request: EditRequest, clock: EditClock): EditPlan {
  switch (request.op) {
    case 'create-child':
      return planCreateChild(state, request, clock)
    case 'update-field':
      return planNodeWrite(state, request.nodeId, 'update', node => writeField(node, request.field, {
        value: request.value,
        ...request.sourceId === undefined ? {} : { sourceId: request.sourceId },
      }))
    case 'rename':
      return planNodeWrite(state, request.nodeId, 'update', node => ({ ...node, title: request.title }))
    case 'move':
      return planNodeWrite(state, request.nodeId, 'move', node => ({ ...node, parent: request.parentId }))
    case 'delete':
      return planDelete(state, request.nodeId)
    case 'promote':
      return planPromote(state, request.nodeId, request.maturity, request.note)
    case 'promote-to-constraint':
      return planPromoteToConstraint(state, request.nodeId, clock)
    case 'accept-proposal':
      return planAcceptProposal(state, request, clock)
    case 'reject-proposal':
      return planRejectProposal(state, request.proposalId, request.reason)
    case 'set-tmp':
      return planScratch(state, request.nodeId, request.tmp)
    case 'discard-tmp':
      return planScratch(state, request.nodeId, null)
    case 'commit-tmp':
      return planCommitTmp(state, request.nodeId)
    case 'delete-body':
      return planDeleteBody(state, request.nodeId, request.bodyId)
    case 'open-ideas':
      return planOpenIdeas(state, request.nodeId, clock)
    default:
      // Reachable only from a request that crossed a wire without validation,
      // which the command handler rejects before planning.
      throw new Error(`workbench: unknown edit op ${(request as EditRequest).op}`)
  }
}

/** Refuse with a request-level reason. */
function refuseRequest(message: string): EditPlan {
  return { ok: false, failure: { kind: 'request', message } }
}

/**
 * Gate one whole-node commit and turn it into its events. The single place a node
 * write is judged, so no op can reach the log around the gates.
 */
function commitNodes(
  state: WorkbenchState,
  candidates: readonly WorkbenchNode[],
  op: WorkbenchNodeChange['op'],
  extraFindings: readonly GateFinding[] = [],
): EditPlan {
  const rev = nextRev(state.meta)
  const promoting = op === 'promote' || op === 'reject'
  // Gating against a graph that already carries this commit's siblings is what
  // lets a skeleton reference a node the same commit creates.
  const pending = new Map(state.nodes)
  for (const candidate of candidates) pending.set(candidate.id, candidate)
  const graph = { ...state, nodes: pending }
  const findings = [
    ...extraFindings,
    ...candidates.flatMap(candidate => runNodeGates(graph, candidate, { promoting })),
  ]
  const blocking = blockingFindings(findings)
  if (blocking.length > 0) return { ok: false, failure: { kind: 'gate', findings: blocking } }
  const invalidation = candidates.flatMap(candidate =>
    state.nodes.has(candidate.id) ? invalidate(state, candidate.id) : [])
  return {
    ok: true,
    rev,
    events: candidates.map(candidate => nodeChange(rev, op, { ...candidate, lastRev: rev }, invalidation)),
    invalidation,
    advisories: findings.filter(finding => !finding.blocking),
  }
}

/** Build one `workbench/node-change` event of a human commit. */
function nodeChange(
  rev: number,
  op: WorkbenchNodeChange['op'],
  node: WorkbenchNode,
  invalidation: readonly NodeId[],
): WorkbenchEvent {
  return {
    type: 'workbench/node-change',
    data: {
      rev,
      actor: 'human',
      op,
      node,
      ...invalidation.length === 0 ? {} : { invalidation },
    },
  }
}

/** Plan a change to one existing node through `transform`. */
function planNodeWrite(
  state: WorkbenchState,
  nodeId: NodeId,
  op: WorkbenchNodeChange['op'],
  transform: (node: WorkbenchNode) => WorkbenchNode,
): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  return commitNodes(state, [humanTouched(transform(node))], op)
}

/**
 * Write one slot of a node: a skeleton slot when the name is one of
 * {@link EDITABLE_SKELETON_FIELDS}, otherwise an open field.
 */
function writeField(node: WorkbenchNode, field: string, value: NodeField): WorkbenchNode {
  if (field === 'body') return { ...node, body: value.value }
  if (field === 'duty') return { ...node, duty: value.value }
  return { ...node, fields: { ...node.fields, [field]: value } }
}

/**
 * Mark a node the person just wrote as theirs. Only `'ai'` flips: a node
 * distilled from the first-hand layer keeps its citation, because losing it would
 * drop a dependency item, and the edit itself is already recorded by the event's
 * `actor` and `rev`.
 */
function humanTouched(node: WorkbenchNode): WorkbenchNode {
  return node.source === 'ai' ? { ...node, source: 'human' } : node
}

/** Plan a fresh child. */
function planCreateChild(
  state: WorkbenchState,
  request: Extract<EditRequest, { op: 'create-child' }>,
  clock: EditClock,
): EditPlan {
  return commitNodes(state, [{
    id: clock.nodeId(),
    title: request.title,
    parent: request.parentId,
    maturity: 'thought',
    source: 'human',
    fields: {},
    lastRev: nextRev(state.meta),
    createdAt: clock.now(),
    ...request.body === undefined ? {} : { body: request.body },
  }], 'create')
}

/** Plan a removal, refusing to orphan children. */
function planDelete(state: WorkbenchState, nodeId: NodeId): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  const orphans = [...state.nodes.values()].filter(candidate => candidate.parent === nodeId)
  if (orphans.length > 0) {
    return refuseRequest(`${nodeId} 还有 ${String(orphans.length)} 个子节点；先把它们移走或删掉`)
  }
  const rev = nextRev(state.meta)
  const invalidation = invalidate(state, nodeId)
  return {
    ok: true,
    rev,
    events: [nodeChange(rev, 'delete', { ...node, lastRev: rev }, invalidation)],
    invalidation,
    advisories: [],
  }
}

/** Plan a promotion or a rejection. */
function planPromote(
  state: WorkbenchState,
  nodeId: NodeId,
  maturity: Extract<Maturity, 'committed' | 'rejected'>,
  note: string | undefined,
): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  if (node.maturity === maturity) return refuseRequest(`${nodeId} 已经是这个成熟度了`)
  const reason = maturity === 'rejected' ? gateReason(note) : []
  return commitNodes(
    state,
    [{ ...node, maturity }],
    maturity === 'committed' ? 'promote' : 'reject',
    reason,
  )
}

/**
 * Plan moving a node into the global-constraint area, creating that area's root
 * on demand in the same commit. It is a move rather than a copy: a global
 * constraint is not owned by one module, and `parent` names exactly one home.
 */
function planPromoteToConstraint(state: WorkbenchState, nodeId: NodeId, clock: EditClock): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  if (node.id === GLOBAL_CONSTRAINT_ROOT_ID) return refuseRequest('全局约束区的根不能提升为约束')
  if (node.parent === GLOBAL_CONSTRAINT_ROOT_ID) return refuseRequest(`${nodeId} 已经在全局约束区里`)
  const root = state.nodes.get(GLOBAL_CONSTRAINT_ROOT_ID)
  const candidates: WorkbenchNode[] = [
    ...root === undefined ? [constraintRoot(clock.now())] : [],
    { ...node, parent: GLOBAL_CONSTRAINT_ROOT_ID },
  ]
  return commitNodes(state, candidates, 'move')
}

/** The global-constraint area's root, as created on first promotion. */
function constraintRoot(createdAt: number): WorkbenchNode {
  return {
    id: GLOBAL_CONSTRAINT_ROOT_ID,
    title: '全局约束',
    parent: null,
    duty: '这里的每一条都约束它以外的所有节点',
    maturity: 'committed',
    source: 'human',
    fields: {},
    lastRev: 0,
    createdAt,
  }
}


/**
 * Plan a write to a card's edit state. It emits one `workbench/scratch` and
 * nothing else: no node changes, no `rev` step, no gates. Gating happens at 确定,
 * because refusing keystrokes would make the edit state unusable while a draft is
 * legitimately half-finished.
 *
 * The returned plan reports the CURRENT `rev` rather than a next one, which is the
 * honest answer — nothing committed.
 */
function planScratch(state: WorkbenchState, nodeId: NodeId, tmp: NodeTmp | null): EditPlan {
  if (!state.nodes.has(nodeId)) return refuseRequest(`节点 ${nodeId} 不存在`)
  return {
    ok: true,
    rev: state.meta.rev,
    events: [{ type: 'workbench/scratch', data: { nodeId, tmp } }],
    invalidation: [],
    advisories: [],
  }
}

/**
 * 确定: fold a card's edit state into the card as ONE commit.
 *
 * The commit carries the whole resulting node, never a reference to the edit state
 * — which is what lets `workbench/scratch` stay `ignorable`. The projection clears
 * the edit state when it folds the commit, so no companion clearing event is
 * needed and a crash between the two cannot leave a card editing over content that
 * already landed.
 */
function planCommitTmp(state: WorkbenchState, nodeId: NodeId): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  const tmp = state.tmp.get(nodeId)
  if (tmp === undefined) return refuseRequest(`节点 ${nodeId} 没有待提交的改动`)
  return commitNodes(state, [humanTouched({
    ...node,
    ...tmp.title === undefined ? {} : { title: tmp.title },
    ...tmp.duty === undefined ? {} : { duty: tmp.duty },
    ...tmp.body === undefined ? {} : { body: tmp.body },
    ...tmp.bodies === undefined ? {} : { bodies: tmp.bodies.map(body => ({ ...body, lastRev: nextRev(state.meta) })) },
  })], 'update')
}

/**
 * Remove one authored body. The gates decide whether it may go, which is how the
 * brief is protected without this function knowing why it matters.
 */
function planDeleteBody(state: WorkbenchState, nodeId: NodeId, bodyId: BodyId): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  const bodies = node.bodies ?? []
  if (!bodies.some(body => body.id === bodyId)) return refuseRequest(`内容体 ${bodyId} 不在这张卡上`)
  return commitNodes(state, [humanTouched({ ...node, bodies: bodies.filter(body => body.id !== bodyId) })], 'update')
}

/**
 * Open a card's idea area. Every card has one conceptually; its root node is
 * created the first time someone looks, so a tree of untouched cards does not pay
 * for an empty area each.
 *
 * The root is `committed` and carries a duty, because it is structure rather than
 * content — leaving it in the thought region would put a gate finding on scaffolding
 * nobody wrote.
 */
function planOpenIdeas(state: WorkbenchState, nodeId: NodeId, clock: EditClock): EditPlan {
  const node = state.nodes.get(nodeId)
  if (node === undefined) return refuseRequest(`节点 ${nodeId} 不存在`)
  const existing = children(state, nodeId).find(child => child.region === 'idea')
  if (existing !== undefined) return refuseRequest(`节点 ${nodeId} 的想法区已经开过了`)
  return commitNodes(state, [{
    id: clock.nodeId(),
    title: `${node.title}·想法`,
    parent: nodeId,
    duty: '这里放未确认、未落地的想法；对这张卡以外的一切不可见',
    maturity: 'committed',
    source: 'human',
    region: 'idea',
    fields: {},
    lastRev: nextRev(state.meta),
    createdAt: clock.now(),
  }], 'create')
}

/**
 * Fold proposed bodies onto a card's existing ones: a proposal that names
 * `replaces` supersedes that body in place, keeping tag order stable, and one that
 * does not is appended.
 *
 * In-place replacement is what makes "draw me a flow chart, and bring the brief
 * along" one commit instead of an add plus a delete the person has to notice.
 */
function mergeBodies(
  existing: readonly AuthoredBody[],
  offered: readonly ProposedBody[],
  rev: number,
  mintId: () => BodyId,
): readonly AuthoredBody[] {
  const merged = [...existing]
  for (const body of offered) {
    const landed: AuthoredBody = { id: mintId(), label: body.label, source: 'ai', lastRev: rev, ...body.payload }
    const replaced = body.replaces
    const at = replaced === undefined ? -1 : merged.findIndex(item => item.id === replaced)
    // `at >= 0` means a body with exactly that id is there, so the id to keep is
    // `replaced` itself — no second read of the slot, and nothing to fall back to.
    if (at < 0) merged.push(landed)
    else merged.splice(at, 1, { ...landed, id: replaced as BodyId })
  }
  return merged
}

/**
 * Plan accepting a proposal: apply the person's edits to the draft, then run the
 * gates over the result. Re-running them on the edited content is the point —
 * the person holds the knife, and a hand-corrected draft still has to be a legal
 * tree before it lands.
 */
function planAcceptProposal(
  state: WorkbenchState,
  request: Extract<EditRequest, { op: 'accept-proposal' }>,
  clock: EditClock,
): EditPlan {
  const { proposalId } = request
  const edits = request.edits ?? []
  const record = state.proposals.get(proposalId)
  if (record === undefined) return refuseRequest(`草稿 ${proposalId} 不存在`)
  if (record.verdict !== undefined) return refuseRequest(`草稿 ${proposalId} 已经裁决过了`)
  const proposal = record.proposal
  const merged = mergeFields([...proposal.fields ?? [], ...edits])

  const candidates: WorkbenchNode[] = []
  if (proposal.targetNode !== null) {
    const target = state.nodes.get(proposal.targetNode)
    if (target === undefined) return refuseRequest(`草稿指向的节点 ${proposal.targetNode} 不存在`)
    const offeredBodies = proposal.bodies ?? []
    candidates.push({
      ...target,
      fields: { ...target.fields, ...merged },
      ...proposal.body === undefined ? {} : { body: proposal.body },
      ...offeredBodies.length === 0
        ? {}
        : { bodies: mergeBodies(target.bodies ?? [], offeredBodies, nextRev(state.meta), clock.bodyId) },
    })
  } else if (Object.keys(merged).length > 0) {
    return refuseRequest('草稿没有目标节点，字段无处可落')
  }
  const offered = proposal.newNodes ?? []
  const kept: readonly { readonly index: number; readonly title?: string }[] =
    request.keptNodes ?? offered.map((_proposed, index) => ({ index }))
  for (const choice of kept) {
    const proposed = offered[choice.index]
    if (proposed === undefined) return refuseRequest(`草稿里没有第 ${String(choice.index)} 个节点`)
    candidates.push({
      id: clock.nodeId(),
      title: choice.title ?? proposed.title,
      parent: proposed.parent ?? proposal.targetNode,
      maturity: 'thought',
      source: 'ai',
      fields: mergeFields(proposed.fields ?? []),
      lastRev: nextRev(state.meta),
      createdAt: clock.now(),
      ...proposed.duty === undefined ? {} : { duty: proposed.duty },
      ...proposed.body === undefined ? {} : { body: proposed.body },
      ...proposed.bodies === undefined
        ? {}
        : { bodies: mergeBodies([], proposed.bodies, nextRev(state.meta), clock.bodyId) },
    })
  }
  if (candidates.length === 0) return refuseRequest('这份草稿没有可落盘的内容')

  const plan = commitNodes(state, candidates, candidates.length === 1 && proposal.targetNode !== null ? 'update' : 'create')
  if (!plan.ok) return plan
  const untouched = edits.length === 0 && request.keptNodes === undefined
  return {
    ...plan,
    events: [...plan.events, {
      type: 'workbench/verdict',
      data: {
        proposalId,
        outcome: untouched ? 'accepted' : 'edited',
        rev: plan.rev,
      },
    }],
  }
}

/** Plan rejecting a proposal; the reason is what makes the rejection worth keeping. */
function planRejectProposal(state: WorkbenchState, proposalId: ProposalId, reason: string): EditPlan {
  const record = state.proposals.get(proposalId)
  if (record === undefined) return refuseRequest(`草稿 ${proposalId} 不存在`)
  if (record.verdict !== undefined) return refuseRequest(`草稿 ${proposalId} 已经裁决过了`)
  const findings = blockingFindings(gateReason(reason))
  if (findings.length > 0) return { ok: false, failure: { kind: 'gate', findings } }
  return {
    ok: true,
    rev: state.meta.rev,
    events: [{
      type: 'workbench/verdict',
      data: { proposalId, outcome: 'rejected', rev: state.meta.rev, note: reason },
    }],
    invalidation: [],
    advisories: [],
  }
}

/** Fold proposed fields into a node's field map; a later entry wins, which is how an edit overrides the draft. */
function mergeFields(fields: readonly ProposedField[]): Record<string, NodeField> {
  const merged: Record<string, NodeField> = {}
  for (const field of fields) {
    merged[field.name] = {
      value: field.value,
      ...field.sourceId === undefined ? {} : { sourceId: field.sourceId },
    }
  }
  return merged
}
