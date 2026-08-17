/**
 * The 工作台 tab: a directory, the focused card, and one module's exchange with the
 * composer under it.
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
import { SkeletonReview } from './SkeletonReview.tsx'
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
  useSession, useStore, actions, t, renderSlot,
  createChild, promote, acceptProposal, rejectProposal,
  setTmp, commitTmp, discardTmp, deleteBody, openIdeas, promoteToConstraint, focusNode,
}: WorkbenchTabProps): React.JSX.Element {
  const tree = useSession(snapshot => snapshot.views.get('workbench')?.tree) ?? EMPTY
  const selected = useStore(state => state.selected)
  const openTag = useStore(state => state.openTag)
  const asDiagram = useStore(state => state.asDiagram)
  const anchor = useStore(state => state.anchor)
  const ask = useStore(state => state.ask)
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

  // A skeleton draft offers whole new cards instead of editing one that exists, so it
  // has no target to render inside and gets the focus column to itself. Oldest first:
  // the person rules on them in the order the model offered them. A target-less draft
  // carrying no cards is not a skeleton and opens nothing — the accept path refuses it
  // as having nothing to commit, and an empty review would be a surface with no subject.
  const skeleton = tree.proposals.flatMap((row) => {
    const offered = row.proposal.newNodes
    if (row.ruled || row.proposal.targetNode !== null) return []
    if (offered === undefined || offered.length === 0) return []
    return [{ proposal: row.proposal, offered }]
  })[0]

  return (
    <div className={styles.root}>
      <div className={styles.map}>
        <WorkbenchTree
          rows={tree.rows}
          selected={focus}
          t={t}
          onSelect={(nodeId) => { actions.select(nodeId) }}
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
        {/* Above the card, not instead of it: a skeleton is a decision waiting on the
            person, and selecting a card must not hide something they have to rule on.
            Keyed by the draft, so a second one does not inherit the first's renames. */}
        {skeleton === undefined ? null : (
          <SkeletonReview
            key={skeleton.proposal.proposalId}
            proposal={skeleton.proposal}
            offered={skeleton.offered}
            t={t}
            onAccept={(kept) => {
              run(acceptProposal(ProposalId(skeleton.proposal.proposalId), [], kept))
            }}
            onDiscard={() => {
              actions.setAsk({ kind: 'discard-proposal', proposalId: skeleton.proposal.proposalId })
            }}
          />
        )}
        {card === undefined
          ? skeleton !== undefined
            ? null
            : (
              <div className={styles.empty}>
                <p>{t('empty.title')}</p>
                <p>{t('empty.hint')}</p>
              </div>
            )
          : (
            <>
              <Card
                // Keyed by the card AND by whether it is in edit state: the card owns
                // a local draft, and remounting is what seeds it — from the node when
                // reading, from the stored edit state when one opens.
                key={`${card.node.id}:${card.tmp === undefined ? 'read' : 'edit'}`}
                view={card}
                openTag={openTag[card.node.id]}
                asDiagram={asDiagram}
                anchorObjectId={anchor?.objectId ?? null}
                t={t}
                onOpenTag={(key) => { actions.openTag(card.node.id, key) }}
                onToggleForm={(bodyId) => { actions.toggleForm(bodyId) }}
                onAnchor={(bodyId, objectId, label) => { actions.anchorTo({ bodyId, objectId, label }) }}
                onEnter={(nodeId) => { actions.select(nodeId) }}
                onOpenEdit={() => { run(setTmp(card.node.id, {})) }}
                onCommit={(tmp) => { run(commitTmp(card.node.id, tmp)) }}
                onDiscard={() => { run(discardTmp(card.node.id)) }}
                onPromote={() => { run(promote(card.node.id, 'committed')) }}
                onAskReject={() => { actions.setAsk({ kind: 'reject', nodeId: card.node.id }) }}
                onDeleteBody={(bodyId: BodyId) => { run(deleteBody(card.node.id, bodyId)) }}
                onOpenIdeas={() => { run(openIdeas(card.node.id)) }}
                onPromoteToConstraint={() => { run(promoteToConstraint(card.node.id)) }}
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
        {/* One site for the reason a rejection needs, wherever the draft was turned
            down from: a skeleton has no card to host this, and rendering it in both
            places would put two inputs on screen for one question. */}
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
      </div>

      <div className={styles.talk}>
        <div className={styles.talkScroll}>
          <TalkColumn
            lines={lines}
            anchorLabel={anchor?.label ?? null}
            t={t}
            onClearAnchor={() => { actions.anchorTo(null) }}
          />
        </div>
        {/* The composer, moved here from the foot of the page: it continues the
            exchange above it. One instance — ui-conversation renders its own into
            this seat, so the draft, the images, and the command menu all come along. */}
        {renderSlot('conversation.view.composer', {})}
      </div>
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
