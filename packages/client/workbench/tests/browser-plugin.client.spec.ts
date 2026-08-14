/**
 * The browser half on a real SlotRegistry: the plugin waits for the conversation
 * view ring, registers the 工作台 tab into it, folds the event family through the
 * two registries, and turns each tab action into one `workbench-edit` command.
 * Teardown empties the ring (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { BodyId, NodeId, ProposalId } from '@deepseek-ai/dsh-workbench/projection'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { WORKBENCH_KIND, WORKBENCH_TARGET } from '../src/client/definition.ts'
import { WorkbenchTab } from '../src/client/WorkbenchTab.tsx'
import type { WorkbenchInjected } from '../src/client/contract.ts'

const SID = 's-workbench' as SessionId

/** One composed browser bench: the slot ring declared, the registries stubbed, the commands Remote recorded. */
async function bench(result: unknown = { kind: 'success', sourceEventSeq: 7 }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const definitions: unknown[] = []
  const targets: unknown[] = []
  ctx.provide('conversationEvents', { register: (definition: unknown) => { definitions.push(definition) } })
  ctx.provide('conversationViews', { register: (target: unknown) => { targets.push(target) } })
  return { ctx, slots, execute, definitions, targets }
}

/** The injected face of the registered tab. */
function injectedFace(slots: SlotRegistry): WorkbenchInjected {
  const entry = slots.entries('conversation.view')[0]
  if (entry === undefined) throw new Error('the workbench tab did not register')
  return (entry.inject as unknown as (id: SessionId) => WorkbenchInjected)(SID)
}

/** The request the plugin encoded into the last dispatched command line. */
function lastRequest(execute: { mock: { calls: unknown[][] } }): unknown {
  const line = execute.mock.calls.at(-1)?.[1] as string
  return JSON.parse(line.slice('/workbench-edit '.length))
}

describe('the browser half', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual([
      'slots', 'conversationEvents', 'conversationViews', 'remote', 'remote.commands', 'locale',
    ])
  })

  it('has an intentional no-op node half', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the fold, the view target, and the tab', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.definitions).toEqual([expect.objectContaining({ kind: WORKBENCH_KIND }) as unknown])
    expect(b.targets).toEqual([expect.objectContaining({ target: WORKBENCH_TARGET }) as unknown])
    const entry = b.slots.entries('conversation.view')[0]
    expect(entry?.component).toBe(WorkbenchTab)
    // The label is a thunk so it follows the active locale without re-registering.
    expect(entry?.options.id).toBe('workbench')
    expect((entry?.options.label as () => string)()).toBe('工作台')
  })

  it('waits until the conversation declares the view ring', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('conversationEvents', { register: () => {} })
    ctx.provide('conversationViews', { register: () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
  })

  it('empties the ring on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('conversation.view')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
  })

  it('turns each tab action into one edit request', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = injectedFace(b.slots)

    await expect(face.createChild(null, '内部分享')).resolves.toEqual({ ok: true })
    expect(lastRequest(b.execute)).toEqual({ op: 'create-child', parentId: null, title: '内部分享' })

    await face.updateField('n1' as NodeId, 'body', '人自己改的一句话')
    expect(lastRequest(b.execute)).toEqual({
      op: 'update-field', nodeId: 'n1', field: 'body', value: '人自己改的一句话',
    })

    await face.promote('n1' as NodeId, 'committed')
    expect(lastRequest(b.execute)).toEqual({ op: 'promote', nodeId: 'n1', maturity: 'committed' })

    await face.promote('n1' as NodeId, 'rejected', '场地拿不到')
    expect(lastRequest(b.execute)).toEqual({
      op: 'promote', nodeId: 'n1', maturity: 'rejected', note: '场地拿不到',
    })

    await face.acceptProposal('p1' as ProposalId, [])
    expect(lastRequest(b.execute)).toEqual({ op: 'accept-proposal', proposalId: 'p1' })

    await face.acceptProposal('p1' as ProposalId, [{ name: '准备成本', value: '低' }])
    expect(lastRequest(b.execute)).toEqual({
      op: 'accept-proposal', proposalId: 'p1', edits: [{ name: '准备成本', value: '低' }],
    })

    await face.acceptProposal('p1' as ProposalId, [], [{ index: 0, title: '为什么办' }])
    expect(lastRequest(b.execute)).toEqual({
      op: 'accept-proposal', proposalId: 'p1', keptNodes: [{ index: 0, title: '为什么办' }],
    })

    await face.rejectProposal('p1' as ProposalId, '这条不是我要的')
    expect(lastRequest(b.execute)).toEqual({
      op: 'reject-proposal', proposalId: 'p1', reason: '这条不是我要的',
    })
  })

  it('sends the edit-state ops the two card states need', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = injectedFace(b.slots)

    // No `at`: the stamp is the host's, so the browser cannot put a time in the log.
    await face.setTmp('n1' as NodeId, { title: '改了一半' })
    expect(lastRequest(b.execute)).toEqual({ op: 'set-tmp', nodeId: 'n1', tmp: { title: '改了一半' } })

    // An empty draft is how a person opens edit state on an already-committed card.
    await face.setTmp('n1' as NodeId, {})
    expect(lastRequest(b.execute)).toEqual({ op: 'set-tmp', nodeId: 'n1', tmp: {} })

    await face.commitTmp('n1' as NodeId)
    expect(lastRequest(b.execute)).toEqual({ op: 'commit-tmp', nodeId: 'n1' })

    await face.discardTmp('n1' as NodeId)
    expect(lastRequest(b.execute)).toEqual({ op: 'discard-tmp', nodeId: 'n1' })

    await face.deleteBody('n1' as NodeId, 'b1' as BodyId)
    expect(lastRequest(b.execute)).toEqual({ op: 'delete-body', nodeId: 'n1', bodyId: 'b1' })

    await face.openIdeas('n1' as NodeId)
    expect(lastRequest(b.execute)).toEqual({ op: 'open-ideas', nodeId: 'n1' })

    await face.focusNode('n1' as NodeId)
    expect(lastRequest(b.execute)).toEqual({ op: 'focus', nodeId: 'n1' })

    await face.focusNode(null)
    expect(lastRequest(b.execute)).toEqual({ op: 'focus', nodeId: null })
  })

  it('carries the host refusal through unchanged', async () => {
    const b = await bench({ kind: 'error', text: 'GATE_MISSING_DUTY: n1 有子节点但没写职责；一句话说清它管什么' })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await expect(injectedFace(b.slots).promote('n1' as NodeId, 'committed')).resolves.toEqual({
      ok: false,
      message: 'GATE_MISSING_DUTY: n1 有子节点但没写职责；一句话说清它管什么',
    })
  })

  it('reports a transport failure and an unrecognized command as failures of their own', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { message: 'gateway unavailable', code: 'transport' } })
      .mockResolvedValueOnce({ ok: true, value: undefined })
    const commandsRemote = { execute }
    ctx.provide('remote', { commands: commandsRemote })
    ctx.provide('remote.commands', commandsRemote)
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('conversationEvents', { register: () => {} })
    ctx.provide('conversationViews', { register: () => {} })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const face = injectedFace(slots)

    await expect(face.createChild(null, 'x')).resolves.toEqual({
      ok: false, message: 'gateway unavailable (transport)',
    })
    await expect(face.createChild(null, 'x')).resolves.toEqual({
      ok: false, message: 'unknown command: /workbench-edit',
    })
  })
})
