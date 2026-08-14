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
    // Nothing structured yet: the tab asks for one sentence and counts nothing.
    expect(await page.getByText('One sentence is enough').count()).toBe(1)
    expect(await page.getByText('No global constraints yet.', { exact: false }).count()).toBe(1)
    expect(await page.getByText('rev 0').count()).toBe(1)
  }, 60_000)

  it('takes the first card from the person, and the tree, the card and the meter all follow', async () => {
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

  it('shows one module’s exchange, not the whole session’s', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-talk'))
    // Said while 场地与时间 is focused, so the host stamps it with that module. The
    // browser never sends the card along: the host reads its own recorded focus.
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

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['descended.expected.md', 'first-card.expected.md'])
  })
})
