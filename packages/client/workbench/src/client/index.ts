/**
 * Browser half of the workbench: the 工作台 tab beside Chat, over the folded
 * `workbench/*` event family.
 *
 * Every write goes out as the `workbench-edit` command, dispatched
 * programmatically — a person never types a slash. The host answers with the seq
 * of the event it appended, and the change itself arrives back through the event
 * stream this tab already folds, so the tab never has to trust its own optimistic
 * copy of anything.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the commands Remote face onto ctx.remote.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row, declared by its owning package.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NodeId, ProposalId } from '@deepseek-ai/dsh-workbench/projection'
import type { EditOutcome, WorkbenchInjected } from './contract.ts'
import { registerWorkbenchFold } from './definition.ts'
import { en, zh, type WorkbenchKey } from './locales.ts'
import { createWorkbenchStore } from './store.ts'
import { WorkbenchTab } from './WorkbenchTab.tsx'

export type { EditOutcome, ProposalRow, TreeRow, WorkbenchInjected, WorkbenchSnapshot, WorkbenchTreeView } from './contract.ts'
export type { WorkbenchKey } from './locales.ts'
export type { WorkbenchStoreState } from './store.ts'
export { createWorkbenchStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The 工作台 tab's copy. */
    workbench: WorkbenchKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workbench'

/** The command the host registers for the human write path. */
const EDIT_COMMAND = 'workbench-edit'

/** Required services: the conversation slot ring, both fold registries, the commands Remote, and locale. */
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the fold, the view target, and the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-workbench: dictionaries')
  const t = ctx.locale.bind(NS)
  const store = createWorkbenchStore()
  registerWorkbenchFold(ctx)

  /**
   * Dispatch one edit and read the host's answer. A refusal comes back as the
   * host's own line; failure strings stay unlocalized, matching the client's
   * error-surface policy.
   */
  const dispatch = async (sessionId: SessionId, request: unknown): Promise<EditOutcome> => {
    const result = await ctx.remote.commands.execute(sessionId, `/${EDIT_COMMAND} ${JSON.stringify(request)}`)
    if (!result.ok) return { ok: false, message: `${result.error.message} (${result.error.code})` }
    if (result.value === undefined) return { ok: false, message: `unknown command: /${EDIT_COMMAND}` }
    const outcome = result.value.result
    return outcome.kind === 'success' ? { ok: true } : { ok: false, message: outcome.text }
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'workbench',
    order: 20,
    locale: NS,
    label: () => t('view.workbench'),
    store,
    inject: (sessionId: SessionId): WorkbenchInjected => ({
      createChild: (parentId: NodeId | null, title: string) =>
        dispatch(sessionId, { op: 'create-child', parentId, title }),
      updateField: (nodeId: NodeId, field: string, value: string) =>
        dispatch(sessionId, { op: 'update-field', nodeId, field, value }),
      promote: (nodeId: NodeId, maturity: 'committed' | 'rejected', note?: string) =>
        dispatch(sessionId, { op: 'promote', nodeId, maturity, ...note === undefined ? {} : { note } }),
      acceptProposal: (
        proposalId: ProposalId,
        edits: readonly { name: string; value: string }[],
        keptNodes?: readonly { index: number; title?: string }[],
      ) => dispatch(sessionId, {
        op: 'accept-proposal',
        proposalId,
        ...edits.length === 0 ? {} : { edits },
        ...keptNodes === undefined ? {} : { keptNodes },
      }),
      rejectProposal: (proposalId: ProposalId, reason: string) =>
        dispatch(sessionId, { op: 'reject-proposal', proposalId, reason }),
    }),
  }, WorkbenchTab))
}
