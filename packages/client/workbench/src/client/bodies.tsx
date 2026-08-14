/**
 * One renderer per content body. Every one is a pure function of the body it is
 * handed: nothing here reads the projection, so a body cannot draw a fact that is
 * not in it.
 *
 * The diagrams are hand-drawn SVG over a layered layout. That is a deliberate
 * choice over a graph library: a library brings its own node-and-edge state, and
 * these graphs are read-only projections of the tree — a diagram the person could
 * drag into a different shape would be a second source for what the content says.
 */
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ArgumentGround, AuthoredBody, ChartPoint, DerivedView, FlowStep, RelationEdge, SubmoduleMapItem, TableRow,
} from '@deepseek-ai/dsh-workbench/projection'
import type { BodyId, WorkbenchNode } from './contract.ts'
import { MATURITY_MARKS, REMINDER_MARK } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** Geometry of the hand-drawn diagrams, in user units. */
const BOX = { width: 150, height: 38, gapX: 34, gapY: 18 } as const

/** What every body renderer receives. */
export interface BodyProps {
  /** The object the conversation is anchored to, so the diagram can mark it. */
  readonly anchoredObject: string | null
  /** Report that the person double-clicked an addressable object. */
  readonly onAnchor: (bodyId: BodyId, objectId: string, label: string) => void
  /** Descend into a node the body names. */
  readonly onEnter: (nodeId: WorkbenchNode['id']) => void
}

/** One box of a diagram, at a computed position. */
function Box(props: {
  readonly x: number
  readonly y: number
  readonly text: string
  readonly anchored: boolean
  readonly onOpen?: () => void
}): React.JSX.Element {
  return (
    <g onDoubleClick={props.onOpen}>
      <rect
        x={props.x}
        y={props.y}
        width={BOX.width}
        height={BOX.height}
        rx={6}
        className={props.anchored ? styles.diagramNodeAnchored : styles.diagramNode}
      />
      <text x={props.x + 10} y={props.y + 24} className={styles.diagramText}>
        {props.text.length > 16 ? `${props.text.slice(0, 15)}…` : props.text}
      </text>
    </g>
  )
}

/** The brief: what the card is answerable for, then its prose. */
export function BriefBody({ duty, body }: { readonly duty: string; readonly body: string }): React.JSX.Element {
  return (
    <div>
      {duty === '' ? null : <p className={styles.duty}>职责：{duty}</p>}
      <div className={styles.prose}><MarkdownText text={body} /></div>
    </div>
  )
}

/** A table. Rows are addressable, so a person can anchor the conversation to one. */
export function TableBody(props: BodyProps & {
  readonly bodyId: BodyId
  readonly columns: readonly string[]
  readonly rows: readonly TableRow[]
}): React.JSX.Element {
  return (
    <table className={styles.grid}>
      <thead>
        <tr>{props.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
      </thead>
      <tbody>
        {props.rows.map(row => (
          <tr
            key={row.rowId}
            onDoubleClick={() => { props.onAnchor(props.bodyId, row.rowId, row.cells[0] ?? row.rowId) }}
          >
            {props.columns.map((column, index) => <td key={column}>{row.cells[index] ?? ''}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A flow, one box per step, top to bottom, with an arrow between neighbours. */
export function FlowBody(props: BodyProps & {
  readonly bodyId: BodyId
  readonly steps: readonly FlowStep[]
}): React.JSX.Element {
  const height = Math.max(props.steps.length * (BOX.height + BOX.gapY), BOX.height)
  return (
    <svg className={styles.diagram} width={BOX.width + 20} height={height} role="group" aria-label="流程图">
      {props.steps.map((step, index) => {
        const y = index * (BOX.height + BOX.gapY)
        return (
          <g key={step.stepId}>
            {index === 0 ? null : (
              <line x1={10 + BOX.width / 2} y1={y - BOX.gapY} x2={10 + BOX.width / 2} y2={y} className={styles.diagramEdge} />
            )}
            <Box
              x={10}
              y={y}
              text={step.text}
              anchored={props.anchoredObject === step.stepId}
              onOpen={() => { props.onAnchor(props.bodyId, step.stepId, step.text) }}
            />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * An argument, and its controlled-text twin.
 *
 * The twin is not a convenience. A diagram has no place for a conditional, a
 * negation, a quantifier, or a tense, so what the model dropped is invisible in the
 * picture and obvious in the text — which is why the text is what opens first.
 */
export function ArgumentBody(props: BodyProps & {
  readonly bodyId: BodyId
  readonly stance: string
  readonly grounds: readonly ArgumentGround[]
  readonly asText: boolean
}): React.JSX.Element {
  if (props.asText) {
    return (
      <div className={styles.prose}>
        <p><strong>立场</strong>：{props.stance}</p>
        <ul>
          {props.grounds.map(ground => (
            <li key={ground.groundId}>{ground.opposes === true ? '反对：' : '支持：'}{ground.text}</li>
          ))}
        </ul>
      </div>
    )
  }
  const height = Math.max((props.grounds.length + 1) * (BOX.height + BOX.gapY), BOX.height * 2)
  return (
    <svg className={styles.diagram} width={BOX.width * 2 + BOX.gapX + 20} height={height} role="group" aria-label="论证图">
      <Box x={10} y={0} text={props.stance} anchored={false} />
      {props.grounds.map((ground, index) => {
        const y = (index + 1) * (BOX.height + BOX.gapY)
        return (
          <g key={ground.groundId}>
            <path
              d={`M ${String(10 + BOX.width / 2)} ${String(BOX.height)} V ${String(y + BOX.height / 2)} H ${String(BOX.width + BOX.gapX + 10)}`}
              className={styles.diagramEdge}
            />
            <Box
              x={BOX.width + BOX.gapX + 10}
              y={y}
              text={`${ground.opposes === true ? '反 ' : ''}${ground.text}`}
              anchored={props.anchoredObject === ground.groundId}
              onOpen={() => { props.onAnchor(props.bodyId, ground.groundId, ground.text) }}
            />
          </g>
        )
      })}
    </svg>
  )
}

/** A bar chart over a table column whose every cell was a bare number. */
export function ChartBody({ axis, points }: { readonly axis: string; readonly points: readonly ChartPoint[] }): React.JSX.Element {
  const top = Math.max(...points.map(point => point.value), 1)
  const rowHeight = 26
  return (
    <svg
      className={styles.diagram}
      width={420}
      height={Math.max(points.length * rowHeight, rowHeight)}
      role="group"
      aria-label={`图表 ${axis}`}
    >
      {points.map((point, index) => (
        <g key={point.label}>
          <text x={0} y={index * rowHeight + 16} className={styles.diagramText}>{point.label}</text>
          <rect
            x={120}
            y={index * rowHeight + 4}
            width={Math.max((point.value / top) * 240, 1)}
            height={14}
            className={styles.diagramBar}
          />
          <text x={370} y={index * rowHeight + 16} className={styles.diagramText}>{point.value}</text>
        </g>
      ))}
    </svg>
  )
}

/**
 * A list of child cards, one level only.
 *
 * One level is a screen budget rather than a simplification: three nested levels in
 * one column leave the third too narrow to read, so depth is reached by descending.
 */
export function SubmoduleBody(props: BodyProps & {
  readonly items: readonly SubmoduleMapItem[]
  readonly empty: string
}): React.JSX.Element {
  if (props.items.length === 0) return <p className={styles.empty}>{props.empty}</p>
  return (
    <div className={styles.cards}>
      {props.items.map(item => (
        <div
          key={item.nodeId}
          className={styles.subcard}
          onDoubleClick={() => { props.onEnter(item.nodeId) }}
        >
          <span className={styles.mark}>{MATURITY_MARKS[item.maturity]}</span>
          <span className={styles.subcardTitle}>{item.title}</span>
          <span className={styles.subcardMeta}>
            {item.contains === 0 ? '' : `内含 ${String(item.contains)}`}
            {item.reminders === 0 ? '' : ` ${REMINDER_MARK}${String(item.reminders)}`}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The relation edges leaving this card, as a two-column graph. */
export function RelationBody({ edges }: { readonly edges: readonly RelationEdge[] }): React.JSX.Element {
  return (
    <svg
      className={styles.diagram}
      width={BOX.width * 2 + BOX.gapX + 20}
      height={Math.max(edges.length * (BOX.height + BOX.gapY), BOX.height)}
      role="group"
      aria-label="关系图"
    >
      {edges.map((edge, index) => {
        const y = index * (BOX.height + BOX.gapY)
        return (
          <g key={`${edge.via}-${edge.to}`}>
            <Box x={10} y={y} text={edge.via} anchored={false} />
            <line
              x1={BOX.width + 10}
              y1={y + BOX.height / 2}
              x2={BOX.width + BOX.gapX + 10}
              y2={y + BOX.height / 2}
              className={styles.diagramEdge}
            />
            <Box x={BOX.width + BOX.gapX + 10} y={y} text={edge.to} anchored={false} />
          </g>
        )
      })}
    </svg>
  )
}

/** The global-constraint entries, which apply to everything outside their area. */
export function ConstraintsBody({ items, empty }: {
  readonly items: readonly WorkbenchNode[]
  readonly empty: string
}): React.JSX.Element {
  if (items.length === 0) return <p className={styles.empty}>{empty}</p>
  return (
    <div className={styles.cards}>
      {items.map(item => (
        <div key={item.id} className={styles.subcard}>
          <span className={styles.subcardTitle}>{item.title}</span>
          <span className={styles.subcardMeta}>{item.duty ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

/** Dispatch one authored body to its renderer. */
export function AuthoredBodyView(props: BodyProps & {
  readonly body: AuthoredBody
  readonly argumentAsText: boolean
}): React.JSX.Element {
  const { body } = props
  switch (body.kind) {
    case 'brief':
      return <BriefBody duty={body.duty} body={body.body} />
    case 'table':
      return <TableBody {...props} bodyId={body.id} columns={body.columns} rows={body.rows} />
    case 'flow':
      return <FlowBody {...props} bodyId={body.id} steps={body.steps} />
    case 'argument':
      return <ArgumentBody {...props} bodyId={body.id} stance={body.stance} grounds={body.grounds} asText={props.argumentAsText} />
    default:
      // BodyPayload is closed over the authored kinds; a value here would have to
      // come from a log this build cannot type.
      return <p className={styles.empty}>{(body as AuthoredBody).kind}</p>
  }
}

/**
 * Dispatch one derived view to its renderer.
 *
 * No fallback branch: a derived view is computed in this process from the projection,
 * never read off a log, so the union is closed and the switch is exhaustive.
 */
export function DerivedBodyView(props: BodyProps & {
  readonly view: DerivedView
  readonly empty: string
}): React.JSX.Element {
  const { view } = props
  switch (view.kind) {
    case 'submodule-map':
    case 'ideas':
      return <SubmoduleBody {...props} items={view.items} empty={props.empty} />
    case 'relation':
      return <RelationBody edges={view.edges} />
    case 'constraints':
      return <ConstraintsBody items={view.items} empty={props.empty} />
    case 'chart':
      return <ChartBody axis={view.axis} points={view.points} />
  }
}
