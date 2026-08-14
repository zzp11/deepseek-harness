import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ProposalId, NodeId, SourceId } from '../src/brand.ts'
import * as Workbench from '../src/index.ts'
import * as WorkbenchInvariant from '../src/invariant.ts'
import type { EditRequest } from '../src/edit.ts'
import type { WorkbenchNodeChange, WorkbenchSnapshot, WorkbenchUtterance } from '../src/events.ts'

/** One composed host: the session store, the command registry, and this plugin. */
async function mount(config: Partial<Workbench.Config> = {}): Promise<{ ctx: Context; fiber: { dispose: () => Promise<void> } }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(CommandRuntime)
  const fiber = await ctx.plugin(Workbench, { snapshotEveryChanges: 50, ...config })
  return { ctx, fiber }
}

/** A live agent over a real session, and the scope the command executor needs. */
async function agentOn(ctx: Context, name: string): Promise<Agent> {
  const session = ctx.sessions.create(SessionId(name))
  const agent = { id: session.id, session } as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return agent
}

/** Dispatch one edit the way the browser does: programmatically, never typed. */
async function edit(ctx: Context, agent: Agent, request: EditRequest): ReturnType<typeof executeLine> {
  return executeLine(ctx, agent, `/${Workbench.EDIT_COMMAND} ${JSON.stringify(request)}`)
}

/** Dispatch one raw command line. */
async function executeLine(ctx: Context, agent: Agent, line: string): Promise<{ kind: string; text?: string; sourceEventSeq?: number }> {
  const execution = await ctx.commands.execute(agent, line, new AbortController().signal)
  if (execution === undefined) throw new Error(`command line not recognized: ${line}`)
  return execution.result
}

/** Say something as the person, the way the composer does. */
function say(session: Session, text: string): SessionEvent {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** The workbench events of one session. */
function workbenchEvents(session: Session, type: string): readonly SessionEvent[] {
  return session.events.filter(event => event.type === type)
}

/** Let the mirror's deferred append run. */
const settle = (): Promise<void> => Promise.resolve()

describe('the human write path through the command channel', () => {
  it('lands an edit and answers with the event the browser should read', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'edit')

    const created = await edit(ctx, agent, { op: 'create-child', parentId: null, title: '内部分享' })
    expect(created.kind).toBe('success')

    const changes = workbenchEvents(agent.session, 'workbench/node-change')
    expect(changes).toHaveLength(1)
    const change = changes[0]?.data as WorkbenchNodeChange
    expect([change.rev, change.actor, change.op, change.node.title]).toEqual([1, 'human', 'create', '内部分享'])
    // The answer points at the authoritative event rather than restating it.
    expect(created.sourceEventSeq).toBe(changes[0]?.seq)
  })

  it('costs nothing: the edit reaches the log with no model service mounted at all', async () => {
    // Nothing in this composition can call a model — there is no llm service to
    // call — so an edit landing here is proof the write path never asks for one.
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'free')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '第一个念头' })
    expect(ctx.get('llm')).toBeUndefined()
    expect(workbenchEvents(agent.session, 'workbench/node-change')).toHaveLength(1)
  })

  it('answers a gate refusal with its code, and writes nothing', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'gate')
    const refused = await edit(ctx, agent, { op: 'create-child', parentId: NodeId('gone'), title: 'x' })
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('GATE_DANGLING_REF')
    expect(workbenchEvents(agent.session, 'workbench/node-change')).toHaveLength(0)
  })

  it('answers a malformed line without throwing out of the handler', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'malformed')
    expect(await executeLine(ctx, agent, `/${Workbench.EDIT_COMMAND} not-json`))
      .toEqual({ kind: 'error', text: '工作台编辑请求不是合法 JSON' })
    expect(await executeLine(ctx, agent, `/${Workbench.EDIT_COMMAND} 42`))
      .toEqual({ kind: 'error', text: '工作台编辑请求不是合法 JSON' })
    expect(await executeLine(ctx, agent, `/${Workbench.EDIT_COMMAND} {"noop":1}`))
      .toEqual({ kind: 'error', text: '工作台编辑请求不是合法 JSON' })
  })

  it('answers a request-level refusal with its own words', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'request-refusal')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '父' })
    const parentId = (workbenchEvents(agent.session, 'workbench/node-change')[0]?.data as WorkbenchNodeChange).node.id
    await edit(ctx, agent, { op: 'create-child', parentId, title: '子' })
    expect(await edit(ctx, agent, { op: 'delete', nodeId: parentId }))
      .toEqual({ kind: 'error', text: `${parentId} 还有 1 个子节点；先把它们移走或删掉` })
  })

  it('does not put the edit in the log twice', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'once')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: 'x' })
    const run = workbenchEvents(agent.session, 'command/run')[0]?.data as { args?: string }
    expect(run.args).toBeUndefined()
  })

  it('lands a multi-node acceptance at one rev', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'batch')
    agent.session.append('workbench/proposal', {
      proposalId: 'p1' as never,
      targetNode: null,
      title: '候选骨架',
      newNodes: [{ title: '目标' }, { title: '内容' }, { title: '场地' }],
      createdAt: 0,
    })
    expect((await edit(ctx, agent, { op: 'accept-proposal', proposalId: 'p1' as never })).kind).toBe('success')
    const revs = workbenchEvents(agent.session, 'workbench/node-change')
      .map(event => (event.data as WorkbenchNodeChange).rev)
    expect(revs).toEqual([1, 1, 1])
    expect(workbenchEvents(agent.session, 'workbench/verdict')).toHaveLength(1)
  })

  it('anchors the log with an empty checkpoint before the first change', async () => {
    // The browser folds this family into one Context whose start is a
    // checkpoint; without the anchor the tab would have updates and no state.
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'anchor')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: 'x' })
    const types = agent.session.events.map(event => event.type).filter(type => type.startsWith('workbench/'))
    expect(types).toEqual(['workbench/snapshot', 'workbench/node-change'])
    const anchor = workbenchEvents(agent.session, 'workbench/snapshot')[0]?.data as unknown as WorkbenchSnapshot
    expect(anchor.nodes).toEqual([])
  })

  it('checkpoints when the configured interval is reached, after the anchor', async () => {
    const { ctx } = await mount({ snapshotEveryChanges: 1 })
    const agent = await agentOn(ctx, 'checkpoint')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: 'x' })
    const checkpoints = workbenchEvents(agent.session, 'workbench/snapshot')
    expect(checkpoints).toHaveLength(2)
    expect((checkpoints[1]?.data as unknown as WorkbenchSnapshot).nodes).toHaveLength(1)
  })

  it('rebuilds the tree from a log written earlier before the first edit of the process', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'cold')
    // A log written by an earlier process: the plugin has never seen these events.
    agent.session.append('workbench/node-change', {
      rev: 3,
      actor: 'human',
      op: 'create',
      node: {
        id: NodeId('root'),
        title: '早先建的',
        parent: null,
        maturity: 'thought',
        source: 'human',
        fields: {},
        lastRev: 3,
        createdAt: 0,
      },
    })
    const created = await edit(ctx, agent, { op: 'create-child', parentId: NodeId('root'), title: '新的' })
    expect(created.kind).toBe('success')
    const latest = workbenchEvents(agent.session, 'workbench/node-change').at(-1)?.data as WorkbenchNodeChange
    // rev continues from the log rather than restarting, which only holds if the
    // projection was rebuilt.
    expect(latest.rev).toBe(4)
  })

  it('unregisters the command when the fiber goes', async () => {
    const { ctx, fiber } = await mount()
    const agent = await agentOn(ctx, 'dispose')
    expect(ctx.commands.list(agent).map(command => command.name)).toContain(Workbench.EDIT_COMMAND)
    await fiber.dispose()
    expect(ctx.commands.list(agent).map(command => command.name)).not.toContain(Workbench.EDIT_COMMAND)
  })
})

describe('the wire boundary and the ids it mints', () => {
  it('refuses an operation the edit channel does not have, rather than letting it reach planning', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'wire')
    const answer = await executeLine(ctx, agent, `/${Workbench.EDIT_COMMAND} {"op":"drop-database"}`)
    expect(answer.kind).toBe('error')
    expect(workbenchEvents(agent.session, 'workbench/node-change')).toHaveLength(0)
  })

  it('mints a body id when a draft brings content bodies along', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'bodies')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '选题' })
    const created = workbenchEvents(agent.session, 'workbench/node-change')[0]?.data as WorkbenchNodeChange
    const proposalId = ProposalId('p-bodies')
    agent.session.append('workbench/proposal', {
      proposalId,
      targetNode: created.node.id,
      title: '补一份简介',
      createdAt: 0,
      bodies: [{ label: '简介', payload: { kind: 'brief', duty: '定每期讲什么', body: '谁想讲谁报' } }],
    })
    expect((await edit(ctx, agent, { op: 'accept-proposal', proposalId })).kind).toBe('success')
    const landed = workbenchEvents(agent.session, 'workbench/node-change').at(-1)?.data as WorkbenchNodeChange
    expect(landed.node.bodies?.map(body => body.label)).toEqual(['简介'])
    expect(landed.node.bodies?.[0]?.id).toMatch(/^b\d+-\d+$/)
  })
})

describe('the first-hand mirror', () => {
  it('carries the words in unchanged, one entry per message', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror')
    say(agent.session, '就是想做个内部分享，别搞太正式')
    await settle()
    const entries = workbenchEvents(agent.session, 'workbench/utterance')
    expect(entries).toHaveLength(1)
    expect((entries[0]?.data as WorkbenchUtterance).text).toBe('就是想做个内部分享，别搞太正式')
  })

  it('anchors the log before the first mirrored utterance', async () => {
    // The mirror is a session's first workbench event in every real flow, so it
    // owes the checkpoint the browser fold starts from.
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror-anchor')
    say(agent.session, '第一句')
    await settle()
    const types = agent.session.events.map(event => event.type).filter(type => type.startsWith('workbench/'))
    expect(types).toEqual(['workbench/snapshot', 'workbench/utterance'])
  })

  it('mirrors every message exactly once', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror-many')
    for (const text of ['第一句', '第二句', '第三句']) {
      say(agent.session, text)
      await settle()
    }
    expect(workbenchEvents(agent.session, 'workbench/utterance')
      .map(event => (event.data as WorkbenchUtterance).text)).toEqual(['第一句', '第二句', '第三句'])
  })

  it('ignores a message carrying no words', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror-empty')
    agent.session.append('user/message', createUserMessage({
      content: [], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    expect(workbenchEvents(agent.session, 'workbench/utterance')).toHaveLength(0)
  })

  it('ignores a message whose content is not blocks at all', async () => {
    // Durable data another package wrote: the type says blocks, the log is what
    // it is, and a mirror is not the place to discover that.
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror-nonblocks')
    agent.session.append('user/message', {
      ...createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }),
      content: 'plain string',
    } as never, { surfaceOp: 'append' })
    await settle()
    expect(workbenchEvents(agent.session, 'workbench/utterance')).toHaveLength(0)
  })

  it('takes the words and leaves everything else the message carries', async () => {
    const { ctx } = await mount()
    const agent = await agentOn(ctx, 'mirror-blocks')
    agent.session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } },
        { type: 'text', text: '第二段' },
      ],
      source: { kind: 'user' },
    } as never), { surfaceOp: 'append' })
    await settle()
    expect((workbenchEvents(agent.session, 'workbench/utterance')[0]?.data as WorkbenchUtterance).text)
      .toBe('第一段\n第二段')
  })


  it('stops mirroring once the fiber goes', async () => {
    const { ctx, fiber } = await mount()
    const agent = await agentOn(ctx, 'mirror-disposed')
    say(agent.session, '装载期间说的')
    await settle()
    await fiber.dispose()

    say(agent.session, '卸载之后说的')
    await settle()
    expect(workbenchEvents(agent.session, 'workbench/utterance')
      .map(event => (event.data as WorkbenchUtterance).text)).toEqual(['装载期间说的'])
  })
})

describe('the mirror invariant', () => {
  it('accepts a session whose every message is mirrored', async () => {
    const { ctx } = await mount()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(WorkbenchInvariant)
    const agent = await agentOn(ctx, 'invariant-ok')
    say(agent.session, '第一句')
    await settle()
    expect(() => { say(agent.session, '第二句') }).not.toThrow()
  })

  it('refuses a first-hand entry that mirrors no message', async () => {
    const { ctx } = await mount()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(WorkbenchInvariant)
    const agent = await agentOn(ctx, 'invariant-orphan')
    expect(() => {
      agent.session.append('workbench/utterance', {
        entryId: SourceId('u99'), text: '没有对应消息', rev: 0, createdAt: 0,
      })
    }).toThrow(/mirrors no user\/message/)
  })

  it('catches a skipped mirror at the next one that lands', async () => {
    // No mirror in this composition, so the entries are appended by hand: the
    // first message is skipped and the second is carried in, which is the gap
    // the invariant exists to see.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(WorkbenchInvariant)
    const session = ctx.sessions.create(SessionId('invariant-dropped'))
    say(session, '第一句')
    const second = say(session, '第二句')
    expect(() => {
      session.append('workbench/utterance', {
        entryId: SourceId(`u${String(second.seq)}`), text: '第二句', rev: 0, createdAt: 0,
      })
    }).toThrow(/was never mirrored/)
  })
})
