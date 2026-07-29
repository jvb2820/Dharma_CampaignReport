import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const statePath = resolve('.auth/respondio-state.json')
const profilePath = resolve('.auth/respondio-profile')
const reportDate = readArg('--date') ?? getTodayISO()
const userIds = JSON.parse(readArg('--user-ids') ?? '[]')

if (!existsSync(statePath) && !existsSync(profilePath)) {
  fail('Missing saved respond.io session. Use the dashboard login prompt first.')
}

let browser = null
const context = existsSync(profilePath)
  ? await chromium.launchPersistentContext(profilePath, { headless: true })
  : await createStorageStateContext()
const page = await context.newPage()

try {
  await page.goto('https://app.respond.io/space/238284/reports/messages', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(3_000)

  if (page.url().includes('/login') || page.url().includes('/auth')) {
    fail('Saved respond.io session is expired. Run `npm run respond:login` again.')
  }

  const counts = {}
  for (const userId of userIds) {
    const payload = await fetchOutgoingWithRetry(page, userId)
    counts[userId] = readOutgoingTotal(payload)
    await page.waitForTimeout(350)
  }

  console.log(JSON.stringify({ reportDate, counts }))
} catch (error) {
  fail(error instanceof Error ? error.message : 'Unable to fetch respond.io messages.')
} finally {
  await context.close()
  await browser?.close()
}

async function fetchOutgoingWithRetry(page, userId) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await appFetch(page, '/analytics/message/outgoing', {
        method: 'POST',
        body: {
          date: getNewYorkDateRange(reportDate),
          userIds: [userId],
          groupBy: 'channelId',
        },
      })
    } catch (error) {
      lastError = error
      if (!String(error).toLowerCase().includes('too many requests')) throw error
      await page.waitForTimeout(2_000 * (attempt + 1))
    }
  }
  throw lastError
}

async function createStorageStateContext() {
  browser = await chromium.launch({ headless: true })
  return browser.newContext({ storageState: statePath })
}

async function appFetch(page, path, options) {
  return page.evaluate(
    async ({ path: requestPath, options: requestOptions }) => {
      const token = localStorage.getItem('ID_TOKEN')
      const organization = parseStoredJson(localStorage.getItem('ORGANIZATION'))
      const space = parseStoredJson(localStorage.getItem('SPACE'))
      const response = await fetch(requestPath, {
        method: requestOptions.method,
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          orgid: String(readStoredId(organization) ?? 236383),
          botid: String(readStoredId(space) ?? 238284),
          timezone: 'America/New_York',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestOptions.body),
      })
      const text = await response.text()
      const payload = text ? JSON.parse(text) : {}
      if (!response.ok) throw new Error(payload.message ?? `Request failed with ${response.status}`)
      return payload

      function parseStoredJson(value) {
        try {
          return value ? JSON.parse(value) : null
        } catch {
          return null
        }
      }

      function readStoredId(value) {
        return typeof value === 'number' || typeof value === 'string' ? value : value?.id
      }
    },
    { path, options },
  )
}

function readOutgoingTotal(payload) {
  const data = payload?.data ?? payload
  return Object.entries(data ?? {}).reduce((total, [key, value]) => {
    if (key === 'labels' || key === 'values') return total
    return total + (typeof value?.count === 'number' ? value.count : 0)
  }, 0)
}

function getNewYorkDateRange(date) {
  return { from: `${date} 00:00:00`, to: `${date} 23:59:59` }
}

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function readArg(name) {
  const value = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return value?.slice(name.length + 1)
}

function fail(message) {
  console.error(JSON.stringify({ message }))
  process.exitCode = 1
  throw new Error(message)
}
