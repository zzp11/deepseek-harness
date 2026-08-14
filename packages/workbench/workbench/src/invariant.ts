/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-workbench`.
 * @module @deepseek-ai/dsh-workbench/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SourceId } from './brand.ts'
import type {} from './events.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-workbench'

/** Cordis companion plugin name. */
export const name = 'workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The mirror is the only thing keeping the first-hand layer and the model's
 * context from diverging: the words the model reads travel as `user/message`, the
 * words the tree cites travel as `workbench/utterance`, and a skipped mirror
 * leaves the tree missing a sentence the model has — silent drift of exactly the
 * kind this design exists to prevent.
 *
 * Checked as the mirror lands, which needs no deadline. Each entry is named after
 * the message it mirrors, so one arriving entry proves two things at once: that
 * its message exists, and that no earlier message was skipped. A dropped mirror
 * therefore surfaces at the next successful one. The trailing case — the newest
 * message, whose mirror is still in flight — has no synchronous answer and is
 * covered by this package's mirror specs instead.
 *
 * Validation runs on `internal/dispatch` rather than in a `session/event`
 * listener: the store contains listener failures per observer, so a companion
 * that threw there would report nothing. Pre-commit dispatch is also why the
 * incoming event is absent from `session.events` below.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'workbench/utterance') return
    const { entryId } = event.data
    const owed = messageEntryIds(session)
    if (!owed.includes(entryId)) {
      fail(`workbench/utterance ${entryId} mirrors no user/message in session ${session.id}`)
    }
    const mirrored = new Set(utteranceEntryIds(session))
    for (const earlier of owed.slice(0, owed.indexOf(entryId))) {
      if (!mirrored.has(earlier)) {
        fail(`user/message ${earlier} was never mirrored into the first-hand layer of session ${session.id}`)
      }
    }
  }, { global: true })
}, { inject: ['sessions'] })

/** The entry ids the mirror owes this session, in message order. */
function messageEntryIds(session: Session): SourceId[] {
  return session.events
    .filter(event => event.type === 'user/message')
    .map(event => SourceId(`u${String(event.seq)}`))
}

/** The entry ids the first-hand layer already holds. */
function utteranceEntryIds(session: Session): SourceId[] {
  return session.events
    .filter((event): event is SessionEvent<'workbench/utterance'> => event.type === 'workbench/utterance')
    .map(event => event.data.entryId)
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
