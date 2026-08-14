/**
 * One model draft, editable in place.
 *
 * The person holds the knife: the card carries a draft copy, so changing it
 * neither writes to the log nor calls a model. What they end up with is what the
 * gates re-run against on accept, which is what stops a hand-corrected draft from
 * landing with a dangling reference or an unregistered field.
 */
import clsx from 'clsx'
import type { NodeChoices, ProposalEdits } from './store.ts'
import type { ProposalRow } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import styles from './WorkbenchTab.module.css'

/** What one proposal card needs. */
export interface ProposalCardProps {
  readonly row: ProposalRow
  /** What the person has typed over the draft, by field name. */
  readonly edits: ProposalEdits
  /** What the person decided about each proposed node, by its index in the draft. */
  readonly nodeChoices: NodeChoices
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onEdit: (field: string, value: string) => void
  readonly onRename: (index: number, title: string) => void
  readonly onToggle: (index: number) => void
  readonly onAccept: () => void
  readonly onDiscard: () => void
}

/**
 * Render one draft with its verdict buttons.
 * @param props - the draft, the person's edits, copy, and the three callbacks.
 * @returns the card element.
 */
export function ProposalCard({
  row, edits, nodeChoices, t, onEdit, onRename, onToggle, onAccept, onDiscard,
}: ProposalCardProps): React.JSX.Element {
  const { proposal } = row
  const fields = proposal.fields ?? []
  const newNodes = proposal.newNodes ?? []
  return (
    <div className={clsx(styles.card, row.ruled && styles.cardRuled)}>
      <div className={styles.header}>
        <strong>{proposal.title}</strong>
        {row.ruled ? <span className={styles.badge}>{t('proposal.ruled')}</span> : null}
      </div>
      {proposal.summary === undefined ? null : <p className={styles.block}>{proposal.summary}</p>}
      {proposal.body === undefined ? null : <p className={styles.block}>{proposal.body}</p>}

      {fields.length === 0 ? null : (
        <div className={styles.block}>
          <p className={styles.hint}>{t('proposal.editHint')}</p>
          {fields.map(field => (
            <div key={field.name} className={styles.block}>
              <label className={styles.label} htmlFor={`draft-${proposal.proposalId}-${field.name}`}>
                {field.name}
              </label>
              <input
                id={`draft-${proposal.proposalId}-${field.name}`}
                className={styles.line}
                readOnly={row.ruled}
                value={edits[field.name] ?? field.value}
                onChange={(event) => { onEdit(field.name, event.target.value) }}
              />
            </div>
          ))}
        </div>
      )}

      {newNodes.length === 0 ? null : (
        <div className={styles.block}>
          <p className={styles.label}>{t('proposal.newNodes')}</p>
          {newNodes.map((proposed, index) => {
            const choice = nodeChoices[String(index)]
            const dropped = choice?.dropped === true
            return (
              <div key={`${String(index)}-${proposed.title}`} className={styles.actions}>
                <input
                  aria-label={`${t('proposal.nodeTitle')} ${proposed.title}`}
                  className={styles.line}
                  readOnly={row.ruled || dropped}
                  value={choice?.title ?? proposed.title}
                  onChange={(event) => { onRename(index, event.target.value) }}
                />
                {proposed.duty === undefined ? null : <span className={styles.warn}>{proposed.duty}</span>}
                {row.ruled ? null : (
                  <button type="button" className={styles.button} onClick={() => { onToggle(index) }}>
                    {dropped ? t('proposal.restoreNode') : t('proposal.dropNode')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {row.ruled ? null : (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onAccept}>{t('proposal.accept')}</button>
          <button type="button" className={styles.button} onClick={onDiscard}>{t('proposal.discard')}</button>
        </div>
      )}
    </div>
  )
}
