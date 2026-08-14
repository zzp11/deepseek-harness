import { describe, expect, it } from 'vitest'
import { BodyId, NodeId, ProposalId, SourceId } from '../src/brand.ts'
import { planEdit, type EditClock, type EditPlan, type EditRequest } from '../src/edit.ts'
import { GLOBAL_CONSTRAINT_ROOT_ID, type WorkbenchNode } from '../src/model.ts'
import {
  applyWorkbenchEvent, emptyWorkbenchState, type WorkbenchEvent, type WorkbenchState,
} from '../src/store.ts'
import { node, utterance } from './fixtures.ts'

/** A deterministic clock, so a plan's ids and timestamps are assertable. */
function clockFrom(prefix = 'new'): EditClock {
  let minted = 0
  return {
    nodeId: () => NodeId(`${prefix}${String(minted++)}`),
    bodyId: () => BodyId(`${prefix}b${String(minted++)}`),
    now: () => 1000,
  }
}

/** A projection seeded with nodes, first-hand entries, and a field dictionary. */
function stateWith(
  nodes: readonly WorkbenchNode[] = [],
  events: readonly WorkbenchEvent[] = [],
): WorkbenchState {
  const state = emptyWorkbenchState()
  applyWorkbenchEvent(state, {
    type: 'workbench/snapshot',
    data: {
      nodes: [...nodes],
      firstLayer: [utterance('s1', '讲者不该为了讲这个准备一整周', 1)],
      proposals: [],
      meta: { rev: 4, fieldDictionary: { 准备成本: { semantic: '讲者要付的准备时间', shape: '低|中|高' } } },
    },
  })
  for (const event of events) applyWorkbenchEvent(state, event)
  return state
}

/** The successful plan, failing the test with the refusal when there is one. */
function planned(plan: EditPlan): Extract<EditPlan, { ok: true }> {
  if (!plan.ok) throw new Error(`unexpected refusal: ${JSON.stringify(plan.failure)}`)
  return plan
}

/** Every node written by a plan. */
function writtenNodes(plan: Extract<EditPlan, { ok: true }>): WorkbenchNode[] {
  return plan.events
    .filter((event): event is Extract<WorkbenchEvent, { type: 'workbench/node-change' }> =>
      event.type === 'workbench/node-change')
    .map(event => event.data.node)
}

describe('create-child', () => {
  it('plans one commit at the next rev, with the minted id', () => {
    const plan = planned(planEdit(
      stateWith([node('root')]),
      { op: 'create-child', parentId: NodeId('root'), title: '门票', body: '正文' },
      clockFrom(),
    ))
    expect(plan.rev).toBe(5)
    expect(writtenNodes(plan)).toEqual([{
      id: 'new0',
      title: '门票',
      parent: 'root',
      maturity: 'thought',
      source: 'human',
      fields: {},
      // Born with its brief: it is the duty carrier, so the place to write the duty
      // exists from the card's first moment rather than after a second round.
      bodies: [{
        id: 'newb1', label: '简介', source: 'human', lastRev: 5, kind: 'brief', duty: '', body: '正文',
      }],
      lastRev: 5,
      createdAt: 1000,
      body: '正文',
    }])
  })

  it('is refused when the parent does not exist', () => {
    const plan = planEdit(
      stateWith(),
      { op: 'create-child', parentId: NodeId('gone'), title: '门票' },
      clockFrom(),
    )
    expect(plan.ok).toBe(false)
    expect(plan.ok ? [] : plan.failure).toEqual({
      kind: 'gate',
      findings: [{ code: 'GATE_DANGLING_REF', blocking: true, message: '父节点 gone 不存在' }],
    })
  })
})

describe('update-field', () => {
  it('writes body as a skeleton slot, with no model call and no wait', () => {
    const plan = planned(planEdit(
      stateWith([node('n1')]),
      { op: 'update-field', nodeId: NodeId('n1'), field: 'body', value: '人自己改的一句话' },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.body).toBe('人自己改的一句话')
    expect(plan.rev).toBe(5)
  })

  it('writes duty as a skeleton slot too', () => {
    const plan = planned(planEdit(
      stateWith([node('mod')]),
      { op: 'update-field', nodeId: NodeId('mod'), field: 'duty', value: '管住入场' },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.duty).toBe('管住入场')
  })

  it('writes anything else as an open field, carrying its citation', () => {
    const plan = planned(planEdit(
      stateWith([node('n1')]),
      { op: 'update-field', nodeId: NodeId('n1'), field: '准备成本', value: '低', sourceId: SourceId('s1') },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.fields).toEqual({ 准备成本: { value: '低', sourceId: 's1' } })
  })

  it('marks a node the person edited as theirs, so the AI-authored count stays honest', () => {
    const plan = planned(planEdit(
      stateWith([node('n1', { source: 'ai' })]),
      { op: 'update-field', nodeId: NodeId('n1'), field: 'body', value: '改过了' },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.source).toBe('human')
  })

  it('leaves a distilled node its citation rather than erasing the evidence', () => {
    const plan = planned(planEdit(
      stateWith([node('n1', { source: { sourceId: SourceId('s1') } })]),
      { op: 'update-field', nodeId: NodeId('n1'), field: 'body', value: '改过了' },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.source).toEqual({ sourceId: 's1' })
  })

  it('is refused for a node that does not exist', () => {
    const plan = planEdit(
      stateWith(),
      { op: 'update-field', nodeId: NodeId('gone'), field: 'body', value: 'x' },
      clockFrom(),
    )
    expect(plan.ok ? undefined : plan.failure).toEqual({ kind: 'request', message: '节点 gone 不存在' })
  })
})

describe('rename and move', () => {
  it('renames in place', () => {
    const plan = planned(planEdit(
      stateWith([node('n1')]),
      { op: 'rename', nodeId: NodeId('n1'), title: '新名字' },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.title).toBe('新名字')
  })

  it('reparents, and reports the children the move puts in doubt', () => {
    const state = stateWith([node('a'), node('b'), node('a1', { parent: NodeId('a') })])
    const plan = planned(planEdit(state, { op: 'move', nodeId: NodeId('a'), parentId: NodeId('b') }, clockFrom()))
    expect(writtenNodes(plan)[0]?.parent).toBe('b')
    expect(plan.invalidation).toEqual(['a1'])
  })

  it('refuses a move that would close a loop', () => {
    const state = stateWith([node('root'), node('mid', { parent: NodeId('root') })])
    const plan = planEdit(state, { op: 'move', nodeId: NodeId('root'), parentId: NodeId('mid') }, clockFrom())
    expect(plan.ok ? [] : plan.failure.kind === 'gate' ? plan.failure.findings.map(f => f.code) : [])
      .toEqual(['GATE_CYCLE'])
  })
})

describe('delete', () => {
  it('removes a leaf', () => {
    const plan = planned(planEdit(stateWith([node('n1')]), { op: 'delete', nodeId: NodeId('n1') }, clockFrom()))
    expect(plan.events[0]?.type === 'workbench/node-change' && plan.events[0].data.op).toBe('delete')
  })

  it('is refused for a node that does not exist', () => {
    expect(planEdit(stateWith(), { op: 'delete', nodeId: NodeId('gone') }, clockFrom()).ok).toBe(false)
  })

  it('refuses to orphan children', () => {
    const state = stateWith([node('a'), node('a1', { parent: NodeId('a') })])
    const plan = planEdit(state, { op: 'delete', nodeId: NodeId('a') }, clockFrom())
    expect(plan.ok ? undefined : plan.failure)
      .toEqual({ kind: 'request', message: 'a 还有 1 个子节点；先把它们移走或删掉' })
  })
})

describe('promote', () => {
  it('charges the whole friction here: a module with children must state its duty', () => {
    const state = stateWith([node('mod'), node('child', { parent: NodeId('mod') })])
    const blocked = planEdit(state, { op: 'promote', nodeId: NodeId('mod'), maturity: 'committed' }, clockFrom())
    expect(blocked.ok ? [] : blocked.failure.kind === 'gate' ? blocked.failure.findings.map(f => f.code) : [])
      .toEqual(['GATE_MISSING_DUTY'])

    const withDuty = stateWith([node('mod', { duty: '管住入场' }), node('child', { parent: NodeId('mod') })])
    const plan = planned(planEdit(withDuty, { op: 'promote', nodeId: NodeId('mod'), maturity: 'committed' }, clockFrom()))
    expect(writtenNodes(plan)[0]?.maturity).toBe('committed')
    expect(plan.events[0]?.type === 'workbench/node-change' && plan.events[0].data.op).toBe('promote')
  })

  it('refuses to reject something without a reason, and accepts one with', () => {
    const state = stateWith([node('n1')])
    const noReason = planEdit(state, { op: 'promote', nodeId: NodeId('n1'), maturity: 'rejected' }, clockFrom())
    expect(noReason.ok ? [] : noReason.failure.kind === 'gate' ? noReason.failure.findings.map(f => f.code) : [])
      .toEqual(['GATE_NO_REASON'])

    const plan = planned(planEdit(
      state,
      { op: 'promote', nodeId: NodeId('n1'), maturity: 'rejected', note: '场地拿不到' },
      clockFrom(),
    ))
    expect(plan.events[0]?.type === 'workbench/node-change' && plan.events[0].data.op).toBe('reject')
  })

  it('is refused for a node that does not exist', () => {
    expect(planEdit(stateWith(), { op: 'promote', nodeId: NodeId('gone'), maturity: 'committed' }, clockFrom()).ok)
      .toBe(false)
  })

  it('refuses a promotion that changes nothing', () => {
    const state = stateWith([node('n1', { maturity: 'committed' })])
    const plan = planEdit(state, { op: 'promote', nodeId: NodeId('n1'), maturity: 'committed' }, clockFrom())
    expect(plan.ok ? undefined : plan.failure).toEqual({ kind: 'request', message: 'n1 已经是这个成熟度了' })
  })

  it('refuses an unregistered or uncited field at the moment of commitment', () => {
    const state = stateWith([node('n1', { fields: { 场地: { value: '会议室' } } })])
    const plan = planEdit(state, { op: 'promote', nodeId: NodeId('n1'), maturity: 'committed' }, clockFrom())
    expect(plan.ok ? [] : plan.failure.kind === 'gate' ? plan.failure.findings.map(f => f.code).sort() : [])
      .toEqual(['GATE_NO_EVIDENCE', 'GATE_UNREGISTERED_FIELD'])
  })
})

describe('advisories', () => {
  it('lets an ordinary write through and reports what it noticed', () => {
    // A committed module with children and no duty: blocking at promotion,
    // reported and allowed here.
    const state = stateWith([node('mod', { maturity: 'committed' }), node('child', { parent: NodeId('mod') })])
    const plan = planned(planEdit(
      state,
      { op: 'update-field', nodeId: NodeId('mod'), field: 'body', value: '先写点正文' },
      clockFrom(),
    ))
    expect(plan.advisories.map(finding => [finding.code, finding.blocking]))
      .toEqual([['GATE_MISSING_DUTY', false]])
  })
})

describe('promote-to-constraint', () => {
  it('creates the constraint area on first use and moves the node into it, in one commit', () => {
    const plan = planned(planEdit(
      stateWith([node('c1', { title: '讲者的准备成本必须低' })]),
      { op: 'promote-to-constraint', nodeId: NodeId('c1') },
      clockFrom(),
    ))
    expect(writtenNodes(plan).map(written => [written.id, written.parent])).toEqual([
      [GLOBAL_CONSTRAINT_ROOT_ID, null],
      ['c1', GLOBAL_CONSTRAINT_ROOT_ID],
    ])
    expect(new Set(plan.events.map(event => event.type === 'workbench/node-change' && event.data.rev))).toEqual(new Set([5]))
  })

  it('reuses the area once it exists', () => {
    const state = stateWith([node('G-', { duty: '约束' }), node('c2')])
    const plan = planned(planEdit(state, { op: 'promote-to-constraint', nodeId: NodeId('c2') }, clockFrom()))
    expect(writtenNodes(plan).map(written => written.id)).toEqual(['c2'])
  })

  it('refuses the area root itself and a node already inside', () => {
    const state = stateWith([node('G-'), node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID })])
    expect(planEdit(state, { op: 'promote-to-constraint', nodeId: GLOBAL_CONSTRAINT_ROOT_ID }, clockFrom()).ok).toBe(false)
    expect(planEdit(state, { op: 'promote-to-constraint', nodeId: NodeId('c1') }, clockFrom()).ok).toBe(false)
  })

  it('is refused for a node that does not exist', () => {
    expect(planEdit(stateWith(), { op: 'promote-to-constraint', nodeId: NodeId('gone') }, clockFrom()).ok).toBe(false)
  })
})

describe('accept-proposal', () => {
  /** A proposal offering a five-node cold-start skeleton. */
  const skeleton: WorkbenchEvent = {
    type: 'workbench/proposal',
    data: {
      proposalId: ProposalId('p1'),
      targetNode: null,
      title: '候选骨架',
      newNodes: [
        { title: '目标', duty: '说清为什么做' },
        { title: '内容', duty: '讲什么' },
        { title: '场地' },
      ],
      createdAt: 0,
    },
  }

  it('lands the whole skeleton at one rev, so no reader sees half of it', () => {
    const plan = planned(planEdit(stateWith([], [skeleton]), { op: 'accept-proposal', proposalId: ProposalId('p1') }, clockFrom()))
    expect(writtenNodes(plan).map(written => [written.id, written.title, written.source])).toEqual([
      ['new0', '目标', 'ai'],
      ['new1', '内容', 'ai'],
      ['new2', '场地', 'ai'],
    ])
    expect(new Set(writtenNodes(plan).map(written => written.lastRev))).toEqual(new Set([5]))
    expect(plan.events.at(-1)).toEqual({
      type: 'workbench/verdict',
      data: { proposalId: 'p1', outcome: 'accepted', rev: 5 },
    })
  })

  it('carries the draft prose and each proposed node duty and body onto the tree', () => {
    const rich: WorkbenchEvent = {
      type: 'workbench/proposal',
      data: {
        proposalId: ProposalId('p9'),
        targetNode: NodeId('n1'),
        title: '补内容',
        body: '草稿写的正文',
        newNodes: [{ title: '子', duty: '管子事', body: '子正文' }],
        createdAt: 0,
      },
    }
    const plan = planned(planEdit(
      stateWith([node('n1')], [rich]),
      { op: 'accept-proposal', proposalId: ProposalId('p9') },
      clockFrom(),
    ))
    expect(writtenNodes(plan).map(written => [written.id, written.body, written.duty])).toEqual([
      ['n1', '草稿写的正文', undefined],
      ['new0', '子正文', '管子事'],
    ])
  })

  it('keeps only the nodes the person kept, under the titles they settled on', () => {
    const plan = planned(planEdit(
      stateWith([], [skeleton]),
      { op: 'accept-proposal', proposalId: ProposalId('p1'), keptNodes: [{ index: 2 }, { index: 0, title: '为什么办' }] },
      clockFrom(),
    ))
    expect(writtenNodes(plan).map(written => written.title)).toEqual(['场地', '为什么办'])
    // Pruning happened before the commit, so the dropped node never existed.
    expect(plan.events.at(-1)?.type === 'workbench/verdict' && plan.events.at(-1)?.data)
      .toEqual({ proposalId: 'p1', outcome: 'edited', rev: 5 })
  })

  it('refuses a kept index the draft never offered', () => {
    const plan = planEdit(
      stateWith([], [skeleton]),
      { op: 'accept-proposal', proposalId: ProposalId('p1'), keptNodes: [{ index: 9 }] },
      clockFrom(),
    )
    expect(plan.ok ? undefined : plan.failure).toEqual({ kind: 'request', message: '草稿里没有第 9 个节点' })
  })

  it('records that the person rewrote it before accepting', () => {
    const proposal: WorkbenchEvent = {
      type: 'workbench/proposal',
      data: {
        proposalId: ProposalId('p2'),
        targetNode: NodeId('n1'),
        title: '补字段',
        fields: [{ name: '准备成本', value: '高', sourceId: SourceId('s1') }],
        createdAt: 0,
      },
    }
    const plan = planned(planEdit(
      stateWith([node('n1')], [proposal]),
      { op: 'accept-proposal', proposalId: ProposalId('p2'), edits: [{ name: '准备成本', value: '低', sourceId: SourceId('s1') }] },
      clockFrom(),
    ))
    expect(writtenNodes(plan)[0]?.fields).toEqual({ 准备成本: { value: '低', sourceId: 's1' } })
    expect(plan.events.at(-1)?.type === 'workbench/verdict' && plan.events.at(-1)?.data)
      .toEqual({ proposalId: 'p2', outcome: 'edited', rev: 5 })
  })

  it('re-runs the gates on what the person edited, so a hand-broken draft cannot land', () => {
    const proposal: WorkbenchEvent = {
      type: 'workbench/proposal',
      data: {
        proposalId: ProposalId('p3'),
        targetNode: NodeId('n1'),
        title: '补字段',
        fields: [{ name: '准备成本', value: '高', sourceId: SourceId('s1') }],
        createdAt: 0,
      },
    }
    // The person keeps the value but drops the citation on a committed node.
    const plan = planEdit(
      stateWith([node('n1', { maturity: 'committed' })], [proposal]),
      { op: 'accept-proposal', proposalId: ProposalId('p3'), edits: [{ name: '准备成本', value: '低' }] },
      clockFrom(),
    )
    expect(plan.ok ? [] : plan.failure.kind === 'gate' ? plan.failure.findings.map(f => f.code) : [])
      .toEqual(['GATE_NO_EVIDENCE'])
  })

  it('refuses an unknown draft, a ruled one, a missing target, homeless fields, and an empty draft', () => {
    const ruled = stateWith([], [skeleton, {
      type: 'workbench/verdict',
      data: { proposalId: ProposalId('p1'), outcome: 'accepted', rev: 4 },
    }])
    expect(planEdit(stateWith(), { op: 'accept-proposal', proposalId: ProposalId('nope') }, clockFrom()).ok).toBe(false)
    expect(planEdit(ruled, { op: 'accept-proposal', proposalId: ProposalId('p1') }, clockFrom()).ok).toBe(false)

    const missingTarget = stateWith([], [{
      type: 'workbench/proposal',
      data: { proposalId: ProposalId('p4'), targetNode: NodeId('gone'), title: 'x', createdAt: 0 },
    }])
    expect(planEdit(missingTarget, { op: 'accept-proposal', proposalId: ProposalId('p4') }, clockFrom()).ok).toBe(false)

    const homeless = stateWith([], [{
      type: 'workbench/proposal',
      data: {
        proposalId: ProposalId('p5'),
        targetNode: null,
        title: 'x',
        fields: [{ name: '准备成本', value: '低' }],
        createdAt: 0,
      },
    }])
    expect(planEdit(homeless, { op: 'accept-proposal', proposalId: ProposalId('p5') }, clockFrom()).ok).toBe(false)

    const empty = stateWith([], [{
      type: 'workbench/proposal',
      data: { proposalId: ProposalId('p6'), targetNode: null, title: 'x', createdAt: 0 },
    }])
    expect(planEdit(empty, { op: 'accept-proposal', proposalId: ProposalId('p6') }, clockFrom()).ok).toBe(false)
  })
})

describe('reject-proposal', () => {
  const proposal: WorkbenchEvent = {
    type: 'workbench/proposal',
    data: { proposalId: ProposalId('p1'), targetNode: null, title: 'x', newNodes: [{ title: 'y' }], createdAt: 0 },
  }

  it('keeps the reason and leaves the tree alone', () => {
    const plan = planned(planEdit(
      stateWith([], [proposal]),
      { op: 'reject-proposal', proposalId: ProposalId('p1'), reason: '这条不是我要的' },
      clockFrom(),
    ))
    expect(plan.events).toEqual([{
      type: 'workbench/verdict',
      data: { proposalId: 'p1', outcome: 'rejected', rev: 4, note: '这条不是我要的' },
    }])
    expect(plan.rev).toBe(4)
  })

  it('refuses a rejection with no reason', () => {
    const plan = planEdit(stateWith([], [proposal]), { op: 'reject-proposal', proposalId: ProposalId('p1'), reason: ' ' }, clockFrom())
    expect(plan.ok ? [] : plan.failure.kind === 'gate' ? plan.failure.findings.map(f => f.code) : [])
      .toEqual(['GATE_NO_REASON'])
  })

  it('refuses an unknown or already ruled draft', () => {
    expect(planEdit(stateWith(), { op: 'reject-proposal', proposalId: ProposalId('nope'), reason: 'r' }, clockFrom()).ok)
      .toBe(false)
    const ruled = stateWith([], [proposal, {
      type: 'workbench/verdict',
      data: { proposalId: ProposalId('p1'), outcome: 'rejected', rev: 4, note: 'r' },
    }])
    expect(planEdit(ruled, { op: 'reject-proposal', proposalId: ProposalId('p1'), reason: 'r' }, clockFrom()).ok).toBe(false)
  })
})

describe('unknown ops', () => {
  it('refuses an op that crossed a wire unvalidated', () => {
    expect(() => planEdit(stateWith(), { op: 'nope' } as unknown as EditRequest, clockFrom()))
      .toThrow('workbench: unknown edit op nope')
  })
})
