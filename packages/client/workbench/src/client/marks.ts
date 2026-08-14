/** The one-character marks the tree, the tag strip, and the card all read. */

import type { Maturity } from '@deepseek-ai/dsh-workbench/projection'

/**
 * Mark per maturity rung. Deliberately terse: a tree row is scanned, not read, and
 * the word itself sits on the focused card.
 */
export const MATURITY_MARKS: Readonly<Record<Maturity, string>> = {
  thought: '○',
  idea: '△',
  committed: '◆',
  rejected: '✖',
}

/** A node inside the global-constraint area. */
export const CONSTRAINT_MARK = '⚖'

/**
 * Results waiting to be read at or below a node.
 *
 * The count is the whole signal. A list of what is waiting would drown the person,
 * while a number tells them there is something without deciding when they look.
 */
export const REMINDER_MARK = '⚑'

/** An authored body that may no longer agree with its newer siblings. */
export const STALE_MARK = '⚠'

/** A derived view — computed per read, so it can neither be edited nor go stale. */
export const DERIVED_PREFIX = '⁄'
