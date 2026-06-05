import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { chromium } from 'playwright'

const statePath = resolve('.auth/respondio-state.json')
const profilePath = resolve('.auth/respondio-profile')
const isAutoMode = process.argv.includes('--auto')
const isProfileMode = process.argv.includes('--profile')

await mkdir(dirname(statePath), { recursive: true })
await mkdir(profilePath, { recursive: true })

const context = isProfileMode
  ? await chromium.launchPersistentContext(profilePath, { headless: false })
  : await (await chromium.launch({ headless: false })).newContext()
const page = await context.newPage()

await page.goto('https://app.respond.io/space/238284/reports/conversations', {
  waitUntil: 'domcontentloaded',
})

console.log('A browser window is open. Log in to respond.io and open Reports > Conversations.')

if (isProfileMode) {
  console.log('This window will stay open. After login reaches Reports > Conversations, close it.')
  await page.waitForEvent('close', { timeout: 0 })
} else if (isAutoMode) {
  console.log('This window will close after Reports analytics is authenticated.')
  await page.waitForFunction(isAuthenticatedOnReportsPage, undefined, {
    timeout: 10 * 60 * 1000,
    polling: 3000,
  })
} else {
  console.log('When the report page is visible, come back here and press Enter.')

  const prompt = createInterface({ input, output })
  await prompt.question('')
  prompt.close()
}

await context.storageState({ path: statePath })
await context.close()

console.log(`Saved respond.io browser session to ${statePath}`)

async function isAuthenticatedOnReportsPage() {
  if (!window.location.pathname.includes('/reports/conversations')) {
    return false
  }

  try {
    const response = await fetch('/analytics/conversation', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: {
          from: '2026-06-02 00:00:00',
          to: '2026-06-02 23:59:59',
        },
        timezone: 'America/New_York',
      }),
    })

    if (!response.ok) {
      console.log(`Reports analytics not ready: ${response.status}`)
      return false
    }

    const payload = await response.json().catch(() => null)
    const hasOverviewCounts =
      typeof payload?.opened?.count === 'number' || typeof payload?.closed?.count === 'number'
    const hasChartData = Boolean(payload?.labels || payload?.values)

    return hasOverviewCounts || hasChartData
  } catch {
    return false
  }
}
