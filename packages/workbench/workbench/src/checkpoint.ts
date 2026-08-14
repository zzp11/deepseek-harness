/**
 * The session's first checkpoint.
 * @module @deepseek-ai/dsh-workbench/checkpoint
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { snapshotOf, type WorkbenchState } from './store.ts'

/**
 * Append a checkpoint if this session has none yet.
 *
 * The browser folds the event family into one Context whose start is a
 * checkpoint; without one, every later event is an update with no state to update
 * and the tab stays empty until the interval happens to fire. An empty whole-value
 * checkpoint is also the honest anchor for cold-start replay.
 * @param session - the session about to take its first workbench event.
 * @param state - its projection.
 */
export function ensureCheckpoint(session: Session, state: WorkbenchState): void {
  if (session.events.some(event => event.type === 'workbench/snapshot')) return
  session.append('workbench/snapshot', snapshotOf(state))
}
