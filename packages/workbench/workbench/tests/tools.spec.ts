import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRuntime from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { NodeId } from '../src/brand.ts'
import * as Workbench from '../src/index.ts'
import { WORKBENCH_PROMPT_NAME } from '../src/prompt.ts'
import { CHECK_PROMOTION_TOOL, PROPOSE_TOOL, READ_NODES_TOOL } from '../src/tools.ts'
import type { EditRequest } from '../src/edit.ts'
import type { WorkbenchNodeChange, WorkbenchProposal } from '../src/events.ts'

/** A composed host with the model-facing plane mounted. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(Workbench, { snapshotEveryChanges: 50 })
  return ctx
}

/** A live agent over a real session. */
function agentOn(ctx: Context, name: string): Agent {
  const session = ctx.sessions.create(SessionId(name))
  return { id: session.id, session } as Agent
}

/** Call one tool the way the executor does. */
async function call(ctx: Context, agent: Agent, name: string, args: unknown): Promise<unknown> {
  const result = await ctx.tools.execute({
    callId: `call-${name}` as never,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })
  return result
}

/** The canonical value of a tool result, failing the test on an error result. */
function value(result: unknown): Record<string, unknown> {
  const outcome = result as { isError?: boolean; value?: unknown; content?: unknown }
  if (outcome.isError === true) throw new Error(`tool failed: ${JSON.stringify(outcome.content)}`)
  return outcome.value as Record<string, unknown>
}

/** The rendered model-facing text of a tool result. */
function rendered(result: unknown): string {
  const blocks = (result as { content?: readonly { type: string; text?: string }[] }).content ?? []
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

/** Seed a tree through the human write path, which is the only way nodes exist. */
async function edit(ctx: Context, agent: Agent, request: EditRequest): Promise<void> {
  const execution = await ctx.commands.execute(
    agent,
    `/${Workbench.EDIT_COMMAND} ${JSON.stringify(request)}`,
    new AbortController().signal,
  )
  if (execution?.result.kind !== 'success') {
    throw new Error(`edit refused: ${JSON.stringify(execution?.result)}`)
  }
}

/** The id of the node the last commit wrote. */
function lastNodeId(session: Session): NodeId {
  const changes = session.events.filter(event => event.type === 'workbench/node-change')
  const last = changes.at(-1)?.data as WorkbenchNodeChange
  return last.node.id
}

/** Say something as the person, so the mirror creates a citable first-hand entry. */
function say(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** The workbench events of one type. */
function eventsOf(session: Session, type: string): readonly SessionEvent[] {
  return session.events.filter(event => event.type === type)
}

describe('the prompt section', () => {
  it('tells the model to read the dependency set instead of assembling its own', async () => {
    const ctx = await mount()
    const assembly = await ctx.systemPrompt.assemble()
    const text = assembly.sections.find(section => section.name === WORKBENCH_PROMPT_NAME)?.text ?? ''
    expect(text).toContain('先不带 `nodeId` 调一次 `workbench_read_nodes`')
    expect(text).toContain('不要自己推断还需要什么')
    expect(text).toContain('你唯一的写路径是 `workbench_propose`')
    expect(text).toContain('你**不能**晋升节点')
  })
})

describe(READ_NODES_TOOL, () => {
  it('hands over the whole dependency set, mechanically expanded', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'read')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '内部分享' })
    const root = lastNodeId(agent.session)
    await edit(ctx, agent, { op: 'update-field', nodeId: root, field: 'duty', value: '把这次分享带到能讲的状态' })
    await edit(ctx, agent, { op: 'create-child', parentId: root, title: '场地' })
    const leaf = lastNodeId(agent.session)

    const result = await call(ctx, agent, READ_NODES_TOOL, { nodeId: leaf })
    const canonical = value(result)
    expect(canonical.nodeId).toBe(leaf)
    const kinds = (canonical.dependencySet as { kind: string }[]).map(item => item.kind)
    expect(kinds).toEqual(['self', 'ancestor', 'skeleton'])

    const text = rendered(result)
    expect(text).toContain('机械展开，未经取舍')
    expect(text).toContain('把这次分享带到能讲的状态')
    expect(text).toContain('【骨架】')
  })

  it('hands over the tree index when no node is named, so a cold start is not a dead end', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'read-cold')

    // An empty tree: the index is empty, and that is a readable answer rather
    // than an error the model has to work around.
    const empty = value(await call(ctx, agent, READ_NODES_TOOL, {}))
    expect(empty.nodeId).toBeNull()
    expect((empty.dependencySet as { kind: string }[]).map(item => item.kind)).toEqual(['skeleton'])

    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '内部分享' })
    const seeded = value(await call(ctx, agent, READ_NODES_TOOL, {}))
    const index = (seeded.dependencySet as { kind: string; content: string }[])
      .find(item => item.kind === 'skeleton')
    expect(index?.content).toContain('内部分享')
  })

  it('points a bad node id at the cold-start read instead of just failing', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'read-missing')
    const result = await call(ctx, agent, READ_NODES_TOOL, { nodeId: 'ghost' })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(JSON.stringify((result as { content?: unknown }).content))
      .toContain('call workbench_read_nodes with no nodeId')
  })
})

describe(PROPOSE_TOOL, () => {
  it('records a skeleton as a draft and writes nothing to the tree', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose')
    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '候选骨架',
      newNodes: [
        { title: '目标', duty: '说清为什么办这次分享' },
        { title: '内容', duty: '讲什么' },
        { title: '场地' },
      ],
    })
    const canonical = value(result)
    expect(canonical.kind).toBe('drafted')
    expect(rendered(result)).toContain('等人裁决')

    const drafts = eventsOf(agent.session, 'workbench/proposal')
    expect(drafts).toHaveLength(1)
    expect((drafts[0]?.data as WorkbenchProposal).newNodes).toHaveLength(3)
    // The model's only write path does not reach the tree.
    expect(eventsOf(agent.session, 'workbench/node-change')).toHaveLength(0)
  })

  it('carries every part of a rich draft into the recorded event', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose-rich')
    say(agent.session, '讲者不该为了讲这个准备一整周')
    await Promise.resolve()
    const entryId = (eventsOf(agent.session, 'workbench/utterance')[0]?.data as { entryId: string }).entryId
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '门票' })
    const target = lastNodeId(agent.session)

    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '补内容',
      targetNode: target,
      summary: '补正文和一个字段',
      body: '草稿正文',
      fields: [{ name: '准备成本', value: '低', sourceId: entryId }],
      newNodes: [{
        title: '子节点',
        parent: target,
        duty: '管子事',
        body: '子正文',
        fields: [{ name: '准备成本', value: '高', sourceId: entryId }],
      }],
    })
    expect(value(result).kind).toBe('drafted')
    const draft = eventsOf(agent.session, 'workbench/proposal')[0]?.data as WorkbenchProposal
    expect(draft.summary).toBe('补正文和一个字段')
    expect(draft.body).toBe('草稿正文')
    expect(draft.fields).toEqual([{ name: '准备成本', value: '低', sourceId: entryId }])
    expect(draft.newNodes).toEqual([{
      title: '子节点',
      parent: target,
      duty: '管子事',
      body: '子正文',
      fields: [{ name: '准备成本', value: '高', sourceId: entryId }],
    }])
  })

  it('carries parentIndex through, so a cold-start draft can describe a tree', async () => {
    // Without this the reader dropped the field and the model's shape never reached the
    // log — every card would land at the root on accept.
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose-shaped')
    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '冷启动骨架',
      newNodes: [
        { title: '总纲', duty: '管全局' },
        { title: '场地', parentIndex: 0 },
      ],
    })
    expect(value(result).kind).toBe('drafted')
    const draft = eventsOf(agent.session, 'workbench/proposal')[0]?.data as WorkbenchProposal
    expect(draft.newNodes).toEqual([
      { title: '总纲', duty: '管全局' },
      { title: '场地', parentIndex: 0 },
    ])
  })

  it('refuses a draft that could never land, instead of recording it', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose-blocked')
    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '挂错地方',
      newNodes: [{ title: '场地', parent: 'ghost' }],
    })
    const canonical = value(result)
    expect(canonical.kind).toBe('blocked')
    expect((canonical.findings as { code: string }[]).map(finding => finding.code)).toEqual(['GATE_DANGLING_REF'])
    expect(eventsOf(agent.session, 'workbench/proposal')).toHaveLength(0)
  })

  it('refuses an unregistered, uncited field on a committed node', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose-committed')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '门票' })
    const node = lastNodeId(agent.session)
    await edit(ctx, agent, { op: 'promote', nodeId: node, maturity: 'committed' })

    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '补字段',
      targetNode: node,
      fields: [{ name: '准备成本', value: '低' }],
    })
    const codes = (value(result).findings as { code: string }[]).map(finding => finding.code).sort()
    expect(codes).toEqual(['GATE_NO_EVIDENCE', 'GATE_UNREGISTERED_FIELD'])
  })

  it('says the node is missing rather than reporting a gate, when the target is gone', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'propose-ghost-target')
    const result = await call(ctx, agent, PROPOSE_TOOL, { title: 'x', targetNode: 'ghost' })
    expect((value(result).findings as { message: string }[])[0]?.message).toContain('先调 workbench_read_nodes')
  })
})

describe(`${PROPOSE_TOOL} content bodies`, () => {
  it('records the bodies a draft offers, in the order given', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'bodies')
    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '一张成形的卡',
      newNodes: [{
        title: '形式',
        bodies: [
          { label: '简介', kind: 'brief', duty: '定怎么讲', body: '十五分钟随便讲讲' },
          { label: '流程图', kind: 'flow', steps: ['定主题', '找讲师', '开放报名'] },
          { label: '对比', kind: 'table', columns: ['做法', '准备成本'], rows: [['正式', '8'], ['随便讲', '2']] },
          { label: '论证', kind: 'argument', stance: '不要求 PPT', grounds: ['准备成本低', '反：不够正式'] },
        ],
      }],
    })
    expect(value(result).kind).toBe('drafted')
    const draft = agent.session.events.find(event => event.type === 'workbench/proposal')?.data as WorkbenchProposal
    const offered = draft.newNodes?.[0]?.bodies ?? []
    expect(offered.map(body => body.payload.kind)).toEqual(['brief', 'flow', 'table', 'argument'])
  })

  it('gives every addressable object an id, which is what an anchor cites', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'ids')
    await call(ctx, agent, PROPOSE_TOOL, {
      title: '带流程',
      newNodes: [{ title: '形式', bodies: [{ label: '流程图', kind: 'flow', steps: ['甲', '乙'] }] }],
    })
    const draft = agent.session.events.find(event => event.type === 'workbench/proposal')?.data as WorkbenchProposal
    const payload = draft.newNodes?.[0]?.bodies?.[0]?.payload
    expect(payload?.kind === 'flow' && payload.steps.map(step => step.stepId)).toEqual(['s0', 's1'])
  })

  it('reads 反： as opposing the stance rather than as part of the text', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'against')
    await call(ctx, agent, PROPOSE_TOOL, {
      title: '论证',
      newNodes: [{ title: '形式', bodies: [{ label: '论证', kind: 'argument', stance: '甲', grounds: ['反：乙'] }] }],
    })
    const draft = agent.session.events.find(event => event.type === 'workbench/proposal')?.data as WorkbenchProposal
    const payload = draft.newNodes?.[0]?.bodies?.[0]?.payload
    expect(payload?.kind === 'argument' && payload.grounds[0]).toEqual({ groundId: 'g0', text: '乙', opposes: true })
  })

  it('refuses each kind whose own fields are missing, and records no draft', async () => {
    const incomplete = [
      { label: '简介', kind: 'brief', duty: '只有职责' },
      { label: '表格', kind: 'table', columns: ['a'] },
      { label: '流程', kind: 'flow' },
      { label: '论证', kind: 'argument', stance: '只有立场' },
    ]
    for (const body of incomplete) {
      const ctx = await mount()
      const agent = agentOn(ctx, `bad-${body.kind}`)
      const result = await call(ctx, agent, PROPOSE_TOOL, { title: '坏草稿', bodies: [body] })
      const canonical = value(result)
      expect(canonical.kind).toBe('blocked')
      expect(agent.session.events.filter(event => event.type === 'workbench/proposal')).toHaveLength(0)
    }
  })

  it('carries replaces through, which is how one round revises an existing body', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'replaces')
    await call(ctx, agent, PROPOSE_TOOL, {
      title: '改一版',
      targetNode: 'anything',
      bodies: [{ label: '简介', kind: 'brief', duty: '新职责', body: '新正文', replaces: 'b1' }],
    })
    // The draft is refused for its dangling target, which is a different gate; what
    // this pins is that `replaces` survived the read rather than being dropped.
    const drafted = agent.session.events.find(event => event.type === 'workbench/proposal')
    expect(drafted).toBeUndefined()
  })

  it('refuses a malformed body on a proposed node too, not only on the target', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'bad-nested')
    const result = await call(ctx, agent, PROPOSE_TOOL, {
      title: '坏草稿',
      newNodes: [{ title: '形式', bodies: [{ label: '流程', kind: 'flow' }] }],
    })
    expect(value(result).kind).toBe('blocked')
  })
})

describe(CHECK_PROMOTION_TOOL, () => {
  it('reports what a node still needs, and does not promote it', async () => {
    const ctx = await mount()
    const agent = agentOn(ctx, 'check')
    await edit(ctx, agent, { op: 'create-child', parentId: null, title: '内容' })
    const parent = lastNodeId(agent.session)
    await edit(ctx, agent, { op: 'create-child', parentId: parent, title: '一个小节' })

    const blocked = await call(ctx, agent, CHECK_PROMOTION_TOOL, { nodeId: parent })
    expect(value(blocked).kind).toBe('blocked')
    expect((value(blocked).findings as { code: string }[]).map(finding => finding.code)).toEqual(['GATE_MISSING_DUTY'])
    expect(rendered(blocked)).toContain('还差')
    // Nothing was written: the maturity is still where the person left it.
    const changes = eventsOf(agent.session, 'workbench/node-change')
    expect((changes.at(-1)?.data as WorkbenchNodeChange).op).toBe('create')

    await edit(ctx, agent, { op: 'update-field', nodeId: parent, field: 'duty', value: '讲什么' })
    const ready = await call(ctx, agent, CHECK_PROMOTION_TOOL, { nodeId: parent })
    expect(value(ready).kind).toBe('ready')
    expect(rendered(ready)).toContain('晋升要人来点')
  })
})

describe('a call with no agent behind it', () => {
  it('fails rather than guessing which session it meant', async () => {
    const ctx = await mount()
    const result = await ctx.tools.execute({
      callId: 'call-orphan' as never,
      name: READ_NODES_TOOL,
      arguments: { nodeId: 'n1' },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
  })
})

describe('the model has no write path into the tree', () => {
  it('registers exactly three tools, none of which promotes', async () => {
    const ctx = await mount()
    const names = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('workbench'))
    expect(names.sort()).toEqual([CHECK_PROMOTION_TOOL, PROPOSE_TOOL, READ_NODES_TOOL].sort())
  })

  it('unregisters them when the fiber goes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentRuntime)
    const fiber = await ctx.plugin(Workbench, { snapshotEveryChanges: 50 })
    expect(ctx.tools.schemas().some(schema => schema.name === PROPOSE_TOOL)).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === PROPOSE_TOOL)).toBe(false)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === WORKBENCH_PROMPT_NAME)).toBe(false)
  })
})
