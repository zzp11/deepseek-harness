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
import { BodyId, BodyObjectId, NodeId, ProposalId, SourceId } from './brand.ts'
import { ensureCheckpoint } from './checkpoint.ts'
import { dependencySet, expand, requireNode, treeIndexSet } from './core.ts'
import { blockingFindings, gateDuty, gateEvidence, gateRegisteredFields, type GateFinding } from './gates.ts'
import type { ProposedBody, ProposedField, ProposedNode } from './events.ts'
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

  /**
 * Schema of one proposed content body. The payload is one of the authored kinds;
 * a derived view is deliberately absent — the model cannot offer a submodule map or
 * a chart, because those are computed from the tree and offering one would be a
 * second source for a fact that already has one.
 */
  const PROPOSED_BODY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', required: true, description: 'tag 条上显示的名字，两到四个字。' },
      replaces: { type: 'string', description: '要替换掉的内容体 id。改一份已有内容体时填它，不填就是新增。' },
      kind: {
        type: 'string',
        required: true,
        enum: ['brief', 'table', 'flow', 'argument'],
        description: 'brief 简介文档（每张卡必有一个）｜table 表格｜flow 流程图｜argument 论证图。',
      },
      duty: { type: 'string', description: 'kind=brief：这张卡管什么、不管什么，一两句。' },
      body: { type: 'string', description: 'kind=brief：展开的正文。' },
      columns: { type: 'array', description: 'kind=table：列名。', items: { type: 'string' } },
      rows: {
        type: 'array',
        description: 'kind=table：每行的单元格，顺序与 columns 一致。某一列每格都是纯数字时，图表会自动可用。',
        items: { type: 'array', items: { type: 'string' } },
      },
      steps: {
        type: 'array',
        description: 'kind=flow：按顺序的步骤。',
        items: { type: 'string' },
      },
      stance: { type: 'string', description: 'kind=argument：立场。' },
      grounds: {
        type: 'array',
        description: 'kind=argument：论据；以「反：」开头的表示反对这个立场。',
        items: { type: 'string' },
      },
    },
  } as const

  ctx.tools.register(defineTool({
    name: PROPOSE_TOOL,
    description:
      '提一份草稿。这是你唯一的写路径，草稿不进本体：人会看、可能就地改、然后采纳或不要。'
      + '可以给一个已有节点补正文、字段和内容体，也可以提一批新节点（冷启动时的候选骨架）。'
      + '一个模块通常需要不止一种形式才说得清：简介文档是必有的那一份，另外可以给流程图、表格、论证图。'
      + '闸门当场校验，过不了会返回缺什么而不是记下一份落不了地的草稿。',
    parameters: {
      title: { type: 'string', required: true, description: '一行说清这份草稿是什么。' },
      targetNode: { type: 'string', description: '这份草稿针对哪个节点。提新骨架时留空。' },
      summary: { type: 'string', description: '给人看的一句话摘要。' },
      body: { type: 'string', description: '给 targetNode 的正文。' },
      fields: { type: 'array', description: '给 targetNode 提的字段。', items: PROPOSED_FIELD_SCHEMA },
      bodies: {
        type: 'array',
        description:
          '给 targetNode 的内容体。复杂的东西用多种形式说清楚是应该的，一次可以提好几个；'
          + '改已有的那份就填它的 replaces。',
        items: PROPOSED_BODY_SCHEMA,
      },
      newNodes: {
        type: 'array',
        description:
          '提议新建的节点。可以一次提一棵树：用 parentIndex 指向这个列表里更靠前的一项，'
          + '就能表达层级——冷启动时父节点还不存在，parent 那个 id 无从填起。'
          + 'parent 与 parentIndex 都留空就挂在 targetNode 下（targetNode 也为空则挂到根）。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true },
            parent: { type: 'string', description: '已存在的父节点 id。' },
            parentIndex: {
              type: 'number',
              description:
                '父节点在本列表里的下标，必须比自己小（从上到下写这棵树就自然满足）。'
                + '冷启动提整棵骨架时用这个，不要用 parent。',
            },
            duty: { type: 'string', description: '这个节点管什么。有子节点的节点晋升时必须有。' },
            body: { type: 'string' },
            fields: { type: 'array', items: PROPOSED_FIELD_SCHEMA },
            bodies: { type: 'array', items: PROPOSED_BODY_SCHEMA },
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
      if (!draft.ok) {
        return Promise.resolve({
          kind: 'blocked' as const,
          findings: [{ code: 'GATE_MALFORMED_BODY', message: draft.message }],
        })
      }
      const plan = planProposal(state, draft.draft, {
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


/** One body read off the tool arguments, or the message naming what is missing. */
type BodyRead =
  | { readonly ok: true; readonly body: ProposedBody }
  | { readonly ok: false; readonly message: string }

/** Every body read off the tool arguments, or the first problem found. */
type BodiesRead =
  | { readonly ok: true; readonly bodies: ProposedBody[] }
  | { readonly ok: false; readonly message: string }

/** One content body as the tool receives it: flat, with the fields of one kind filled. */
interface RawBody {
  label: string
  replaces?: string
  kind: 'brief' | 'table' | 'flow' | 'argument'
  duty?: string
  body?: string
  columns?: readonly string[]
  rows?: readonly (readonly string[])[]
  steps?: readonly string[]
  stance?: string
  grounds?: readonly string[]
}

/**
 * Read one proposed body off the tool arguments, refusing a payload that does not
 * match the kind it claims.
 *
 * The tool surface is flat because a JSON-schema union is awkward for a model to
 * fill, so the pairing of `kind` with its own fields is checked here — a model/tool
 * JSON boundary, where a wrong combination must be refused rather than coerced into
 * an empty body that would look like a deliberate blank.
 *
 * Object ids are minted per body version. An anchor cites `(bodyId, objectId)` and
 * stays valid until the body is replaced, which is exactly when its target may have
 * ceased to exist.
 * @param raw - the body as the tool received it.
 * @returns the proposed body, or a message naming what is missing.
 */
function readBody(raw: RawBody): BodyRead {
  const head = { label: raw.label, ...raw.replaces === undefined ? {} : { replaces: BodyId(raw.replaces) } }
  switch (raw.kind) {
    case 'brief':
      if (raw.duty === undefined || raw.body === undefined) {
        return { ok: false, message: `内容体「${raw.label}」是 brief，必须同时给 duty 与 body` }
      }
      return { ok: true, body: { ...head, payload: { kind: 'brief', duty: raw.duty, body: raw.body } } }
    case 'table': {
      if (raw.columns === undefined || raw.rows === undefined) {
        return { ok: false, message: `内容体「${raw.label}」是 table，必须同时给 columns 与 rows` }
      }
      const rows = raw.rows.map((cells, index) => ({ rowId: BodyObjectId(`r${String(index)}`), cells: [...cells] }))
      return { ok: true, body: { ...head, payload: { kind: 'table', columns: [...raw.columns], rows } } }
    }
    case 'flow': {
      if (raw.steps === undefined) return { ok: false, message: `内容体「${raw.label}」是 flow，必须给 steps` }
      const steps = raw.steps.map((text, index) => ({ stepId: BodyObjectId(`s${String(index)}`), text }))
      return { ok: true, body: { ...head, payload: { kind: 'flow', steps } } }
    }
    case 'argument': {
      if (raw.stance === undefined || raw.grounds === undefined) {
        return { ok: false, message: `内容体「${raw.label}」是 argument，必须同时给 stance 与 grounds` }
      }
      const grounds = raw.grounds.map((text, index) => ({
        groundId: BodyObjectId(`g${String(index)}`),
        text: text.replace(/^反：/, ''),
        ...text.startsWith('反：') ? { opposes: true as const } : {},
      }))
      return { ok: true, body: { ...head, payload: { kind: 'argument', stance: raw.stance, grounds } } }
    }
    // defineTool validates arguments against the schema and throws ToolArgsError
    // before execute runs, so a kind outside the enum cannot reach this arm through
    // the tool. It stays because this function is the payload-validation boundary
    // and a caller need not arrive through that schema.
    /* v8 ignore next 2 -- unreachable through the schema-validated tool surface */
    default:
      return { ok: false, message: `内容体「${raw.label}」的 kind 不认识` }
  }
}

/**
 * Read every proposed body, stopping at the first malformed one.
 * @param raw - the bodies as the tool received them.
 * @returns the bodies, or the message naming the first problem.
 */
function readBodies(raw: readonly RawBody[]): BodiesRead {
  const bodies: ProposedBody[] = []
  for (const item of raw) {
    const read = readBody(item)
    if (!read.ok) return read
    bodies.push(read.body)
  }
  return { ok: true, bodies }
}

/** Read the tool arguments into a draft, branding the ids they carry. */
function readDraft(args: {
  title: string
  targetNode?: string
  summary?: string
  body?: string
  fields?: readonly { name: string; value: string; sourceId?: string }[]
  bodies?: readonly RawBody[]
  newNodes?: readonly {
    title: string
    parent?: string
    parentIndex?: number
    duty?: string
    body?: string
    fields?: readonly { name: string; value: string; sourceId?: string }[]
    bodies?: readonly RawBody[]
  }[]
}): { readonly ok: true; readonly draft: ProposalDraft } | { readonly ok: false; readonly message: string } {
  const own = readBodies(args.bodies ?? [])
  if (!own.ok) return own
  const created: ProposedNode[] = []
  for (const proposed of args.newNodes ?? []) {
    const bodies = readBodies(proposed.bodies ?? [])
    if (!bodies.ok) return bodies
    created.push({
      title: proposed.title,
      ...proposed.parent === undefined ? {} : { parent: NodeId(proposed.parent) },
      ...proposed.parentIndex === undefined ? {} : { parentIndex: proposed.parentIndex },
      ...proposed.duty === undefined ? {} : { duty: proposed.duty },
      ...proposed.body === undefined ? {} : { body: proposed.body },
      ...proposed.fields === undefined ? {} : { fields: proposed.fields.map(readField) },
      ...bodies.bodies.length === 0 ? {} : { bodies: bodies.bodies },
    })
  }
  return { ok: true, draft: {
    targetNode: args.targetNode === undefined ? null : NodeId(args.targetNode),
    title: args.title,
    ...args.summary === undefined ? {} : { summary: args.summary },
    ...args.body === undefined ? {} : { body: args.body },
    ...args.fields === undefined ? {} : { fields: args.fields.map(readField) },
    ...own.bodies.length === 0 ? {} : { bodies: own.bodies },
    ...created.length === 0 ? {} : { newNodes: created },
  } }
}

/** Brand one proposed field's citation. */
function readField(field: { name: string; value: string; sourceId?: string }): ProposedField {
  return {
    name: field.name,
    value: field.value,
    ...field.sourceId === undefined ? {} : { sourceId: SourceId(field.sourceId) },
  }
}
