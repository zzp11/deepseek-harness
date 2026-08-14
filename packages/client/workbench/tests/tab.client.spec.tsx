// @vitest-environment jsdom
/**
 * The 工作台 tab over a folded tree: the first screen, the three columns, a card in
 * each of its two states, the tag strip and its overflow, questions asked in place
 * rather than in a dialog, and the meter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  emptyWorkbenchState, snapshotOf, type AuthoredBody, type WorkbenchNode,
} from '@deepseek-ai/dsh-workbench/projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { treeView, workbenchTreeDefinition, WORKBENCH_KIND, type WorkbenchTreeState } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'
import { createWorkbenchStore } from '../src/client/store.ts'
import { WorkbenchTab } from '../src/client/WorkbenchTab.tsx'
import type { EditOutcome, WorkbenchTabProps, WorkbenchTreeView } from '../src/client/contract.ts'

afterEach(cleanup)

/** The framework-injected t seat, over the zh dictionaries (the default locale). */
const t = makeTranslate(zh, commonZh)

/** A brief body, which every card is expected to carry. */
function brief(id: string, overrides: Partial<Extract<AuthoredBody, { kind: 'brief' }>> = {}): AuthoredBody {
  return {
    id: id as AuthoredBody['id'],
    label: '简介',
    source: 'human',
    lastRev: 1,
    kind: 'brief',
    duty: '管这块',
    body: '正文若干',
    ...overrides,
  }
}

/** A node with no content body at all — a card nobody has started. */
function bareNode(id: string, overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  const { bodies: _bodies, ...rest } = node(id, overrides)
  return rest
}

/** Build a node with the values a test does not pin already filled. */
function node(id: string, overrides: Partial<WorkbenchNode> = {}): WorkbenchNode {
  return {
    id: id as WorkbenchNode['id'],
    title: `title-${id}`,
    parent: null,
    maturity: 'thought',
    source: 'human',
    fields: {},
    bodies: [brief(`${id}-brief`)],
    lastRev: 1,
    createdAt: 0,
    ...overrides,
  }
}

/** One session event as the fold receives it. */
function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
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

/** One commit of one node. */
function change(target: WorkbenchNode, rev: number, op = 'create'): SessionEvent {
  return event('workbench/node-change', { rev, actor: 'human', op, node: { ...target, lastRev: rev } }, rev)
}

/** Every injected callback, stubbed to succeed, so a test overrides only what it asserts. */
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
    focusNode: vi.fn(ok),
    ...overrides,
  }
}

/** Render the tab over one folded tree. */
function setup(tree: WorkbenchTreeView | undefined, overrides: Partial<WorkbenchTabProps> = {}) {
  const snapshot = createSnapshotStore({ views: new Map(tree === undefined ? [] : [['workbench', { tree }]]) })
  const useSession = bindSnapshotSelector(snapshot)
  const store = createWorkbenchStore().create()
  const injected = callbacks(overrides)
  const props = {
    useSession,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t,
    ...injected,
  } as unknown as WorkbenchTabProps
  return { ...injected, actions: store.actions, view: render(<WorkbenchTab {...props} />) }
}

describe('the first screen', () => {
  it('asks for one sentence when nothing has happened yet', () => {
    setup(undefined)
    expect(screen.getByText(zh['empty.title'])).toBeDefined()
    expect(screen.getByText(zh['meter.rev'].replace('{n}', '0'))).toBeDefined()
  })
})

describe('the left column', () => {
  it('pins the constraints, the working set, and the rest, each with its count', () => {
    setup(view([change(node('root', { maturity: 'committed' }), 1), change(node('leaf', { parent: 'root' as never }), 2)]))
    expect(screen.getByText(`⚖ ${zh['map.constraints']}`)).toBeDefined()
    expect(screen.getByText(zh['map.working'])).toBeDefined()
    expect(screen.getByText(zh['map.rest'])).toBeDefined()
    expect(screen.getByText(zh['map.constraintsEmpty'])).toBeDefined()
  })

  it('scans: a row carries a mark, a title, and nothing editable', () => {
    setup(view([change(node('root', { maturity: 'committed' }), 1)]))
    expect(screen.getAllByText('◆').length).toBeGreaterThan(0)
    // The tree offers no input: renaming happens on the card.
    expect(screen.queryByLabelText(zh['card.title'])).toBeNull()
  })

  it('follows the selection to the card', () => {
    setup(view([
      change(node('root'), 1),
      change(node('leaf', { parent: 'root' as never, title: '第二张' }), 2),
    ]))
    expect(screen.getByRole('heading', { name: 'title-root' })).toBeDefined()
    // The same card shows twice by design: pinned in the working set and again in
    // the full tree. Either row selects it.
    fireEvent.click(screen.getAllByRole('button', { name: /第二张/ })[0] as HTMLElement)
    expect(screen.getByRole('heading', { name: '第二张' })).toBeDefined()
  })
})

describe('the card', () => {
  it('shows the brief first, with the duty set apart from the prose', () => {
    setup(view([change(node('root'), 1)]))
    expect(screen.getByText('简介')).toBeDefined()
    expect(screen.getByText(/管这块/)).toBeDefined()
  })

  it('marks a derived view with its prefix, so it is not mistaken for content that can go stale', () => {
    setup(view([change(node('root'), 1), change(node('leaf', { parent: 'root' as never }), 2)]))
    expect(screen.getByText('⁄子模块')).toBeDefined()
  })

  it('names rev and source in the title row', () => {
    setup(view([change(node('root', { source: 'ai' }), 3)]))
    expect(screen.getByText('rev 3')).toBeDefined()
    expect(screen.getByText(zh['source.ai'])).toBeDefined()
  })

  it('says so when a card has no content body and nothing to derive either', () => {
    setup(view([
      change(node('root'), 1),
      change(bareNode('bare', { parent: 'root' as never, title: '空卡' }), 2),
    ]))
    fireEvent.click(screen.getAllByRole('button', { name: /空卡/ })[0] as HTMLElement)
    expect(screen.getByText(zh['card.noBody'])).toBeDefined()
  })
})

describe('the two states of one card', () => {
  it('is quiet when nothing is pending', () => {
    setup(view([change(node('root'), 1)]))
    expect(screen.queryByText(zh['card.pending'])).toBeNull()
    expect(screen.queryByRole('button', { name: zh['card.commit'] })).toBeNull()
  })

  it('carries the pending bar and its two actions once edit state exists', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '改了一半', at: 0 } }, 2),
    ]))
    expect(screen.getByText(zh['card.pending'])).toBeDefined()
    expect(screen.getByRole('button', { name: zh['card.commit'] })).toBeDefined()
    expect(screen.getByRole('button', { name: zh['card.discard'] })).toBeDefined()
  })

  it('commits and discards through the host rather than deciding for itself', () => {
    const { commitTmp, discardTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '改了一半', at: 0 } }, 2),
    ]))
    fireEvent.click(screen.getByRole('button', { name: zh['card.commit'] }))
    expect(commitTmp).toHaveBeenCalledWith('root')
    fireEvent.click(screen.getByRole('button', { name: zh['card.discard'] }))
    expect(discardTmp).toHaveBeenCalledWith('root')
  })

  it('shows what the edit state says, not what the card last committed', () => {
    setup(view([
      change(node('root', { title: '已落盘的标题' }), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '还没提交的标题', at: 0 } }, 2),
    ]))
    expect(screen.getByLabelText(zh['card.title'])).toHaveProperty('value', '还没提交的标题')
  })

  it('writes what the person types into the edit state, which costs no rev', () => {
    const { setTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '甲', at: 0 } }, 2),
    ]))
    fireEvent.change(screen.getByLabelText(zh['card.title']), { target: { value: '乙' } })
    expect(setTmp).toHaveBeenCalledWith('root', expect.objectContaining({ title: '乙' }))
  })
})

describe('asking in place', () => {
  it('never opens a browser dialog', () => {
    const prompt = vi.spyOn(window, 'prompt')
    setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['map.add'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['card.reject'] }))
    expect(prompt).not.toHaveBeenCalled()
    prompt.mockRestore()
  })

  it('asks for a new card’s title in a row, submitting on Enter', () => {
    const { createChild } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['map.add'] }))
    const input = screen.getByLabelText(zh['map.addAsk'])
    fireEvent.change(input, { target: { value: '新的一张' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createChild).toHaveBeenCalledWith('root', '新的一张')
  })

  it('abandons the question on Escape without writing anything', () => {
    const { createChild } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['map.add'] }))
    fireEvent.keyDown(screen.getByLabelText(zh['map.addAsk']), { key: 'Escape' })
    expect(screen.queryByLabelText(zh['map.addAsk'])).toBeNull()
    expect(createChild).not.toHaveBeenCalled()
  })

  it('requires a reason before a rejection lands', () => {
    const { promote } = setup(view([change(node('root'), 1)]))
    fireEvent.click(screen.getByRole('button', { name: zh['card.reject'] }))
    const input = screen.getByLabelText(zh['card.rejectAsk'])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(promote).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '成本太高' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(promote).toHaveBeenCalledWith('root', 'rejected', '成本太高')
  })
})

describe('the conversation column', () => {
  it('shows what was said on this card, and nothing said on another', () => {
    setup(view([
      change(node('root'), 1),
      change(node('other', { title: '别的卡' }), 2),
      event('workbench/utterance', { entryId: 'u1', text: '这句在 root 上说的', rev: 1, createdAt: 0, moduleId: 'root' }, 3),
      event('workbench/utterance', { entryId: 'u2', text: '这句在别处说的', rev: 1, createdAt: 0, moduleId: 'other' }, 4),
    ]))
    expect(screen.getByText('这句在 root 上说的')).toBeDefined()
    expect(screen.queryByText('这句在别处说的')).toBeNull()
  })

  it('is empty rather than showing the whole session when a card has no exchange', () => {
    setup(view([change(node('root'), 1)]))
    expect(screen.getByText(zh['talk.empty'])).toBeDefined()
  })
})

describe('the meter', () => {
  it('publishes the round, the rev, the △ account, and the structuring trend', () => {
    setup(view([
      change(node('a', { source: 'ai', bodies: [brief('a-brief', { body: '模型写的一段' })] }), 1),
      change(node('b'), 2),
    ]))
    expect(screen.getByText(zh['meter.commits'].replace('{n}', '2'))).toBeDefined()
    expect(screen.getByText(zh['meter.rev'].replace('{n}', '2'))).toBeDefined()
    expect(screen.getByText(zh['meter.ai'].replace('{n}', '1'))).toBeDefined()
  })

  it('counts results waiting only while any are', () => {
    const waiting = view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '一份草稿', createdAt: 0 }, 2),
    ])
    setup(waiting)
    expect(screen.getByText(zh['meter.reminders'].replace('{n}', '1'))).toBeDefined()
    cleanup()
    setup(view([change(node('root'), 1)]))
    expect(screen.queryByText(zh['meter.reminders'].replace('{n}', '1'))).toBeNull()
  })
})

describe('a refusal', () => {
  it('shows the host’s own line where the person can see it', async () => {
    setup(view([change(node('root'), 1)]), {
      promote: vi.fn(() => Promise.resolve({ ok: false, message: 'GATE_MISSING_DUTY: 说不出职责' })),
    })
    fireEvent.click(screen.getByRole('button', { name: zh['card.promote'] }))
    expect(await screen.findByText(/GATE_MISSING_DUTY/)).toBeDefined()
  })
})
