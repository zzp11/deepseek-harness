/**
 * The model-facing surface: one tool to read a node's dependency set, one to
 * propose against it, and one to ask whether a node would pass the promotion
 * gate. There is deliberately no tool that promotes — see
 * {@link CHECK_PROMOTION_TOOL}.
 * @module @deepseek-ai/dsh-workbench/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import { NodeId, ProposalId, SourceId } from './brand.ts'
import { ensureCheckpoint } from './checkpoint.ts'
import { dependencySet, expand, requireNode, treeIndexSet } from './core.ts'
import { blockingFindings, gateDuty, gateEvidence, gateRegisteredFields, type GateFinding } from './gates.ts'
import type { ProposedField, ProposedNode } from './events.ts'
import {
  presentCheckPromotionCall, presentProposeCall, presentReadNodesCall, readOnlyConcurrency,
} from './present.ts'
import { planProposal, type ProposalDraft } from './propose.ts'
import type { WorkbenchState } from './store.ts'

/** Reads the dependency set of one node, expanded mechanically. */
export const READ_NODES_TOOL = 'workbench_read_nodes'
/** Records one draft; the model's only write path. */
export const PROPOSE_TOOL = 'workbench_propose'
/**
 * Reports whether one node would pass the promotion gate, and what is missing.
 *
 * It does not promote. Promotion is the moment a person commits to something, and
 * the design's second hard constraint is that nothing the model produces enters
 * the tree without a human verdict — a model-driven promotion would be exactly
 * that. What this gives the model is the missing list, so it can fix it the only
 * way it can: by proposing.
 */
export const CHECK_PROMOTION_TOOL = 'workbench_check_promotion'

/** Resolves the projection of the session a tool call is running in. */
export type ProjectionResolver = (session: Session) => WorkbenchState

/** One gate finding as the model reads it. */
interface ModelFinding {
  readonly code: string
  readonly message: string
}

/** Project findings into the model-facing list. */
function modelFindings(findings: readonly GateFinding[]): ModelFinding[] {
  return findings.map(finding => ({ code: finding.code, message: finding.message }))
}

/** The session a tool call belongs to, refusing a call with no agent behind it. */
function sessionOf(exec: ToolExecution): Session {
  if (exec.agent === undefined) throw new Error('workbench tools require an Agent-backed session')
  return exec.agent.session
}

/** Schema of one gate-finding list, shared by the two tools that can refuse. */
const FINDINGS_SCHEMA = {
  type: 'array',
  required: true,
  description: '拦住这一步的闸门，每条带它自己的说明。',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
    },
  },
} as const

/** Schema of one proposed field, shared by the draft's own fields and its new nodes. */
const PROPOSED_FIELD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true, description: '字段名。已承诺区必须是已登记的名字。' },
    value: { type: 'string', required: true },
    sourceId: { type: 'string', description: '一手层条目 id：这个取值是从哪句原话来的。已承诺区必填。' },
  },
} as const

/**
 * Register the three tools and the prompt section's companion behavior.
 * @param ctx - Cordis context carrying the tool registry.
 * @param projectionOf - resolves the calling session's projection.
 */
export function registerWorkbenchTools(ctx: Context, projectionOf: ProjectionResolver): void {
  ctx.tools.register(defineTool({
    name: READ_NODES_TOOL,
    description:
      '读一个工作台节点的依赖集：它自己的全部字段、父链的职责与正文、全部全局约束、它的字段引用的一手层原话，'
      + '以及整棵树的索引。这是机械展开的完整结果，不要在它之外自己推断依赖——需要别的节点就再调一次。'
      + '**不知道有哪些节点时，不要传 nodeId**：那样只返回全局约束和整棵树的索引，树是空的就返回空索引。',
    parameters: {
      nodeId: {
        type: 'string',
        description: '要读哪个节点。留空只看全局约束和树的索引——冷启动时就该留空。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          dependencySet: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['self', 'ancestor', 'constraint', 'source', 'skeleton'] },
                id: { type: 'string', required: true },
                rev: { type: 'integer', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: expand(value.dependencySet) }],
    },
    execute(args, exec) {
      const state = projectionOf(sessionOf(exec))
      if (args.nodeId === undefined) {
        return Promise.resolve({ nodeId: null, dependencySet: treeIndexSet(state) })
      }
      const nodeId = NodeId(args.nodeId)
      requireNode(state, nodeId)
      return Promise.resolve({ nodeId, dependencySet: dependencySet(state, nodeId) })
    },
    presentCall: presentReadNodesCall,
    isConcurrencySafe: readOnlyConcurrency,
  }))

  ctx.tools.register(defineTool({
    name: PROPOSE_TOOL,
    description:
      '提一份草稿。这是你唯一的写路径，草稿不进本体：人会看、可能就地改、然后采纳或不要。'
      + '可以给一个已有节点补正文和字段，也可以提一批新节点（冷启动时的候选骨架）。'
      + '闸门当场校验，过不了会返回缺什么而不是记下一份落不了地的草稿。',
    parameters: {
      title: { type: 'string', required: true, description: '一行说清这份草稿是什么。' },
      targetNode: { type: 'string', description: '这份草稿针对哪个节点。提新骨架时留空。' },
      summary: { type: 'string', description: '给人看的一句话摘要。' },
      body: { type: 'string', description: '给 targetNode 的正文。' },
      fields: { type: 'array', description: '给 targetNode 提的字段。', items: PROPOSED_FIELD_SCHEMA },
      newNodes: {
        type: 'array',
        description: '提议新建的节点。parent 留空就挂在 targetNode 下（targetNode 也为空则挂到根）。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true },
            parent: { type: 'string', description: '已存在的父节点 id。' },
            duty: { type: 'string', description: '这个节点管什么。有子节点的节点晋升时必须有。' },
            body: { type: 'string' },
            fields: { type: 'array', items: PROPOSED_FIELD_SCHEMA },
          },
        },
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: ['drafted'] },
              proposalId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: ['blocked'] },
              findings: FINDINGS_SCHEMA,
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'drafted'
          ? `草稿 ${value.proposalId} 已记下，等人裁决。`
          : `这份草稿现在落不了地：\n${value.findings.map(finding => `${finding.code}: ${finding.message}`).join('\n')}`,
      }],
    },
    execute(args, exec) {
      const session = sessionOf(exec)
      const state = projectionOf(session)
      const draft = readDraft(args)
      const plan = planProposal(state, draft, {
        proposalId: () => ProposalId(`p${String(session.seq)}`),
        now: () => Date.now(),
      })
      if (!plan.ok) return Promise.resolve({ kind: 'blocked' as const, findings: modelFindings(plan.findings) })
      ensureCheckpoint(session, state)
      for (const event of plan.events) session.append(event.type, event.data)
      return Promise.resolve({ kind: 'drafted' as const, proposalId: plan.proposalId })
    },
    presentCall: presentProposeCall,
  }))

  ctx.tools.register(defineTool({
    name: CHECK_PROMOTION_TOOL,
    description:
      '问一个节点现在能不能晋升到已承诺，缺什么。**它不晋升**——晋升是人的动作。'
      + '拿到缺项后用 workbench_propose 去补。',
    parameters: {
      nodeId: { type: 'string', required: true },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string', required: true, enum: ['ready'] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: ['blocked'] },
              findings: FINDINGS_SCHEMA,
            },
          },
        ],
      },
      render: (args, value) => [{
        type: 'text',
        text: value.kind === 'ready'
          ? `${args.nodeId} 现在过晋升门；晋升要人来点。`
          : `${args.nodeId} 还差：\n${value.findings.map(finding => `${finding.code}: ${finding.message}`).join('\n')}`,
      }],
    },
    execute(args, exec) {
      const state = projectionOf(sessionOf(exec))
      const node = requireNode(state, NodeId(args.nodeId))
      // Gate the node as it would stand after promotion, not as it stands now:
      // the committed-region gates are exactly the ones that say nothing until
      // the maturity changes.
      const committed = { ...node, maturity: 'committed' as const }
      const findings = blockingFindings([
        ...gateRegisteredFields(state, committed),
        ...gateEvidence(committed),
        ...gateDuty(state, committed, { promoting: true }),
      ])
      return Promise.resolve(findings.length === 0
        ? { kind: 'ready' as const }
        : { kind: 'blocked' as const, findings: modelFindings(findings) })
    },
    presentCall: presentCheckPromotionCall,
    isConcurrencySafe: readOnlyConcurrency,
  }))
}

/** Read the tool arguments into a draft, branding the ids they carry. */
function readDraft(args: {
  title: string
  targetNode?: string
  summary?: string
  body?: string
  fields?: readonly { name: string; value: string; sourceId?: string }[]
  newNodes?: readonly {
    title: string
    parent?: string
    duty?: string
    body?: string
    fields?: readonly { name: string; value: string; sourceId?: string }[]
  }[]
}): ProposalDraft {
  return {
    targetNode: args.targetNode === undefined ? null : NodeId(args.targetNode),
    title: args.title,
    ...args.summary === undefined ? {} : { summary: args.summary },
    ...args.body === undefined ? {} : { body: args.body },
    ...args.fields === undefined ? {} : { fields: args.fields.map(readField) },
    ...args.newNodes === undefined ? {} : {
      newNodes: args.newNodes.map((proposed): ProposedNode => ({
        title: proposed.title,
        ...proposed.parent === undefined ? {} : { parent: NodeId(proposed.parent) },
        ...proposed.duty === undefined ? {} : { duty: proposed.duty },
        ...proposed.body === undefined ? {} : { body: proposed.body },
        ...proposed.fields === undefined ? {} : { fields: proposed.fields.map(readField) },
      })),
    },
  }
}

/** Brand one proposed field's citation. */
function readField(field: { name: string; value: string; sourceId?: string }): ProposedField {
  return {
    name: field.name,
    value: field.value,
    ...field.sourceId === undefined ? {} : { sourceId: SourceId(field.sourceId) },
  }
}
