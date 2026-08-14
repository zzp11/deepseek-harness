// @vitest-environment jsdom
/**
 * The 工作台 tab over a folded tree: the empty first screen, the tree and focus
 * pane, a draft the person rewrites before accepting, the promotion gate's
 * refusal shown where they can see it, and the meter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  emptyWorkbenchState, snapshotOf, type WorkbenchNode, type WorkbenchProposal,
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

describe('the tree and the focused node', () => {
  it('shows the maturity mark per row and focuses the first node', () => {
    setup(view([
      change(node('root', { maturity: 'committed', duty: '管住入场' }), 1),
      change(node('leaf', { parent: 'root' as never, body: '正文若干' }), 2),
    ]))
    expect(screen.getByText('◆').textContent).toBe('◆')
    expect(screen.getByText('○').textContent).toBe('○')
    expect(screen.getByRole('heading', { name: 'title-root' })).toBeDefined()
    // A node with children draws as its child list.
    expect(screen.getByText(zh['focus.shape.child-list'])).toBeDefined()
    expect(screen.getByRole('listitem').textContent).toBe('title-leaf')
  })

  it('draws a childless node with a body as a paragraph card', () => {
    setup(view([change(node('solo', { body: '一段正文' }), 1)]))
    expect(screen.getByText(zh['focus.shape.paragraph-card'])).toBeDefined()
  })

  it('says a node carrying only a title has no shape yet', () => {
    setup(view([change(node('bare'), 1)]))
    expect(screen.getByText(zh['focus.shape.none'])).toBeDefined()
  })

  it('follows the selection', () => {
    const tab = setup(view([change(node('a'), 1), change(node('b'), 2)]))
    fireEvent.click(screen.getByText('title-b'))
    expect(screen.getByRole('heading', { name: 'title-b' })).toBeDefined()
    expect(tab.actions).toBeDefined()
  })

  it('names where a distilled node was drawn from', () => {
    setup(view([change(node('n1', { source: { sourceId: 'u3' as never } }), 1)]))
    expect(screen.getByText(`${zh['focus.source']}: ${zh['source.derived']} u3`)).toBeDefined()
  })

  it('names the model as the source of a node it wrote', () => {
    setup(view([change(node('n1', { source: 'ai' }), 1)]))
    expect(screen.getByText(`${zh['focus.source']}: ${zh['source.ai']}`)).toBeDefined()
  })

  it('flags an unregistered and uncited field on the focused node', () => {
    setup(view([change(node('n1', { fields: { 准备成本: { value: '低' } } }), 1)]))
    expect(screen.getByText(new RegExp(zh['focus.unregistered']))).toBeDefined()
  })
})

describe('a committed node with registered, cited fields', () => {
  it('flags nothing, and names the entry each value came from', () => {
    const seeded = event('workbench/snapshot', {
      nodes: [{
        ...node('n1', {
          maturity: 'committed',
          duty: '管住入场',
          body: '正文若干',
          fields: { 准备成本: { value: '低', sourceId: 'u3' as never } },
        }),
      }],
      firstLayer: [],
      proposals: [],
      meta: { rev: 3, fieldDictionary: { 准备成本: { semantic: '讲者要付的准备时间', shape: '低|中|高' } } },
    }, 1)
    setup(view([seeded]))
    expect(screen.queryByText(new RegExp(zh['focus.unregistered']))).toBeNull()
    expect(screen.getByText(/u3/)).toBeDefined()
    // The duty and body inputs hold what the node already says, so a blur that
    // changed nothing writes nothing.
    expect(screen.getByLabelText<HTMLInputElement>(zh['focus.duty']).value).toBe('管住入场')
    expect(screen.getByLabelText<HTMLTextAreaElement>(zh['focus.body']).value).toBe('正文若干')
    fireEvent.blur(screen.getByLabelText(zh['focus.duty']))
    fireEvent.blur(screen.getByLabelText(zh['focus.body']))
  })
})

describe('editing costs nothing', () => {
  it('writes the body through the command channel on blur, and only when it changed', () => {
    const tab = setup(view([change(node('n1', { body: '原来的' }), 1)]))
    const body = screen.getByLabelText(zh['focus.body'])
    fireEvent.blur(body)
    expect(tab.updateField).not.toHaveBeenCalled()
    fireEvent.change(body, { target: { value: '人自己改的一句话' } })
    fireEvent.blur(body)
    expect(tab.updateField).toHaveBeenCalledWith('n1', 'body', '人自己改的一句话')
  })

  it('writes the duty the same way', () => {
    const tab = setup(view([change(node('n1'), 1)]))
    const duty = screen.getByLabelText(zh['focus.duty'])
    fireEvent.change(duty, { target: { value: '管住入场' } })
    fireEvent.blur(duty)
    expect(tab.updateField).toHaveBeenCalledWith('n1', 'duty', '管住入场')
  })

  it('treats a node that never had a body as having an empty one', () => {
    const tab = setup(view([change(node('n1'), 1)]))
    const body = screen.getByLabelText<HTMLTextAreaElement>(zh['focus.body'])
    expect(body.value).toBe('')
    fireEvent.blur(body)
    expect(tab.updateField).not.toHaveBeenCalled()
    fireEvent.change(body, { target: { value: '第一段正文' } })
    fireEvent.blur(body)
    expect(tab.updateField).toHaveBeenCalledWith('n1', 'body', '第一段正文')
  })
})

describe('the promotion gate', () => {
  it('shows the host refusal where the person can see it', async () => {
    const refuse = vi.fn(() => Promise.resolve<EditOutcome>({
      ok: false,
      message: 'GATE_MISSING_DUTY: n1 有子节点但没写职责；一句话说清它管什么',
    }))
    setup(view([change(node('n1'), 1)]), { promote: refuse })
    fireEvent.click(screen.getByRole('button', { name: zh['focus.promote'] }))
    expect(await screen.findByText(/GATE_MISSING_DUTY/)).toBeDefined()
  })

  it('asks for a reason before rejecting, and does nothing when the person backs out', () => {
    const tab = setup(view([change(node('n1'), 1)]))
    const prompt = vi.spyOn(window, 'prompt')
    prompt.mockReturnValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: zh['focus.reject'] }))
    expect(tab.promote).not.toHaveBeenCalled()
    prompt.mockReturnValueOnce('场地拿不到')
    fireEvent.click(screen.getByRole('button', { name: zh['focus.reject'] }))
    expect(tab.promote).toHaveBeenCalledWith('n1', 'rejected', '场地拿不到')
    prompt.mockRestore()
  })
})

describe('adding a node', () => {
  it('creates under the focused node, and does nothing on an empty title', () => {
    const tab = setup(view([change(node('root'), 1)]))
    const prompt = vi.spyOn(window, 'prompt')
    prompt.mockReturnValueOnce('')
    fireEvent.click(screen.getByRole('button', { name: zh['tree.add'] }))
    expect(tab.createChild).not.toHaveBeenCalled()
    prompt.mockReturnValueOnce('场地')
    fireEvent.click(screen.getByRole('button', { name: zh['tree.add'] }))
    expect(tab.createChild).toHaveBeenCalledWith('root', '场地')
    prompt.mockRestore()
  })

  it('creates at the root when the tree only holds drafts', () => {
    const draft: WorkbenchProposal = {
      proposalId: 'p1' as never, targetNode: null, title: '候选骨架', createdAt: 0,
      newNodes: [{ title: '目标' }],
    }
    const tab = setup(view([event('workbench/proposal', draft, 1)]))
    const prompt = vi.spyOn(window, 'prompt')
    prompt.mockReturnValueOnce('目标')
    fireEvent.click(screen.getByRole('button', { name: zh['tree.add'] }))
    expect(tab.createChild).toHaveBeenCalledWith(null, '目标')
    prompt.mockRestore()
  })
})

describe('a draft and its verdict', () => {
  /** A draft offering one field and three nodes. */
  const draft: WorkbenchProposal = {
    proposalId: 'p1' as never,
    targetNode: 'n1' as never,
    title: '补字段',
    createdAt: 0,
    summary: '给这个节点补一个字段',
    body: '草稿正文',
    fields: [{ name: '准备成本', value: '高' }],
    newNodes: [{ title: '目标', duty: '说清为什么' }, { title: '场地' }],
  }

  it('shows what the draft offers and that editing it is free', () => {
    setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    expect(screen.getByText('补字段')).toBeDefined()
    expect(screen.getByText(zh['proposal.editHint'])).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>(`${zh['proposal.nodeTitle']} 目标`).value).toBe('目标')
    expect(screen.getByText('说清为什么')).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>(`${zh['proposal.nodeTitle']} 场地`).value).toBe('场地')
  })

  it('accepts what the person edited, not what the model proposed', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    fireEvent.change(screen.getByLabelText('准备成本'), { target: { value: '低' } })
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p1', [{ name: '准备成本', value: '低' }], undefined)
  })

  it('accepts an untouched draft as proposed', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p1', [], undefined)
  })

  it('prunes and renames before the commit, so a dropped node never reaches the tree', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    // Prune the second offered node and rename the first.
    fireEvent.click(screen.getAllByRole('button', { name: zh['proposal.dropNode'] })[1]!)
    fireEvent.change(screen.getByLabelText(`${zh['proposal.nodeTitle']} 目标`), { target: { value: '为什么办' } })
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p1', [], [{ index: 0, title: '为什么办' }])
  })

  it('keeps a rename that restates the proposed title as no change at all', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    const title = screen.getByLabelText(`${zh['proposal.nodeTitle']} 目标`)
    fireEvent.change(title, { target: { value: '改了' } })
    fireEvent.change(title, { target: { value: '目标' } })
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p1', [], [{ index: 0 }, { index: 1 }])
  })

  it('lets the person take a pruned node back', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    fireEvent.click(screen.getAllByRole('button', { name: zh['proposal.dropNode'] })[0]!)
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.restoreNode'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p1', [], [{ index: 0 }, { index: 1 }])
  })

  it('keeps the reason when the person turns a draft down, and backs out cleanly', () => {
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', draft, 2)]))
    const prompt = vi.spyOn(window, 'prompt')
    prompt.mockReturnValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.discard'] }))
    expect(tab.rejectProposal).not.toHaveBeenCalled()
    prompt.mockReturnValueOnce('这条不是我要的')
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.discard'] }))
    expect(tab.rejectProposal).toHaveBeenCalledWith('p1', '这条不是我要的')
    prompt.mockRestore()
  })

  it('shows a ruled draft as settled, with no buttons left', () => {
    setup(view([
      change(node('n1'), 1),
      event('workbench/proposal', draft, 2),
      event('workbench/verdict', { proposalId: 'p1', outcome: 'accepted', rev: 1 }, 3),
    ]))
    expect(screen.getByText(zh['proposal.ruled'])).toBeDefined()
    expect(screen.queryByRole('button', { name: zh['proposal.accept'] })).toBeNull()
  })

  it('accepts a draft offering no nodes at all after the person touched a field', () => {
    const fieldsOnly = {
      proposalId: 'p3' as never, targetNode: 'n1' as never, title: '只补字段', createdAt: 0,
      fields: [{ name: '准备成本', value: '高' }],
    }
    const tab = setup(view([change(node('n1'), 1), event('workbench/proposal', fieldsOnly, 2)]))
    fireEvent.change(screen.getByLabelText('准备成本'), { target: { value: '低' } })
    fireEvent.click(screen.getByRole('button', { name: zh['proposal.accept'] }))
    expect(tab.acceptProposal).toHaveBeenCalledWith('p3', [{ name: '准备成本', value: '低' }], undefined)
  })

  it('shows a bare draft without a field editor or a node list', () => {
    setup(view([event('workbench/proposal', {
      proposalId: 'p2' as never, targetNode: null, title: '只有标题', createdAt: 0,
    }, 1)]))
    expect(screen.getByText('只有标题')).toBeDefined()
    expect(screen.queryByText(zh['proposal.editHint'])).toBeNull()
    expect(screen.queryByText(zh['proposal.newNodes'])).toBeNull()
  })
})

describe('the meter', () => {
  it('counts the round, the rev, the untouched model nodes, and the structuring trend', () => {
    setup(view([
      change(node('a', { source: 'ai', body: '模型写的一段', fields: { 准备成本: { value: '低' } } }), 1),
      change(node('b', { body: '四个字' }), 2),
    ]))
    expect(screen.getByText(zh['meter.commits'].replace('{n}', '2'))).toBeDefined()
    expect(screen.getByText(zh['meter.rev'].replace('{n}', '2'))).toBeDefined()
    expect(screen.getByText(zh['meter.ai'].replace('{n}', '1'))).toBeDefined()
    expect(screen.getByText(
      zh['meter.structure'].replace('{chars}', '4.5').replace('{fields}', '1'),
    )).toBeDefined()
  })
})
