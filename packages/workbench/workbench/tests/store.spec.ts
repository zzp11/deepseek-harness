import { describe, expect, it } from 'vitest'
import { NodeId, ProposalId, SourceId } from '../src/brand.ts'
import { dependencySet } from '../src/core.ts'
import type { WorkbenchNodeChange, WorkbenchProposal, WorkbenchVerdict } from '../src/events.ts'
import {
  applyWorkbenchEvent, cloneWorkbenchState, emptyWorkbenchState, latestSnapshotIndex, projectWorkbench,
  shouldSnapshot, snapshotOf,
  type WorkbenchEvent, type WorkbenchState,
} from '../src/store.ts'
import { node, utterance } from './fixtures.ts'

/** A `workbench/node-change` event with the commit values a test does not pin. */
function change(overrides: Partial<WorkbenchNodeChange> & Pick<WorkbenchNodeChange, 'node'>): WorkbenchEvent {
  return {
    type: 'workbench/node-change',
    data: { rev: overrides.node.lastRev, actor: 'human', op: 'create', ...overrides },
  }
}

/** A `workbench/proposal` event carrying nothing but its identity and title. */
function proposal(id: string, overrides: Partial<WorkbenchProposal> = {}): WorkbenchEvent {
  return {
    type: 'workbench/proposal',
    data: { proposalId: ProposalId(id), targetNode: null, title: `proposal-${id}`, createdAt: 0, ...overrides },
  }
}

/** A `workbench/verdict` event. */
function verdict(id: string, overrides: Partial<WorkbenchVerdict> = {}): WorkbenchEvent {
  return {
    type: 'workbench/verdict',
    data: { proposalId: ProposalId(id), outcome: 'accepted', rev: 1, ...overrides },
  }
}

/** Fold a log from empty without the checkpoint shortcut, for comparison against {@link projectWorkbench}. */
function foldEveryEvent(events: readonly WorkbenchEvent[]): WorkbenchState {
  const state = emptyWorkbenchState()
  for (const event of events) applyWorkbenchEvent(state, event)
  return state
}

describe('emptyWorkbenchState', () => {
  it('starts at rev 0 with an empty dictionary, so every open field is unregistered', () => {
    const state = emptyWorkbenchState()
    expect(state.meta).toEqual({ rev: 0, fieldDictionary: {} })
    expect(state.nodes.size).toBe(0)
    expect(state.changesSinceSnapshot).toBe(0)
  })
})

describe('folding node changes', () => {
  it('writes the whole-value node and advances the tree rev', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('n1', { lastRev: 3 }) }))
    expect(state.nodes.get(NodeId('n1'))?.title).toBe('title-n1')
    expect(state.meta.rev).toBe(3)
    expect(state.changesSinceSnapshot).toBe(1)
  })

  it('gives every node of one commit the same rev', () => {
    const state = emptyWorkbenchState()
    for (const id of ['a', 'b', 'c']) {
      applyWorkbenchEvent(state, change({ node: node(id, { lastRev: 5 }), rev: 5 }))
    }
    expect([...state.nodes.values()].map(item => item.lastRev)).toEqual([5, 5, 5])
    expect(state.meta.rev).toBe(5)
  })

  it('is idempotent under a repeated event, because the payload is the whole node', () => {
    const events = [change({ node: node('n1', { lastRev: 2 }) })]
    expect(foldEveryEvent([...events, ...events])).toEqual(
      { ...foldEveryEvent(events), changesSinceSnapshot: 2 },
    )
  })

  it('removes the node on delete', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('n1') }))
    applyWorkbenchEvent(state, change({ node: node('n1'), op: 'delete', rev: 2 }))
    expect(state.nodes.has(NodeId('n1'))).toBe(false)
  })

  it('reparents on move', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('root') }))
    applyWorkbenchEvent(state, change({ node: node('n1') }))
    applyWorkbenchEvent(state, change({ node: node('n1', { parent: NodeId('root') }), op: 'move', rev: 2 }))
    expect(state.nodes.get(NodeId('n1'))?.parent).toBe('root')
  })

  it('refuses a rev that moves backwards', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('n1', { lastRev: 4 }) }))
    expect(() => { applyWorkbenchEvent(state, change({ node: node('n2'), rev: 2 })) })
      .toThrow('workbench: node-change rev 2 moves backwards from 4')
  })

  it('refuses a promotion that did not promote', () => {
    const state = emptyWorkbenchState()
    expect(() => { applyWorkbenchEvent(state, change({ node: node('n1', { maturity: 'idea' }), op: 'promote' })) })
      .toThrow('workbench: promote left n1 at idea')
  })

  it('refuses promoting what is already committed', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('n1', { maturity: 'committed' }), op: 'promote' }))
    expect(() => {
      applyWorkbenchEvent(state, change({
        node: node('n1', { maturity: 'committed', lastRev: 2 }), op: 'promote', rev: 2,
      }))
    }).toThrow('workbench: promote of already committed n1')
  })
})

describe('folding the first-hand layer', () => {
  it('appends the words unchanged', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, { type: 'workbench/utterance', data: { ...utterance('s1', '就是想做个内部分享') } })
    expect(state.firstLayer.get(SourceId('s1'))?.text).toBe('就是想做个内部分享')
  })

  it('refuses to overwrite an id the layer already holds', () => {
    const state = emptyWorkbenchState()
    const event: WorkbenchEvent = { type: 'workbench/utterance', data: { ...utterance('s1', '第一遍') } }
    applyWorkbenchEvent(state, event)
    expect(() => { applyWorkbenchEvent(state, event) })
      .toThrow('workbench: first-hand entry s1 appended twice')
  })
})

describe('folding proposals and verdicts', () => {
  it('records a draft and then its ruling', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, proposal('p1'))
    applyWorkbenchEvent(state, verdict('p1', { outcome: 'edited', note: '删了两个' }))
    const record = state.proposals.get(ProposalId('p1'))
    expect(record?.proposal.title).toBe('proposal-p1')
    expect(record?.verdict?.outcome).toBe('edited')
  })

  it('refuses a second declaration of one proposal', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, proposal('p1'))
    expect(() => { applyWorkbenchEvent(state, proposal('p1')) })
      .toThrow('workbench: proposal p1 declared twice')
  })

  it('refuses a ruling on a draft nobody made', () => {
    expect(() => { applyWorkbenchEvent(emptyWorkbenchState(), verdict('ghost')) })
      .toThrow('workbench: verdict on unknown proposal ghost')
  })

  it('refuses a second ruling', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, proposal('p1'))
    applyWorkbenchEvent(state, verdict('p1'))
    expect(() => { applyWorkbenchEvent(state, verdict('p1', { outcome: 'rejected' })) })
      .toThrow('workbench: proposal p1 ruled twice')
  })
})

describe('checkpoints', () => {
  it('replays from the newest checkpoint to the same projection as folding everything', () => {
    const events: WorkbenchEvent[] = [
      { type: 'workbench/utterance', data: { ...utterance('s1', '原话一', 1) } },
      change({ node: node('n1', { lastRev: 2 }), rev: 2 }),
      proposal('p1'),
      verdict('p1'),
    ]
    const before = foldEveryEvent(events)
    const log: WorkbenchEvent[] = [
      ...events,
      { type: 'workbench/snapshot', data: snapshotOf(before) },
      change({ node: node('n2', { lastRev: 3 }), rev: 3 }),
      { type: 'workbench/utterance', data: { ...utterance('s2', '原话二', 3) } },
    ]
    expect(projectWorkbench(log)).toEqual(foldEveryEvent(log))
  })

  it('carries the first-hand layer across the checkpoint, so a cited entry survives a cold start', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, { type: 'workbench/utterance', data: { ...utterance('s1', '原话', 1) } })
    applyWorkbenchEvent(state, change({
      node: node('n1', { lastRev: 2, fields: { 准备成本: { value: '低', sourceId: SourceId('s1') } } }),
      rev: 2,
    }))
    // Cold start sees only the checkpoint and what followed it; without the
    // first-hand layer in the payload this dependency set could not be built.
    const cold = projectWorkbench([{ type: 'workbench/snapshot', data: snapshotOf(state) }])
    expect(dependencySet(cold, NodeId('n1')).map(item => item.content)).toContain('原话')
  })

  it('restarts the change count and replaces the tree', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, change({ node: node('old') }))
    applyWorkbenchEvent(state, {
      type: 'workbench/snapshot',
      data: { nodes: [node('fresh')], firstLayer: [], proposals: [], meta: { rev: 9, fieldDictionary: {} } },
    })
    expect([...state.nodes.keys()]).toEqual(['fresh'])
    expect(state.meta.rev).toBe(9)
    expect(state.changesSinceSnapshot).toBe(0)
  })

  it('finds the newest checkpoint, and starts at 0 when a log holds none', () => {
    const snapshot: WorkbenchEvent = { type: 'workbench/snapshot', data: snapshotOf(emptyWorkbenchState()) }
    expect(latestSnapshotIndex([change({ node: node('a') })])).toBe(0)
    expect(latestSnapshotIndex([snapshot, change({ node: node('a') }), snapshot])).toBe(2)
  })

  it('keeps a ruled and an unruled proposal apart in the payload', () => {
    const state = emptyWorkbenchState()
    applyWorkbenchEvent(state, proposal('ruled'))
    applyWorkbenchEvent(state, verdict('ruled'))
    applyWorkbenchEvent(state, proposal('open'))
    const checkpointed = snapshotOf(state).proposals
    expect(checkpointed.map(entry => [entry.proposal.proposalId, entry.verdict?.outcome])).toEqual([
      ['ruled', 'accepted'],
      ['open', undefined],
    ])
    expect(Object.hasOwn(checkpointed[1] ?? {}, 'verdict')).toBe(false)
  })
})

describe('cloneWorkbenchState', () => {
  it('gives an independent projection with the same contents', () => {
    const original = emptyWorkbenchState()
    applyWorkbenchEvent(original, change({ node: node('n1', { lastRev: 2 }) }))
    const copy = cloneWorkbenchState(original)
    expect(copy).toEqual(original)
    applyWorkbenchEvent(copy, change({ node: node('n2'), rev: 3 }))
    expect(original.nodes.has(NodeId('n2'))).toBe(false)
    expect(copy.nodes.has(NodeId('n2'))).toBe(true)
  })
})

describe('shouldSnapshot', () => {
  it('checkpoints on every promotion, whatever the count', () => {
    const state = emptyWorkbenchState()
    const promotion = change({ node: node('n1', { maturity: 'committed' }), op: 'promote' })
    applyWorkbenchEvent(state, promotion)
    expect(shouldSnapshot(state, promotion.data as WorkbenchNodeChange, 50)).toBe(true)
  })

  it('otherwise waits for the configured interval', () => {
    const state = emptyWorkbenchState()
    const edit = change({ node: node('n1'), op: 'update' })
    applyWorkbenchEvent(state, edit)
    expect(shouldSnapshot(state, edit.data as WorkbenchNodeChange, 2)).toBe(false)
    applyWorkbenchEvent(state, edit)
    expect(shouldSnapshot(state, edit.data as WorkbenchNodeChange, 2)).toBe(true)
  })
})

describe('unknown events', () => {
  it('refuses a workbench type this build does not know', () => {
    expect(() => { applyWorkbenchEvent(emptyWorkbenchState(), { type: 'workbench/future' } as unknown as WorkbenchEvent) })
      .toThrow('workbench: cannot fold event workbench/future')
  })
})
