import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const statePath = resolve('.auth/respondio-state.json')
const profilePath = resolve('.auth/respondio-profile')
const reportDate = readArg('--date') ?? getTodayISO()
const platform = readArg('--platform') ?? 'all'
const defaultMetaChannelIds = [
  494850, 493621, 439286, 433241, 433238, 426799, 396210, 396209, 376692, 333332, 333331,
  333330, 333328, 333321, 330509, 330347,
]

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

  const shouldFetchMeta = platform === 'all' || platform === 'meta'
  const shouldFetchTiktok = platform === 'all' || platform === 'tiktok'
  const excludedChannelId = excludedTiktokChannel?.id ?? 333279
  const includedMetaChannelIds = getIncludedMetaChannelIds(channels, excludedChannelId)
  const meta = shouldFetchMeta
    ? await fetchConversationOpenedMetrics(page, {
        reportDate,
        adPlatform: 'meta',
        includedChannelIds: includedMetaChannelIds,
      })
    : null
  const tiktok = shouldFetchTiktok
    ? await fetchConversationOpenedMetrics(page, {
        reportDate,
        adPlatform: 'tiktok',
      })
    : null

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
        source: 'analytics/conversation',
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

async function fetchConversationOpenedMetrics(
  page,
  { reportDate, adPlatform, includedChannelIds = [] },
) {
  const baseFilters = {
    date: getNewYorkDateRange(reportDate),
    adPlatform: [adPlatform],
    ...(includedChannelIds.length
      ? { conversationOpenedChannels: includedChannelIds }
      : {}),
  }
  const overview = await appFetch(page, '/analytics/conversation', {
    method: 'POST',
    body: baseFilters,
  })
  const openedByContactType = await appFetch(page, '/analytics/conversation/open-group', {
    method: 'POST',
    body: { ...baseFilters, groupBy: 'contactType' },
  })

  return {
    totalCount: readOpenedCount(overview),
    newCount: readCountByPossibleKeys(openedByContactType, [
      'new',
      'New',
      'New Contact',
      'new_contact',
    ]),
  }
}

function getIncludedMetaChannelIds(channels, excludedChannelId) {
  const channelIds = channels.length > 0 ? channels.map((channel) => channel.id) : defaultMetaChannelIds

  return channelIds.filter((channelId) => channelId !== excludedChannelId)
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

function readOpenedCount(payload) {
  const data = unwrapAnalyticsPayload(payload)
  const count = data?.opened?.count ?? data?.overview?.opened?.count

  return typeof count === 'number' ? count : 0
}

function readCountByPossibleKeys(payload, keys) {
  const data = unwrapAnalyticsPayload(payload)

  for (const key of keys) {
    const count = readCountAtKey(data, key)

    if (count !== null) {
      return count
    }
  }

  const values = Array.isArray(data?.values) ? data.values : Array.isArray(data) ? data : []

  for (const row of values) {
    const label = String(
      row?.key ?? row?.label ?? row?.name ?? row?.type ?? row?.contactType ?? '',
    ).toLowerCase()

    if (keys.some((key) => label === key.toLowerCase())) {
      const count = row?.count ?? row?.value ?? row?.total
      return typeof count === 'number' ? count : 0
    }
  }

  return 0
}

function readCountAtKey(data, key) {
  const value = data?.[key] ?? data?.values?.[key]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'object' && value) {
    const count = value.count ?? value.value ?? value.total
    return typeof count === 'number' ? count : 0
  }

  return null
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
