/** The one-character maturity marks the tree and the focus pane both read. */

import type { Maturity } from '@deepseek-ai/dsh-workbench/projection'

/**
 * Mark per maturity rung. They are deliberately terse: a tree row is scanned,
 * not read, and the word itself is on the focused node.
 */
export const MATURITY_MARKS: Readonly<Record<Maturity, string>> = {
  thought: '○',
  idea: '△',
  committed: '◆',
  rejected: '✖',
}
