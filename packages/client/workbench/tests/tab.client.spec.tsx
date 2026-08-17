// @vitest-environment jsdom
/**
 * The 工作台 tab over a folded tree: the first screen, the three columns, a card in
 * each of its two states, the tag strip and its overflow, questions asked in place
 * rather than in a dialog, and the meter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    duty: '管这块',
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
    promoteToConstraint: vi.fn(ok),
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
    // The composer's seat. ui-conversation owns what goes in it; these specs only
    // need the tab to offer the seat, which is what the marker proves.
    renderSlot: (name: string) => <div data-slot={name} />,
    ...injected,
  } as unknown as WorkbenchTabProps
  return {
    ...injected,
    actions: store.actions,
    view: render(<WorkbenchTab {...props} />),
    /** Push a newly folded tree, the way a fresh event from the host arrives. */
    refold: (next: WorkbenchTreeView) => {
      act(() => { snapshot.set({ views: new Map([['workbench', { tree: next }]]) }) })
    },
  }
}

describe('the first screen', () => {
  it('asks for one sentence when nothing has happened yet', () => {
    setup(undefined)
    expect(screen.getByText(zh['empty.title'])).toBeDefined()
    expect(screen.getByText(zh['map.empty'])).toBeDefined()
  })
})

describe('the left column', () => {
  it('is one indented list, with no band headers and no counts to read', () => {
    setup(view([change(node('root', { maturity: 'committed' }), 1), change(node('leaf', { parent: 'root' as never }), 2)]))
    expect(screen.getAllByRole('button', { name: /title-root/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /title-leaf/ })).toHaveLength(1)
    // The child is indented under its parent; the depth is the whole hierarchy cue.
    const leaf = screen.getByRole('button', { name: /title-leaf/ })
    expect(leaf.style.paddingLeft).toBe('20px')
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
    expect(commitTmp).toHaveBeenCalledWith('root', expect.objectContaining({ title: '改了一半' }))
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

  it('keeps typing local, and autosaves the draft when the field is left', () => {
    // The failure this closes: the field's value came back from the host, so a person
    // typing faster than the round trip watched most of their characters vanish.
    const { setTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '甲', at: 0 } }, 2),
    ]))
    const title = screen.getByLabelText(zh['card.title'])
    fireEvent.change(title, { target: { value: '乙' } })
    fireEvent.change(title, { target: { value: '乙丙' } })
    fireEvent.change(title, { target: { value: '乙丙丁' } })
    expect(setTmp).not.toHaveBeenCalled()
    expect(title).toHaveProperty('value', '乙丙丁')
    fireEvent.blur(title)
    expect(setTmp).toHaveBeenCalledTimes(1)
    expect(setTmp).toHaveBeenCalledWith('root', expect.objectContaining({ title: '乙丙丁' }))
  })

  it('commits the draft it is holding, not the one the host last autosaved', () => {
    const { commitTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', { nodeId: 'root', tmp: { title: '存到一半', at: 0 } }, 2),
    ]))
    fireEvent.change(screen.getByLabelText(zh['card.title']), { target: { value: '最终的标题' } })
    fireEvent.click(screen.getByRole('button', { name: zh['card.commit'] }))
    expect(commitTmp).toHaveBeenCalledWith('root', expect.objectContaining({ title: '最终的标题' }))
  })

  it('keeps the model’s body edits in the draft while the person retypes the title', () => {
    // The whole point of one card with two states: a model proposal opens the edit
    // state carrying its edits to the content bodies, and the person's own typing rides
    // on top of them. Seeding the local draft from three named fields dropped
    // `bodies` and `fromProposal` on the floor, so the first blur or 确定 committed
    // the person's title and silently threw the model's work away.
    const edited = [brief('b1', { duty: 'AI 改过的职责', body: 'AI 改过的正文' })]
    const { setTmp, commitTmp } = setup(view([
      change(node('root'), 1),
      event('workbench/scratch', {
        nodeId: 'root',
        tmp: { title: 'AI 起的名字', bodies: edited, fromProposal: 'p1', at: 0 },
      }, 2),
    ]))
    const title = screen.getByLabelText(zh['card.title'])
    fireEvent.change(title, { target: { value: '人改的名字' } })
    fireEvent.blur(title)
    expect(setTmp).toHaveBeenCalledWith('root', expect.objectContaining({
      title: '人改的名字',
      bodies: edited,
      fromProposal: 'p1',
    }))
    fireEvent.click(screen.getByRole('button', { name: zh['card.commit'] }))
    expect(commitTmp).toHaveBeenCalledWith('root', expect.objectContaining({
      title: '人改的名字',
      bodies: edited,
      fromProposal: 'p1',
    }))
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

describe('the page carries no counters', () => {
  it('shows no round, rev, or trend numbers of its own', () => {
    // Five numbers reading 0 across an empty project is not a measurement, it is
    // noise. The counts that mean something stay where they are about something:
    // `⚑n` on the card and the row it belongs to.
    setup(view([
      change(node('a', { source: 'ai', bodies: [brief('a-brief', { body: '模型写的一段' })] }), 1),
      change(node('b'), 2),
    ]))
    expect(screen.queryByText(/第 \d+ 轮/)).toBeNull()
    expect(screen.queryByText(/累计 rev/)).toBeNull()
    expect(screen.queryByText(/正文均长/)).toBeNull()
  })

  it('still says a result is waiting, on the card it is waiting on', () => {
    setup(view([
      change(node('root'), 1),
      event('workbench/proposal', { proposalId: 'p1', targetNode: 'root', title: '一份草稿', createdAt: 0 }, 2),
    ]))
    expect(screen.getAllByText(/⚑1/).length).toBeGreaterThan(0)
  })
})

describe('ruling on a skeleton the model proposed', () => {
  /** A cold-start draft shaped as a tree: 总纲 with 场地 and 预算 under it, 门票 under 预算. */
  const skeleton = (proposalId = 'p1'): SessionEvent => event('workbench/proposal', {
    proposalId,
    targetNode: null,
    title: '冷启动骨架',
    summary: '一棵四张卡的骨架',
    newNodes: [
      { title: '总纲', duty: '管全局' },
      { title: '场地', parentIndex: 0 },
      { title: '预算', parentIndex: 0 },
      { title: '门票', parentIndex: 2 },
    ],
    createdAt: 0,
  }, 2)

  it('shows the draft on an empty tree, where the empty state used to be', () => {
    // The failure this closes: accept rendered only inside a focused card, filtered to
    // that card, so a draft with no target on a tree with no cards was unreachable —
    // the model's whole skeleton showed as one line of text.
    setup(view([skeleton()]))
    expect(screen.getByText(zh['skeleton.title'])).toBeDefined()
    // Twice on purpose: the right column records that a draft was proposed at this
    // point in the exchange, the focus column is the thing to act on now.
    expect(screen.getAllByText('冷启动骨架')).toHaveLength(2)
    expect(screen.getByText('一棵四张卡的骨架')).toBeDefined()
    expect(screen.queryByText(zh['empty.title'])).toBeNull()
    expect(screen.getByText('4 / 4 张')).toBeDefined()
    for (const title of ['总纲', '场地', '预算', '门票']) {
      expect(screen.getByDisplayValue(title)).toBeDefined()
    }
  })

  it('opens nothing for a target-less draft that carries no cards', () => {
    // Not a skeleton: the accept path refuses it as having nothing to commit, so a
    // review would be a surface with no subject.
    setup(view([event('workbench/proposal', {
      proposalId: 'p-bare', targetNode: null, title: '只有标题', createdAt: 0,
    }, 2)]))
    expect(screen.queryByText(zh['skeleton.title'])).toBeNull()
    expect(screen.getByText(zh['empty.title'])).toBeDefined()
  })

  it('renders a draft that carries no summary, without an empty line where it would go', () => {
    setup(view([event('workbench/proposal', {
      proposalId: 'p-nosum',
      targetNode: null,
      title: '没有摘要的骨架',
      newNodes: [{ title: '总纲', duty: '管全局' }],
      createdAt: 0,
    }, 2)]))
    expect(screen.getByText(zh['skeleton.title'])).toBeDefined()
    expect(screen.getByDisplayValue('总纲')).toBeDefined()
  })

  it('keeps the draft on screen while a card is selected', () => {
    // A skeleton is a decision waiting on the person. Gating it on "no card focused"
    // meant the model could propose more structure onto a tree that already had cards
    // and the person would never see it — the same unreachability, one step later.
    setup(view([change(node('root'), 1), skeleton()]))
    fireEvent.click(screen.getAllByRole('button', { name: /title-root/ })[0] as HTMLElement)
    expect(screen.getByText(zh['skeleton.title'])).toBeDefined()
    expect(screen.getByRole('heading', { name: 'title-root' })).toBeDefined()
  })

  it('accepts as proposed when the person changed nothing', () => {
    const { acceptProposal } = setup(view([skeleton()]))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(acceptProposal).toHaveBeenCalledWith('p1', [], [
      { index: 0 }, { index: 1 }, { index: 2 }, { index: 3 },
    ])
  })

  it('carries a renamed card, and only the ones actually renamed', () => {
    const { acceptProposal } = setup(view([skeleton()]))
    fireEvent.change(screen.getByDisplayValue('场地'), { target: { value: '场地与档期' } })
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(acceptProposal).toHaveBeenCalledWith('p1', [], [
      { index: 0 }, { index: 1, title: '场地与档期' }, { index: 2 }, { index: 3 },
    ])
  })

  it('cuts a card together with everything under it', () => {
    // 门票 under 预算 is a budget line; 门票 at the root is a concern of its own. The
    // host refuses an accept that orphans a child, so the surface must not offer it.
    const { acceptProposal } = setup(view([skeleton()]))
    const rows = screen.getAllByRole('button', { name: zh['skeleton.cut'] })
    fireEvent.click(rows[2] as HTMLElement)
    expect(screen.getByText('2 / 4 张')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(acceptProposal).toHaveBeenCalledWith('p1', [], [{ index: 0 }, { index: 1 }])
  })

  it('puts a cut card back, without restoring its children', () => {
    const { acceptProposal } = setup(view([skeleton()]))
    fireEvent.click((screen.getAllByRole('button', { name: zh['skeleton.cut'] })[2]) as HTMLElement)
    // Two rows now offer 恢复 — 预算 and the 门票 that went with it. Restoring the
    // first puts back only 预算.
    expect(screen.getAllByRole('button', { name: zh['skeleton.restore'] })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: zh['skeleton.restore'] })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    // 预算 is back; 门票 stays cut, because restoring a parent cannot know whether the
    // person wanted the whole subtree back.
    expect(acceptProposal).toHaveBeenCalledWith('p1', [], [{ index: 0 }, { index: 1 }, { index: 2 }])
  })

  it('refuses to accept nothing, and says why', () => {
    const { acceptProposal } = setup(view([skeleton()]))
    fireEvent.click((screen.getAllByRole('button', { name: zh['skeleton.cut'] })[0]) as HTMLElement)
    expect(screen.getByText('0 / 4 张')).toBeDefined()
    expect(screen.getByText(zh['skeleton.emptyKept'])).toBeDefined()
    const accept = screen.getByRole('button', { name: zh['proposal.accept'] })
    expect(accept).toHaveProperty('disabled', true)
    fireEvent.click(accept)
    expect(acceptProposal).not.toHaveBeenCalled()
  })

  it('asks for a reason before discarding, because a rejection is worth keeping', () => {
    const { rejectProposal } = setup(view([skeleton()]))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.discard'] }))
    expect(rejectProposal).not.toHaveBeenCalled()
    const reason = screen.getByLabelText(zh['talk.discardAsk'])
    fireEvent.change(reason, { target: { value: '规模不对' } })
    fireEvent.keyDown(reason, { key: 'Enter' })
    expect(rejectProposal).toHaveBeenCalledWith('p1', '规模不对')
  })

  it('starts a second draft from what the model offered, not the first draft’s renames', () => {
    // The surface is keyed by the draft. Without that key React reuses the component and
    // the person's renames and cuts from a draft they already ruled on would silently
    // ride onto the next one.
    const { refold, acceptProposal } = setup(view([skeleton('pA')]))
    fireEvent.change(screen.getByDisplayValue('场地'), { target: { value: '改过的' } })
    refold(view([
      skeleton('pA'),
      event('workbench/verdict', { proposalId: 'pA', outcome: 'rejected', rev: 1 }, 3),
      skeleton('pB'),
    ]))
    expect(screen.queryByDisplayValue('改过的')).toBeNull()
    expect(screen.getByDisplayValue('场地')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(acceptProposal).toHaveBeenCalledWith('pB', [], [
      { index: 0 }, { index: 1 }, { index: 2 }, { index: 3 },
    ])
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
