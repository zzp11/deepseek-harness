// Keyless assembled-browser coverage for the 工作台 tab: the human half of the long
// flow in my_docs/仿真功能测试场景.md, over the shipped Web bundles, the real Typert
// wire, the real `workbench-edit` command, and the real projection.
//
// No model row and no replay fixture: every write here is a person's, so a stray
// model stream fails loud on the open llm seam instead of being quietly answered.
// What this proves that a package test cannot is that the seam holds across the
// process boundary — the browser folds the event family the host appended, a gate
// refuses in the host and the refusal reaches the person's screen, and the card the
// person is on is what stamps what they say next.
//
// The opening sentence is appended host-side rather than typed. It has to exist (the
// conversation skeleton renders no view tabs at all while a session is blank, so the
// tab is unreachable until something is said) and typing it would start a turn this
// keyless lane has no adapter for.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// The HOST package's browser-safe face, not a `dsh-client-*` one: this lane may not pull
// the Client project graph into the Host build graph.
import { ProposalId } from '@deepseek-ai/dsh-workbench/projection'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/workbench-salon', import.meta.url))
const FIRST_CARD_EXPECTED = join(SNAPSHOT_DIR, 'first-card.expected.md')
const DESCENDED_EXPECTED = join(SNAPSHOT_DIR, 'descended.expected.md')
const OVERLAY = fileURLToPath(new URL('./workbench-salon.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

const OPENING = '就是想做个内部技术沙龙，别搞太正式'

describe('web e2e: the workbench, one long human flow', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Say something as the person, the way the composer does, without starting a turn. */
  const say = (text: string): void => {
    const live = scaffold.ctx.sessions.list().at(-1)
    if (live === undefined) throw new Error('no live session to say anything in')
    live.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }

  /**
   * Append a skeleton draft the way `workbench_propose` does, without a model. Shaped as
   * a tree through `parentIndex`, which is the only way a cold-start draft can say what
   * hangs under what — nothing it names exists yet, so an id-based parent has nothing to
   * point at.
   */
  const proposeSkeleton = (proposalId: string): void => {
    const live = scaffold.ctx.sessions.list().at(-1)
    if (live === undefined) throw new Error('no live session to propose into')
    live.append('workbench/proposal', {
      proposalId: ProposalId(proposalId),
      targetNode: null,
      title: '冷启动骨架',
      summary: '一棵三张卡的骨架',
      newNodes: [
        { title: '沙龙总纲', duty: '管这次沙龙从定题到复盘' },
        { title: '场地档期', parentIndex: 0 },
        { title: '要不要卖票', parentIndex: 1 },
      ],
      createdAt: 0,
    })
  }

  /**
   * The left column. Every row locator is scoped to it: the session breadcrumb above
   * the tab strip carries the same words the opening sentence does, and it is
   * disabled, so an unscoped match waits forever on it.
   */
  const column = () => page.locator('[class*="_map"]')

  /** The focused card. The CSS-module hash is a PREFIX, so the class ends in the name. */
  const card = () => page.locator('[class*="_card"]').first()

  /** Add a card through the inline row, which is the only way the tab creates one. */
  const addCard = async (title: string): Promise<void> => {
    await column().getByRole('button', { name: 'Add a card' }).click()
    const ask = page.getByLabel('Title of the new card')
    await ask.waitFor({ timeout: 10_000 })
    await ask.fill(title)
    await ask.press('Enter')
    await expect.poll(
      () => column().getByRole('button', { name: new RegExp(title) }).count(),
      { timeout: 10_000 },
    ).toBeGreaterThan(0)
  }

  /** Focus a card by clicking its row; the pinned copy and the tree copy both work. */
  const focusCard = async (title: string): Promise<void> => {
    await column().getByRole('button', { name: new RegExp(title) }).first().click()
    await page.getByRole('heading', { name: title }).waitFor({ timeout: 10_000 })
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    say(OPENING)
    await page.getByRole('tab', { name: 'Workbench', exact: true }).click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('carries the opening sentence into the first-hand layer, unchanged', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-opening'))
    // Exactly one copy on screen: one view renders at a time, and this is the
    // workbench's own mirror rather than the chat transcript's line. It is what the
    // tree may later cite, so it must be verbatim.
    await expect.poll(
      () => page.locator('[class*="_talk"]').getByText(OPENING, { exact: true }).count(),
      { timeout: 20_000 },
    ).toBe(1)
    // Nothing structured yet: the directory says so in one line and counts nothing.
    // No meter and no banded empty-state copy — my_docs/04 D-48 records why the
    // five-number strip came out.
    expect(await column().getByText('No cards yet.', { exact: true }).count()).toBe(1)
    expect(await page.getByText(/rev \d/).count()).toBe(0)
  }, 60_000)

  it('takes the composer into its own column instead of growing a second one', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-composer'))
    // ONE composer, moved — never a second implementation. Two seats on screen would
    // give the draft, the images and the chain election two homes each. The seat
    // carries `data-composer-seat` from ui-conversation's own skeleton, so this holds
    // without naming a hashed class or a copy string.
    await expect.poll(
      () => page.locator('[data-composer-seat]').count(),
      { timeout: 15_000 },
    ).toBe(1)
    // And it is INSIDE the conversation column, not under the page.
    await expect.poll(
      () => page.locator('[class*="_talk"] [data-composer-seat]').count(),
      { timeout: 15_000 },
    ).toBe(1)
    // Typing survives the move: what arrived here is the live composer, not a detached
    // copy that re-mounted empty.
    const typing = page.locator('[data-composer-seat] textarea:enabled')
    await typing.fill('场地定在会议室')
    expect(await typing.inputValue()).toBe('场地定在会议室')
    await typing.fill('')
  }, 60_000)

  it('takes the first card from the person, and the directory and the card both follow', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-first-card'))
    await addCard('内部技术沙龙')
    await focusCard('内部技术沙龙')
    // rev moved because a commit landed in the host's log, not because the browser
    // decided to count something.
    await expect.poll(() => page.getByText('rev 1').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    const snapshot = await captureStableAria(page, '[class*="_card"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(FIRST_CARD_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('refuses promotion in the host’s own words once the card has children but no duty', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-refusal'))
    await addCard('场地与时间')
    await focusCard('内部技术沙龙')
    // The card says what promotion is still missing before the person tries.
    await expect.poll(
      () => page.getByText(/things missing before it can be committed/).count(),
      { timeout: 10_000 },
    ).toBe(1)
    await card().getByRole('button', { name: 'Commit to this' }).click()
    // The gate runs in the host; the browser shows the line it answered with.
    await expect.poll(() => page.getByText(/GATE_MISSING_DUTY/).count(), { timeout: 10_000 }).toBe(1)
  }, 60_000)

  it('lets the person write the duty in place and commit it, which clears the refusal', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-duty'))
    // A committed card reads read-only; 改这张卡 puts it into the SAME edit state a
    // model draft opens, which is why there is one card with two states rather than
    // two kinds of card.
    await card().getByRole('button', { name: 'Edit this card' }).click()
    const duty = page.getByLabel('Duty')
    await duty.waitFor({ timeout: 10_000 })
    await duty.fill('管这次沙龙从定题到复盘的全过程')
    await page.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect.poll(() => page.getByText('Uncommitted changes').count(), { timeout: 10_000 }).toBe(0)
    await card().getByRole('button', { name: 'Commit to this' }).click()
    await expect.poll(() => page.getByText(/GATE_MISSING_DUTY/).count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => page.getByText('committed').count(), { timeout: 10_000 }).toBeGreaterThan(0)
  }, 60_000)

  it('descends into a submodule from the map, and the breadcrumb makes it reversible', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-descend'))
    await card().getByRole('button', { name: '⁄子模块' }).click()
    // `.first()`: the card element and the title span inside it both carry a class
    // containing `_subcard`, and a strict locator refuses an ambiguous match.
    const mapped = page.locator('[class*="_subcard"]', { hasText: '场地与时间' }).first()
    await mapped.waitFor({ timeout: 10_000 })
    await mapped.dblclick()
    await page.getByRole('heading', { name: '场地与时间' }).waitFor({ timeout: 10_000 })
    const trail = page.getByRole('navigation', { name: 'Where this sits' })
    await trail.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[class*="_card"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DESCENDED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('opens an idea area on the card, and keeps it out of the tree', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-ideas'))
    // Opening the area is an action on the card, not a tab that shows nothing: the
    // tag appears only once the area exists.
    expect(await card().getByRole('button', { name: '⁄想法' }).count()).toBe(0)
    await card().getByRole('button', { name: '⋯' }).last().click()
    await page.getByRole('menuitem', { name: 'Open the idea area' }).click()
    const ideas = card().getByRole('button', { name: '⁄想法' })
    await ideas.waitFor({ timeout: 10_000 })
    await ideas.click()
    // Empty, and its root is nowhere in main-region navigation — an unconfirmed
    // thought must not be reachable by scanning the tree.
    await expect.poll(
      () => card().getByText('Nothing to draw here yet.').count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(await column().getByRole('button', { name: /想法区/ }).count()).toBe(0)
  }, 60_000)

  it('marks a promoted card as a global constraint in place, without a second band', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-constraint'))
    await addCard('不超预算')
    await focusCard('不超预算')
    // Before: an ordinary card carries its maturity mark, not the scales.
    await expect.poll(
      () => column().getByRole('button', { name: /⚖.*不超预算/ }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await card().getByRole('button', { name: '⋯' }).last().click()
    await page.getByRole('menuitem', { name: 'Promote to a global constraint' }).click()
    // After: the SAME row changes its mark. A card that governs the others is still one
    // card in one place — the earlier banded column listed it twice, which is why the
    // directory is now one flat list (my_docs/04 D-48).
    await expect.poll(
      () => column().getByRole('button', { name: /⚖.*不超预算/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    await expect.poll(
      () => column().getByRole('button', { name: /不超预算/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)
  }, 60_000)

  it('shows one module’s exchange, not the whole session’s', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-talk'))
    // Said while 场地与时间 is focused, so the host stamps it with that module. The
    // browser never sends the card along: the host reads its own recorded focus.
    await focusCard('场地与时间')
    say('会议室周四晚上是空的')
    await expect.poll(
      () => page.locator('[class*="_talk"]').getByText('会议室周四晚上是空的', { exact: true }).count(),
      { timeout: 15_000 },
    ).toBe(1)

    await focusCard('内部技术沙龙')
    // The parent hears neither line: the opening sentence was said before any card
    // was focused, and the second belongs to the submodule.
    await expect.poll(
      () => page.getByText('Nothing has been said on this card yet.').count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('lets the person rule on a skeleton the model proposed, and prunes before the commit', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-skeleton'))
    proposeSkeleton('p-salon-1')
    // Reachable at all: before this surface existed, a draft aiming at no card rendered
    // as one line of text and could be neither accepted nor refused.
    const review = page.locator('[data-skeleton-review]')
    await review.waitFor({ timeout: 15_000 })
    await expect.poll(() => review.getByText('3 / 3').count(), { timeout: 10_000 }).toBe(1)
    // The shape the draft described survives to the screen: one root, one child, one
    // grandchild, by `parentIndex`.
    const indents = await page.locator('[class*="_skeletonRow"]').evaluateAll(
      rows => rows.map(row => (row as HTMLElement).style.marginLeft),
    )
    expect(indents).toEqual(['0px', '18px', '36px'])

    // Cutting a parent takes its subtree: 要不要卖票 under 场地档期 is a question about
    // that venue; at the root it would be a concern of its own.
    await review.getByRole('button', { name: 'Cut' }).nth(1).click()
    await expect.poll(() => review.getByText('1 / 3').count(), { timeout: 10_000 }).toBe(1)
    await review.getByRole('button', { name: 'Restore' }).first().click()
    await expect.poll(() => review.getByText('2 / 3').count(), { timeout: 10_000 }).toBe(1)

    await review.getByLabel('Title of card 1').fill('内部沙龙总纲')
    await review.getByRole('button', { name: 'Accept', exact: true }).click()

    // The host committed the kept pair under the person's title, and the pruned card is
    // nowhere — it never entered the tree, so there is nothing to have deleted.
    await expect.poll(
      () => column().getByRole('button', { name: /内部沙龙总纲/ }).count(),
      { timeout: 15_000 },
    ).toBe(1)
    await expect.poll(
      () => column().getByRole('button', { name: /场地档期/ }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    expect(await column().getByRole('button', { name: /要不要卖票/ }).count()).toBe(0)
    // The review is done and gone once ruled on.
    expect(await page.locator('[data-skeleton-review]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('asks why before discarding a skeleton, because a rejection is worth keeping', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-skeleton-discard'))
    proposeSkeleton('p-salon-2')
    const review = page.locator('[data-skeleton-review]')
    await review.waitFor({ timeout: 15_000 })
    await review.getByRole('button', { name: 'Discard' }).click()
    // No reason, no rejection: the host requires one, so the surface asks in place.
    const reason = page.getByLabel('Why not this draft')
    await reason.waitFor({ timeout: 10_000 })
    expect(await page.locator('[data-skeleton-review]').count()).toBe(1)
    await reason.fill('规模不对')
    await reason.press('Enter')
    await expect.poll(
      () => page.locator('[data-skeleton-review]').count(),
      { timeout: 15_000 },
    ).toBe(0)
    // Refused, so nothing of it reached the tree. Counted against the cards the earlier
    // accept left behind rather than by title alone: the two drafts offer the same
    // titles, and 内部沙龙总纲 from that accept already contains 沙龙总纲.
    expect(await column().getByRole('button', { name: /场地档期/ }).count()).toBe(1)
    expect(await column().getByRole('button', { name: /要不要卖票/ }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['descended.expected.md', 'first-card.expected.md'])
  })
})
