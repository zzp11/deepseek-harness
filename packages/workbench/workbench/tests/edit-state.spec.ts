/**
 * The edit channel's stage-1 operations: a card's edit state, 确定 and 丢弃,
 * removing a body, opening an idea area, and a proposal that revises bodies.
 */
import { describe, expect, it } from 'vitest'
import { BodyId, NodeId, ProposalId } from '../src/brand.ts'
import { EDIT_OPS, planEdit, type EditClock, type EditRequest } from '../src/edit.ts'
import type { ProposedBody } from '../src/events.ts'
import type { AuthoredBody } from '../src/model.ts'
import { applyWorkbenchEvent, emptyWorkbenchState, type WorkbenchState } from '../src/store.ts'
import { node } from './fixtures.ts'

/** A clock whose ids are pinned, so a plan is comparable. */
function clock(): EditClock {
  let minted = 0
  return {
    nodeId: () => NodeId(`new${String(minted++)}`),
    bodyId: () => BodyId(`body${String(minted++)}`),
    now: () => 111,
  }
}

/** A brief body. */
function brief(id: string, lastRev = 1): AuthoredBody {
  return { id: BodyId(id), label: '简介', source: 'human', lastRev, kind: 'brief', duty: '管这块', body: '正文' }
}

/** A projection holding the given nodes at `rev` 1. */
function stateWith(...nodes: readonly Parameters<typeof node>[]): WorkbenchState {
  const state = emptyWorkbenchState()
  for (const args of nodes) {
    const built = node(...args)
    state.nodes.set(built.id, built)
  }
  state.meta = { rev: 1, fieldDictionary: {} }
  return state
}

/** Plan a request and fold its events, so a test can assert the resulting projection. */
function run(state: WorkbenchState, request: EditRequest): WorkbenchState {
  const plan = planEdit(state, request, clock())
  if (!plan.ok) throw new Error(`refused: ${JSON.stringify(plan.failure)}`)
  for (const event of plan.events) applyWorkbenchEvent(state, event)
  return state
}

describe('the accepted operation set', () => {
  it('lists every branch the request union carries, so an unknown op never reaches planning', () => {
    expect(EDIT_OPS).toHaveLength(14)
    expect(new Set(EDIT_OPS).size).toBe(EDIT_OPS.length)
  })
})

describe('edit state', () => {
  it('costs no rev and leaves the card alone', () => {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    const plan = planEdit(state, { op: 'set-tmp', nodeId: NodeId('n1'), tmp: { title: '半成品', at: 9 } }, clock())
    expect(plan.ok && plan.rev).toBe(1)
    expect(plan.ok && plan.events).toEqual([
      { type: 'workbench/scratch', data: { nodeId: NodeId('n1'), tmp: { title: '半成品', at: 9 } } },
    ])
  })

  it('refuses a card that does not exist', () => {
    const plan = planEdit(emptyWorkbenchState(), { op: 'discard-tmp', nodeId: NodeId('ghost') }, clock())
    expect(plan.ok).toBe(false)
  })

  it('lands on 确定 as one commit, one rev, and clears itself', () => {
    let state = stateWith(['n1', { bodies: [brief('b1')] }])
    state = run(state, { op: 'set-tmp', nodeId: NodeId('n1'), tmp: { title: '定稿', body: '新正文', at: 9 } })
    expect(state.meta.rev).toBe(1)
    state = run(state, { op: 'commit-tmp', nodeId: NodeId('n1') })
    expect(state.meta.rev).toBe(2)
    expect(state.nodes.get(NodeId('n1'))?.title).toBe('定稿')
    expect(state.nodes.get(NodeId('n1'))?.body).toBe('新正文')
    expect(state.tmp.has(NodeId('n1'))).toBe(false)
  })

  it('stamps committed bodies with the commit rev, which is what staleness later compares', () => {
    let state = stateWith(['n1', { bodies: [brief('b1', 1)] }])
    state = run(state, {
      op: 'set-tmp',
      nodeId: NodeId('n1'),
      tmp: { bodies: [brief('b1', 1), { ...brief('b2', 1), label: '流程图' }], at: 9 },
    })
    state = run(state, { op: 'commit-tmp', nodeId: NodeId('n1') })
    expect(state.nodes.get(NodeId('n1'))?.bodies?.map(body => body.lastRev)).toEqual([2, 2])
  })

  it('turns the source to a person, because 确定 is the person committing', () => {
    let state = stateWith(['n1', { source: 'ai', bodies: [brief('b1')] }])
    state = run(state, { op: 'set-tmp', nodeId: NodeId('n1'), tmp: { title: '我改的', at: 9 } })
    state = run(state, { op: 'commit-tmp', nodeId: NodeId('n1') })
    expect(state.nodes.get(NodeId('n1'))?.source).toBe('human')
  })

  it('drops on 丢弃 without touching the committed card', () => {
    let state = stateWith(['n1', { bodies: [brief('b1')] }])
    state = run(state, { op: 'set-tmp', nodeId: NodeId('n1'), tmp: { title: '不要了', at: 9 } })
    state = run(state, { op: 'discard-tmp', nodeId: NodeId('n1') })
    expect(state.tmp.has(NodeId('n1'))).toBe(false)
    expect(state.nodes.get(NodeId('n1'))?.title).toBe('title-n1')
    expect(state.meta.rev).toBe(1)
  })

  it('refuses 确定 and 内容体删除 on a card that does not exist', () => {
    const empty = emptyWorkbenchState()
    expect(planEdit(empty, { op: 'commit-tmp', nodeId: NodeId('ghost') }, clock()).ok).toBe(false)
    expect(planEdit(empty, { op: 'delete-body', nodeId: NodeId('ghost'), bodyId: BodyId('b') }, clock()).ok).toBe(false)
  })

  it('carries every slot the edit state names, duty included', () => {
    let state = stateWith(['n1', { bodies: [brief('b1')] }])
    state = run(state, { op: 'set-tmp', nodeId: NodeId('n1'), tmp: { duty: '新职责', at: 9 } })
    state = run(state, { op: 'commit-tmp', nodeId: NodeId('n1') })
    expect(state.nodes.get(NodeId('n1'))?.duty).toBe('新职责')
  })

  it('refuses 确定 when nothing is pending', () => {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    const plan = planEdit(state, { op: 'commit-tmp', nodeId: NodeId('n1') }, clock())
    expect(plan.ok).toBe(false)
  })
})

describe('removing a body', () => {
  it('is immediate and free for anything but the brief', () => {
    const other: AuthoredBody = { ...brief('b2'), label: '流程图', kind: 'flow', steps: [] }
    let state = stateWith(['n1', { bodies: [brief('b1'), other] }])
    state = run(state, { op: 'delete-body', nodeId: NodeId('n1'), bodyId: BodyId('b2') })
    expect(state.nodes.get(NodeId('n1'))?.bodies?.map(body => body.id)).toEqual([BodyId('b1')])
  })

  it('refuses to remove the brief, and says why', () => {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    const plan = planEdit(state, { op: 'delete-body', nodeId: NodeId('n1'), bodyId: BodyId('b1') }, clock())
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.failure.kind === 'gate' && plan.failure.findings[0]?.code).toBe('GATE_REQUIRED_BODY')
  })

  it('refuses a body the card does not carry, and a card carrying none at all', () => {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    expect(planEdit(state, { op: 'delete-body', nodeId: NodeId('n1'), bodyId: BodyId('ghost') }, clock()).ok).toBe(false)
    const bare = stateWith(['n2'])
    expect(planEdit(bare, { op: 'delete-body', nodeId: NodeId('n2'), bodyId: BodyId('b1') }, clock()).ok).toBe(false)
  })
})

describe('opening an idea area', () => {
  it('creates the idea root once, and refuses a second time', () => {
    let state = stateWith(['n1', { bodies: [brief('b1')] }])
    state = run(state, { op: 'open-ideas', nodeId: NodeId('n1') })
    const root = [...state.nodes.values()].find(item => item.region === 'idea')
    expect(root?.parent).toBe(NodeId('n1'))
    expect(root?.maturity).toBe('committed')
    expect(planEdit(state, { op: 'open-ideas', nodeId: NodeId('n1') }, clock()).ok).toBe(false)
  })

  it('refuses a card that does not exist', () => {
    expect(planEdit(emptyWorkbenchState(), { op: 'open-ideas', nodeId: NodeId('ghost') }, clock()).ok).toBe(false)
  })
})

describe('a proposal that revises bodies', () => {
  /** A proposal offering bodies against `n1`. */
  function offer(bodies: readonly ProposedBody[]): WorkbenchState {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    state.proposals.set(ProposalId('p1'), {
      proposal: {
        proposalId: ProposalId('p1'),
        targetNode: NodeId('n1'),
        title: '改一版',
        createdAt: 0,
        bodies,
      },
    })
    return state
  }

  it('adds bodies to a card that had none', () => {
    const state = stateWith(['n1'])
    state.proposals.set(ProposalId('p3'), {
      proposal: {
        proposalId: ProposalId('p3'),
        targetNode: NodeId('n1'),
        title: '起个头',
        createdAt: 0,
        bodies: [{ label: '简介', payload: { kind: 'brief', duty: '管这块', body: '正文' } }],
      },
    })
    const after = run(state, { op: 'accept-proposal', proposalId: ProposalId('p3') })
    expect(after.nodes.get(NodeId('n1'))?.bodies?.map(body => body.label)).toEqual(['简介'])
  })

  it('replaces a named body in place, keeping tag order and the body’s identity', () => {
    let state = offer([{ label: '简介', payload: { kind: 'brief', duty: '新职责', body: '新正文' }, replaces: BodyId('b1') }])
    state = run(state, { op: 'accept-proposal', proposalId: ProposalId('p1') })
    const bodies = state.nodes.get(NodeId('n1'))?.bodies ?? []
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.id).toBe(BodyId('b1'))
    expect(bodies[0]?.kind === 'brief' && bodies[0].duty).toBe('新职责')
  })

  it('appends a body it does not claim to replace, so one round can revise and add', () => {
    let state = offer([
      { label: '简介', payload: { kind: 'brief', duty: '新职责', body: '新正文' }, replaces: BodyId('b1') },
      { label: '流程图', payload: { kind: 'flow', steps: [] } },
    ])
    state = run(state, { op: 'accept-proposal', proposalId: ProposalId('p1') })
    const bodies = state.nodes.get(NodeId('n1'))?.bodies ?? []
    expect(bodies.map(body => body.label)).toEqual(['简介', '流程图'])
    expect(bodies.every(body => body.lastRev === 2)).toBe(true)
  })

  it('gives a newly created node the bodies the draft offered with it', () => {
    const state = stateWith(['n1', { bodies: [brief('b1')] }])
    state.proposals.set(ProposalId('p2'), {
      proposal: {
        proposalId: ProposalId('p2'),
        targetNode: null,
        title: '候选骨架',
        createdAt: 0,
        newNodes: [{ title: '场地', bodies: [{ label: '简介', payload: { kind: 'brief', duty: '管场地', body: '正文' } }] }],
      },
    })
    const after = run(state, { op: 'accept-proposal', proposalId: ProposalId('p2') })
    const created = [...after.nodes.values()].find(item => item.title === '场地')
    expect(created?.bodies?.map(body => body.label)).toEqual(['简介'])
  })

  it('appends when replaces names a body that is not there, rather than dropping the content', () => {
    let state = offer([{ label: '表格', payload: { kind: 'table', columns: ['a'], rows: [] }, replaces: BodyId('gone') }])
    state = run(state, { op: 'accept-proposal', proposalId: ProposalId('p1') })
    expect(state.nodes.get(NodeId('n1'))?.bodies?.map(body => body.label)).toEqual(['简介', '表格'])
  })
})
