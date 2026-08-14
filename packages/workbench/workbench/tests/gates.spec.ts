import { describe, expect, it } from 'vitest'
import { NodeId, SourceId } from '../src/brand.ts'
import {
  blockingFindings, gateDanglingRefs, gateDuty, gateEvidence, gateNoCycle, gateReason, gateRegisteredFields,
  renderFindings, runNodeGates,
} from '../src/gates.ts'
import { graphOf, node, utterance } from './fixtures.ts'

/** Each gate is asserted by injecting what it must refuse, then by the case it must let through. */

describe('gateDanglingRefs', () => {
  it('refuses a parent that does not exist', () => {
    const findings = gateDanglingRefs(graphOf([]), node('n1', { parent: NodeId('gone') }))
    expect(findings.map(finding => finding.code)).toEqual(['GATE_DANGLING_REF'])
    expect(findings[0]?.message).toContain('父节点 gone 不存在')
  })

  it('refuses a node source citing an entry the first-hand layer lacks', () => {
    const findings = gateDanglingRefs(graphOf([]), node('n1', { source: { sourceId: SourceId('gone') } }))
    expect(findings.map(finding => finding.message)).toEqual(['来源依据 gone 不在一手层'])
  })

  it('refuses a field citing an entry the first-hand layer lacks', () => {
    const findings = gateDanglingRefs(graphOf([]), node('n1', {
      fields: { 准备成本: { value: '低', sourceId: SourceId('gone') } },
    }))
    expect(findings.map(finding => finding.message)).toEqual(['字段「准备成本」的依据 gone 不在一手层'])
  })

  it('lets a node through when every reference resolves', () => {
    const graph = graphOf([node('root')], [utterance('s1', '原话')])
    expect(gateDanglingRefs(graph, node('n1', {
      parent: NodeId('root'),
      fields: { 准备成本: { value: '低', sourceId: SourceId('s1') } },
    }))).toEqual([])
  })
})

describe('gateNoCycle', () => {
  it('refuses a node parented to itself', () => {
    const candidate = node('n1', { parent: NodeId('n1') })
    expect(gateNoCycle(graphOf([candidate]), candidate).map(finding => finding.code)).toEqual(['GATE_CYCLE'])
  })

  it('refuses a move that closes a longer loop', () => {
    // root → mid, and moving root under mid would close root → mid → root.
    const graph = graphOf([node('root'), node('mid', { parent: NodeId('root') })])
    const findings = gateNoCycle(graph, node('root', { parent: NodeId('mid') }))
    expect(findings.map(finding => finding.code)).toEqual(['GATE_CYCLE'])
  })

  it('leaves a dangling parent to the reference gate rather than reporting a cycle', () => {
    expect(gateNoCycle(graphOf([]), node('n1', { parent: NodeId('gone') }))).toEqual([])
  })

  it('lets a chain that terminates through', () => {
    const graph = graphOf([node('root'), node('mid', { parent: NodeId('root') })])
    expect(gateNoCycle(graph, node('leaf', { parent: NodeId('mid') }))).toEqual([])
  })
})

describe('gateRegisteredFields', () => {
  it('refuses an unregistered field in the committed region', () => {
    const findings = gateRegisteredFields(
      graphOf([]),
      node('n1', { maturity: 'committed', fields: { 准备成本: { value: '低' } } }),
    )
    expect(findings.map(finding => finding.code)).toEqual(['GATE_UNREGISTERED_FIELD'])
  })

  it('stays quiet in the working region, where friction would tax thinking', () => {
    expect(gateRegisteredFields(
      graphOf([]),
      node('n1', { maturity: 'idea', fields: { 准备成本: { value: '低' } } }),
    )).toEqual([])
  })

  it('accepts a field the dictionary registered', () => {
    const graph = graphOf([], [], { 准备成本: { semantic: '讲者要付的准备时间', shape: '低|中|高' } })
    expect(gateRegisteredFields(
      graph,
      node('n1', { maturity: 'committed', fields: { 准备成本: { value: '低' } } }),
    )).toEqual([])
  })
})

describe('gateEvidence', () => {
  it('refuses a committed field with no citation', () => {
    const findings = gateEvidence(node('n1', { maturity: 'committed', fields: { 准备成本: { value: '低' } } }))
    expect(findings.map(finding => finding.code)).toEqual(['GATE_NO_EVIDENCE'])
  })

  it('stays quiet in the working region', () => {
    expect(gateEvidence(node('n1', { maturity: 'thought', fields: { 准备成本: { value: '低' } } }))).toEqual([])
  })

  it('accepts a cited field', () => {
    expect(gateEvidence(node('n1', {
      maturity: 'committed',
      fields: { 准备成本: { value: '低', sourceId: SourceId('s1') } },
    }))).toEqual([])
  })
})

describe('gateDuty', () => {
  it('is advisory on an ordinary write and blocking at promotion', () => {
    const graph = graphOf([node('mod', { maturity: 'committed' }), node('child', { parent: NodeId('mod') })])
    const candidate = node('mod', { maturity: 'committed' })
    expect(gateDuty(graph, candidate, { promoting: false })).toEqual([
      { code: 'GATE_MISSING_DUTY', blocking: false, message: 'mod 有子节点但没写职责；一句话说清它管什么' },
    ])
    expect(gateDuty(graph, candidate, { promoting: true })[0]?.blocking).toBe(true)
  })

  it('says nothing about a childless node or one that states its duty', () => {
    const graph = graphOf([node('mod', { maturity: 'committed' }), node('child', { parent: NodeId('mod') })])
    expect(gateDuty(graph, node('leaf', { maturity: 'committed' }), { promoting: true })).toEqual([])
    expect(gateDuty(graph, node('mod', { maturity: 'committed', duty: '管住入场' }), { promoting: true })).toEqual([])
  })
})

describe('gateReason', () => {
  it('refuses a rejection with no reason, including whitespace', () => {
    expect(gateReason(undefined).map(finding => finding.code)).toEqual(['GATE_NO_REASON'])
    expect(gateReason('   ').map(finding => finding.code)).toEqual(['GATE_NO_REASON'])
  })

  it('accepts a reason', () => {
    expect(gateReason('场地拿不到')).toEqual([])
  })
})

describe('runNodeGates', () => {
  it('reports every gate a single bad write trips at once', () => {
    const graph = graphOf([node('mod', { maturity: 'committed' }), node('child', { parent: NodeId('mod') })])
    const findings = runNodeGates(graph, node('mod', {
      maturity: 'committed',
      parent: NodeId('gone'),
      fields: { 准备成本: { value: '低' } },
    }), { promoting: true })
    expect(new Set(findings.map(finding => finding.code))).toEqual(new Set([
      'GATE_DANGLING_REF', 'GATE_UNREGISTERED_FIELD', 'GATE_NO_EVIDENCE', 'GATE_MISSING_DUTY',
    ]))
    expect(blockingFindings(findings)).toHaveLength(4)
  })

  it('renders findings one per line, code first', () => {
    expect(renderFindings(gateReason(undefined))).toBe('GATE_NO_REASON: 否决要写理由；不然过一阵没人知道为什么不做')
  })
})
