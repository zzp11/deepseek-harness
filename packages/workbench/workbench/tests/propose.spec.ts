import { describe, expect, it } from 'vitest'
import { BodyObjectId, NodeId, ProposalId, SourceId } from '../src/brand.ts'
import {
  presentCheckPromotionCall, presentProposeCall, presentReadNodesCall, readOnlyConcurrency,
} from '../src/present.ts'
import { gateDraft, planProposal, type ProposalClock, type ProposalDraft } from '../src/propose.ts'
import { applyWorkbenchEvent, emptyWorkbenchState, type WorkbenchState } from '../src/store.ts'
import type { WorkbenchNode } from '../src/model.ts'
import { node, utterance } from './fixtures.ts'

/** A deterministic clock, so a plan's id and timestamp are assertable. */
const clock: ProposalClock = { proposalId: () => ProposalId('p1'), now: () => 1000 }

/** A projection seeded with nodes, one first-hand entry, and one registered field. */
function stateWith(nodes: readonly WorkbenchNode[] = []): WorkbenchState {
  const state = emptyWorkbenchState()
  applyWorkbenchEvent(state, {
    type: 'workbench/snapshot',
    data: {
      nodes: [...nodes],
      firstLayer: [utterance('s1', '讲者不该为了讲这个准备一整周', 1)],
      proposals: [],
      meta: { rev: 2, fieldDictionary: { 准备成本: { semantic: '讲者要付的准备时间', shape: '低|中|高' } } },
    },
  })
  return state
}

describe('planProposal', () => {
  it('records everything the draft carries, unchanged', () => {
    const draft: ProposalDraft = {
      targetNode: NodeId('n1'),
      title: '补内容',
      summary: '给这个节点补正文和一个字段',
      body: '草稿正文',
      fields: [{ name: '准备成本', value: '低', sourceId: SourceId('s1') }],
      newNodes: [{
        title: '子节点',
        duty: '管子事',
        body: '子正文',
        fields: [{ name: '准备成本', value: '高', sourceId: SourceId('s1') }],
      }],
    }
    const plan = planProposal(stateWith([node('n1')]), draft, clock)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.proposalId).toBe('p1')
    expect(plan.events).toEqual([{
      type: 'workbench/proposal',
      data: { ...draft, proposalId: 'p1', createdAt: 1000 },
    }])
  })

  it('records the content bodies the draft offers for its target', () => {
    // The failure this closes: `planProposal` built the event without `bodies`, so a
    // model that drew a flow chart on an existing card got `草稿 … 已记下` back and the
    // chart was gone. `planAcceptProposal` already read `proposal.bodies`, so the accept
    // side had been waiting for a field the propose side never wrote.
    const plan = planProposal(stateWith([node('n1')]), {
      targetNode: NodeId('n1'),
      title: '给总纲加一份流程图',
      bodies: [{
        label: '总流程',
        payload: {
          kind: 'flow',
          steps: [
            { stepId: BodyObjectId('s0'), text: '定主题' },
            { stepId: BodyObjectId('s1'), text: '复盘' },
          ],
        },
      }],
    }, clock)
    if (!plan.ok) throw new Error(`unexpected refusal: ${JSON.stringify(plan.findings)}`)
    const recorded = plan.events[0]?.data as { bodies?: readonly { label: string }[] }
    expect(recorded.bodies).toHaveLength(1)
    expect(recorded.bodies?.[0]?.label).toBe('总流程')
  })

  it('refuses a parentIndex that does not point at an earlier node', () => {
    // The model is the only writer of this field, and a draft whose shape cannot be
    // built is worth refusing while the model can still fix it. Pointing forward (or at
    // itself) is also what would let a cycle in.
    for (const parentIndex of [1, 2, 7]) {
      const plan = planProposal(stateWith(), {
        targetNode: null,
        title: '骨架',
        newNodes: [{ title: '总纲' }, { title: '场地', parentIndex }],
      }, clock)
      expect(plan.ok).toBe(false)
      if (plan.ok) throw new Error(`expected a refusal for parentIndex=${String(parentIndex)}`)
      expect(plan.findings[0]?.code).toBe('GATE_DANGLING_REF')
      expect(plan.findings[0]?.message).toMatch(/parentIndex/)
    }
  })

  it('keeps a parentIndex that points at an earlier node', () => {
    const plan = planProposal(stateWith(), {
      targetNode: null,
      title: '骨架',
      newNodes: [{ title: '总纲', duty: '管全局' }, { title: '场地', parentIndex: 0 }],
    }, clock)
    if (!plan.ok) throw new Error(`unexpected refusal: ${JSON.stringify(plan.findings)}`)
    expect(plan.events[0]?.data).toMatchObject({
      newNodes: [{ title: '总纲' }, { title: '场地', parentIndex: 0 }],
    })
  })

  it('omits what the draft did not carry rather than writing empty values', () => {
    const plan = planProposal(stateWith(), { targetNode: null, title: '只有标题' }, clock)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.events[0]?.data).toEqual({
      proposalId: 'p1', targetNode: null, title: '只有标题', createdAt: 1000,
    })
  })

  it('refuses instead of recording, when the gates would never let it land', () => {
    const plan = planProposal(
      stateWith(),
      { targetNode: null, title: 'x', newNodes: [{ title: '场地', parent: NodeId('ghost') }] },
      clock,
    )
    expect(plan.ok).toBe(false)
    expect(plan.ok ? [] : plan.findings.map(finding => finding.code)).toEqual(['GATE_DANGLING_REF'])
  })
})

describe('gateDraft', () => {
  it('points the model at the tree index when its target is gone', () => {
    const findings = gateDraft(stateWith(), { targetNode: NodeId('ghost'), title: 'x' })
    expect(findings).toEqual([{
      code: 'GATE_DANGLING_REF',
      blocking: true,
      message: '节点 ghost 不存在；先调 workbench_read_nodes 看骨架里有什么',
    }])
  })

  it('gates the target as it would stand with the draft prose applied', () => {
    expect(gateDraft(stateWith([node('n1')]), { targetNode: NodeId('n1'), title: 'x', body: '草稿正文' })).toEqual([])
  })

  it('says nothing about a working-region draft carrying a brand-new field', () => {
    const findings = gateDraft(stateWith([node('n1')]), {
      targetNode: NodeId('n1'),
      title: 'x',
      fields: [{ name: '全新字段', value: '值' }],
    })
    expect(findings).toEqual([])
  })

  it('refuses an unregistered or uncited field once the target is committed', () => {
    const findings = gateDraft(stateWith([node('n1', { maturity: 'committed' })]), {
      targetNode: NodeId('n1'),
      title: 'x',
      fields: [{ name: '全新字段', value: '值' }],
    })
    expect(findings.map(finding => finding.code).sort()).toEqual(['GATE_NO_EVIDENCE', 'GATE_UNREGISTERED_FIELD'])
  })

  it('gates a proposed node under a placeholder id, catching a citation it cannot resolve', () => {
    const findings = gateDraft(stateWith(), {
      targetNode: null,
      title: 'x',
      newNodes: [{ title: '场地', fields: [{ name: '准备成本', value: '低', sourceId: SourceId('gone') }] }],
    })
    expect(findings.map(finding => finding.message)).toEqual(['字段「准备成本」的依据 gone 不在一手层'])
  })
})

describe('card presentation', () => {
  it('names what each call is about, from the arguments alone', () => {
    expect(presentReadNodesCall({})).toEqual({ card: 'generic', title: '读树的索引', kind: 'read' })
    expect(presentReadNodesCall({ nodeId: 'n1' })).toEqual({ card: 'generic', title: '读依赖集 n1', kind: 'read' })
    expect(presentProposeCall({ title: '候选骨架' })).toEqual({ card: 'generic', title: '提草稿：候选骨架' })
    expect(presentCheckPromotionCall({ nodeId: 'n1' })).toEqual({ card: 'generic', title: '查晋升门 n1', kind: 'read' })
  })

  it('declares the two read-only tools safe to run in parallel', () => {
    expect(readOnlyConcurrency()).toBe(true)
  })
})
