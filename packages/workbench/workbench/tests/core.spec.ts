import { describe, expect, it } from 'vitest'
import { BodyId, BodyObjectId, NodeId, ProposalId, SourceId } from '../src/brand.ts'
import {
  ancestors, children, citedSourceIds, constraints, dependencySet, expand, invalidate, isConstraint,
  isRegisteredField, nextRev, renderNodeDuty, renderNodeFully, renderSkeletonIndex, requireNode,
  shapeCandidates, structuralHealth, treeIndexSet,
} from '../src/core.ts'
import { GLOBAL_CONSTRAINT_ROOT_ID, SKELETON_ITEM_ID } from '../src/model.ts'
import { graphOf, node, utterance } from './fixtures.ts'

describe('branded ids', () => {
  it('carries the string through unchanged', () => {
    expect(NodeId('n1')).toBe('n1')
    expect(SourceId('s1')).toBe('s1')
    expect(ProposalId('p1')).toBe('p1')
    expect(BodyId('b1')).toBe('b1')
    expect(BodyObjectId('o1')).toBe('o1')
  })
})

describe('requireNode', () => {
  it('refuses an id the graph does not carry rather than answering empty', () => {
    expect(() => requireNode(graphOf([]), NodeId('ghost')))
      .toThrow('workbench: no node ghost; call workbench_read_nodes with no nodeId to see the tree index')
  })

  it('resolves a present node', () => {
    const only = node('n1')
    expect(requireNode(graphOf([only]), only.id)).toBe(only)
  })
})

describe('children', () => {
  it('lists only direct children', () => {
    const graph = graphOf([
      node('root'),
      node('a', { parent: NodeId('root') }),
      node('b', { parent: NodeId('root') }),
      node('a1', { parent: NodeId('a') }),
    ])
    expect(children(graph, NodeId('root')).map(child => child.id)).toEqual(['a', 'b'])
  })
})

describe('ancestors', () => {
  it('is empty at a root', () => {
    expect(ancestors(graphOf([node('root')]), NodeId('root'))).toEqual([])
  })

  it('runs root first', () => {
    const graph = graphOf([
      node('root'),
      node('mid', { parent: NodeId('root') }),
      node('leaf', { parent: NodeId('mid') }),
    ])
    expect(ancestors(graph, NodeId('leaf')).map(item => item.id)).toEqual(['root', 'mid'])
  })

  it('names a parent cycle instead of walking forever', () => {
    const graph = graphOf([
      node('a', { parent: NodeId('b') }),
      node('b', { parent: NodeId('a') }),
    ])
    expect(() => ancestors(graph, NodeId('a'))).toThrow('workbench: parent cycle at a')
  })

  it('refuses a dangling parent', () => {
    expect(() => ancestors(graphOf([node('a', { parent: NodeId('gone') })]), NodeId('a')))
      .toThrow('workbench: no node gone')
  })
})

describe('constraints', () => {
  it('is empty while nothing has been promoted', () => {
    expect(constraints(graphOf([node('root'), node('a', { parent: NodeId('root') })]))).toEqual([])
  })

  it('collects the whole area, parents before children, excluding the root', () => {
    const graph = graphOf([
      node('G-'),
      node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID }),
      node('c1a', { parent: NodeId('c1') }),
      node('outside'),
    ])
    expect(constraints(graph).map(item => item.id)).toEqual(['c1', 'c1a'])
  })
})

describe('isConstraint', () => {
  it('is false for an absent node, a node outside the area, and the area root itself', () => {
    const graph = graphOf([node('G-'), node('outside'), node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID })])
    expect(isConstraint(graph, NodeId('ghost'))).toBe(false)
    expect(isConstraint(graph, NodeId('outside'))).toBe(false)
    expect(isConstraint(graph, GLOBAL_CONSTRAINT_ROOT_ID)).toBe(false)
    expect(isConstraint(graph, NodeId('c1'))).toBe(true)
  })
})

describe('dependencySet', () => {
  it('injects all five kinds in a fixed order', () => {
    const graph = graphOf([
      node('root', { duty: 'root duty', body: 'root body' }),
      node('G-'),
      node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID, title: '讲者准备成本必须低' }),
      node('leaf', {
        parent: NodeId('root'),
        body: 'leaf body',
        lastRev: 4,
        fields: { 准备成本: { value: '高', sourceId: SourceId('s1') } },
      }),
    ], [utterance('s1', '讲者不该为了讲这个准备一整周', 3)])

    const items = dependencySet(graph, NodeId('leaf'))
    expect(items.map(item => item.kind)).toEqual(['self', 'ancestor', 'constraint', 'source', 'skeleton'])
    expect(items.map(item => item.id)).toEqual(['leaf', 'root', 'c1', 's1', SKELETON_ITEM_ID])
    // Each item reports the rev it was last true at: the node's own write, the
    // ancestor's, the immutable entry's, and the tree-wide rev for the index.
    expect(items.map(item => item.rev)).toEqual([4, 1, 1, 3, 7])
  })

  it('carries no source item when nothing is cited', () => {
    const graph = graphOf([node('solo', { body: 'text' })])
    expect(dependencySet(graph, NodeId('solo')).map(item => item.kind)).toEqual(['self', 'skeleton'])
  })

  it('cites the entry a distilled node was drawn from', () => {
    const graph = graphOf(
      [node('n1', { source: { sourceId: SourceId('s9') } })],
      [utterance('s9', '原话')],
    )
    expect(dependencySet(graph, NodeId('n1')).find(item => item.kind === 'source')?.content).toBe('原话')
  })

  it('refuses a citation the first-hand layer cannot answer', () => {
    const graph = graphOf([node('n1', { fields: { f: { value: 'v', sourceId: SourceId('gone') } } })])
    expect(() => dependencySet(graph, NodeId('n1')))
      .toThrow('workbench: node n1 cites missing first-hand entry gone')
  })
})

describe('treeIndexSet', () => {
  it('answers an empty tree with an empty index rather than nothing to call', () => {
    const items = treeIndexSet(graphOf([]))
    expect(items.map(item => item.kind)).toEqual(['skeleton'])
    expect(items[0]?.content).toBe('')
  })

  it('carries the constraint area and the index, with no node named', () => {
    const graph = graphOf([
      node('G-'),
      node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID, title: '讲者的准备成本必须低' }),
      node('m1', { title: '门票' }),
    ])
    expect(treeIndexSet(graph).map(item => [item.kind, item.id])).toEqual([
      ['constraint', 'c1'],
      ['skeleton', SKELETON_ITEM_ID],
    ])
    expect(treeIndexSet(graph).at(-1)?.content).toContain('门票')
  })
})

describe('citedSourceIds', () => {
  it('deduplicates across the node source and its fields', () => {
    const cited = citedSourceIds(node('n1', {
      source: { sourceId: SourceId('s1') },
      fields: { a: { value: 'v', sourceId: SourceId('s1') }, b: { value: 'v', sourceId: SourceId('s2') }, c: { value: 'v' } },
    }))
    expect(cited).toEqual(['s1', 's2'])
  })
})

describe('expand', () => {
  it('states that the set is complete and unedited, then the items under their headings', () => {
    const text = expand(dependencySet(graphOf([node('n1', { body: 'b' })]), NodeId('n1')))
    expect(text).toContain('机械展开，未经取舍')
    expect(text).toContain('要别的节点就再调 workbench_read_nodes')
    expect(text).toContain('【自己】n1 rev=1')
    expect(text).toContain('【骨架】skeleton rev=7')
  })
})

describe('invalidate', () => {
  it('puts the direct children in doubt', () => {
    const graph = graphOf([
      node('root'),
      node('a', { parent: NodeId('root') }),
      node('b', { parent: NodeId('root') }),
      node('a1', { parent: NodeId('a') }),
    ])
    expect(invalidate(graph, NodeId('root'))).toEqual(['a', 'b'])
  })

  it('does NOT put unrelated nodes in doubt when a title changes', () => {
    // Every dependency set carries the tree index, so treating the index as an
    // edge would return the whole tree here and leave nothing to schedule.
    const graph = graphOf([node('a'), node('b'), node('c')])
    expect(invalidate(graph, NodeId('a'))).toEqual([])
  })

  it('broadcasts a constraint change to everything outside the area', () => {
    const graph = graphOf([
      node('G-'),
      node('c1', { parent: GLOBAL_CONSTRAINT_ROOT_ID }),
      node('c2', { parent: GLOBAL_CONSTRAINT_ROOT_ID }),
      node('m1'),
      node('m2'),
    ])
    expect(invalidate(graph, NodeId('c1'))).toEqual(['m1', 'm2'])
  })
})

describe('shapeCandidates', () => {
  it('draws a node with children as a child list', () => {
    const graph = graphOf([node('root', { body: 'body too' }), node('a', { parent: NodeId('root') })])
    expect(shapeCandidates(graph, NodeId('root'))).toEqual(['child-list'])
  })

  it('draws a childless node with a body as a paragraph card', () => {
    expect(shapeCandidates(graphOf([node('n1', { body: 'text' })]), NodeId('n1'))).toEqual(['paragraph-card'])
  })

  it('offers no shape for a node carrying only a title', () => {
    expect(shapeCandidates(graphOf([node('n1')]), NodeId('n1'))).toEqual([])
    expect(shapeCandidates(graphOf([node('n2', { body: '' })]), NodeId('n2'))).toEqual([])
  })
})

describe('isRegisteredField', () => {
  it('accepts the skeleton names by construction', () => {
    expect(isRegisteredField(graphOf([]).meta, 'body')).toBe(true)
  })

  it('rejects a newly opened field while the dictionary is empty', () => {
    expect(isRegisteredField(graphOf([]).meta, '准备成本')).toBe(false)
  })

  it('accepts a name the dictionary registered', () => {
    const meta = graphOf([], [], { 准备成本: { semantic: '讲者要付的准备时间', shape: '低|中|高' } }).meta
    expect(isRegisteredField(meta, '准备成本')).toBe(true)
  })
})

describe('nextRev', () => {
  it('steps once per commit', () => {
    expect(nextRev(graphOf([]).meta)).toBe(8)
  })
})

describe('structuralHealth', () => {
  it('reports zeros for an empty tree', () => {
    expect(structuralHealth([])).toEqual({ nodeCount: 0, meanBodyChars: 0, distinctOpenFields: 0 })
  })

  it('counts a node with no body as no prose rather than skipping it', () => {
    expect(structuralHealth([node('a', { body: '1234' }), node('b')]))
      .toEqual({ nodeCount: 2, meanBodyChars: 2, distinctOpenFields: 0 })
  })

  it('averages the prose and counts the distinct field vocabulary', () => {
    expect(structuralHealth([
      node('a', { body: '1234', fields: { 准备成本: { value: '低' } } }),
      node('b', { body: '12', fields: { 准备成本: { value: '高' }, 场地: { value: '会议室' } } }),
    ])).toEqual({ nodeCount: 2, meanBodyChars: 3, distinctOpenFields: 2 })
  })

  it('shows prose growing while the vocabulary stands still — the silent failure it exists for', () => {
    const before = structuralHealth([node('a', { body: '短', fields: { 准备成本: { value: '低' } } })])
    const after = structuralHealth([node('a', { body: '写了很长一段散文进正文', fields: { 准备成本: { value: '低' } } })])
    expect(after.meanBodyChars).toBeGreaterThan(before.meanBodyChars)
    expect(after.distinctOpenFields).toBe(before.distinctOpenFields)
  })
})

describe('rendering', () => {
  it('renders every field of a node, with each citation', () => {
    const text = renderNodeFully(node('n1', {
      title: '门票',
      maturity: 'committed',
      duty: '管住入场',
      body: '正文若干',
      fields: { 准备成本: { value: '低', sourceId: SourceId('s1') }, 场地: { value: '会议室' } },
    }))
    expect(text).toBe([
      '标题：门票',
      '成熟度：已承诺',
      '来源：人',
      '职责：管住入场',
      '正文：正文若干',
      '准备成本：低（依据 s1）',
      '场地：会议室',
    ].join('\n'))
  })

  it('renders the model and the first-hand layer as the source', () => {
    expect(renderNodeFully(node('n1', { source: 'ai' }))).toContain('来源：AI')
    expect(renderNodeFully(node('n2', { source: { sourceId: SourceId('s1') } }))).toContain('来源：依据 s1')
  })

  it('gives an ancestor only its title, duty, and body', () => {
    expect(renderNodeDuty(node('n1', { duty: 'd', body: 'b', fields: { x: { value: 'v' } } })))
      .toBe('标题：title-n1\n职责：d\n正文：b')
    expect(renderNodeDuty(node('n2'))).toBe('标题：title-n2')
  })

  it('indexes the tree one node per line', () => {
    const graph = graphOf([node('a', { title: '甲', maturity: 'idea' }), node('b', { title: '乙', maturity: 'rejected' })])
    expect(renderSkeletonIndex(graph, null)).toBe('a 甲 想法\nb 乙 已否决')
  })
})
