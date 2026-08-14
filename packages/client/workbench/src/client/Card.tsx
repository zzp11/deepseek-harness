/**
 * The focused card: title, tag strip, one content body, auxiliaries.
 *
 * There is one card and it has two states. A model draft does not arrive as a
 * second kind of card — it puts this one into edit state, which is also what a
 * person's larger edit does. That collapse is why 夺刀权 and "a person's edit costs
 * nothing" are one action sequence here rather than two competing ones: the model
 * offers, the person rewrites, 确定 commits.
 *
 * The section caps are the readable-in-one-glance rule made executable: three
 * metadata entries, two actions, one drawer. Without numbers "keep it simple" erodes
 * one button at a time.
 */
import clsx from 'clsx'
import { useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoredBody, BodyId, CardView, NodeId, NodeTmp, TagEntry } from './contract.ts'
import type { WorkbenchKey } from './locales.ts'
import { AuthoredBodyView, DerivedBodyView } from './bodies.tsx'
import { MATURITY_MARKS, REMINDER_MARK, STALE_MARK } from './marks.ts'
import styles from './WorkbenchTab.module.css'

/** How many tags fit before the rest go into the overflow menu. */
const VISIBLE_TAGS = 5

/**
 * The word for each maturity rung. The tree carries only the mark, because rows are
 * scanned; the focused card is read, and a lone `○` says nothing on its own.
 */
const MATURITY_WORDS: Readonly<Record<CardView['node']['maturity'], WorkbenchKey>> = {
  thought: 'maturity.thought',
  idea: 'maturity.idea',
  committed: 'maturity.committed',
  rejected: 'maturity.rejected',
}

/** What the card needs. */
export interface CardProps {
  readonly view: CardView
  /** Which tag is open; falls back to the first, and to the text twin for an argument. */
  readonly openTag: string | undefined
  readonly anchorObjectId: string | null
  /** Argument bodies switched to the diagram form, by body id. */
  readonly asDiagram: Readonly<Record<string, boolean>>
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  readonly onOpenTag: (key: string) => void
  readonly onToggleForm: (bodyId: BodyId) => void
  readonly onAnchor: (bodyId: BodyId, objectId: string, label: string) => void
  readonly onEnter: (nodeId: NodeId) => void
  /** Open edit state on a card that is already committed. */
  readonly onOpenEdit: () => void
  readonly onCommit: () => void
  readonly onDiscard: () => void
  readonly onPromote: () => void
  readonly onAskReject: () => void
  readonly onDeleteBody: (bodyId: BodyId) => void
  readonly onOpenIdeas: () => void
  readonly onPromoteToConstraint: () => void
  /**
   * Write the card's whole edit state. Whole-value rather than a patch: only the
   * editing branches call it, and each of them has the current edit state narrowed to
   * hand, so the tab needs no fallback for a card that is not in edit state.
   */
  readonly onEditTmp: (tmp: NodeTmp) => void
}

/** The person-facing words for a card's source, including the third state. */
function sourceText(view: CardView, t: CardProps['t']): string {
  const { source } = view.node
  if (source === 'human') return t('source.human')
  if (source === 'ai') return t('source.ai')
  return `${t('source.derived')} ${source.sourceId}`
}

/** One tag button. */
function Tag(props: {
  readonly tag: TagEntry
  readonly active: boolean
  readonly onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={clsx(
        styles.tag,
        props.active && styles.tagActive,
        props.tag.kind === 'derived' && styles.tagDerived,
      )}
      onClick={props.onOpen}
    >
      {props.tag.label}
      {props.tag.kind === 'authored' && props.tag.stale
        ? <span className={styles.tagStale}>{STALE_MARK}</span>
        : null}
    </button>
  )
}

/**
 * Render the focused card.
 * @param props - the folded card view, the open tag, and the callbacks.
 * @returns the card element.
 */
export function Card(props: CardProps): React.JSX.Element {
  const { view, t } = props
  const tmp = view.tmp
  const editing = tmp !== undefined
  const tags = view.tags
  const active = tags.find(tag => tag.key === props.openTag) ?? tags[0]
  const visible = tags.slice(0, VISIBLE_TAGS)
  const overflow = tags.slice(VISIBLE_TAGS)
  const authored = active?.kind === 'authored' ? active.body : undefined

  return (
    <div className={clsx(styles.card, editing && styles.cardEditing)}>
      {!editing ? null : (
        <div className={styles.pending}>
          <span>{t('card.pending')}</span>
          <span className={styles.pendingActions}>
            <Button variant="primary" size="sm" onClick={props.onCommit}>{t('card.commit')}</Button>
            <Button variant="ghost" size="sm" onClick={props.onDiscard}>{t('card.discard')}</Button>
          </span>
        </div>
      )}

      {view.trail.length === 0 ? null : (
        <nav className={styles.crumbs} aria-label={t('card.trail')}>
          {view.trail.map(ancestor => (
            <button key={ancestor.id} type="button" className={styles.crumb} onClick={() => { props.onEnter(ancestor.id) }}>
              {ancestor.title}
            </button>
          ))}
        </nav>
      )}

      <div className={styles.head}>
        <span className={styles.mark}>{MATURITY_MARKS[view.node.maturity]}</span>
        {tmp === undefined
          ? <h2 className={styles.title}>{view.node.title}</h2>
          : (
            <input
              aria-label={t('card.title')}
              className={styles.line}
              value={tmp.title ?? view.node.title}
              onChange={(event) => { props.onEditTmp({ ...tmp, title: event.target.value }) }}
            />
          )}
        <span className={styles.meta}>
          <span>{t(MATURITY_WORDS[view.node.maturity])}</span>
          <span>rev {view.node.lastRev}</span>
          <span>{sourceText(view, t)}</span>
          {view.reminders > 0 ? <span>{REMINDER_MARK}{view.reminders}</span> : null}
        </span>
      </div>

      <div className={styles.tags}>
        {visible.map(tag => (
          <Tag
            key={tag.key}
            tag={tag}
            active={tag.key === active?.key}
            onOpen={() => { props.onOpenTag(tag.key) }}
          />
        ))}
        {overflow.length === 0 ? null : (
          <Overflow
            label="⋯"
            items={overflow.map(tag => ({
              id: tag.key,
              label: tag.label,
              onSelect: () => { props.onOpenTag(tag.key) },
            }))}
          />
        )}
      </div>

      <div className={styles.body}>
        {active === undefined
          ? <p className={styles.empty}>{t('card.noBody')}</p>
          : active.kind === 'authored'
            ? (
              <>
                {active.body.kind !== 'argument' ? null : (
                  <button
                    type="button"
                    className={styles.tag}
                    onClick={() => { props.onToggleForm(active.key) }}
                  >
                    {props.asDiagram[active.key] === true ? t('card.asText') : t('card.asDiagram')}
                  </button>
                )}
                <AuthoredBodyEditor
                  body={active.body}
                  tmp={tmp}
                  asDiagram={props.asDiagram[active.key] === true}
                  anchoredObject={props.anchorObjectId}
                  t={t}
                  onAnchor={props.onAnchor}
                  onEnter={props.onEnter}
                  onEditTmp={props.onEditTmp}
                />
              </>
            )
            : (
              <DerivedBodyView
                view={active.view}
                empty={t('card.viewEmpty')}
                anchoredObject={props.anchorObjectId}
                onAnchor={props.onAnchor}
                onEnter={props.onEnter}
              />
            )}
      </div>

      <div className={styles.foot}>
        {view.blocking.length === 0
          ? null
          : <span className={styles.warn}>{t('card.blocking', { n: String(view.blocking.length) })}</span>}
        {editing ? null : (
          <Button variant="ghost" size="sm" onClick={props.onOpenEdit}>{t('card.edit')}</Button>
        )}
        <Button variant="ghost" size="sm" onClick={props.onPromote} disabled={view.node.maturity === 'committed'}>
          {t('card.promote')}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onAskReject} disabled={view.node.maturity === 'rejected'}>
          {t('card.reject')}
        </Button>
        <Overflow
          label="⋯"
          items={[
            { id: 'ideas', label: t('card.openIdeas'), onSelect: props.onOpenIdeas },
            { id: 'constraint', label: t('card.toConstraint'), onSelect: props.onPromoteToConstraint },
            ...authored === undefined || authored.kind === 'brief'
              ? []
              : [{
                id: 'delete-body',
                label: t('card.deleteBody'),
                onSelect: () => { props.onDeleteBody(authored.id) },
              }],
          ]}
        />
      </div>
    </div>
  )
}

/**
 * The overflow control. Everything that does not fit the caps lives behind it, which
 * is what lets the caps hold without anything becoming unreachable.
 */
function Overflow(props: {
  readonly label: string
  readonly items: readonly { readonly id: string; readonly label: string; readonly onSelect: () => void }[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const chosen = (id: string): void => {
    setOpen(false)
    props.items.find(item => item.id === id)?.onSelect()
  }
  return (
    <Menu
      open={open}
      anchor={<button type="button" className={styles.tag} onClick={() => { setOpen(!open) }}>{props.label}</button>}
      items={props.items.map(item => ({ kind: 'item' as const, id: item.id, label: item.label }))}
      onSelect={chosen}
      onClose={() => { setOpen(false) }}
    />
  )
}

/** One authored body, editable in place while the card is in edit state. */
function AuthoredBodyEditor(props: {
  readonly body: AuthoredBody
  /** The card's edit state, or undefined when it is not in one. */
  readonly tmp: NodeTmp | undefined
  /** Set once the person asked for the argument's diagram form. */
  readonly asDiagram: boolean
  readonly anchoredObject: string | null
  readonly t: CardProps['t']
  readonly onAnchor: CardProps['onAnchor']
  readonly onEnter: CardProps['onEnter']
  readonly onEditTmp: CardProps['onEditTmp']
}): React.JSX.Element {
  const { tmp } = props
  if (tmp !== undefined && props.body.kind === 'brief') {
    return (
      <div>
        <label className={styles.label} htmlFor="wb-duty">{props.t('card.duty')}</label>
        <input
          id="wb-duty"
          className={styles.line}
          value={tmp.duty ?? props.body.duty}
          onChange={(event) => { props.onEditTmp({ ...tmp, duty: event.target.value }) }}
        />
        <label className={styles.label} htmlFor="wb-body">{props.t('card.body')}</label>
        <textarea
          id="wb-body"
          className={styles.text}
          value={tmp.body ?? props.body.body}
          onChange={(event) => { props.onEditTmp({ ...tmp, body: event.target.value }) }}
        />
      </div>
    )
  }
  return (
    <AuthoredBodyView
      body={props.body}
      argumentAsText={!props.asDiagram}
      anchoredObject={props.anchoredObject}
      onAnchor={props.onAnchor}
      onEnter={props.onEnter}
    />
  )
}
