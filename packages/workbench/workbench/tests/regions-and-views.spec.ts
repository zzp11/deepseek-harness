/**
 * The idea region's visibility rule, the reminder count that bubbles, and the
 * views computed rather than stored.
 */
import { describe, expect, it } from 'vitest'
import { BodyId, BodyObjectId, NodeId, ProposalId } from '../src/brand.ts'
import {
  chartOf, dependencySet, derivedViews, descendants, ideaArea, ideaRoots, numericColumns, pendingProposals,
  relationEdges, renderSkeletonIndex, staleBodies, submoduleMap, visibleFrom, visibleNodes, workingSet,
} from '../src/core.ts'
import { gateRequiredBody } from '../src/gates.ts'
import type { AuthoredBody, PendingProposal, TableRow } from '../src/model.ts'
import { graphOf, node } from './fixtures.ts'

/** A table body, ids filled in from the label so a test reads by name. */
function table(label: string, columns: readonly string[], cells: readonly (readonly string[])[]): AuthoredBody {
  const rows: TableRow[] = cells.map((row, index) => ({ rowId: BodyObjectId(`${label}-r${String(index)}`), cells: row }))
  return { id: BodyId(label), label, source: 'ai', lastRev: 1, kind: 'table', columns, rows }
}

/** A brief body at a given rev. */
function brief(label: string, lastRev: number): AuthoredBody {
  return { id: BodyId(label), label, source: 'human', lastRev, kind: 'brief', duty: '管这块', body: '正文' }
}

/** An unruled or ruled proposal record, as the reminder count reads it. */
function pending(id: string, targetNode: string | null, ruled = false): PendingProposal {
  return {
    proposal: { proposalId: ProposalId(id), targetNode: targetNode === null ? null : NodeId(targetNode) },
    ...ruled ? { verdict: { outcome: 'accepted' } } : {},
  }
}

/**
 * A module `m` with a submodule `sub`, an idea root `i` under `m`, and an idea card
 * `idea` under that root.
 */
const nested = graphOf([
  node('m'),
  node('sub', { parent: NodeId('m') }),
  node('i', { parent: NodeId('m'), region: 'idea' }),
  node('idea', { parent: NodeId('i') }),
])

describe('idea-region membership', () => {
  it('names the roots enclosing a node, and none for the main region', () => {
    expect(ideaRoots(nested, NodeId('idea'))).toEqual([NodeId('i')])
    expect(ideaRoots(nested, NodeId('i'))).toEqual([NodeId('i')])
    expect(ideaRoots(nested, NodeId('sub'))).toEqual([])
  })
})

describe('a node the graph does not carry', () => {
  it('encloses no idea area rather than refusing, because a partial window is legal', () => {
    expect(ideaRoots(nested, NodeId('never-arrived'))).toEqual([])
  })

  it('answers "not known to be inside" when the walk up hits a parent the window lacks', () => {
    // The browser folds a window of the log, so a card can legally arrive before the
    // parent it names. Membership answers with what it can reach; it does not refuse.
    const broken = graphOf([node('orphan', { parent: NodeId('never-arrived') })])
    expect(ideaRoots(broken, NodeId('orphan'))).toEqual([])
  })
})

describe('visibility', () => {
  it('hides an idea from the module it hangs under', () => {
    expect(visibleFrom(nested, NodeId('m'), NodeId('idea'))).toBe(false)
  })

  it('hides it from that module’s own submodule, which is the case people expect to differ', () => {
    expect(visibleFrom(nested, NodeId('sub'), NodeId('idea'))).toBe(false)
  })

  it('hides it at cold start, when nothing is focused', () => {
    expect(visibleFrom(nested, null, NodeId('idea'))).toBe(false)
  })

  it('shows it from inside the same idea area', () => {
    expect(visibleFrom(nested, NodeId('idea'), NodeId('idea'))).toBe(true)
    expect(visibleFrom(nested, NodeId('idea'), NodeId('i'))).toBe(true)
  })

  it('always shows the main region, from anywhere', () => {
    expect(visibleFrom(nested, NodeId('idea'), NodeId('sub'))).toBe(true)
    expect(visibleNodes(nested, null).map(item => item.id)).toEqual([NodeId('m'), NodeId('sub')])
  })
})

describe('the model never sees an idea', () => {
  it('leaves it out of the tree index, which every dependency set carries', () => {
    expect(renderSkeletonIndex(nested, null)).not.toContain('idea')
    expect(renderSkeletonIndex(nested, NodeId('idea'))).toContain('idea')
  })

  it('leaves it out of a sibling’s dependency set', () => {
    const rendered = dependencySet(nested, NodeId('sub')).map(item => item.content).join('\n')
    expect(rendered).not.toContain('title-idea')
  })
})

describe('reminders that bubble', () => {
  it('counts unruled proposals at or below a node', () => {
    const proposals = [pending('p1', 'idea'), pending('p2', 'sub'), pending('p3', 'sub', true)]
    expect(pendingProposals(nested, proposals, NodeId('m'))).toBe(2)
    expect(pendingProposals(nested, proposals, NodeId('sub'))).toBe(1)
    expect(pendingProposals(nested, proposals, NodeId('i'))).toBe(1)
  })

  it('ignores a proposal that targets no node at all', () => {
    expect(pendingProposals(nested, [pending('p1', null)], NodeId('m'))).toBe(0)
  })
})

describe('descendants', () => {
  it('walks below a node, excluding it', () => {
    expect(descendants(nested, NodeId('m')).map(item => item.id))
      .toEqual([NodeId('sub'), NodeId('i'), NodeId('idea')])
  })
})

describe('workingSet', () => {
  it('pins the most recently committed nodes, newest first, capped', () => {
    const graph = graphOf([
      node('a', { lastRev: 3 }), node('b', { lastRev: 9 }), node('c', { lastRev: 5 }),
    ])
    expect(workingSet(graph, 2).map(item => item.id)).toEqual([NodeId('b'), NodeId('c')])
  })

  it('leaves idea cards out, because the left column is main-region navigation', () => {
    expect(workingSet(nested, 10).map(item => item.id)).toEqual([NodeId('m'), NodeId('sub')])
  })
})

describe('staleBodies', () => {
  it('names every body older than the newest on the same card', () => {
    const card = node('n1', { bodies: [brief('b1', 1), brief('b2', 4), brief('b3', 4)] })
    expect(staleBodies(card)).toEqual([BodyId('b1')])
  })

  it('names none when a card has one body or none', () => {
    expect(staleBodies(node('n1', { bodies: [brief('only', 2)] }))).toEqual([])
    expect(staleBodies(node('n1'))).toEqual([])
  })
})

describe('the numeric-column criterion', () => {
  it('accepts a bare integer, a decimal, and a negative', () => {
    expect(numericColumns(table('t', ['名', '值'], [['甲', '3'], ['乙', '0.5'], ['丙', '-2']]))).toEqual([1])
  })

  it('refuses a unit suffix, a currency mark, a hedge, and a trailing unit', () => {
    for (const cell of ['8万', '$0.4', '约 200', '100元']) {
      expect(numericColumns(table('t', ['名', '值'], [['甲', '3'], ['乙', cell]]))).toEqual([])
    }
  })

  it('refuses a column with any empty cell rather than treating it as zero', () => {
    expect(numericColumns(table('t', ['名', '值'], [['甲', '3'], ['乙', '']]))).toEqual([])
  })

  it('refuses a column a row does not reach at all', () => {
    expect(numericColumns(table('t', ['名', '值'], [['甲', '3'], ['乙']]))).toEqual([])
  })

  it('answers nothing for a table with no rows and for a body that is not a table', () => {
    expect(numericColumns(table('t', ['名', '值'], []))).toEqual([])
    expect(numericColumns(brief('b', 1))).toEqual([])
  })
})

describe('chartOf', () => {
  it('plots the first numeric column after the labels', () => {
    const body = table('cost', ['做法', '准备成本', '备注'], [['正式分享', '8', 'x'], ['随便讲', '2', 'y']])
    expect(chartOf(body)).toEqual({
      kind: 'chart',
      source: BodyId('cost'),
      axis: '准备成本',
      points: [{ label: '正式分享', value: 8 }, { label: '随便讲', value: 2 }],
    })
  })

  it('answers null when no column qualifies, so the chart never becomes available', () => {
    expect(chartOf(table('t', ['做法', '准备成本'], [['甲', '低'], ['乙', '高']]))).toBeNull()
    expect(chartOf(brief('b', 1))).toBeNull()
  })

  it('does not plot the label column even when it is numeric', () => {
    expect(chartOf(table('t', ['年', '说明'], [['2026', '甲']]))).toBeNull()
  })
})

describe('derived views', () => {
  it('offers the submodule map without counting the idea root as a submodule', () => {
    const proposals = [pending('p1', 'sub')]
    expect(submoduleMap(nested, proposals, NodeId('m'))).toEqual([
      { nodeId: NodeId('sub'), title: 'title-sub', maturity: 'thought', contains: 0, reminders: 1 },
    ])
  })

  it('reaches the idea area through the card’s idea root', () => {
    expect(ideaArea(nested, [], NodeId('m')).map(item => item.nodeId)).toEqual([NodeId('idea')])
    expect(ideaArea(nested, [], NodeId('sub'))).toEqual([])
  })

  it('offers the relation view when an edge exists', () => {
    const linked = graphOf([node('a', { fields: { 依赖: { value: 'b' } } }), node('b')])
    expect(derivedViews(linked, [], NodeId('a')).map(view => view.kind)).toContain('relation')
  })

  it('draws a relation edge only when the named node exists', () => {
    const graph = graphOf([
      node('a', { fields: { 依赖: { value: 'b' }, 悬空: { value: 'ghost' } } }),
      node('b'),
    ])
    expect(relationEdges(graph, NodeId('a'))).toEqual([{ from: NodeId('a'), to: NodeId('b'), via: '依赖' }])
  })

  it('omits a view that would draw nothing — including an idea area nobody has opened', () => {
    expect(derivedViews(nested, [], NodeId('sub'))).toEqual([])
    expect(derivedViews(nested, [], NodeId('m')).map(view => view.kind))
      .toEqual(['submodule-map', 'constraints', 'ideas'])
  })

  it('offers the chart exactly when a card owns a plottable table', () => {
    const plottable = graphOf([node('n1', {
      parent: null,
      bodies: [table('cost', ['做法', '成本'], [['甲', '8']])],
    })])
    expect(derivedViews(plottable, [], NodeId('n1')).map(view => view.kind)).toContain('chart')
  })
})

describe('the required body', () => {
  it('refuses a card whose bodies exist but no longer include the brief', () => {
    const stripped = node('n1', { bodies: [table('t', ['a'], [['1']])] })
    expect(gateRequiredBody(stripped).map(finding => finding.code)).toEqual(['GATE_REQUIRED_BODY'])
    expect(gateRequiredBody(stripped)[0]?.blocking).toBe(true)
  })

  it('passes a card that keeps it, and one whose bodies were never set up', () => {
    expect(gateRequiredBody(node('n1', { bodies: [brief('b', 1)] }))).toEqual([])
    expect(gateRequiredBody(node('n1'))).toEqual([])
  })

  it('refuses an emptied card, which is how deleting down to the last body would strip it', () => {
    expect(gateRequiredBody(node('n1', { bodies: [] })).map(finding => finding.code))
      .toEqual(['GATE_REQUIRED_BODY'])
  })
})
