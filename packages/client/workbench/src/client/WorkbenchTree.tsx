/**
 * The left column: where you are.
 *
 * Three sections — the global constraints, the working set, then the rest of the
 * tree. Rows are scanned rather than read, so a row carries a mark, a title, and at
 * most one number; renaming happens on the card, because turning every row into an
 * input would cost exactly the scannability the column exists for.
 */
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TreeRow, WorkbenchNode } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import { CONSTRAINT_MARK, MATURITY_MARKS, REMINDER_MARK } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** What the left column needs to draw itself and report a click. */
export interface WorkbenchTreeProps {
  readonly rows: readonly TreeRow[]
  readonly working: readonly TreeRow[]
  readonly constraints: readonly WorkbenchNode[]
  readonly selected: string | null
  readonly sections: { constraints: boolean; working: boolean; rest: boolean }
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onSelect: (nodeId: string) => void
  readonly onToggle: (section: 'constraints' | 'working' | 'rest') => void
  /** Open the inline row that asks for a new card's title. */
  readonly onAdd: () => void
}

/** One row: mark, title, and at most one trailing number. */
function Row(props: {
  readonly row: TreeRow
  readonly selected: boolean
  readonly indent: number
  readonly onSelect: () => void
}): React.JSX.Element {
  const { row } = props
  return (
    <button
      type="button"
      className={clsx(styles.row, props.selected && styles.rowSelected)}
      style={{ paddingLeft: `${String(6 + props.indent * 14)}px` }}
      onClick={props.onSelect}
    >
      <span className={styles.mark}>
        {row.constraint ? CONSTRAINT_MARK : MATURITY_MARKS[row.node.maturity]}
      </span>
      <span className={styles.rowTitle}>{row.node.title}</span>
      {row.reminders > 0
        ? <span className={styles.rowReminder}>{REMINDER_MARK}{row.reminders}</span>
        : row.contains > 0 ? <span className={styles.rowCount}>{row.contains}</span> : null}
    </button>
  )
}

/**
 * Render the left column.
 * @param props - the rows, the pinned sections, the selection, and the callbacks.
 * @returns the column element.
 */
export function WorkbenchTree(props: WorkbenchTreeProps): React.JSX.Element {
  const { t } = props
  const pinned = new Set(props.working.map(row => row.node.id))
  return (
    <div>
      <section className={styles.section}>
        <button type="button" className={styles.sectionHead} onClick={() => { props.onToggle('constraints') }}>
          <span>{CONSTRAINT_MARK} {t('map.constraints')}</span>
          <span>{props.constraints.length}</span>
        </button>
        {!props.sections.constraints ? null : props.constraints.length === 0
          ? <p className={styles.empty}>{t('map.constraintsEmpty')}</p>
          : props.constraints.map(node => (
            <button
              key={node.id}
              type="button"
              className={clsx(styles.row, node.id === props.selected && styles.rowSelected)}
              onClick={() => { props.onSelect(node.id) }}
            >
              <span className={styles.mark}>{CONSTRAINT_MARK}</span>
              <span className={styles.rowTitle}>{node.title}</span>
            </button>
          ))}
      </section>

      <section className={styles.section}>
        <button type="button" className={styles.sectionHead} onClick={() => { props.onToggle('working') }}>
          <span>{t('map.working')}</span>
          <span>{props.working.length}</span>
        </button>
        {!props.sections.working ? null : props.working.length === 0
          ? <p className={styles.empty}>{t('map.workingEmpty')}</p>
          : props.working.map(row => (
            <Row
              key={row.node.id}
              row={row}
              indent={0}
              selected={row.node.id === props.selected}
              onSelect={() => { props.onSelect(row.node.id) }}
            />
          ))}
      </section>

      <section className={styles.section}>
        <button type="button" className={styles.sectionHead} onClick={() => { props.onToggle('rest') }}>
          <span>{t('map.rest')}</span>
          <span>{props.rows.filter(row => !pinned.has(row.node.id)).length}</span>
        </button>
        {!props.sections.rest ? null : props.rows.map(row => (
          <Row
            key={row.node.id}
            row={row}
            indent={row.depth}
            selected={row.node.id === props.selected}
            onSelect={() => { props.onSelect(row.node.id) }}
          />
        ))}
        <div className={styles.askRow}>
          <Button variant="ghost" size="sm" onClick={props.onAdd}>{t('map.add')}</Button>
        </div>
      </section>
    </div>
  )
}
