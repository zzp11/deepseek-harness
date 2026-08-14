/** The node tree: one row per node, its maturity mark, nested by depth. */
import clsx from 'clsx'
import type { TreeRow } from './contract.ts'
import { MATURITY_MARKS } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** What the tree needs to draw itself and report a click. */
export interface WorkbenchTreeProps {
  readonly rows: readonly TreeRow[]
  readonly selected: string | null
  readonly title: string
  readonly onSelect: (nodeId: string) => void
}

/**
 * Render the tree.
 * @param props - the rows, the selection, and the click callback.
 * @returns the tree element.
 */
export function WorkbenchTree({ rows, selected, title, onSelect }: WorkbenchTreeProps): React.JSX.Element {
  return (
    <div>
      <p className={styles.sectionTitle}>{title}</p>
      {rows.map(row => (
        <button
          key={row.node.id}
          type="button"
          className={clsx(styles.row, row.node.id === selected && styles.rowSelected)}
          style={{ paddingLeft: `${String(6 + row.depth * 14)}px` }}
          onClick={() => { onSelect(row.node.id) }}
        >
          <span className={styles.mark}>{MATURITY_MARKS[row.node.maturity]}</span>
          <span className={styles.rowTitle}>{row.node.title}</span>
        </button>
      ))}
    </div>
  )
}
