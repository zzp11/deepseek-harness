/**
 * The right column: what was said on this card.
 *
 * Deliberately a digest, not a second chat. The full transcript — reasoning, token
 * lines, whole tool cards — belongs to the Chat tab, and those renderers cannot be
 * imported across the bundle-purity gate anyway. What earns its place here is the
 * exchange itself plus a pointer: a count never drowns the person, a list does.
 */
import type { FirstLayerEntry, NodeId, ProposalRow } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import styles from './WorkbenchTab.module.css'

/** One line of the digest, already ordered. */
export type TalkLine =
  | { readonly kind: 'said'; readonly id: string; readonly text: string }
  | { readonly kind: 'draft'; readonly id: string; readonly title: string; readonly ruled: boolean }

/** What the conversation column needs. */
export interface TalkColumnProps {
  readonly lines: readonly TalkLine[]
  readonly anchorLabel: string | null
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onClearAnchor: () => void
}

/**
 * Build the digest for one card: what was said while focused on it, then the drafts
 * that came back.
 *
 * Utterances carry the card they were said on, so this shows one module's exchange
 * rather than the whole session's. An utterance recorded before anything was focused
 * has no module and belongs to the opening of the session, which is why it shows at
 * the root.
 * @param entries - the first-hand layer.
 * @param proposals - the drafts and their rulings.
 * @param nodeId - the focused card, or null at the root.
 * @returns the lines, in log order.
 */
export function talkLines(
  entries: Iterable<FirstLayerEntry>,
  proposals: readonly ProposalRow[],
  nodeId: NodeId | null,
): TalkLine[] {
  const said: TalkLine[] = []
  for (const entry of entries) {
    const belongs = entry.moduleId === undefined ? nodeId === null : entry.moduleId === nodeId
    if (belongs) said.push({ kind: 'said', id: entry.entryId, text: entry.text })
  }
  const drafts: TalkLine[] = proposals
    .filter(row => row.proposal.targetNode === nodeId)
    .map(row => ({
      kind: 'draft' as const,
      id: row.proposal.proposalId,
      title: row.proposal.title,
      ruled: row.ruled,
    }))
  return [...said, ...drafts]
}

/**
 * Render the conversation column.
 * @param props - the digest, the anchor, copy, and the callbacks.
 * @returns the column element.
 */
export function TalkColumn(props: TalkColumnProps): React.JSX.Element {
  const { t } = props
  return (
    <div>
      {props.anchorLabel === null ? null : (
        <div className={styles.anchorBar}>
          <span>{t('talk.anchored', { what: props.anchorLabel })}</span>
          <button
            type="button"
            className={styles.anchorClear}
            aria-label={t('talk.clearAnchor')}
            onClick={props.onClearAnchor}
          >
            ×
          </button>
        </div>
      )}
      {props.lines.length === 0
        ? <p className={styles.empty}>{t('talk.empty')}</p>
        : props.lines.map(line => (
          <div key={line.id} className={styles.turn}>
            {line.kind === 'said'
              ? (
                <>
                  <p className={styles.turnWho}>{t('talk.you')}</p>
                  <p className={styles.turnBody}>{line.text}</p>
                </>
              )
              : (
                // Says a draft is waiting and no more: its 采纳／不要 sit on the card
                // itself, where the content being ruled on is visible.
                <div className={styles.turnTool}>
                  <span>{line.ruled ? t('talk.draftRuled') : t('talk.draftWaiting')}</span>
                  <span>{line.title}</span>
                </div>
              )}
          </div>
        ))}
    </div>
  )
}
