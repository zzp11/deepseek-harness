/**
 * Card presentation for the three workbench tools. Pure functions of the call
 * arguments, because they run on live streaming and again on session-log replay.
 * @module @deepseek-ai/dsh-workbench/present
 */

import type { ToolCallView } from '@deepseek-ai/dsh-tools'

/**
 * Pending card for a dependency-set read.
 * @param args - the call arguments.
 * @returns the call view.
 */
export function presentReadNodesCall(args: { nodeId?: string }): ToolCallView {
  return {
    card: 'generic',
    title: args.nodeId === undefined ? '读树的索引' : `读依赖集 ${args.nodeId}`,
    kind: 'read',
  }
}

/**
 * Pending card for a draft. The title is the draft's own one-line summary, which
 * is what a person scanning the stream needs to see.
 * @param args - the call arguments.
 * @returns the call view.
 */
export function presentProposeCall(args: { title: string }): ToolCallView {
  return { card: 'generic', title: `提草稿：${args.title}` }
}

/**
 * Pending card for a promotion check.
 * @param args - the call arguments.
 * @returns the call view.
 */
export function presentCheckPromotionCall(args: { nodeId: string }): ToolCallView {
  return { card: 'generic', title: `查晋升门 ${args.nodeId}`, kind: 'read' }
}

/**
 * Concurrency declaration shared by the two read-only tools: they derive from the
 * projection and write nothing, so parallel sub-calls cannot interfere. `propose`
 * deliberately does not carry it — it appends.
 * @returns always true.
 */
export const readOnlyConcurrency = (): boolean => true
