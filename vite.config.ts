import { execFile, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const execFileAsync = promisify(execFile)
const ACCOUNT_ID = 'act_653630476536860'
const GRAPH_VERSION = 'v20.0'
const TARGET_CAMPAIGN_PATTERNS = [
  '{sp} smg campaign - 0123 v3 - secondary',
  '{sp} smg campaign - 0123 v2 - secondary',
  '{sp} smg campaign - new ppl - 0123 v3',
]

type GraphCampaign = {
  id: string
  name: string
  status: string
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  budget_remaining?: string
}

type GraphInsight = {
  campaign_id: string
  spend?: string
  impressions?: string
  clicks?: string
  actions?: GraphAction[]
}

type GraphAction = {
  action_type: string
  value?: string
}

type GraphList<T> = {
  data?: T[]
}

type RespondIoContact = Record<string, unknown>

type RespondIoListResponse = {
  items?: RespondIoContact[]
  pagination?: unknown
  message?: string
}

type RespondIoChannel = {
  id: number
  name: string
  source: string
}

type RespondIoChannelResponse = {
  items?: RespondIoChannel[]
  message?: string
}

type RespondIoAnalyticsResponse = {
  opened?: { count?: number }
  values?: Record<string, unknown>
  [key: string]: unknown
}

function facebookBudgetApi(token: string): Plugin {
  return {
    name: 'facebook-budget-api',
    configureServer(server) {
      server.middlewares.use('/api/smg-campaign-budgets', async (request, response) => {
        try {
          if (!token) {
            sendJson(response, 500, {
              message: 'Missing FACEBOOK_SYSTEM_ACCESS_TOKEN in .env.local.',
            })
            return
          }

          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const timezone = requestUrl.searchParams.get('timezone') || 'America/New_York'

          if (timezone !== 'America/New_York') {
            sendJson(response, 400, {
              message: 'Meta budget reports must use America/New_York timezone.',
            })
            return
          }

          const reportDate = requestUrl.searchParams.get('date') || getYesterdayInNewYork()
          const campaigns = await graphGet<GraphList<GraphCampaign>>(`${ACCOUNT_ID}/campaigns`, {
            fields:
              'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining',
            limit: '200',
            access_token: token,
          })

          const activeTargets = (campaigns.data ?? []).filter(
            (campaign) =>
              isTargetSmgCampaign(campaign.name) && campaign.effective_status === 'ACTIVE',
          )

          const insights = await graphGet<GraphList<GraphInsight>>(`${ACCOUNT_ID}/insights`, {
            fields: 'campaign_id,spend,impressions,clicks,actions',
            level: 'campaign',
            time_range: JSON.stringify({ since: reportDate, until: reportDate }),
            access_token: token,
          })

          const insightsByCampaign = new Map(
            (insights.data ?? []).map((insight) => [insight.campaign_id, insight]),
          )

          sendJson(response, 200, {
            reportDate,
            timezone,
            fetchedAt: new Date().toISOString(),
            accountName: 'Dtrix Ad Account #1',
            accountId: ACCOUNT_ID,
            currency: 'USD',
            campaigns: activeTargets.map((campaign) => {
              const insight = insightsByCampaign.get(campaign.id)

              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                status: campaign.status,
                effectiveStatus: campaign.effective_status,
                dailyBudget: centsToDollars(campaign.daily_budget),
                lifetimeBudget: centsToDollars(campaign.lifetime_budget),
                budgetRemaining: centsToDollars(campaign.budget_remaining),
                spendYesterday: decimalStringToNumber(insight?.spend),
                impressionsYesterday: integerStringToNumber(insight?.impressions),
                clicksYesterday: integerStringToNumber(insight?.clicks),
                resultsYesterday: getMessagingConversationResults(insight),
              }
            }),
          })
        } catch (error) {
          sendJson(response, 500, {
            message: error instanceof Error ? error.message : 'Unable to fetch Facebook data.',
          })
        }
      })
    },
  }
}

function respondIoReportMetricsApi(apiToken: string, analyticsToken: string): Plugin {
  return {
    name: 'respond-io-report-metrics-api',
    configureServer(server) {
      server.middlewares.use('/api/respondio-login', async (_request, response) => {
        try {
          const stdout = openSync('respond-login.out.log', 'a')
          const stderr = openSync('respond-login.err.log', 'a')
          const child = spawnNodeScript(['respond-login.mjs', '--profile'], {
            cwd: getAppRoot(),
            detached: true,
            stdio: ['ignore', stdout, stderr],
          })

          child.unref()
          sendJson(response, 202, {
            message:
              'respond.io login opened. Complete login and open Reports > Conversations in the browser window.',
          })
        } catch (error) {
          sendJson(response, 500, {
            message:
              error instanceof Error ? error.message : 'Unable to open respond.io login window.',
          })
        }
      })

      server.middlewares.use('/api/respondio-report-metrics', async (request, response) => {
        try {
          if (!apiToken) {
            sendJson(response, 500, {
              message: 'Missing RESPOND_IO_ACCESS_TOKEN in .env.local.',
            })
            return
          }

          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const reportDate = requestUrl.searchParams.get('date') || getYesterdayInNewYork()
          const platform = requestUrl.searchParams.get('platform') ?? 'all'
          const channels = await respondIoGet<RespondIoChannelResponse>('space/channel', apiToken, {
            limit: '100',
          })
          const excludedTiktokChannel = (channels.items ?? []).find(
            (channel) => channel.name === 'PT - 2034',
          )

          if (!analyticsToken) {
            if (process.env.RENDER) {
              sendJson(response, 500, {
                message:
                  'Missing RESPOND_IO_ANALYTICS_ACCESS_TOKEN in Render. Browser login only works for local saved-session fetching.',
              })
              return
            }

            const report = await runRespondIoSessionReport(reportDate, platform)
            sendJson(response, 200, {
              ...report,
              excludedTiktokChannel: report.excludedTiktokChannel ?? excludedTiktokChannel,
            })
            return
          }

          const meta = await fetchRespondReportGroup({
            token: analyticsToken,
            reportDate,
            adPlatform: 'meta',
            includedChannelIds: getIncludedMetaChannelIds(channels.items ?? [], excludedTiktokChannel?.id),
          })
          const tiktok = await fetchRespondReportGroup({
            token: analyticsToken,
            reportDate,
            adPlatform: 'tiktok',
          })

          sendJson(response, 200, {
            reportDate,
            timezone: 'America/New_York',
            excludedTiktokChannel,
            metrics: {
              newRespondMeta: meta.newCount,
              totalRespondMeta: meta.totalCount,
              newRespondTiktok: tiktok.newCount,
              totalRespondTiktok: tiktok.totalCount,
            },
          })
        } catch (error) {
          sendJson(response, 500, {
            message: error instanceof Error ? error.message : 'Unable to fetch respond.io report.',
          })
        }
      })
    },
  }
}

function tiktokAdsManagerApi(): Plugin {
  return {
    name: 'tiktok-ads-manager-api',
    configureServer(server) {
      server.middlewares.use('/api/tiktok-login', async (_request, response) => {
        try {
          const stdout = openSync('tiktok-login.out.log', 'a')
          const stderr = openSync('tiktok-login.err.log', 'a')
          const child = spawnNodeScript(['tiktok-login.mjs'], {
            cwd: getAppRoot(),
            detached: true,
            stdio: ['ignore', stdout, stderr],
          })

          child.unref()
          sendJson(response, 202, {
            message: 'TikTok Ads Manager login opened. Log in, then close that browser window.',
          })
        } catch (error) {
          sendJson(response, 500, {
            message:
              error instanceof Error ? error.message : 'Unable to open TikTok login window.',
          })
        }
      })

      server.middlewares.use('/api/tiktok-report', async (request, response) => {
        try {
          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const reportDate = requestUrl.searchParams.get('date') || getYesterdayInNewYork()
          const mode = requestUrl.searchParams.get('mode')
          const args = ['tiktok-report.mjs', `--date=${reportDate}`]

          if (mode === 'manual') {
            args.push('--manual')
          }

          const { stdout } = await execNodeScript(args, {
            cwd: getAppRoot(),
            timeout: 120_000,
          })

          sendJson(response, 200, JSON.parse(String(stdout)))
        } catch (error) {
          const message =
            error && typeof error === 'object' && 'stderr' in error
              ? parseRespondReportError(String(error.stderr))
              : error instanceof Error
                ? error.message
                : 'Unable to fetch TikTok Ads Manager data.'

          sendJson(response, 500, { message })
        }
      })
    },
  }
}

async function runRespondIoSessionReport(reportDate: string, platform: string) {
  try {
    const { stdout } = await execNodeScript(
      ['respond-report.mjs', `--date=${reportDate}`, `--platform=${platform}`],
      {
        cwd: getAppRoot(),
        timeout: 120_000,
      },
    )

    return JSON.parse(String(stdout)) as {
      reportDate: string
      timezone: string
      excludedTiktokChannel?: RespondIoChannel
      metrics: {
        newRespondMeta: number | null
        totalRespondMeta: number | null
        newRespondTiktok: number | null
        totalRespondTiktok: number | null
      }
    }
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'stderr' in error
        ? parseRespondReportError(String(error.stderr))
        : 'Unable to run saved-session respond.io report.'

    throw new Error(message, { cause: error })
  }
}

function getNodeScriptEnv() {
  return process.versions.electron
    ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    : process.env
}

function getAppRoot() {
  return process.env.DHARMA_APP_ROOT || process.cwd()
}

function resolveScriptArg(scriptName: string) {
  return resolve(getAppRoot(), 'scripts', scriptName)
}

function spawnNodeScript(
  args: string[],
  options: Parameters<typeof spawn>[2],
) {
  const [scriptName, ...scriptArgs] = args

  return spawn(process.execPath, [resolveScriptArg(scriptName), ...scriptArgs], {
    ...options,
    env: getNodeScriptEnv(),
  })
}

function execNodeScript(
  args: string[],
  options: Parameters<typeof execFile>[2],
) {
  const [scriptName, ...scriptArgs] = args

  return execFileAsync(process.execPath, [resolveScriptArg(scriptName), ...scriptArgs], {
    ...options,
    env: getNodeScriptEnv(),
  })
}

function parseRespondReportError(stderr: string) {
  try {
    const payload = JSON.parse(stderr)
    return payload.message ?? stderr
  } catch {
    return stderr || 'Unable to run saved-session respond.io report.'
  }
}

function respondIoSampleApi(token: string): Plugin {
  return {
    name: 'respond-io-sample-api',
    configureServer(server) {
      server.middlewares.use('/api/respondio-contact-sample', async (_request, response) => {
        try {
          if (!token) {
            sendJson(response, 500, {
              message: 'Missing RESPOND_IO_ACCESS_TOKEN in .env.local.',
            })
            return
          }

          const payload = await respondIoPost<RespondIoListResponse>(
            'contact/list',
            {
              search: '',
              timezone: 'UTC',
              filter: { $and: [] },
            },
            token,
            { limit: '1' },
          )
          const contacts = payload.items ?? []
          const firstContact = contacts[0]

          sendJson(response, 200, {
            fetchedAt: new Date().toISOString(),
            endpoint: 'POST /v2/contact/list?limit=1',
            returnedItems: contacts.length,
            hasPagination: Boolean(payload.pagination),
            firstContactId: typeof firstContact?.id === 'number' ? firstContact.id : null,
            firstContactFields: firstContact ? Object.keys(firstContact) : [],
          })
        } catch (error) {
          sendJson(response, 500, {
            message: error instanceof Error ? error.message : 'Unable to fetch respond.io data.',
          })
        }
      })
    },
  }
}

async function graphGet<T>(path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url)
  const payload = (await response.json()) as { error?: { message?: string } }

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Facebook API failed with ${response.status}.`)
  }

  return payload as T
}

async function respondIoPost<T>(
  path: string,
  body: unknown,
  token: string,
  params: Record<string, string> = {},
) {
  const url = new URL(`https://api.respond.io/v2/${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as RespondIoListResponse

  if (!response.ok) {
    throw new Error(payload?.message ?? `respond.io API failed with ${response.status}.`)
  }

  return payload as T
}

async function respondIoGet<T>(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://api.respond.io/v2/${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const payload = (await response.json()) as RespondIoChannelResponse

  if (!response.ok) {
    throw new Error(payload?.message ?? `respond.io API failed with ${response.status}.`)
  }

  return payload as T
}

async function respondIoAnalyticsPost<T>(path: string, body: unknown, token: string) {
  const response = await fetch(`https://app.respond.io/analytics/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { message?: string }

  if (!response.ok) {
    throw new Error(payload?.message ?? `respond.io analytics failed with ${response.status}.`)
  }

  return payload as T
}

async function fetchRespondReportGroup({
  token,
  reportDate,
  adPlatform,
  includedChannelIds,
}: {
  token: string
  reportDate: string
  adPlatform: string
  includedChannelIds?: number[]
}) {
  const baseFilters = {
    date: getNewYorkDateRange(reportDate),
    adPlatform: [adPlatform],
    ...(includedChannelIds?.length
      ? { conversationOpenedChannels: includedChannelIds }
      : {}),
  }
  const overview = await respondIoAnalyticsPost<RespondIoAnalyticsResponse>(
    'conversation',
    baseFilters,
    token,
  )
  const openedByContactType = await respondIoAnalyticsPost<RespondIoAnalyticsResponse>(
    'conversation/open-group',
    { ...baseFilters, groupBy: 'contactType' },
    token,
  )

  return {
    totalCount: overview.opened?.count ?? 0,
    newCount: readCountByPossibleKeys(openedByContactType, ['new', 'New Contact', 'new_contact']),
  }
}

function getIncludedMetaChannelIds(channels: RespondIoChannel[], excludedChannelId?: number) {
  return channels
    .map((channel) => channel.id)
    .filter((channelId) => channelId !== excludedChannelId)
}

function readCountByPossibleKeys(payload: RespondIoAnalyticsResponse, keys: string[]) {
  for (const key of keys) {
    const count = readCountAtKey(payload, key)

    if (count !== null) {
      return count
    }
  }

  const values = Array.isArray(payload.values) ? payload.values : Array.isArray(payload) ? payload : []

  for (const row of values) {
    if (!row || typeof row !== 'object') {
      continue
    }

    const item = row as Record<string, unknown>
    const label = String(
      item.key ?? item.label ?? item.name ?? item.type ?? item.contactType ?? '',
    ).toLowerCase()

    if (keys.some((key) => label === key.toLowerCase())) {
      const count = item.count ?? item.value ?? item.total
      return typeof count === 'number' ? count : 0
    }
  }

  return 0
}

function readCountAtKey(payload: RespondIoAnalyticsResponse, key: string) {
  const value = payload[key] ?? payload.values?.[key]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'object' && value) {
    const count = (value as { count?: unknown; value?: unknown; total?: unknown }).count ??
      (value as { count?: unknown; value?: unknown; total?: unknown }).value ??
      (value as { count?: unknown; value?: unknown; total?: unknown }).total

    return typeof count === 'number' ? count : 0
  }

  return null
}

function getNewYorkDateRange(reportDate: string) {
  return {
    from: `${reportDate} 00:00:00`,
    to: `${reportDate} 23:59:59`,
  }
}

function getYesterdayInNewYork() {
  const newYorkDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const noonUtc = new Date(`${newYorkDate}T12:00:00Z`)
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1)

  return noonUtc.toISOString().slice(0, 10)
}

function centsToDollars(value?: string) {
  return value ? Number(value) / 100 : null
}

function decimalStringToNumber(value?: string) {
  return value ? Number(value) : null
}

function integerStringToNumber(value?: string) {
  return value ? Number.parseInt(value, 10) : null
}

function isTargetSmgCampaign(campaignName: string) {
  const normalizedName = normalizeCampaignName(campaignName)

  return TARGET_CAMPAIGN_PATTERNS.some((pattern) =>
    normalizedName.includes(normalizeCampaignName(pattern)),
  )
}

function normalizeCampaignName(campaignName: string) {
  return campaignName.trim().toLowerCase().replace(/\s+/g, ' ')
}

function getMessagingConversationResults(insight?: GraphInsight) {
  const messagingActionTypes = [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.messaging_conversation_started',
  ]
  const action = messagingActionTypes
    .map((actionType) =>
      (insight?.actions ?? []).find((currentAction) => currentAction.action_type === actionType),
    )
    .find(Boolean)

  return integerStringToNumber(action?.value) ?? null
}

function sendJson(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.end(JSON.stringify(data))
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      facebookBudgetApi(env.FACEBOOK_SYSTEM_ACCESS_TOKEN ?? ''),
      respondIoReportMetricsApi(
        env.RESPOND_IO_ACCESS_TOKEN ?? '',
        env.RESPOND_IO_ANALYTICS_ACCESS_TOKEN ?? '',
      ),
      respondIoSampleApi(env.RESPOND_IO_ACCESS_TOKEN ?? ''),
      tiktokAdsManagerApi(),
    ],
  }
})
