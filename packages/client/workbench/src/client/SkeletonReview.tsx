/**
 * The review surface for a skeleton draft: a proposal that offers whole new cards
 * rather than edits to one that exists.
 *
 * Without this the model's most valuable single output was unreachable. Accept and
 * discard render inside a focused card, filtered to proposals aimed at that card — and a
 * cold-start proposal aims at nothing, on a tree that has no card to focus. The model
 * would read the tree, work out a nine-card skeleton with a flow chart and a budget
 * table, and the page would show an empty directory and one line of text.
 *
 * Renaming and cutting happen HERE, before the accept, because the host's contract is
 * that a cut card never entered the tree. Pruning after the fact would be a different
 * and weaker claim: the node would have existed, been depended on, and been deleted.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProposedNode, WorkbenchProposal } from '@deepseek-ai/dsh-workbench/projection'
import type { WorkbenchKey } from './locales.ts'
import styles from './WorkbenchTab.module.css'

/** What the review surface needs, and the two ways it can end. */
export interface SkeletonReviewProps {
  readonly proposal: WorkbenchProposal
  /**
   * The cards the draft offers. Passed separately rather than read off `proposal`,
   * because the render site only opens this surface for a draft that HAS cards — taking
   * the list as a required prop states that instead of carrying an empty-list fallback
   * that nothing can reach.
   */
  readonly offered: readonly ProposedNode[]
  readonly t: (key: WorkbenchKey, params?: Record<string, string>) => string
  /**
   * Accept the kept cards, in the draft's own order, each under the title the person
   * settled on. An index left out is pruned by the host before the commit.
   */
  readonly onAccept: (kept: readonly { readonly index: number; readonly title?: string }[]) => void
  /** Refuse the whole draft; the caller asks for the reason the host requires. */
  readonly onDiscard: () => void
}

/**
 * Every index at or beneath `root`, by `parentIndex`. A cut takes the subtree with it:
 * re-rooting an orphan would silently change what it means, and the host refuses the
 * accept rather than guessing, so the surface must not offer the state that gets refused.
 * @param offered - the draft's proposed cards.
 * @param root - the index being cut.
 * @returns `root` and every descendant index.
 */
export function subtreeOf(offered: readonly ProposedNode[], root: number): ReadonlySet<number> {
  const cut = new Set([root])
  // One forward pass suffices: `parentIndex` always points at an earlier entry, so a
  // child is always visited after its parent has been added.
  offered.forEach((proposed, index) => {
    if (proposed.parentIndex !== undefined && cut.has(proposed.parentIndex)) cut.add(index)
  })
  return cut
}

/**
 * Render the skeleton review.
 * @param props - the draft, the copy, and the two outcomes.
 * @returns the review element.
 */
export function SkeletonReview(props: SkeletonReviewProps): React.JSX.Element {
  const { proposal, offered, t } = props
  const [titles, setTitles] = useState<Readonly<Record<number, string>>>({})
  const [cut, setCut] = useState<ReadonlySet<number>>(new Set())
  const kept = offered.map((_proposed, index) => index).filter(index => !cut.has(index))

  /** Cut a card and everything under it, or restore just this one. */
  const toggle = (index: number): void => {
    setCut((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else for (const member of subtreeOf(offered, index)) next.add(member)
      return next
    })
  }

  return (
    // A stable handle, because every descendant class here also contains `_skeleton`:
    // CSS-module hashes are a PREFIX, so `[class*="_skeleton"]` matches the container and
    // seven children alike and cannot be used to count reviews.
    <div className={styles.skeleton} data-skeleton-review="">

      <div className={styles.skeletonHead}>
        <h2 className={styles.title}>{t('skeleton.title')}</h2>
        <span className={styles.meta}>
          {t('skeleton.count', { kept: String(kept.length), total: String(offered.length) })}
        </span>
      </div>
      <p className={styles.skeletonWhat}>{proposal.title}</p>
      {proposal.summary === undefined ? null : <p className={styles.duty}>{proposal.summary}</p>}
      <p className={styles.skeletonHint}>{t('skeleton.hint')}</p>

      <div className={styles.skeletonList}>
        {offered.map((proposed, index) => (
          <div
            key={index}
            className={clsx(styles.skeletonRow, cut.has(index) && styles.skeletonRowCut)}
            style={{ marginLeft: `${String(depthOf(offered, index) * 18)}px` }}
          >
            <input
              aria-label={t('skeleton.nodeTitle', { n: String(index + 1) })}
              className={styles.line}
              value={titles[index] ?? proposed.title}
              disabled={cut.has(index)}
              onChange={(event) => {
                setTitles(current => ({ ...current, [index]: event.target.value }))
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { toggle(index) }}
              title={hasChildren(offered, index) && !cut.has(index) ? t('skeleton.cutWithChildren') : undefined}
            >
              {cut.has(index) ? t('skeleton.restore') : t('skeleton.cut')}
            </Button>
          </div>
        ))}
      </div>

      <div className={styles.foot}>
        <Button
          variant="primary"
          size="sm"
          disabled={kept.length === 0}
          onClick={() => {
            props.onAccept(kept.map(index => ({
              index,
              // Only a title the person actually changed travels: an untouched draft
              // accepts as `accepted` rather than `edited`, which is what the verdict
              // records about who wrote what.
              ...titles[index] === undefined || titles[index] === offered[index]?.title
                ? {}
                : { title: titles[index] },
            })))
          }}
        >
          {t('proposal.accept')}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDiscard}>{t('proposal.discard')}</Button>
        {kept.length === 0 ? <span className={styles.warn}>{t('skeleton.emptyKept')}</span> : null}
      </div>
    </div>
  )
}

/**
 * How deep a proposed card sits, for indentation only.
 * @param offered - the draft's proposed cards.
 * @param index - the card to measure.
 * @returns the number of `parentIndex` hops up to a root.
 */
function depthOf(offered: readonly ProposedNode[], index: number): number {
  let depth = 0
  let at = offered[index]?.parentIndex
  // `parentIndex` points strictly backwards, so this walk cannot loop.
  while (at !== undefined) {
    depth += 1
    at = offered[at]?.parentIndex
  }
  return depth
}

/**
 * Whether cutting this card would take others with it.
 * @param offered - the draft's proposed cards.
 * @param index - the card in question.
 * @returns true when at least one card names it as parent.
 */
function hasChildren(offered: readonly ProposedNode[], index: number): boolean {
  return offered.some(proposed => proposed.parentIndex === index)
}
