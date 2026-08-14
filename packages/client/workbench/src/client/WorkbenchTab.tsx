/**
 * The 工作台 tab: three columns and a meter.
 *
 * It reads one thing — the tree the fold publishes — and writes through the injected
 * callbacks. Every question it asks is asked in place: a modal would take the caret
 * away from whatever the person was already typing, which is the one thing the
 * result-arrives path is not allowed to do.
 */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { NodeId, ProposalId, type BodyId } from '@deepseek-ai/dsh-workbench/projection'
import { buildCardView } from './card-view.ts'
import { Card } from './Card.tsx'
import type { EditOutcome, WorkbenchTabProps, WorkbenchTreeView } from './contract.ts'
import { TalkColumn, talkLines } from './TalkColumn.tsx'
import styles from './WorkbenchTab.module.css'
import { WorkbenchTree } from './WorkbenchTree.tsx'

/** The tree before anything has happened in this session. */
const EMPTY: WorkbenchTreeView = {
  rows: [],
  constraints: [],
  working: [],
  proposals: [],
  rev: 0,
  commits: 0,
  untouchedModelNodes: 0,
  meanBodyChars: 0,
  distinctOpenFields: 0,
  reminders: 0,
  projection: {
    nodes: new Map(),
    firstLayer: new Map(),
    proposals: new Map(),
    tmp: new Map(),
    focus: null,
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
  createChild, promote, acceptProposal, rejectProposal,
  setTmp, commitTmp, discardTmp, deleteBody, openIdeas, focusNode,
}: WorkbenchTabProps): React.JSX.Element {
  const tree = useSession(snapshot => snapshot.views.get('workbench')?.tree) ?? EMPTY
  const selected = useStore(state => state.selected)
  const openTag = useStore(state => state.openTag)
  const asDiagram = useStore(state => state.asDiagram)
  const anchor = useStore(state => state.anchor)
  const ask = useStore(state => state.ask)
  const sections = useStore(state => state.sections)
  const refusal = useStore(state => state.refusal)

  /** Report a refusal where the person can see it, and clear it on the next success. */
  const settle = (outcome: EditOutcome): void => { actions.setRefusal(outcome.ok ? null : outcome.message) }
  const run = (work: Promise<EditOutcome>): void => { void work.then(settle) }

  const focus = selected === null ? tree.rows[0]?.node.id ?? null : selected
  const card = focus === null ? undefined : buildCardView(tree.projection, NodeId(focus))

  // The host stamps each utterance with the card it was said on, and it learns that
  // from here: the composer belongs to the conversation surface and knows nothing
  // about cards.
  useEffect(() => {
    if (focus !== null && tree.projection.focus !== focus) run(focusNode(NodeId(focus)))
    // The write is keyed by the focus alone. Re-running it whenever the tree changes
    // would append one focus event per commit, which is noise in the log and does not
    // tell the mirror anything new.
  }, [focus])

  const lines = talkLines(
    tree.projection.firstLayer.values(),
    tree.proposals,
    focus === null ? null : NodeId(focus),
  )

  return (
    <div className={styles.root}>
      <div className={styles.map}>
        <WorkbenchTree
          rows={tree.rows}
          working={tree.working}
          constraints={tree.constraints}
          selected={focus}
          sections={sections}
          t={t}
          onSelect={(nodeId) => { actions.select(nodeId) }}
          onToggle={(section) => { actions.toggleSection(section) }}
          onAdd={() => { actions.setAsk({ kind: 'add-child', parentId: focus }) }}
        />
        {ask?.kind !== 'add-child' ? null : (
          <InlineAsk
            label={t('map.addAsk')}
            onCancel={() => { actions.setAsk(null) }}
            onSubmit={(value) => {
              actions.setAsk(null)
              run(createChild(ask.parentId === null ? null : NodeId(ask.parentId), value))
            }}
          />
        )}
      </div>

      <div className={styles.focus}>
        {refusal === null ? null : <p className={styles.refusal}>{refusal}</p>}
        {card === undefined
          ? (
            <div className={styles.empty}>
              <p>{t('empty.title')}</p>
              <p>{t('empty.hint')}</p>
            </div>
          )
          : (
            <>
              <Card
                view={card}
                openTag={openTag[card.node.id]}
                asDiagram={asDiagram}
                anchorObjectId={anchor?.objectId ?? null}
                t={t}
                onOpenTag={(key) => { actions.openTag(card.node.id, key) }}
                onToggleForm={(bodyId) => { actions.toggleForm(bodyId) }}
                onAnchor={(bodyId, objectId, label) => { actions.anchorTo({ bodyId, objectId, label }) }}
                onEnter={(nodeId) => { actions.select(nodeId) }}
                onCommit={() => { run(commitTmp(card.node.id)) }}
                onDiscard={() => { run(discardTmp(card.node.id)) }}
                onPromote={() => { run(promote(card.node.id, 'committed')) }}
                onAskReject={() => { actions.setAsk({ kind: 'reject', nodeId: card.node.id }) }}
                onDeleteBody={(bodyId: BodyId) => { run(deleteBody(card.node.id, bodyId)) }}
                onOpenIdeas={() => { run(openIdeas(card.node.id)) }}
                onEditTmp={(tmp) => { run(setTmp(card.node.id, tmp)) }}
              />
              {ask?.kind !== 'reject' ? null : (
                <InlineAsk
                  label={t('card.rejectAsk')}
                  onCancel={() => { actions.setAsk(null) }}
                  onSubmit={(value) => {
                    actions.setAsk(null)
                    run(promote(NodeId(ask.nodeId), 'rejected', value))
                  }}
                />
              )}
              {ask?.kind !== 'discard-proposal' ? null : (
                <InlineAsk
                  label={t('talk.discardAsk')}
                  onCancel={() => { actions.setAsk(null) }}
                  onSubmit={(value) => {
                    actions.setAsk(null)
                    run(rejectProposal(ProposalId(ask.proposalId), value))
                  }}
                />
              )}
              {tree.proposals.filter(row => !row.ruled && row.proposal.targetNode === card.node.id).map(row => (
                <div key={row.proposal.proposalId} className={styles.askRow}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { run(acceptProposal(ProposalId(row.proposal.proposalId), [])) }}
                  >
                    {t('proposal.accept')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      actions.setAsk({ kind: 'discard-proposal', proposalId: row.proposal.proposalId })
                    }}
                  >
                    {t('proposal.discard')}
                  </Button>
                </div>
              ))}
            </>
          )}
      </div>

      <div className={styles.talk}>
        <TalkColumn
          lines={lines}
          anchorLabel={anchor?.label ?? null}
          t={t}
          onClearAnchor={() => { actions.anchorTo(null) }}
        />
      </div>

      <Meter tree={tree} t={t} />
    </div>
  )
}

/**
 * A question asked in place: one line, Enter to submit, Escape to cancel.
 *
 * Never a modal. A dialog takes the caret from whatever the person was already
 * typing, and the answer to "why not" is not worth interrupting a sentence for.
 */
function InlineAsk(props: {
  readonly label: string
  readonly onSubmit: (value: string) => void
  readonly onCancel: () => void
}): React.JSX.Element {
  return (
    <div className={styles.askRow}>
      <input
        aria-label={props.label}
        placeholder={props.label}
        className={styles.line}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.value !== '') props.onSubmit(event.currentTarget.value)
          if (event.key === 'Escape') props.onCancel()
        }}
      />
    </div>
  )
}

/** What the meter strip needs. */
interface MeterProps {
  readonly tree: WorkbenchTreeView
  readonly t: WorkbenchTabProps['t']
}

/**
 * The foot strip. The △ account is set apart because it is the only number about the
 * person rather than the tree, and nobody notices their own verification slipping.
 */
function Meter({ tree, t }: MeterProps): React.JSX.Element {
  return (
    <div className={styles.meter}>
      <span>{t('meter.commits', { n: String(tree.commits) })}</span>
      <span>{t('meter.rev', { n: String(tree.rev) })}</span>
      <span className={styles.meterSelf}>{t('meter.ai', { n: String(tree.untouchedModelNodes) })}</span>
      <span>
        {t('meter.structure', {
          chars: tree.meanBodyChars.toFixed(1),
          fields: String(tree.distinctOpenFields),
        })}
      </span>
      {tree.reminders === 0 ? null : <span>{t('meter.reminders', { n: String(tree.reminders) })}</span>}
    </div>
  )
}
