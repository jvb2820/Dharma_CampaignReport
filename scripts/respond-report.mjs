import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const statePath = resolve('.auth/respondio-state.json')
const profilePath = resolve('.auth/respondio-profile')
const reportDate = readArg('--date') ?? getTodayISO()
const platform = readArg('--platform') ?? 'all'

if (!existsSync(statePath) && !existsSync(profilePath)) {
  fail('Missing saved respond.io session. Use the dashboard login prompt first.')
}

let browser = null
const context = existsSync(profilePath)
  ? await chromium.launchPersistentContext(profilePath, { headless: true })
  : await createStorageStateContext()
const page = await context.newPage()
const capturedRequests = []

page.on('request', (request) => {
  const url = request.url()

  if (!url.includes('/analytics/')) {
    return
  }

  const body = parseJson(request.postData() ?? '')
  capturedRequests.push({
    url,
    path: new URL(url).pathname.replace('/analytics/', ''),
    body,
  })
})

try {
  await page.goto('https://app.respond.io/reports/conversations', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(5_000)

  const url = page.url()
  if (url.includes('/login') || url.includes('/auth')) {
    fail('Saved respond.io session is expired. Run `npm run respond:login` again.')
  }

  const channelResponse = await firstSuccessfulAppFetch(page, [
    '/workspace/channel',
    '/api/v2/workspace/channel',
    '/api/v2/space/channel',
  ])
  const channels = normalizeItems(channelResponse)
  const excludedTiktokChannel = channels.find((channel) => channel.name === 'PT - 2034') ?? null

  const rows = await fetchConversationLogRows(page, reportDate)
  const shouldFetchMeta = platform === 'all' || platform === 'meta'
  const shouldFetchTiktok = platform === 'all' || platform === 'tiktok'
  const excludedChannelId = excludedTiktokChannel?.id ?? 333279
  const meta = shouldFetchMeta
    ? summarizeRows(rows, { adPlatform: 'meta', excludedChannelId })
    : null
  const tiktok = shouldFetchTiktok ? summarizeRows(rows, { adPlatform: 'tiktok' }) : null

  console.log(
    JSON.stringify({
      reportDate,
      timezone: 'America/New_York',
      excludedTiktokChannel,
      metrics: {
        newRespondMeta: meta?.newCount ?? null,
        totalRespondMeta: meta?.totalCount ?? null,
        newRespondTiktok: tiktok?.newCount ?? null,
        totalRespondTiktok: tiktok?.totalCount ?? null,
      },
      debug: {
        capturedAnalyticsRequests: capturedRequests.length,
        source: 'conversation/log',
        rows: rows.length,
        platform,
        metaExcludedChannelId: excludedChannelId,
      },
    }),
  )
} catch (error) {
  fail(error instanceof Error ? error.message : 'Unable to fetch respond.io report.')
} finally {
  await context.close()
  await browser?.close()
}

async function createStorageStateContext() {
  browser = await chromium.launch({ headless: true })
  return browser.newContext({ storageState: statePath })
}

async function fetchConversationLogRows(page, reportDate) {
  const date = getNewYorkDateRange(reportDate)
  const itemsPerPage = 100
  const firstPage = await fetchConversationLogPage(page, date, 1, itemsPerPage)
  const rows = [...(firstPage.data ?? [])]
  const pages = Math.ceil((firstPage.totalCount ?? rows.length) / itemsPerPage)

  for (let pageNumber = 2; pageNumber <= pages; pageNumber += 1) {
    const pageData = await fetchConversationLogPage(page, date, pageNumber, itemsPerPage)
    rows.push(...(pageData.data ?? []))
  }

  return rows
}

async function fetchConversationLogPage(page, date, pageNumber, itemsPerPage) {
  const payload = await appFetch(page, '/analytics/conversation/log', {
    method: 'POST',
    body: {
      date,
      pagination: {
        page: pageNumber,
        itemsPerPage,
        sortBy: ['closedAt'],
        sortDesc: [true],
      },
    },
  })

  return unwrapAnalyticsPayload(payload)
}

function summarizeRows(rows, { adPlatform, excludedChannelId = null }) {
  const matchingRows = rows.filter(
    (row) =>
      row.openedByType === 'ctc_ads' &&
      row.adPlatform === adPlatform &&
      row.conversationOpenedChannelId !== excludedChannelId,
  )

  return {
    totalCount: matchingRows.length,
    newCount: matchingRows.filter((row) => row.isNewContact).length,
  }
}

async function appFetch(page, path, options = {}) {
  return page.evaluate(
    async ({ path: requestPath, options: requestOptions }) => {
      const idToken = localStorage.getItem('ID_TOKEN')
      const organization = parseStoredJson(localStorage.getItem('ORGANIZATION'))
      const space = parseStoredJson(localStorage.getItem('SPACE'))
      const orgId = readStoredId(organization) ?? 236383
      const spaceId = readStoredId(space) ?? 238284

      if (!idToken && requestPath.startsWith('/analytics/')) {
        throw new Error('Token not found')
      }

      const response = await fetch(requestPath, {
        method: requestOptions.method ?? 'GET',
        credentials: 'include',
        headers: {
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          ...(orgId ? { orgid: String(orgId) } : {}),
          ...(spaceId ? { botid: String(spaceId) } : {}),
          timezone: 'America/New_York',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
        body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
      })
      const text = await response.text()
      let payload = {}

      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        payload = { text }
      }

      if (!response.ok) {
        throw new Error(payload.message ?? payload.text ?? `Request failed with ${response.status}`)
      }

      return payload

      function parseStoredJson(value) {
        try {
          return value ? JSON.parse(value) : null
        } catch {
          return null
        }
      }

      function readStoredId(value) {
        if (typeof value === 'number' || typeof value === 'string') {
          return value
        }

        return value?.id
      }
    },
    { path, options },
  )
}

async function firstSuccessfulAppFetch(page, paths) {
  let lastError = null

  for (const path of paths) {
    try {
      return await appFetch(page, path)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Unable to fetch from respond.io app session.')
}

function unwrapAnalyticsPayload(payload) {
  return payload?.data ?? payload
}

function getNewYorkDateRange(date) {
  return {
    from: `${date} 00:00:00`,
    to: `${date} 23:59:59`,
  }
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) {
    return payload
  }

  return payload?.items ?? payload?.data ?? []
}

function readArg(name) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`))
  return arg?.slice(name.length + 1)
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function readNumber(value) {
  return typeof value === 'number' ? value : null
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fail(message) {
  console.error(JSON.stringify({ message }))
  process.exit(1)
}
