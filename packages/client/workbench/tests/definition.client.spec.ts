/**
 * The fold: one Context per session over the whole `workbench/*` family, folded
 * with the host's own projection code, replayable by log order.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  emptyWorkbenchState, snapshotOf, type WorkbenchNode, type WorkbenchState,
} from '@deepseek-ai/dsh-workbench/projection'
import {
  treeRows, treeView, WORKBENCH_KIND, WORKBENCH_TARGET, workbenchTreeDefinition, workbenchViewDefinition,
  type WorkbenchTreeState,
} from '../src/client/definition.ts'

/** Build a node with the values a test does not pin already filled. */
function node(id: string, overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  return {
    id: id as WorkbenchNode['id'],
    title: `title-${id}`,
    parent: null,
    maturity: 'thought',
    source: 'human',
    fields: {},
    lastRev: 1,
    createdAt: 0,
    ...overrides,
  }
}

/** One session event as the fold receives it. */
function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

/** The empty checkpoint the host appends before a session's first change. */
const anchor = event('workbench/snapshot', snapshotOf(emptyWorkbenchState()))

/** One commit of one node. */
function change(target: WorkbenchNode, rev: number, op = 'create'): SessionEvent {
  return event('workbench/node-change', { rev, actor: 'human', op, node: { ...target, lastRev: rev } }, rev)
}

/** Fold a log the way the engine does: start on the checkpoint, update on the rest. */
function fold(events: readonly SessionEvent[]): WorkbenchTreeState {
  let state: WorkbenchTreeState | undefined
  for (const raw of events) {
    const match = workbenchTreeDefinition.match(raw)
    if (match === null) continue
    const context = { key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined, current: new Map() }
    if (match.role === 'start') {
      state = workbenchTreeDefinition.start(
        { ...context, state: undefined },
        { event: raw, role: 'start', location: { kind: 'unresolved' } } as never,
        { previous: () => undefined },
      )
      continue
    }
    if (state === undefined) throw new Error('update before start')
    state = workbenchTreeDefinition.update(
      { ...context, state },
      { event: raw, role: 'update', location: { kind: 'unresolved' } } as never,
    )
  }
  if (state === undefined) throw new Error('nothing folded')
  return state
}

describe('match', () => {
  it('claims every workbench event and nothing else, with the checkpoint as the start', () => {
    expect(workbenchTreeDefinition.match(anchor)).toEqual({ id: 'tree', role: 'start' })
    expect(workbenchTreeDefinition.match(change(node('n1'), 1))).toEqual({ id: 'tree', role: 'update' })
    expect(workbenchTreeDefinition.match(event('user/message', {}))).toBeNull()
  })
})

describe('the fold', () => {
  it('builds the tree from the log and counts the commits', () => {
    const state = fold([anchor, change(node('root'), 1), change(node('leaf', { parent: 'root' as never }), 2)])
    expect([...state.projection.nodes.keys()]).toEqual(['root', 'leaf'])
    expect(state.commits).toBe(2)
  })

  it('does not disturb the state it folded from', () => {
    const first = fold([anchor, change(node('root'), 1)])
    const before = first.projection.nodes.size
    workbenchTreeDefinition.update(
      { key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined, current: new Map(), state: first },
      { event: change(node('second'), 2), role: 'update', location: { kind: 'unresolved' } } as never,
    )
    expect(first.projection.nodes.size).toBe(before)
  })

  it('replays a checkpoint mid-log by adopting it wholesale', () => {
    const seeded = fold([anchor, change(node('root'), 1)])
    const later = fold([anchor, change(node('gone'), 1), event('workbench/snapshot', snapshotOf(seeded.projection))])
    expect([...later.projection.nodes.keys()]).toEqual(['root'])
  })
})

describe('treeRows', () => {
  it('nests by depth, parents before children', () => {
    const projection = fold([
      anchor,
      change(node('root'), 1),
      change(node('a', { parent: 'root' as never }), 2),
      change(node('a1', { parent: 'a' as never }), 3),
    ]).projection
    expect(treeRows(projection).map(row => [row.node.id, row.depth])).toEqual([
      ['root', 0], ['a', 1], ['a1', 2],
    ])
  })

  it('still shows a node whose parent is outside the loaded window', () => {
    const projection: WorkbenchState = {
      ...emptyWorkbenchState(),
      nodes: new Map([['orphan' as never, node('orphan', { parent: 'unloaded' as never })]]),
    }
    expect(treeRows(projection).map(row => row.node.id)).toEqual(['orphan'])
  })

  it('carries each row what it contains and what waits below it, computed by the host code', () => {
    const projection = fold([
      anchor,
      change(node('root'), 1),
      change(node('a', { parent: 'root' as never, body: '正文' }), 2),
    ]).projection
    expect(treeRows(projection).map(row => [row.contains, row.reminders])).toEqual([[1, 0], [0, 0]])
  })
})

describe('treeView', () => {
  it('publishes the rev, the round, and the two drift counters', () => {
    const state = fold([
      anchor,
      change(node('a', { source: 'ai', body: '模型写的一段', fields: { 准备成本: { value: '低' } } }), 1),
      change(node('b', { body: '四个字' }), 2),
    ])
    const view = treeView(state)
    expect([view.rev, view.commits, view.untouchedModelNodes, view.distinctOpenFields]).toEqual([2, 2, 1, 1])
    expect(view.meanBodyChars).toBeCloseTo((6 + 3) / 2)
  })

  it('marks a draft the person has already ruled on', () => {
    const state = fold([
      anchor,
      event('workbench/proposal', { proposalId: 'p1', targetNode: null, title: '候选骨架', createdAt: 0 }, 1),
      event('workbench/verdict', { proposalId: 'p1', outcome: 'accepted', rev: 1 }, 2),
    ])
    expect(treeView(state).proposals).toEqual([
      { proposal: expect.objectContaining({ proposalId: 'p1' }) as unknown, ruled: true },
    ])
  })
})

describe('the view target', () => {
  it('publishes the latest tree and keeps it when a transaction changes nothing', () => {
    const builder = workbenchViewDefinition.create()
    expect(builder.empty).toEqual({ tree: undefined })
    const view = treeView(fold([anchor, change(node('root'), 1)]))
    const node1 = { key: 'k', kind: WORKBENCH_KIND, id: 'tree', target: WORKBENCH_TARGET, data: view }
    expect(builder.replace({ nodes: [node1], timeline: { turnOrder: [], turns: new Map() } }).tree).toBe(view)
    expect(builder.apply({ upserts: [], timeline: { turnOrder: [], turns: new Map() } }).tree).toBe(view)
    const next = treeView(fold([anchor, change(node('other'), 1)]))
    expect(builder.apply({
      upserts: [{ ...node1, data: next }],
      timeline: { turnOrder: [], turns: new Map() },
    }).tree).toBe(next)
  })

  it('publishes nothing before a start has been folded', () => {
    const builder = workbenchViewDefinition.create()
    expect(builder.replace({ nodes: [], timeline: { turnOrder: [], turns: new Map() } })).toEqual({ tree: undefined })
    expect(builder.apply({ upserts: [], timeline: { turnOrder: [], turns: new Map() } })).toEqual({ tree: undefined })
  })
})

describe('buildViewNode', () => {
  it('produces nothing until the checkpoint has been folded', () => {
    const pending = {
      key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined,
      current: new Map(), state: undefined,
    }
    expect(workbenchTreeDefinition.buildViewNode?.(pending)).toBeNull()
  })

  it('carries the tree under this definition target', () => {
    const state = fold([anchor, change(node('root'), 1)])
    const built = workbenchTreeDefinition.buildViewNode?.({
      key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined, current: new Map(), state,
    })
    expect(built?.target).toBe(WORKBENCH_TARGET)
    expect((built?.data as { rev: number }).rev).toBe(1)
  })
})
