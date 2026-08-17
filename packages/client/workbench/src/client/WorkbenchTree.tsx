/**
 * The left column: a directory, and nothing else.
 *
 * One flat, indented list of every card, scanned rather than read. It carries a
 * mark, a title, and at most one number — and only when that number is not zero.
 * The earlier version banded the same cards into 全局约束 / 最近在弄 / 其余, which
 * put every card on screen twice and spent three headers, three counts, and two
 * paragraphs of explanation saying nothing on an empty project.
 *
 * A constraint keeps its own mark rather than its own band: it is still one card in
 * one place, and the mark is what says it governs the others.
 */
import clsx from 'clsx'
import type { TreeRow } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import { CONSTRAINT_MARK, MATURITY_MARKS, REMINDER_MARK } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** What the left column needs to draw itself and report a click. */
export interface WorkbenchTreeProps {
  readonly rows: readonly TreeRow[]
  readonly selected: string | null
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onSelect: (nodeId: string) => void
  /** Open the inline row that asks for a new card's title. */
  readonly onAdd: () => void
}

/**
 * Render the left column.
 * @param props - the rows, the selection, and the callbacks.
 * @returns the column element.
 */
export function WorkbenchTree(props: WorkbenchTreeProps): React.JSX.Element {
  const { t } = props
  return (
    <div className={styles.directory}>
      {props.rows.length === 0
        ? <p className={styles.empty}>{t('map.empty')}</p>
        : props.rows.map(row => (
          <button
            key={row.node.id}
            type="button"
            className={clsx(styles.row, row.node.id === props.selected && styles.rowSelected)}
            style={{ paddingLeft: `${String(6 + row.depth * 14)}px` }}
            onClick={() => { props.onSelect(row.node.id) }}
          >
            <span className={styles.mark}>
              {row.constraint ? CONSTRAINT_MARK : MATURITY_MARKS[row.node.maturity]}
            </span>
            <span className={styles.rowTitle}>{row.node.title}</span>
            {row.reminders === 0
              ? null
              : <span className={styles.rowReminder}>{REMINDER_MARK}{row.reminders}</span>}
          </button>
        ))}
      <button type="button" className={styles.addRow} onClick={props.onAdd}>{t('map.add')}</button>
    </div>
  )
}
