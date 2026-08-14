/**
 * The stage-0 acceptance walkthrough, over a real composition: the concrete agent
 * loop, the shipping DeepSeek adapter pointed at a scripted mock provider, the
 * command registry, and this plugin. No API key, no stubbed tool registry — the
 * model's tool call arrives over the wire and enters `workbench_propose` through
 * the normal execution pipeline.
 *
 * It walks the two criteria stage 0 claims:
 *
 * - **Cold start to the first commitment**: one sentence, a model-proposed
 *   skeleton, the person pruning it before it lands, and a promotion the gate
 *   refuses until the tree can answer for itself.
 * - **A person's own edit lands immediately, free**: the edit reaches the log with
 *   no request leaving for the provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { NodeId } from '../src/brand.ts'
import type { EditRequest } from '../src/edit.ts'
import type { WorkbenchNodeChange, WorkbenchProposal, WorkbenchUtterance, WorkbenchVerdict } from '../src/events.ts'
import * as Workbench from '../src/index.ts'
import { PROPOSE_TOOL } from '../src/tools.ts'

let context: Context | undefined
const servers: MockLlmServer[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await Promise.all(servers.splice(0).map(server => server.close()))
})

/** The five-node skeleton the scripted model proposes for the cold start. */
const SKELETON = {
  title: '内部分享的候选骨架',
  newNodes: [
    { title: '目标', duty: '说清为什么办这次分享' },
    { title: '内容', duty: '讲什么' },
    { title: '场地' },
    { title: '时间' },
    { title: '宣传' },
  ],
}

/** Start a mock provider scripted to call one tool and then finish the turn. */
async function scriptedModel(toolName: string, toolArguments: unknown): Promise<MockLlmServer> {
  const server = await startMockLlmServer({
    sequence: ['tool_call_success', 'success'],
    toolName,
    toolArguments: JSON.stringify(toolArguments),
  })
  servers.push(server)
  return server
}

/** Compose the host: loop dependencies, the real adapter over the mock, commands, and the workbench. */
async function host(baseURL: string): Promise<Context> {
  vi.stubEnv('DEEPSEEK_API_KEY', 'mock-key')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LlmDeepSeek, { baseURL, streamIdleTimeoutMs: 5_000 })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(Workbench, { snapshotEveryChanges: 50 })
  await ctx.plugin(AgentLoop, { agents: [] })
  context = ctx
  return ctx
}

/** The one agent this walkthrough runs, over the scripted provider. */
function agentOf(ctx: Context, sessionId: string): Agent {
  return ctx.agentLoop.create(SessionId(sessionId), { provider: 'deepseek-official', model: 'mock-model' })
}

/** Say one sentence as the person and wait for the turn to settle. */
async function say(agent: Agent, text: string): Promise<void> {
  const idle = agent.whenIdle()
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await idle
  // The first-hand mirror appends in a later microtask.
  await Promise.resolve()
}

/** Dispatch one edit the way the tab does, and return the host's answer. */
async function edit(ctx: Context, agent: Agent, request: EditRequest): Promise<{ kind: string; text?: string }> {
  const execution = await ctx.commands.execute(
    agent,
    `/${Workbench.EDIT_COMMAND} ${JSON.stringify(request)}`,
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('the edit command is not registered')
  return execution.result
}

/** Events of one workbench type, in log order. */
function eventsOf(session: Session, type: string): readonly { data: unknown }[] {
  return session.events.filter(event => event.type === type)
}

/** The node ids the tree currently holds, in the order they were written. */
function nodeTitles(session: Session): string[] {
  const live = new Map<string, string>()
  for (const event of eventsOf(session, 'workbench/node-change')) {
    const change = event.data as WorkbenchNodeChange
    if (change.op === 'delete') live.delete(change.node.id)
    else live.set(change.node.id, change.node.title)
  }
  return [...live.values()]
}

describe('判据 1 — cold start to the first commitment', () => {
  it('walks one sentence, a proposed skeleton, the person pruning it, and a gated promotion', async () => {
    const model = await scriptedModel(PROPOSE_TOOL, SKELETON)
    const ctx = await host(model.baseURL)
    const agent = agentOf(ctx, 'workbench-criterion-1')

    // 1. The person says one sentence. It reaches the model as an ordinary
    //    message and the first-hand layer verbatim, and the model answers by
    //    proposing a skeleton.
    await say(agent, '就是想做个内部分享，别搞太正式')

    const utterances = eventsOf(agent.session, 'workbench/utterance')
    expect(utterances).toHaveLength(1)
    expect((utterances[0]?.data as WorkbenchUtterance).text).toBe('就是想做个内部分享，别搞太正式')

    // 2. The model's only write path produced a draft, and nothing entered the tree.
    const drafts = eventsOf(agent.session, 'workbench/proposal')
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]?.data as WorkbenchProposal
    expect(draft.newNodes?.map(proposed => proposed.title)).toEqual(['目标', '内容', '场地', '时间', '宣传'])
    expect(eventsOf(agent.session, 'workbench/node-change')).toHaveLength(0)

    // 3. The person holds the knife: three kept, one renamed, two pruned — and the
    //    pruning happens before the commit, so the dropped nodes never exist.
    const accepted = await edit(ctx, agent, {
      op: 'accept-proposal',
      proposalId: draft.proposalId,
      keptNodes: [{ index: 0, title: '为什么办' }, { index: 1 }, { index: 2 }],
    })
    expect(accepted.kind).toBe('success')
    expect(nodeTitles(agent.session)).toEqual(['为什么办', '内容', '场地'])

    // 4. One acceptance is one commit: the three nodes share one rev.
    const commits = eventsOf(agent.session, 'workbench/node-change')
      .map(event => (event.data as WorkbenchNodeChange).rev)
    expect(new Set(commits).size).toBe(1)

    // The ruling itself is recorded as the person's, and as edited.
    const verdict = eventsOf(agent.session, 'workbench/verdict')[0]?.data as WorkbenchVerdict
    expect(verdict.outcome).toBe('edited')

    // 5. The promotion gate charges its friction here and nowhere else. 场地 is
    //    the node the model proposed without a duty; giving it a child makes it a
    //    module, and a module nobody is answerable for cannot be committed to.
    const parent = NodeId(idOfTitle(agent.session, '场地'))
    await edit(ctx, agent, { op: 'create-child', parentId: parent, title: '候选场地一' })
    const blocked = await edit(ctx, agent, { op: 'promote', nodeId: parent, maturity: 'committed' })
    expect(blocked.kind).toBe('error')
    expect(blocked.text).toContain('GATE_MISSING_DUTY')

    // The person writes the duty, and the same promotion goes through.
    await edit(ctx, agent, { op: 'update-field', nodeId: parent, field: 'duty', value: '定在哪儿开，谁去借' })
    const promoted = await edit(ctx, agent, { op: 'promote', nodeId: parent, maturity: 'committed' })
    expect(promoted.kind).toBe('success')

    const promotion = eventsOf(agent.session, 'workbench/node-change')
      .map(event => event.data as WorkbenchNodeChange)
      .filter(change => change.op === 'promote')
    expect(promotion).toHaveLength(1)
    expect(promotion[0]?.node.maturity).toBe('committed')
    // A promotion always checkpoints, so a restart resumes from the commitment.
    expect(eventsOf(agent.session, 'workbench/snapshot').length).toBeGreaterThanOrEqual(2)

    // The whole walkthrough, as the log recorded it. Everything model-visible is
    // reconstructable from here, which is the property the design turns on.
    expect(agent.session.events.map(event => event.type).filter(type => type.startsWith('workbench/'))).toEqual([
      // The anchor comes first in every session: the browser folds this family
      // into one Context whose start is a checkpoint.
      'workbench/snapshot',
      'workbench/utterance',
      'workbench/proposal',
      'workbench/node-change',
      'workbench/node-change',
      'workbench/node-change',
      'workbench/verdict',
      'workbench/node-change',
      'workbench/node-change',
      'workbench/node-change',
      'workbench/snapshot',
    ])
  }, 30_000)
})

/** The id of the live node with this title. */
function idOfTitle(session: Session, title: string): string {
  for (const event of eventsOf(session, 'workbench/node-change')) {
    const change = event.data as WorkbenchNodeChange
    if (change.node.title === title) return change.node.id
  }
  throw new Error(`no node titled ${title}`)
}

describe('判据 3 — a person edits one line: immediate, no wait, no cost', () => {
  it('lands the edit and advances the rev without a single provider request', async () => {
    // Scripted but never consumed: any request reaching the provider shows up in
    // the server's own record, which is what makes "no model call" checkable
    // rather than asserted.
    const model = await scriptedModel(PROPOSE_TOOL, SKELETON)
    const ctx = await host(model.baseURL)
    const agent = agentOf(ctx, 'workbench-criterion-3')

    const created = await edit(ctx, agent, { op: 'create-child', parentId: null, title: '门票' })
    expect(created.kind).toBe('success')
    const nodeId = NodeId(idOfTitle(agent.session, '门票'))

    const before = (eventsOf(agent.session, 'workbench/node-change').at(-1)?.data as WorkbenchNodeChange).rev
    const edited = await edit(ctx, agent, {
      op: 'update-field', nodeId, field: 'body', value: '一张票 30，现场收现金',
    })
    expect(edited.kind).toBe('success')

    const latest = eventsOf(agent.session, 'workbench/node-change').at(-1)?.data as WorkbenchNodeChange
    expect(latest.node.body).toBe('一张票 30，现场收现金')
    expect(latest.rev).toBe(before + 1)
    expect(latest.actor).toBe('human')

    // Nothing was sent to the provider, and the agent never left idle.
    expect(model.requests).toHaveLength(0)
    await expect(agent.whenIdle()).resolves.toBeUndefined()
  }, 30_000)
})
