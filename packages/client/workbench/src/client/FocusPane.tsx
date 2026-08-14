/**
 * The focused node: what it says, what it is answerable for, its fields and where
 * each came from, and the two actions a person can take on it.
 *
 * Every edit here is immediate and free — the callbacks reach the host's command
 * channel, which appends and answers synchronously. Nothing on this pane waits on
 * a model.
 */
import { useState } from 'react'
import { children, isRegisteredField, type WorkbenchState } from '@deepseek-ai/dsh-workbench/projection'
import type { EditOutcome, TreeRow, WorkbenchNode } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import { MATURITY_MARKS } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** What the focus pane needs. */
export interface FocusPaneProps {
  readonly row: TreeRow
  readonly projection: WorkbenchState
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onUpdateField: (field: string, value: string) => Promise<EditOutcome>
  readonly onPromote: (maturity: 'committed' | 'rejected', note?: string) => Promise<EditOutcome>
}

/** Render one node's source in the person's words. */
function sourceText(node: WorkbenchNode, t: FocusPaneProps['t']): string {
  if (node.source === 'human') return t('source.human')
  if (node.source === 'ai') return t('source.ai')
  return `${t('source.derived')} ${node.source.sourceId}`
}

/**
 * Render the focused node.
 * @param props - the row, the projection its derived facts come from, copy, and the edit callbacks.
 * @returns the focus pane element.
 */
export function FocusPane({ row, projection, t, onUpdateField, onPromote }: FocusPaneProps): React.JSX.Element {
  const { node } = row
  const [body, setBody] = useState(node.body ?? '')
  const [duty, setDuty] = useState(node.duty ?? '')
  const childRows = children(projection, node.id)
  const shape = row.shapes[0]

  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.title}>{node.title}</h2>
        <span className={styles.badge}>{MATURITY_MARKS[node.maturity]} {t(`maturity.${node.maturity}`)}</span>
        <span className={styles.badge}>{t('focus.source')}: {sourceText(node, t)}</span>
        <span className={styles.badge}>rev {node.lastRev}</span>
      </div>

      <div className={styles.block}>
        <label className={styles.label} htmlFor={`duty-${node.id}`}>{t('focus.duty')}</label>
        <input
          id={`duty-${node.id}`}
          className={styles.line}
          value={duty}
          onChange={(event) => { setDuty(event.target.value) }}
          onBlur={() => { if (duty !== (node.duty ?? '')) void onUpdateField('duty', duty) }}
        />
      </div>

      <div className={styles.block}>
        <label className={styles.label} htmlFor={`body-${node.id}`}>{t('focus.body')}</label>
        <textarea
          id={`body-${node.id}`}
          className={styles.text}
          value={body}
          onChange={(event) => { setBody(event.target.value) }}
          onBlur={() => { if (body !== (node.body ?? '')) void onUpdateField('body', body) }}
        />
      </div>

      <div className={styles.block}>
        <p className={styles.label}>{t('focus.fields')}</p>
        {Object.keys(node.fields).length === 0 ? null : (
          <table className={styles.fields}>
            <tbody>
              {Object.entries(node.fields).map(([name, field]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{field.value}</td>
                  <td className={styles.warn}>
                    {isRegisteredField(projection.meta, name) ? '' : t('focus.unregistered')}
                    {field.sourceId === undefined ? ` ${t('focus.noEvidence')}` : ` ${field.sourceId}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.block}>
        <p className={styles.label}>
          {shape === undefined ? t('focus.shape.none') : t(`focus.shape.${shape}`)}
        </p>
        {shape === 'child-list' ? (
          <ul>{childRows.map(child => <li key={child.id}>{child.title}</li>)}</ul>
        ) : null}
        {shape === 'paragraph-card' ? <p>{node.body}</p> : null}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={node.maturity === 'committed'}
          onClick={() => { void onPromote('committed') }}
        >
          {t('focus.promote')}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={node.maturity === 'rejected'}
          onClick={() => {
            const note = window.prompt(t('focus.rejectPrompt'))
            if (note !== null) void onPromote('rejected', note)
          }}
        >
          {t('focus.reject')}
        </button>
      </div>
    </div>
  )
}
