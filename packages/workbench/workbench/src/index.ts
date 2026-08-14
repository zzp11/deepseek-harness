/**
 * The workbench host plugin. It owns three things and delegates everything else:
 * a projection per session, the mirror that carries a person's words into the
 * first-hand layer, and one command that is the human write path.
 *
 * The write path is a command rather than a gateway RPC method. `commands.execute`
 * is already a Remote any browser plugin may call programmatically, and the
 * registry resolves the name at call time, so a new command needs no new wire
 * method and no generated descriptor — the browser reaches this handler without a
 * line changing in the API gateway. The handler answers with
 * `sourceEventSeq` and the browser reads the real change off the event stream it
 * already subscribes to, which keeps one fact in one place.
 * @module @deepseek-ai/dsh-workbench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { NodeId, SourceId } from './brand.ts'
import { ensureCheckpoint } from './checkpoint.ts'
import { planEdit, type EditClock, type EditRequest } from './edit.ts'
import { renderFindings } from './gates.ts'
import type { WorkbenchUtterance } from './events.ts'
import { WORKBENCH_PROMPT_NAME, WORKBENCH_PROMPT_ORDER, WORKBENCH_SYSTEM_PROMPT } from './prompt.ts'
import {
  applyWorkbenchEvent, emptyWorkbenchState, shouldSnapshot, snapshotOf, WORKBENCH_EVENT_TYPES,
  type WorkbenchEvent, type WorkbenchState,
} from './store.ts'
import { registerWorkbenchTools } from './tools.ts'

export const name = 'workbench'
export const inject = ['commands', 'sessions', 'tools', 'systemPrompt']

/** The command name the browser dispatches; a person never types it. */
export const EDIT_COMMAND = 'workbench-edit'

/** Deployment-varying choices this plugin exposes to cordis.yml. */
export interface Config {
  /**
   * How many `workbench/node-change` events may accumulate before a checkpoint
   * is appended. A promotion always checkpoints regardless. Lower costs log
   * bytes; higher costs cold-start replay.
   */
  snapshotEveryChanges: number
}

export const Config: z<Config> = z.object({
  snapshotEveryChanges: z.natural().min(1).default(50)
    .description('node-change events between checkpoints; a promotion always checkpoints'),
})

/**
 * Mount the projection, the first-hand mirror, the edit command, and the
 * model-facing surface.
 * @param ctx - Cordis context carrying the command, tool, and prompt registries.
 * @param config - the checkpoint interval.
 */
export function apply(ctx: Context, config: Config): void {
  const projections = new Map<SessionId, WorkbenchState>()

  /** The projection for one session, rebuilt from its log the first time it is asked for. */
  const projectionOf = (session: Session): WorkbenchState => {
    const existing = projections.get(session.id)
    if (existing !== undefined) return existing
    const state = emptyWorkbenchState()
    for (const event of session.events) foldIfWorkbench(state, event)
    projections.set(session.id, state)
    return state
  }

  ctx.effect(() => {
    // The mirror's append lands in a later microtask, after this fiber may have
    // gone; the flag is what tells that continuation to stop.
    const mounted = { live: true }
    const dispose = ctx.on('session/event', (session, event) => {
      const state = projections.get(session.id)
      if (state !== undefined) foldIfWorkbench(state, event)
      if (event.type === 'user/message') mirrorUtterance(ctx, mounted, session, projectionOf(session), event)
    })
    return () => {
      mounted.live = false
      dispose()
      projections.clear()
    }
  }, 'workbench: session projection and first-hand mirror')

  ctx.systemPrompt.section({
    name: WORKBENCH_PROMPT_NAME,
    order: WORKBENCH_PROMPT_ORDER,
    text: WORKBENCH_SYSTEM_PROMPT,
  })
  registerWorkbenchTools(ctx, projectionOf)

  ctx.effect(() => ctx.commands.register({
    name: EDIT_COMMAND,
    description: '工作台编辑（由工作台界面调用，不用手打）',
    // The node-change events own the payload; recording the line again would
    // put the same edit in the log twice.
    recordInput: false,
    handler: invocation => runEditCommand(invocation, projectionOf, config),
  }), 'workbench: edit command')
}

/** Fold one session event into a projection when it belongs to the workbench family. */
function foldIfWorkbench(state: WorkbenchState, event: SessionEvent): void {
  if (!WORKBENCH_EVENT_TYPES.has(event.type)) return
  applyWorkbenchEvent(state, event as unknown as WorkbenchEvent)
}

/**
 * Carry a person's message into the first-hand layer, unchanged.
 *
 * Custom session events never reach a model request, so the words have to travel
 * twice: the message itself is what the model reads, and this mirror is what the
 * tree cites. The append is deferred to a microtask because `session.append`
 * refuses to reenter while an append is being published, and this runs inside
 * that publication.
 */
function mirrorUtterance(
  ctx: Context,
  mounted: { live: boolean },
  session: Session,
  state: WorkbenchState,
  event: SessionEvent,
): void {
  const text = messageText(event)
  if (text === '') return
  const utterance: WorkbenchUtterance = {
    entryId: SourceId(`u${String(event.seq)}`),
    text,
    rev: state.meta.rev,
    createdAt: event.time,
  }
  queueMicrotask(() => {
    // The fiber may have gone, or the session been detached, between the message
    // and this microtask; either way there is nothing left to mirror into.
    /* v8 ignore next -- awaiting either teardown drains this microtask first, so the losing order cannot be staged from the public API */
    if (!mounted.live || ctx.sessions.get(session.id) !== session) return
    // The mirror is usually a session's FIRST workbench event, so it anchors the
    // log like every other write: the browser folds this family into one Context
    // whose start is a checkpoint, and an utterance arriving first would be an
    // update with no state to update.
    ensureCheckpoint(session, state)
    session.append('workbench/utterance', utterance)
  })
}

/**
 * The verbatim words of a `user/message`: its text blocks, joined, with
 * everything else (attachments, tool results carried on the same message)
 * dropped. Read structurally because the message is durable data another package
 * wrote, and a message with no words at all is not an utterance.
 * @param event - the `user/message` event.
 * @returns the words, or `''` when it carries none.
 */
function messageText(event: SessionEvent): string {
  const { content } = event.data as { content?: unknown }
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      const candidate = block as { type?: unknown; text?: unknown }
      return candidate.type === 'text' && typeof candidate.text === 'string'
    })
    .map(block => block.text)
    .join('\n')
}

/**
 * Run one edit command: parse the request, plan it, and append the plan.
 * @param invocation - the command invocation; `rawInput` is the JSON request.
 * @param projectionOf - resolves the invoking agent's session projection.
 * @param config - the checkpoint interval.
 * @returns the command result: the last appended event's seq, or the refusal.
 */
function runEditCommand(
  invocation: CommandInvocation,
  projectionOf: (session: Session) => WorkbenchState,
  config: Config,
): CommandResult {
  const request = parseEditRequest(invocation.rawInput)
  if (request === undefined) return { kind: 'error', text: '工作台编辑请求不是合法 JSON' }
  const session = invocation.agent.session
  const state = projectionOf(session)
  const plan = planEdit(state, request, sessionClock(session))
  if (!plan.ok) {
    return {
      kind: 'error',
      text: plan.failure.kind === 'gate' ? renderFindings(plan.failure.findings) : plan.failure.message,
    }
  }
  ensureCheckpoint(session, state)
  let lastSeq = session.seq
  for (const event of plan.events) {
    lastSeq = session.append(event.type, event.data).seq
  }
  const lastChange = plan.events.at(-1)
  if (lastChange?.type === 'workbench/node-change' && shouldSnapshot(state, lastChange.data, config.snapshotEveryChanges)) {
    lastSeq = session.append('workbench/snapshot', snapshotOf(state)).seq
  }
  return { kind: 'success', sourceEventSeq: lastSeq }
}

/**
 * Read an edit request off a command line. The line crosses a wire from the
 * browser, so it is validated here rather than trusted: `planEdit` sees only a
 * well-formed request.
 * @param rawInput - the text after the command name.
 * @returns the request, or `undefined` when the line is not one.
 */
export function parseEditRequest(rawInput: string): EditRequest | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    // A malformed line is the browser's bug or a person typing the command by
    // hand; either way the answer is the same refusal, not a thrown handler.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const request = parsed as { op?: unknown }
  return typeof request.op === 'string' ? parsed as EditRequest : undefined
}

/**
 * Mint node ids and timestamps for one session. Ids are derived from the log
 * length, so they are unique within the session and stable under replay.
 */
function sessionClock(session: Session): EditClock {
  let minted = 0
  return {
    nodeId: () => NodeId(`n${String(session.seq)}-${String(minted++)}`),
    now: () => Date.now(),
  }
}
