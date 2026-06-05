import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { chromium } from 'playwright'

const profilePath = resolve('.auth/tiktok-profile')
const reportDate = readArg('--date') ?? getTodayISO()
const isManualMode = process.argv.includes('--manual')
const businessCenterUrl =
  'https://business.tiktok.com/manage/overview?org_id=7223495844006363137&attr_source=TTAM_account_list&attr_type=web'

if (!existsSync(profilePath)) {
  fail('Missing saved TikTok session. Run `npm run tiktok:login` first.')
}

const context = await chromium.launchPersistentContext(profilePath, {
  headless: !isManualMode,
  viewport: { width: 1440, height: 920 },
})
const page = await context.newPage()

try {
  await page.goto('https://ads.tiktok.com/i18n/home', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(4_000)

  if (isLoginUrl(page.url())) {
    fail('Saved TikTok session is expired. Run `npm run tiktok:login` again.')
  }

  await selectBusinessCenterIfNeeded(page)

  if (!page.url().includes('business.tiktok.com')) {
    await page.goto(businessCenterUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
  }

  await page.waitForTimeout(4_000)

  let didSetDateRange = false

  if (isManualMode) {
    await waitForManualDateSelection(page, reportDate)
    didSetDateRange = true
  } else {
    didSetDateRange = await setDateRangeIfPossible(page, reportDate)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null)
    await page.waitForTimeout(3_000)

    if (!didSetDateRange && !(await pageContainsRequestedDate(page, reportDate))) {
      fail(
        `Unable to set TikTok date range to ${reportDate}. Use the dashboard's manual TikTok fetch so you can set the date in the visible browser.`,
      )
    }
  }

  const metrics = await readMetricsFromPage(page)

  if (metrics.tiktokTotalSpending === null && metrics.tiktokLeadsTotal === null) {
    fail(
      'Unable to read TikTok spend/results from Business Center. Open TikTok login, verify the TikTok Ads Manager card is visible, then retry.',
    )
  }

  console.log(
    JSON.stringify({
      reportDate,
      timezone: 'UTC',
      fetchedAt: new Date().toISOString(),
      ...metrics,
    }),
  )
} catch (error) {
  fail(error instanceof Error ? error.message : 'Unable to fetch TikTok Ads Manager data.')
} finally {
  await context.close()
}

async function selectBusinessCenterIfNeeded(page) {
  if (!(await page.getByText('Select an account').isVisible().catch(() => false))) {
    return
  }

  const businessCenter = page
    .getByText(/Dharma Nutrition Clinic|7223495844006363137/)
    .first()

  if (await businessCenter.isVisible().catch(() => false)) {
    await businessCenter.click()
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => null)
    await page.waitForTimeout(3_000)
  }
}

async function waitForManualDateSelection(page, date) {
  console.log(
    `Set TikTok Business Center's date picker to the range/date that corresponds to ${date}, then press Enter here.`,
  )

  const prompt = createInterface({ input, output })
  await prompt.question('')
  prompt.close()

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null)
  await page.waitForTimeout(2_000)
}

async function setDateRangeIfPossible(page, date) {
  const displayDate = formatDisplayDate(date)
  const isoRange = `${date} - ${date}`
  const displayRange = `${displayDate} - ${displayDate}`

  await clickFirstVisible(page, [
    'text=/\\d{4}-\\d{2}-\\d{2}\\s*[–-]\\s*\\d{4}-\\d{2}-\\d{2}/',
    '[data-testid*="date"]',
    '[class*="date"]',
    'button:has-text("UTC")',
    'text=UTC+00:00',
  ]).catch(() => null)

  const textboxes = await page.locator('input, [contenteditable="true"]').all()

  for (const textbox of textboxes) {
    try {
      if (!(await textbox.isVisible())) {
        continue
      }

      await textbox.click({ timeout: 1_000 })
      await textbox.fill(isoRange, { timeout: 1_000 }).catch(async () => {
        await textbox.fill(displayRange, { timeout: 1_000 })
      })
      await page.keyboard.press('Enter')
      return true
    } catch {
      // Keep probing TikTok's changing date UI.
    }
  }

  return clickFirstVisible(page, [
    `text="${displayDate}"`,
    `text="${date}"`,
    'button:has-text("Apply")',
    'button:has-text("Confirm")',
  ])
    .then(() => true)
    .catch(() => false)
}

async function pageContainsRequestedDate(page, date) {
  const text = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '')
  const displayDate = formatDisplayDate(date)

  return text.includes(date) || text.includes(displayDate)
}

async function readMetricsFromPage(page) {
  const text = await page.locator('body').innerText({ timeout: 30_000 })
  const normalizedText = text.replace(/\s+/g, ' ')
  const rowMetrics = readCampaignRows(normalizedText)
  const cardSpend = readNumberAfterLabel(normalizedText, ['Cost', 'Amount spent', 'Spend'])
  const cardLeads = readIntegerAfterLabel(normalizedText, [
    'Results',
    'Result',
    'Conversions',
    'Conversion',
    'Leads',
    'Lead',
  ])

  return {
    tiktokTotalSpending: rowMetrics.spendTotal ?? cardSpend,
    tiktokLeadsTotal: rowMetrics.resultsTotal ?? cardLeads,
    debug: {
      source: rowMetrics.rowCount ? 'campaign rows' : 'business center card',
      rowCount: rowMetrics.rowCount,
    },
  }
}

function readCampaignRows(text) {
  const rowPattern =
    /(?<name>\{SP\}[^|]*?(?:TikTok|Tiktok|tiktok|Dharma|Clinic)[^$]*?)\s+(?<results>[0-9,]+|-)\s+Messaging[^$]*?\$(?<spend>[0-9,]+(?:\.[0-9]{2})?)/g
  const matches = [...text.matchAll(rowPattern)].filter((match) => match.groups)

  if (!matches.length) {
    return { spendTotal: null, resultsTotal: null, rowCount: 0 }
  }

  return {
    spendTotal: roundMoney(
      matches.reduce((total, match) => total + readMoney(match.groups?.spend), 0),
    ),
    resultsTotal: matches.reduce(
      (total, match) => total + readInteger(match.groups?.results),
      0,
    ),
    rowCount: matches.length,
  }
}

function readNumberAfterLabel(text, labels) {
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = text.match(new RegExp(`${escapedLabel}\\s+([0-9,]+(?:\\.[0-9]{2})?)\\s*USD`, 'i'))

    if (match) {
      return readMoney(match[1])
    }
  }

  return null
}

function readIntegerAfterLabel(text, labels) {
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = text.match(new RegExp(`${escapedLabel}\\s+([0-9,]+)(?!\\s*USD)`, 'i'))

    if (match) {
      return readInteger(match[1])
    }
  }

  return null
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()

    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 2_000 })
      return
    }
  }

  throw new Error('No matching visible element found.')
}

function formatDisplayDate(date) {
  const parsedDate = new Date(`${date}T00:00:00Z`)

  return parsedDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function readArg(name) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`))
  return arg?.slice(name.length + 1)
}

function readMoney(value) {
  return Number(String(value ?? '0').replace(/,/g, '')) || 0
}

function readInteger(value) {
  return Number.parseInt(String(value ?? '0').replace(/[,-]/g, ''), 10) || 0
}

function roundMoney(value) {
  return Math.round(value * 100) / 100
}

function isLoginUrl(url) {
  return url.includes('/login') || url.includes('/passport') || url.includes('/auth')
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fail(message) {
  console.error(JSON.stringify({ message }))
  process.exit(1)
}
