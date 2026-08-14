/**
 * The 工作台 tab: the tree, the focused node, the drafts awaiting a verdict, and
 * the meter.
 *
 * It reads one thing — the folded tree published by the workbench view target —
 * and writes through the injected callbacks. It never scans the event window.
 */
import { children, NodeId, ProposalId } from '@deepseek-ai/dsh-workbench/projection'
import type { EditOutcome, WorkbenchTabProps, WorkbenchTreeView } from './contract.ts'
import type { NodeChoices } from './store.ts'
import { FocusPane } from './FocusPane.tsx'
import { ProposalCard } from './ProposalCard.tsx'
import styles from './WorkbenchTab.module.css'
import { WorkbenchTree } from './WorkbenchTree.tsx'

/** The tree before anything has happened in this session. */
const EMPTY: WorkbenchTreeView = {
  rows: [],
  proposals: [],
  rev: 0,
  commits: 0,
  untouchedModelNodes: 0,
  meanBodyChars: 0,
  distinctOpenFields: 0,
  projection: {
    nodes: new Map(),
    firstLayer: new Map(),
    proposals: new Map(),
    meta: { rev: 0, fieldDictionary: {} },
    changesSinceSnapshot: 0,
  },
}

/**
 * Render the workbench tab.
 * @param props - the session runtime kit, the tab store, copy, and the edit callbacks.
 * @returns the tab element.
 */
export function WorkbenchTab({
  useSession, useStore, actions, t,
  createChild, updateField, promote, acceptProposal, rejectProposal,
}: WorkbenchTabProps): React.JSX.Element {
  const tree = useSession(snapshot => snapshot.views.get('workbench')?.tree) ?? EMPTY
  const selected = useStore(state => state.selected)
  const drafts = useStore(state => state.drafts)
  const nodeChoices = useStore(state => state.nodeChoices)
  const refusal = useStore(state => state.refusal)

  /** Report a refusal where the person can see it, and clear it on the next success. */
  const settle = (outcome: EditOutcome): void => {
    actions.setRefusal(outcome.ok ? null : outcome.message)
  }
  const run = (work: Promise<EditOutcome>): void => { void work.then(settle) }

  const focused = tree.rows.find(row => row.node.id === selected) ?? tree.rows[0]

  if (tree.rows.length === 0 && tree.proposals.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty} style={{ gridColumn: '1 / -1' }}>
          <p className={styles.emptyTitle}>{t('empty.title')}</p>
          <p>{t('empty.hint')}</p>
        </div>
        <Meter tree={tree} t={t} />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.tree}>
        <WorkbenchTree
          rows={tree.rows}
          selected={focused?.node.id ?? null}
          title={t('tree.title')}
          onSelect={(nodeId) => { actions.select(nodeId) }}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              const title = window.prompt(t('tree.addPrompt'))
              if (title !== null && title !== '') {
                run(createChild(focused === undefined ? null : NodeId(focused.node.id), title))
              }
            }}
          >
            {t('tree.add')}
          </button>
        </div>
      </div>

      <div className={styles.focus}>
        {refusal === null ? null : <p className={styles.refusal}>{refusal}</p>}
        {focused === undefined ? <p className={styles.empty}>{t('focus.none')}</p> : (
          <FocusPane
            row={focused}
            projection={tree.projection}
            t={t}
            onUpdateField={async (field, value) => {
              const outcome = await updateField(NodeId(focused.node.id), field, value)
              settle(outcome)
              return outcome
            }}
            onPromote={async (maturity, note) => {
              const outcome = await promote(NodeId(focused.node.id), maturity, note)
              settle(outcome)
              return outcome
            }}
          />
        )}

        {tree.proposals.length === 0 ? null : (
          <div>
            <p className={styles.sectionTitle}>{t('proposal.title')}</p>
            {tree.proposals.map((row) => {
              const offered = row.proposal.newNodes ?? []
              return (
                <ProposalCard
                  key={row.proposal.proposalId}
                  row={row}
                  edits={drafts[row.proposal.proposalId] ?? {}}
                  nodeChoices={nodeChoices[row.proposal.proposalId] ?? {}}
                  t={t}
                  onEdit={(field, value) => { actions.editProposal(row.proposal.proposalId, field, value) }}
                  onRename={(index, title) => { actions.renameProposed(row.proposal.proposalId, index, title) }}
                  onToggle={(index) => { actions.toggleProposed(row.proposal.proposalId, index) }}
                  onAccept={() => {
                    const edits = Object.entries(drafts[row.proposal.proposalId] ?? {})
                      .map(([name, value]) => ({ name, value }))
                    const choices = nodeChoices[row.proposal.proposalId]
                    run(acceptProposal(
                      ProposalId(row.proposal.proposalId),
                      edits,
                      choices === undefined ? undefined : keptNodes(offered, choices),
                    ))
                    actions.clearProposal(row.proposal.proposalId)
                  }}
                  onDiscard={() => {
                    const reason = window.prompt(t('proposal.discardPrompt'))
                    if (reason !== null) run(rejectProposal(ProposalId(row.proposal.proposalId), reason))
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      <Meter tree={tree} t={t} />
    </div>
  )
}

/**
 * The nodes the person kept, in draft order, each under the title they settled
 * on. A pruned index is simply absent, and pruning happens before the commit, so
 * a dropped node never reaches the tree.
 */
function keptNodes(
  offered: readonly { readonly title: string }[],
  choices: NodeChoices,
): { index: number; title?: string }[] {
  return offered.flatMap((proposed, index) => {
    const choice = choices[String(index)]
    if (choice?.dropped === true) return []
    const title = choice?.title
    return [title === undefined || title === proposed.title ? { index } : { index, title }]
  })
}

/** What the meter strip needs. */
interface MeterProps {
  readonly tree: WorkbenchTreeView
  readonly t: WorkbenchTabProps['t']
}

/** The foot strip: which round this is, the tree's rev, and the two drift counters. */
function Meter({ tree, t }: MeterProps): React.JSX.Element {
  return (
    <div className={styles.meter}>
      <span>{t('meter.commits', { n: String(tree.commits) })}</span>
      <span>{t('meter.rev', { n: String(tree.rev) })}</span>
      <span>{t('meter.ai', { n: String(tree.untouchedModelNodes) })}</span>
      <span>
        {t('meter.structure', {
          chars: tree.meanBodyChars.toFixed(1),
          fields: String(tree.distinctOpenFields),
        })}
      </span>
    </div>
  )
}

/** Re-exported so the child-list shape and the tab share one derivation. */
export { children }
