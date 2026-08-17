// @vitest-environment jsdom
/**
 * The card and its content bodies: every renderer once, the tag strip and its
 * overflow, the two forms of an argument, anchoring by double-click, descending by
 * double-click, and the auxiliaries.
 *
 * The tab is what these drive, not the components directly. A test that called the
 * store's actions would move state without re-rendering, which is exactly the class of
 * bug this file exists to catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  emptyWorkbenchState, snapshotOf, type AuthoredBody, type BodyPayload, type WorkbenchNode,
} from '@deepseek-ai/dsh-workbench/projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { treeView, workbenchTreeDefinition, WORKBENCH_KIND, type WorkbenchTreeState } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'
import { createWorkbenchStore } from '../src/client/store.ts'
import { WorkbenchTab } from '../src/client/WorkbenchTab.tsx'
import type { EditOutcome, WorkbenchTabProps, WorkbenchTreeView } from '../src/client/contract.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

/** One authored body, with the commit-side values a test does not pin filled in. */
function body(id: string, label: string, payload: BodyPayload, lastRev = 1): AuthoredBody {
  return { id: id as AuthoredBody['id'], label, source: 'human', lastRev, ...payload }
}

/** The brief every card is expected to carry. */
function brief(id: string, duty = '管这块', prose = '正文若干'): AuthoredBody {
  return body(id, '简介', { kind: 'brief', duty, body: prose })
}

/** Build a node with the values a test does not pin already filled. */
function node(id: string, overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  return {
    id: id as WorkbenchNode['id'],
    title: `title-${id}`,
    parent: null,
    maturity: 'thought',
    source: 'human',
    duty: '管这块',
    fields: {},
    bodies: [brief(`${id}-brief`)],
    lastRev: 1,
    createdAt: 0,
    ...overrides,
  }
}

/** A constraint entry nobody has written a duty for, so the band shows the title alone. */
function bareDuty2(id: string, parent: string, title: string): WorkbenchNode {
  const { duty: _duty, ...rest } = node(id, { parent: parent as never, title })
  return rest
}

/** A node with no duty at all, which is what a card looks like before anyone writes one. */
function bareDuty(id: string, prose: string): WorkbenchNode {
  const { duty: _duty, ...rest } = node(id, { body: prose })
  return rest
}

/** One session event as the fold receives it. */
function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

/** One commit of one node. */
function change(target: WorkbenchNode, rev: number, op = 'create'): SessionEvent {
  return event('workbench/node-change', { rev, actor: 'human', op, node: { ...target, lastRev: rev } }, rev)
}

/** Fold a log into the view the tab reads. */
function view(events: readonly SessionEvent[]): WorkbenchTreeView {
  const anchor = event('workbench/snapshot', snapshotOf(emptyWorkbenchState()))
  let state: WorkbenchTreeState = workbenchTreeDefinition.start(
    { key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined, current: new Map(), state: undefined },
    { event: anchor, role: 'start', location: { kind: 'unresolved' } } as never,
    { previous: () => undefined },
  )
  for (const raw of events) {
    state = workbenchTreeDefinition.update(
      { key: 'k', kind: WORKBENCH_KIND, id: 'tree', matches: [], start: undefined, current: new Map(), state },
      { event: raw, role: 'update', location: { kind: 'unresolved' } } as never,
    )
  }
  return treeView(state)
}

/** Every injected callback, stubbed to succeed. */
function callbacks(overrides: Partial<WorkbenchTabProps> = {}) {
  const ok = (): Promise<EditOutcome> => Promise.resolve({ ok: true })
  return {
    createChild: vi.fn(ok),
    updateField: vi.fn(ok),
    promote: vi.fn(ok),
    acceptProposal: vi.fn(ok),
    rejectProposal: vi.fn(ok),
    setTmp: vi.fn(ok),
    commitTmp: vi.fn(ok),
    discardTmp: vi.fn(ok),
    deleteBody: vi.fn(ok),
    openIdeas: vi.fn(ok),
    promoteToConstraint: vi.fn(ok),
    focusNode: vi.fn(ok),
    ...overrides,
  }
}

/** Render the tab over one folded tree. */
function setup(tree: WorkbenchTreeView, overrides: Partial<WorkbenchTabProps> = {}) {
  const snapshot = createSnapshotStore({ views: new Map([['workbench', { tree }]]) })
  const store = createWorkbenchStore().create()
  const injected = callbacks(overrides)
  const props = {
    useSession: bindSnapshotSelector(snapshot),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t,
    // The composer's seat. ui-conversation owns what goes in it; these specs only
    // need the tab to offer the seat, which is what the marker proves.
    renderSlot: (name: string) => <div data-slot={name} />,
    ...injected,
  } as unknown as WorkbenchTabProps
  return { ...injected, snapshot, view: render(<WorkbenchTab {...props} />) }
}

/**
 * Open the tag with exactly this label. Exact rather than partial on purpose: the left
 * column's constraint band reads `⚖ 全局约束` and the card's tag reads `⁄全局约束`, and a
 * loose match collapses the band instead of opening the view.
 */
function openTag(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('the tag strip', () => {
  it('names a body by its own label, and falls back to the kind when it carries none', () => {
    setup(view([change(node('root', {
      bodies: [brief('b-brief'), body('b-flow', '', { kind: 'flow', steps: [] })],
    }), 1)]))
    expect(screen.getByRole('button', { name: '简介' })).toBeDefined()
    expect(screen.getByRole('button', { name: '流程图' })).toBeDefined()
  })

  it('puts everything past the fifth tag behind one control rather than wrapping the row', () => {
    setup(view([change(node('root', {
      bodies: [
        brief('b1'), body('b2', '甲', { kind: 'flow', steps: [] }), body('b3', '乙', { kind: 'flow', steps: [] }),
        body('b4', '丙', { kind: 'flow', steps: [] }), body('b5', '丁', { kind: 'flow', steps: [] }),
        body('b6', '第六个', { kind: 'table', columns: ['x'], rows: [] }),
      ],
    }), 1)]))
    expect(screen.queryByRole('button', { name: '第六个' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: '第六个' }))
    expect(screen.getByRole('table')).toBeDefined()
  })

  it('marks a body older than its newest sibling, and leaves the newest unmarked', () => {
    setup(view([change(node('root', {
      bodies: [brief('b-old', '管这块', '早写的'), body('b-new', '新的', { kind: 'flow', steps: [] }, 4)],
    }), 4)]))
    const stale = screen.getByRole('button', { name: /简介/ })
    expect(stale.textContent).toContain('⚠')
    expect(screen.getByRole('button', { name: /新的/ }).textContent).not.toContain('⚠')
  })
})

describe('the content bodies', () => {
  it('sets the duty apart from the prose, and omits the line when there is no duty', () => {
    // The brief renders the NODE's duty, so a card with none omits the line even
    // though the stored brief still carries a (blank) copy of it.
    setup(view([change(bareDuty('root', '只有正文'), 1)]))
    expect(screen.queryByText(/^职责：/)).toBeNull()
    expect(screen.getByText('只有正文')).toBeDefined()
  })

  it('anchors the conversation to a table row on a double-click, and fills a missing cell', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-table', '预算', {
        kind: 'table',
        columns: ['项目', '金额'],
        rows: [{ rowId: 'r1' as never, cells: ['场地', '0'] }, { rowId: 'r2' as never, cells: ['饮料'] }],
      })],
    }), 1)]))
    openTag('预算')
    fireEvent.doubleClick(screen.getByText('场地').closest('tr') as HTMLElement)
    expect(screen.getByText(zh['talk.anchored'].replace('{what}', '场地'))).toBeDefined()
  })

  it('draws a flow with one box per step, and anchors to the step that was double-clicked', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-flow', '筹备', {
        kind: 'flow',
        steps: [
          { stepId: 's1' as never, text: '定主题' },
          { stepId: 's2' as never, text: '这一步的说明长得根本放不进一个框里去' },
        ],
      })],
    }), 1)]))
    openTag('筹备')
    expect(screen.getByRole('group', { name: '流程图' })).toBeDefined()
    // A long step is elided in the box rather than overflowing it.
    expect(screen.getByText('这一步的说明长得根本放不进一个…')).toBeDefined()
    fireEvent.doubleClick(screen.getByText('定主题').closest('g') as unknown as HTMLElement)
    expect(screen.getByText(zh['talk.anchored'].replace('{what}', '定主题'))).toBeDefined()
  })

  it('drops the anchor when the person leaves the card it pointed into', () => {
    setup(view([
      change(node('root', {
        bodies: [brief('b1'), body('b-flow', '筹备', {
          kind: 'flow', steps: [{ stepId: 's1' as never, text: '定主题' }],
        })],
      }), 1),
      change(node('other', { title: '另一张' }), 2),
    ]))
    openTag('筹备')
    fireEvent.doubleClick(screen.getByText('定主题').closest('g') as unknown as HTMLElement)
    fireEvent.click(screen.getAllByRole('button', { name: /另一张/ })[0] as HTMLElement)
    expect(screen.queryByText(/只针对/)).toBeNull()
  })

  it('clears the anchor when asked, without leaving the card', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-flow', '筹备', {
        kind: 'flow', steps: [{ stepId: 's1' as never, text: '定主题' }],
      })],
    }), 1)]))
    openTag('筹备')
    fireEvent.doubleClick(screen.getByText('定主题').closest('g') as unknown as HTMLElement)
    fireEvent.click(screen.getByLabelText(zh['talk.clearAnchor']))
    expect(screen.queryByText(/只针对/)).toBeNull()
  })

  it('opens an argument as text, because a diagram silently drops what the words carry', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-arg', '要不要请外部讲师', {
        kind: 'argument',
        stance: '不请',
        grounds: [
          { groundId: 'g1' as never, text: '预算只够场地' },
          { groundId: 'g2' as never, text: '外部视角更值钱', opposes: true },
        ],
      })],
    }), 1)]))
    openTag('要不要请外部讲师')
    expect(screen.getByText('支持：预算只够场地')).toBeDefined()
    expect(screen.getByText('反对：外部视角更值钱')).toBeDefined()
    expect(screen.queryByRole('group', { name: '论证图' })).toBeNull()
  })

  it('switches an argument to the diagram on request, and back again', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-arg', '要不要请外部讲师', {
        kind: 'argument',
        stance: '不请',
        grounds: [
          { groundId: 'g1' as never, text: '预算只够场地' },
          { groundId: 'g2' as never, text: '外部视角更值钱', opposes: true },
        ],
      })],
    }), 1)]))
    openTag('要不要请外部讲师')
    fireEvent.click(screen.getByRole('button', { name: zh['card.asDiagram'] }))
    expect(screen.getByRole('group', { name: '论证图' })).toBeDefined()
    // An opposing ground stays marked in the picture, which is all the picture can say about it.
    expect(screen.getByText('反 外部视角更值钱')).toBeDefined()
    fireEvent.doubleClick(screen.getByText('预算只够场地').closest('g') as unknown as HTMLElement)
    expect(screen.getByText(zh['talk.anchored'].replace('{what}', '预算只够场地'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['card.asText'] }))
    expect(screen.getByText('支持：预算只够场地')).toBeDefined()
  })

  it('plots a chart only from a column whose every cell was a bare number', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-table', '报名', {
        kind: 'table',
        columns: ['场次', '人数', '备注'],
        rows: [
          { rowId: 'r1' as never, cells: ['第一场', '12', '满'] },
          { rowId: 'r2' as never, cells: ['第二场', '30', '还有位'] },
        ],
      })],
    }), 1)]))
    openTag('⁄图表')
    const chart = screen.getByRole('group', { name: '图表 人数' })
    expect(chart).toBeDefined()
    expect(screen.getByText('30')).toBeDefined()
  })

  it('descends into a submodule on a double-click in the map', () => {
    setup(view([
      change(node('root'), 1),
      change(node('kid', { parent: 'root' as never, title: '场地', maturity: 'committed' }), 2),
      change(node('grandkid', { parent: 'kid' as never }), 3),
    ]))
    openTag('⁄子模块')
    expect(screen.getByText('内含 1')).toBeDefined()
    // The title shows twice: once as a tree row, once as a card in the map. The map's
    // is the second, and it is the one that descends.
    fireEvent.doubleClick(screen.getAllByText('场地').at(-1) as HTMLElement)
    expect(screen.getByRole('heading', { name: '场地' })).toBeDefined()
  })

  it('names a table row by its id when the row carries no cells to name it by', () => {
    setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-table', '预算', {
        kind: 'table', columns: ['项目'], rows: [{ rowId: 'r-empty' as never, cells: [] }],
      })],
    }), 1)]))
    openTag('预算')
    fireEvent.doubleClick(screen.getByRole('table').querySelector('tbody tr') as HTMLElement)
    expect(screen.getByText(zh['talk.anchored'].replace('{what}', 'r-empty'))).toBeDefined()
  })

  it('carries a submodule’s waiting count into the map, not just into the tree', () => {
    setup(view([
      change(node('root'), 1),
      change(node('kid', { parent: 'root' as never, title: '场地' }), 2),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'kid', title: '草稿', createdAt: 0 }, 3),
    ]))
    openTag('⁄子模块')
    // The tree row bubbles the count up; this asserts the map's own card carries it.
    const mapped = (screen.getAllByText('场地').at(-1) as HTMLElement).parentElement
    expect(mapped?.textContent).toContain('⚑1')
  })

  it('says an idea area is empty once opened but before anything is put in it', () => {
    setup(view([
      change(node('root'), 1),
      change(node('ideas', { parent: 'root' as never, region: 'idea', title: '想法区' }), 2),
    ]))
    openTag('⁄想法')
    expect(screen.getByText(zh['card.viewEmpty'])).toBeDefined()
  })

  it('says the submodule map is empty rather than drawing an empty frame', () => {
    setup(view([
      change(node('root'), 1),
      // The map's own tag exists because a child does; the child then moves away.
      change(node('kid', { parent: 'root' as never }), 2),
      event('workbench/node-change', {
        rev: 3, actor: 'human', op: 'delete', node: { ...node('kid', { parent: 'root' as never }), lastRev: 3 },
      }, 3),
    ]))
    expect(screen.queryByText('⁄子模块')).toBeNull()
  })

  it('draws one edge per open field whose value names another card', () => {
    setup(view([
      change(node('root', { fields: { 依赖: { value: 'other', updatedAt: 0 } as never } }), 1),
      change(node('other', { title: '排期' }), 2),
    ]))
    openTag('⁄关系图')
    expect(screen.getByRole('group', { name: '关系图' })).toBeDefined()
    expect(screen.getByText('依赖')).toBeDefined()
  })

  it('shows the global constraints on the root card, empty until one is promoted', () => {
    setup(view([change(node('root'), 1)]))
    openTag('⁄全局约束')
    expect(screen.getByText(zh['card.viewEmpty'])).toBeDefined()
  })

  it('lists a promoted constraint with the duty it governs by', () => {
    setup(view([
      change(node('root'), 1),
      change(node('G-', { title: '全局约束', parent: 'root' as never }), 2),
      change(node('c1', { parent: 'G-' as never, title: '不超预算', duty: '所有采购走这条' }), 3),
    ]))
    fireEvent.click(screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement)
    openTag('⁄全局约束')
    expect(screen.getByText('所有采购走这条')).toBeDefined()
  })

  it('shows an idea area only once it exists, and marks nothing waiting in it as ordinary structure', () => {
    setup(view([
      change(node('root'), 1),
      change(node('ideas', { parent: 'root' as never, region: 'idea', title: '想法区' }), 2),
      change(node('i1', { parent: 'ideas' as never, title: '也许换个场地', maturity: 'idea' }), 3),
    ]))
    fireEvent.click(screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement)
    openTag('⁄想法')
    // The tag opens the area's contents, not the root that holds them.
    expect(screen.getByText('也许换个场地')).toBeDefined()
    expect(screen.queryByText('想法区')).toBeNull()
    // Neither the area nor what is in it is ever a tree row: unconfirmed thoughts stay
    // off main-region navigation.
    expect(screen.queryByRole('button', { name: /也许换个场地/ })).toBeNull()
  })

  it('renders a body kind this build cannot type as its bare name rather than nothing', () => {
    // The projection is folded from a durable log, so a body written by a later build
    // can reach this switch; the honest answer is to name it, not to render blank.
    setup(view([change(node('root', {
      bodies: [{ id: 'b-x' as never, label: '', source: 'human', lastRev: 1, kind: 'timeline' } as never],
    }), 1)]))
    // Its tag has no name of its own either, so the kind names both.
    expect(screen.getAllByText('timeline')).toHaveLength(2)
  })
})

describe('the auxiliaries', () => {
  it('names the maturity in words on the card, though the tree carries only the mark', () => {
    setup(view([change(node('root', { maturity: 'committed' }), 1)]))
    expect(screen.getByText(zh['maturity.committed'])).toBeDefined()
  })

  it('says which entry a derived card was distilled from', () => {
    setup(view([change(node('root', { source: { sourceId: 'u7' as never } }), 1)]))
    expect(screen.getByText(`${zh['source.derived']} u7`)).toBeDefined()
  })

  it('counts what promotion is still missing, and offers no promotion once committed', () => {
    setup(view([
      change(node('root', { maturity: 'committed' }), 1),
      // A parent with children owes a duty; this one has none, so promotion is blocked.
      change(node('kid', { parent: 'root' as never, bodies: [brief('kid-brief', '')] }), 2),
    ]))
    fireEvent.click(screen.getAllByRole('button', { name: /title-kid/ })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: zh['card.promote'] })).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: zh['card.promote'] })).toHaveProperty('disabled', true)
  })

  it('will not ask again why a card was rejected', () => {
    setup(view([change(node('root', { maturity: 'rejected' }), 1)]))
    expect(screen.getByRole('button', { name: zh['card.reject'] })).toHaveProperty('disabled', true)
  })

  it('abandons the rejection question on Escape', () => {
    const { promote } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['card.reject'] }))
    fireEvent.keyDown(screen.getByLabelText(zh['card.rejectAsk']), { key: 'Escape' })
    expect(screen.queryByLabelText(zh['card.rejectAsk'])).toBeNull()
    expect(promote).not.toHaveBeenCalled()
  })

  it('walks back up through the breadcrumb', () => {
    setup(view([
      change(node('root', { title: '内部分享' }), 1),
      change(node('kid', { parent: 'root' as never, title: '场地' }), 2),
    ]))
    fireEvent.click(screen.getAllByRole('button', { name: /场地/ })[0] as HTMLElement)
    const trail = screen.getByRole('navigation', { name: zh['card.trail'] })
    fireEvent.click(trail.querySelector('button') as HTMLElement)
    expect(screen.getByRole('heading', { name: '内部分享' })).toBeDefined()
  })

  it('opens the idea area from the card, because there is no tree row to open it from', () => {
    const { openIdeas } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' }).at(-1) as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: zh['card.openIdeas'] }))
    expect(openIdeas).toHaveBeenCalledWith('root')
  })

  it('promotes a card into the global-constraint area from the card itself', () => {
    const { promoteToConstraint } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' }).at(-1) as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: zh['card.toConstraint'] }))
    expect(promoteToConstraint).toHaveBeenCalledWith('root')
  })

  it('removes an authored body, but never offers to remove the brief', () => {
    const { deleteBody } = setup(view([change(node('root', {
      bodies: [brief('b1'), body('b-flow', '筹备', { kind: 'flow', steps: [] })],
    }), 1)]))
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' }).at(-1) as HTMLElement)
    expect(screen.queryByRole('menuitem', { name: zh['card.deleteBody'] })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    openTag('筹备')
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' }).at(-1) as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: zh['card.deleteBody'] }))
    expect(deleteBody).toHaveBeenCalledWith('root', 'b-flow')
  })

  it('shows the bodies the edit state would land, not the ones already committed', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/scratch', {
        nodeId: 'root',
        tmp: { at: 0, bodies: [brief('b1'), body('b-new', '模型加的表', { kind: 'table', columns: ['x'], rows: [] })] },
      }, 2),
    ]))
    expect(screen.getByRole('button', { name: '模型加的表' })).toBeDefined()
  })

  it('opens edit state on a committed card, which is where a person’s own edit starts', () => {
    const { setTmp } = setup(view([change(node('root', { maturity: 'committed' }), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['card.edit'] }))
    // An empty draft: what the person types next is what fills it, and the time is
    // the host's to stamp.
    expect(setTmp).toHaveBeenCalledWith('root', {})
  })

  it('offers no second way in while the card is already in edit state', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { at: 0 } }, 2),
    ]))
    expect(screen.queryByRole('button', { name: zh['card.edit'] })).toBeNull()
  })

  it('edits the brief in place while the card is in edit state', () => {
    const { setTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { at: 0 } }, 2),
    ]))
    const duty = screen.getByLabelText(zh['card.duty'])
    fireEvent.change(duty, { target: { value: '管场地和排期' } })
    // Typing writes nothing: a field whose value comes back from the host drops
    // characters typed faster than the round trip.
    expect(setTmp).not.toHaveBeenCalled()
    expect(duty).toHaveProperty('value', '管场地和排期')
    // Leaving the field autosaves it, so a reload does not lose the work.
    fireEvent.blur(duty)
    expect(setTmp).toHaveBeenCalledWith('root', expect.objectContaining({ duty: '管场地和排期' }))
    const body = screen.getByLabelText(zh['card.body'])
    fireEvent.change(body, { target: { value: '换了一段' } })
    fireEvent.blur(body)
    expect(setTmp).toHaveBeenCalledWith('root', expect.objectContaining({ body: '换了一段' }))
  })

  it('leaves a table alone in edit state: only the brief is typed into here', () => {
    setup(view([
      change(node('root', {
        bodies: [brief('b1'), body('b-table', '预算', { kind: 'table', columns: ['项目'], rows: [] })],
      }), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { at: 0 } }, 2),
    ]))
    openTag('预算')
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.queryByLabelText(zh['card.duty'])).toBeNull()
  })
})

describe('the left column', () => {
  it('lists every card exactly once, indented by where it hangs', () => {
    // The banded version put each card on screen two or three times — pinned,
    // and again in the full tree — which is most of what made the column noisy.
    setup(view([
      change(node('root', { title: '沙龙' }), 1),
      change(node('kid', { parent: 'root' as never, title: '场地' }), 2),
    ]))
    expect(screen.getAllByRole('button', { name: /沙龙/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /场地/ })).toHaveLength(1)
  })

  it('says so before any card exists, and still offers the one action', () => {
    setup(view([]))
    expect(screen.getByText(zh['map.empty'])).toBeDefined()
    expect(screen.getByRole('button', { name: zh['map.add'] })).toBeDefined()
    expect(screen.getByText(zh['empty.title'])).toBeDefined()
  })

  it('puts the first card of a session at the root, because there is nothing to hang it under', () => {
    const { createChild } = setup(view([]))
    fireEvent.click(screen.getByRole('button', { name: zh['map.add'] }))
    const input = screen.getByLabelText(zh['map.addAsk'])
    fireEvent.change(input, { target: { value: '内部分享' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createChild).toHaveBeenCalledWith(null, '内部分享')
  })

  it('falls back to the first card when the one it was on is gone from the window', () => {
    // The person's selection is browser state, while the tree is the log's; a fold that
    // drops the selected card must not leave the middle column rendering a missing node.
    const bench = setup(view([change(node('a', { title: '甲' }), 1), change(node('b', { title: '乙' }), 2)]))
    fireEvent.click(screen.getAllByRole('button', { name: /乙/ })[0] as HTMLElement)
    expect(screen.getByRole('heading', { name: '乙' })).toBeDefined()
    act(() => {
      bench.snapshot.update((state) => {
        state.views = new Map([['workbench', { tree: view([change(node('a', { title: '甲' }), 1)]) }]])
      })
    })
    expect(screen.getByText(zh['empty.title'])).toBeDefined()
  })

  it('selects from the full tree, not only from the pinned band', () => {
    setup(view([
      change(node('a'), 1), change(node('b'), 2), change(node('c'), 3),
      change(node('d'), 4), change(node('e', { title: '第五张' }), 5),
    ]))
    // Five cards, four pinned: the fifth exists only as an ordinary row.
    const rows = screen.getAllByRole('button', { name: /title-a/ })
    expect(rows).toHaveLength(1)
    fireEvent.click(rows[0] as HTMLElement)
    expect(screen.getByRole('heading', { name: 'title-a' })).toBeDefined()
  })

  it('marks a constraint in place rather than giving it a band of its own', () => {
    setup(view([
      change(node('root'), 1),
      change(node('G-', { title: '全局约束', parent: 'root' as never }), 2),
      change(bareDuty2('c1', 'G-', '不超预算'), 3),
    ]))
    const row = screen.getAllByRole('button', { name: /不超预算/ })[0] as HTMLElement
    expect(row.textContent).toContain('⚖')
    fireEvent.click(row)
    expect(screen.getByRole('heading', { name: '不超预算' })).toBeDefined()
    // The card's own constraints view still lists it, with no duty rather than a gap.
    fireEvent.click(screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement)
    openTag('⁄全局约束')
    expect(screen.getAllByText('不超预算').length).toBeGreaterThan(1)
  })

  it('shows a row’s waiting count in place of its child count, because the wait is the newer fact', () => {
    setup(view([
      change(node('root'), 1),
      change(node('kid', { parent: 'root' as never }), 2),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'kid', title: '一份草稿', createdAt: 0 }, 3),
    ]))
    const row = screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement
    expect(row.textContent).toContain('⚑1')
    expect(row.textContent).not.toContain('⚑1 1')
  })
})

describe('the conversation column', () => {
  it('shows an opening line at the root, before any card was focused', () => {
    setup(view([
      event('workbench/utterance', { entryId: 'u1', text: '就是想做个内部分享', rev: 0, createdAt: 0 }, 1),
      change(node('root'), 2),
    ]))
    // The card is focused now, so the module-less opening line belongs to the root view.
    expect(screen.queryByText('就是想做个内部分享')).toBeNull()
  })

  it('says a draft is waiting, then that it was ruled on', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '候选骨架', createdAt: 0 }, 2),
    ]))
    expect(screen.getByText(zh['talk.draftWaiting'])).toBeDefined()
    cleanup()
    setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '候选骨架', createdAt: 0 }, 2),
      event('workbench/verdict', { proposalId: 'p1', outcome: 'accepted', rev: 1 }, 3),
    ]))
    expect(screen.getByText(zh['talk.draftRuled'])).toBeDefined()
  })
})

describe('ruling on a draft', () => {
  it('accepts it as proposed', () => {
    const { acceptProposal } = setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '候选骨架', createdAt: 0 }, 2),
    ]))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(acceptProposal).toHaveBeenCalledWith('p1', [])
  })

  it('keeps the reason when it is turned down', () => {
    const { rejectProposal } = setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '候选骨架', createdAt: 0 }, 2),
    ]))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.discard'] }))
    const input = screen.getByLabelText(zh['talk.discardAsk'])
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText(zh['talk.discardAsk'])).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['proposal.discard'] }))
    const reopened = screen.getByLabelText(zh['talk.discardAsk'])
    fireEvent.change(reopened, { target: { value: '这不是我要的层级' } })
    fireEvent.keyDown(reopened, { key: 'Enter' })
    expect(rejectProposal).toHaveBeenCalledWith('p1', '这不是我要的层级')
  })

  it('offers no ruling on a draft already ruled on', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '候选骨架', createdAt: 0 }, 2),
      event('workbench/verdict', { proposalId: 'p1', outcome: 'rejected', rev: 1, note: '不要' }, 3),
    ]))
    expect(screen.queryByRole('button', { name: zh['proposal.accept'] })).toBeNull()
  })
})

describe('where the person is', () => {
  it('tells the host which card they are on, so what they say next is stamped with it', () => {
    const { focusNode } = setup(view([change(node('root'), 1)]))
    expect(focusNode).toHaveBeenCalledWith('root')
  })

  it('does not repeat itself when the tree changes but the card does not', () => {
    const { focusNode } = setup(view([
      change(node('root'), 1),
      event('workbench/focus', { nodeId: 'root' }, 2),
    ]))
    expect(focusNode).not.toHaveBeenCalled()
  })

  it('clears a refusal once the next action succeeds', async () => {
    const promote = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'GATE_MISSING_DUTY: 说不出职责' })
      .mockResolvedValueOnce({ ok: true })
    setup(view([change(node('root'), 1)]), { promote })
    fireEvent.click(screen.getByRole('button', { name: zh['card.promote'] }))
    expect(await screen.findByText(/GATE_MISSING_DUTY/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['card.promote'] }))
    await vi.waitFor(() => { expect(screen.queryByText(/GATE_MISSING_DUTY/)).toBeNull() })
  })
})
