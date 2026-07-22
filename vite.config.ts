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
const CALL_CONFIRMATION_AGENTS = ['William Carcamo', 'Kathering Silva']
const BUSINESS_HOURS_END = 19
// The Public Calls API marks these as missed, but dashboard review confirmed that
// an agent attempted to answer after the caller had already disconnected.
const EXCLUDED_MISSED_CALL_IDS = new Set([3979734082])

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

type AircallUser = {
  id?: number
  name?: string
  email?: string
}

type AircallNumber = {
  name?: string
  digits?: string
}

type AircallIvrOption = {
  title?: string
  key?: string
  branch?: string
  transition_started_at?: string
  transition_ended_at?: string
}

type AircallCall = {
  id: number
  direction: string
  status: string
  missed_call_reason: string | null
  started_at: number
  answered_at: number | null
  ended_at: number
  duration: number
  archived: boolean
  raw_digits: string
  user?: AircallUser | null
  assigned_to?: AircallUser | null
  transferred_to?: AircallUser | null
  number?: AircallNumber | null
  tags?: { name?: string }[]
  comments?: unknown[]
  recording_short_url?: string | null
  voicemail_short_url?: string | null
  ivr_options_selected?: AircallIvrOption[]
}

type AircallCallsResponse = {
  calls?: AircallCall[]
  meta?: {
    next_page_link?: string | null
  }
  message?: string
}

type AircallAssignee = {
  name: string
  email: string | null
  source: 'direct'
}

type HubSpotTask = {
  id: string
  properties: {
    hs_createdate?: string | null
    hs_task_contact_phone?: string | null
    hs_task_status?: string | null
    hs_task_subject?: string | null
    hubspot_owner_id?: string | null
  }
}

type HubSpotTaskSearchResponse = {
  results?: HubSpotTask[]
  paging?: { next?: { after?: string } }
  message?: string
}

type HubSpotOwner = {
  id: string
  firstName?: string
  lastName?: string
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

function aircallMissedCallsApi(apiId: string, apiToken: string): Plugin {
  return {
    name: 'aircall-missed-calls-api',
    configureServer(server) {
      server.middlewares.use('/api/missed-calls', async (request, response) => {
        try {
          if (!apiId || !apiToken) {
            sendJson(response, 500, {
              message: 'Missing AIRCALL_API_ID or AIRCALL_API_TOKEN in .env.local.',
            })
            return
          }

          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const reportDate = requestUrl.searchParams.get('date') || getTodayInNewYork()
          const clientNumber = requestUrl.searchParams.get('phone')?.replace(/\D/g, '') ?? ''
          const { from, to } = getNewYorkUnixDayRange(reportDate)
          const calls = await fetchAircallCalls({
            apiId,
            apiToken,
            from,
            to,
            phoneNumber: clientNumber,
          })

          const missedCallRows = calls
            .filter((call) => isUserDidNotAnswerCall(call))
            .filter((call) => !EXCLUDED_MISSED_CALL_IDS.has(call.id))
            .filter((call) =>
              clientNumber ? call.raw_digits.replace(/\D/g, '') === clientNumber : true,
            )
          const missedCalls = await Promise.all(missedCallRows.map(async (call) => {
            const detailedCall = (await fetchAircallCallDetail(call.id, apiId, apiToken)
              .catch(() => call)
            ) ?? call
            const enrichedCall = {
              ...call,
              ...detailedCall,
              number: detailedCall.number ?? call.number,
              ivr_options_selected:
                detailedCall.ivr_options_selected ?? call.ivr_options_selected,
            }
            const normalizedClientNumber = call.raw_digits.replace(/\D/g, '')
            const assignee = getCallAssignee(enrichedCall, 'direct')

            return {
              id: enrichedCall.id,
              reportDate,
              direction: enrichedCall.direction,
              status: enrichedCall.status,
              missedCallReason: enrichedCall.missed_call_reason,
              startedAt: new Date(enrichedCall.started_at * 1000).toISOString(),
              startedAtNewYork: formatAircallDateTime(enrichedCall.started_at),
              endedAt: new Date(enrichedCall.ended_at * 1000).toISOString(),
              durationSeconds: enrichedCall.duration,
              clientNumber: enrichedCall.raw_digits,
              displayClientNumber: normalizedClientNumber,
              aircallNumberName: enrichedCall.number?.name ?? '',
              aircallNumberDigits: enrichedCall.number?.digits ?? '',
              missedByName:
                getVerifiedMissedByName(enrichedCall.id) ??
                assignee?.name ??
                null,
              assigneeName: assignee?.name ?? null,
              assigneeEmail: assignee?.email ?? null,
              assigneeSource: assignee?.source ?? null,
              tags: (enrichedCall.tags ?? []).map((tag) => tag.name).filter(Boolean),
              commentsCount: enrichedCall.comments?.length ?? 0,
              recordingUrl: enrichedCall.recording_short_url ?? null,
              voicemailUrl: enrichedCall.voicemail_short_url ?? null,
              archived: enrichedCall.archived,
            }
          }))
          const missedByNames = [
            ...new Set(missedCalls.map((call) => call.missedByName).filter(Boolean)),
          ] as string[]
          const users = missedByNames.length
            ? await fetchAircallUsers(apiId, apiToken)
            : []
          const agentCalls = (
            await Promise.all(
              missedByNames.map((agentName) => {
                const user = users.find(
                  (candidate) => candidate.name && namesMatch(candidate.name, agentName),
                )

                return user?.id
                  ? fetchAircallCalls({
                      apiId,
                      apiToken,
                      from,
                      to,
                      phoneNumber: '',
                      direction: null,
                      userId: user.id,
                    })
                  : Promise.resolve([])
              }),
            )
          ).flat()
          const availableMissedCalls = missedCalls.filter(
            (call) =>
              !call.missedByName ||
              !isAgentBusyDuringCall(
                call.missedByName,
                call.id,
                call.startedAt,
                call.endedAt,
                agentCalls,
              ),
          )

          sendJson(response, 200, {
            reportDate,
            timezone: 'America/New_York',
            calls: availableMissedCalls,
          })
        } catch (error) {
          sendJson(response, 500, {
            message: error instanceof Error ? error.message : 'Unable to fetch Aircall missed calls.',
          })
        }
      })
    },
  }
}

function callConfirmationApi(hubSpotToken: string, apiId: string, apiToken: string): Plugin {
  return {
    name: 'call-confirmation-api',
    configureServer(server) {
      server.middlewares.use('/api/call-confirmation', async (request, response) => {
        try {
          if (!hubSpotToken || !apiId || !apiToken) {
            sendJson(response, 500, {
              message: 'Missing HUBSPOT_ACCESS_TOKEN or Aircall credentials in .env.local.',
            })
            return
          }

          const requestUrl = new URL(request.url ?? '', 'http://localhost')
          const reportDate = requestUrl.searchParams.get('date') || getTodayInNewYork()
          const previousReportDate = shiftIsoDate(reportDate, -1)
          const { from, to } = getNewYorkUnixDayRange(reportDate)
          const [tasks, previousTasks, outboundCalls, owners] = await Promise.all([
            fetchHubSpotMissedCallTasks(reportDate, hubSpotToken),
            fetchHubSpotMissedCallTasks(previousReportDate, hubSpotToken),
            fetchAircallCalls({ apiId, apiToken, from, to, phoneNumber: '', direction: 'outbound' }),
            fetchHubSpotOwners(hubSpotToken),
          ])
          const ownerNames = new Map(
            owners.map((owner) => [owner.id, `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim()]),
          )
          const buildConfirmationNumbers = (sourceTasks: HubSpotTask[]) => {
            const uniqueTasks = Array.from(
              new Map(
                sourceTasks
                .map((task) => [normalizePhoneNumber(task.properties.hs_task_contact_phone), task] as const)
                .filter(([phone]) => phone),
              ).entries(),
            )
            return uniqueTasks.map(([phone, task]) => {
              const assignedTo = ownerNames.get(task.properties.hubspot_owner_id ?? '') ?? 'Unassigned'
              const confirmedCalls = outboundCalls.filter((call) => {
                const agentName = getCallAssignee(call, 'direct')?.name ?? ''
                return (
                  phoneNumbersMatch(phone, normalizePhoneNumber(call.raw_digits)) &&
                  CALL_CONFIRMATION_AGENTS.some((allowedAgent) =>
                    namesMatch(agentName, allowedAgent),
                  )
                )
              })

              return {
                phone,
                assignedTo,
                called: confirmedCalls.length > 0,
                calledBy: Array.from(
                  new Set(
                    confirmedCalls
                      .map((call) => getCallAssignee(call, 'direct')?.name)
                      .filter(Boolean),
                  ),
                ),
                callCount: confirmedCalls.length,
              }
            })
          }
          const makeRow = (date: string, outsideBusinessHours: boolean, rowTasks: HubSpotTask[]) => {
            const numbers = buildConfirmationNumbers(rowTasks)
            const notCalled = numbers.filter((number) => !number.called).length

            return {
              reportDate: date,
              outsideBusinessHours,
              totalNumbers: numbers.length,
              notCalled,
              notCalledPercent: numbers.length
                ? Math.round((notCalled / numbers.length) * 10000) / 100
                : 0,
              numbers,
            }
          }
          const previousOutsideHoursTasks = previousTasks.filter(isOutsideBusinessHoursTask)
          const currentBusinessHoursTasks = tasks.filter((task) => !isOutsideBusinessHoursTask(task))
          const rows = [
            ...(previousOutsideHoursTasks.length
              ? [makeRow(previousReportDate, true, previousOutsideHoursTasks)]
              : []),
            makeRow(reportDate, false, currentBusinessHoursTasks),
          ]
          const currentRow = rows.at(-1)!

          sendJson(response, 200, {
            reportDate,
            timezone: 'America/New_York',
            totalNumbers: currentRow.totalNumbers,
            notCalled: currentRow.notCalled,
            notCalledPercent: currentRow.notCalledPercent,
            numbers: currentRow.numbers,
            rows,
          })
        } catch (error) {
          sendJson(response, 500, {
            message: error instanceof Error ? error.message : 'Unable to build call confirmation.',
          })
        }
      })
    },
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

async function fetchAircallCalls({
  apiId,
  apiToken,
  from,
  to,
  phoneNumber,
  direction = 'inbound',
  userId,
}: {
  apiId: string
  apiToken: string
  from: number
  to: number
  phoneNumber: string
  direction?: 'inbound' | 'outbound' | null
  userId?: number
}) {
  const url = new URL('https://api.aircall.io/v1/calls/search')
  url.searchParams.set('from', String(from))
  url.searchParams.set('to', String(to))
  url.searchParams.set('per_page', '100')
  url.searchParams.set('fetch_call_timeline', 'true')

  if (direction) {
    url.searchParams.set('direction', direction)
  }

  if (phoneNumber) {
    url.searchParams.set('phone_number', phoneNumber)
  }

  if (userId) {
    url.searchParams.set('user_id', String(userId))
  }

  const calls: AircallCall[] = []
  let nextUrl: string | null = url.toString()

  while (nextUrl) {
    const requestUrl: string = nextUrl
    const payload: AircallCallsResponse = await aircallGet(requestUrl, apiId, apiToken)
    calls.push(...(payload.calls ?? []))
    nextUrl = payload.meta?.next_page_link ?? null
  }

  return calls
}

async function fetchAircallUsers(apiId: string, apiToken: string) {
  const users: AircallUser[] = []
  let nextUrl: string | null = 'https://api.aircall.io/v1/users?per_page=100'

  while (nextUrl) {
    const payload: { users?: AircallUser[]; meta?: { next_page_link?: string | null } } =
      await aircallGet(nextUrl, apiId, apiToken)
    users.push(...(payload.users ?? []))
    nextUrl = payload.meta?.next_page_link ?? null
  }

  return users
}

async function fetchAircallCallDetail(callId: number, apiId: string, apiToken: string) {
  const url = new URL(`https://api.aircall.io/v1/calls/${callId}`)
  url.searchParams.set('fetch_contact', 'true')
  url.searchParams.set('fetch_short_urls', 'true')
  url.searchParams.set('fetch_call_timeline', 'true')
  const payload = await aircallGet<{ call?: AircallCall }>(url.toString(), apiId, apiToken)

  return payload.call ?? null
}

async function fetchHubSpotMissedCallTasks(reportDate: string, token: string) {
  const { from, to } = getNewYorkUnixDayRange(reportDate)
  const tasks: HubSpotTask[] = []
  let after: string | undefined

  do {
    const response = await hubSpotPost<HubSpotTaskSearchResponse>(
      '/crm/v3/objects/tasks/search',
      {
        filterGroups: [
          {
            filters: [
              { propertyName: 'hs_createdate', operator: 'GTE', value: new Date(from * 1000).toISOString() },
              { propertyName: 'hs_createdate', operator: 'LTE', value: new Date(to * 1000).toISOString() },
            ],
          },
        ],
        properties: [
          'hs_createdate',
          'hs_task_contact_phone',
          'hs_task_status',
          'hs_task_subject',
          'hubspot_owner_id',
        ],
        limit: 200,
        ...(after ? { after } : {}),
      },
      token,
    )
    tasks.push(...(response.results ?? []))
    after = response.paging?.next?.after
  } while (after)

  return tasks.filter(
    (task) => task.properties.hs_task_subject?.trim().toLowerCase() === 'missed calls',
  )
}

async function fetchHubSpotOwners(token: string) {
  const owners: HubSpotOwner[] = []
  let after = ''

  do {
    const url = new URL('https://api.hubapi.com/crm/v3/owners')
    url.searchParams.set('limit', '100')
    url.searchParams.set('archived', 'false')
    if (after) url.searchParams.set('after', after)
    const payload = await hubSpotGet<{
      results?: HubSpotOwner[]
      paging?: { next?: { after?: string } }
    }>(url.toString(), token)
    owners.push(...(payload.results ?? []))
    after = payload.paging?.next?.after ?? ''
  } while (after)

  return owners
}

async function hubSpotGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string }

  if (!response.ok) {
    throw new Error(payload.message ?? `HubSpot API failed with ${response.status}.`)
  }

  return payload
}

async function hubSpotPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string }

  if (!response.ok) {
    throw new Error(payload.message ?? `HubSpot API failed with ${response.status}.`)
  }

  return payload
}

function normalizePhoneNumber(value?: string | null) {
  return value?.replace(/\D/g, '') ?? ''
}

function phoneNumbersMatch(left: string, right: string) {
  if (!left || !right) return false

  const comparisonLength = Math.min(10, left.length, right.length)
  return comparisonLength >= 7 && left.slice(-comparisonLength) === right.slice(-comparisonLength)
}

function namesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function isOutsideBusinessHoursTask(task: HubSpotTask) {
  const createdAt = task.properties.hs_createdate
  if (!createdAt) return false

  const newYorkParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(createdAt))
  const weekday = newYorkParts.find((part) => part.type === 'weekday')?.value
  const hour = Number(newYorkParts.find((part) => part.type === 'hour')?.value)

  return weekday === 'Sat' || hour >= BUSINESS_HOURS_END
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isAgentBusyDuringCall(
  agentName: string,
  missedCallId: number,
  missedCallStartedAt: string,
  missedCallEndedAt: string,
  calls: AircallCall[],
) {
  const missedCallStart = Date.parse(missedCallStartedAt) / 1000
  const missedCallEnd = Date.parse(missedCallEndedAt) / 1000

  return calls.some((call) => {
    if (call.id === missedCallId || !call.user?.name || !namesMatch(call.user.name, agentName)) {
      return false
    }

    // Aircall assigns the user field to the agent making or answering a call.
    // Any overlap means that agent was occupied during this missed call.
    return call.started_at < missedCallEnd && call.ended_at > missedCallStart
  })
}

function getCallAssignee(
  call: AircallCall,
  source: AircallAssignee['source'],
): AircallAssignee | null {
  const user = call.assigned_to ?? call.transferred_to ?? call.user ?? null

  if (!user?.name) {
    return null
  }

  return {
    name: user.name,
    email: user.email ?? null,
    source,
  }
}

function getVerifiedMissedByName(callId: number) {
  // Aircall's public call timeline omits agent ring attempts. Keep dashboard-verified
  // attempts here as a fallback when route timing is unavailable in the API response.
  const verifiedMissedBy: Record<number, string> = {
    3957724828: 'William Carcamo',
    3958681499: 'Kevin Tinjaca',
    3976084348: 'Kevin Tinjaca',
    3979647200: 'Kevin Tinjaca',
    3979664579: 'Kevin Tinjaca',
  }

  return verifiedMissedBy[callId] ?? null
}

async function aircallGet<T>(url: string, apiId: string, apiToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiId}:${apiToken}`).toString('base64')}`,
    },
  })
  const payload = (await response.json().catch(() => ({}))) as AircallCallsResponse

  if (!response.ok) {
    throw new Error(payload.message ?? `Aircall API failed with ${response.status}.`)
  }

  return payload as T
}

function isUserDidNotAnswerCall(call: AircallCall) {
  return (
    call.direction === 'inbound' &&
    call.answered_at === null &&
    call.duration > 0 &&
    call.missed_call_reason === 'agents_did_not_answer'
  )
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

function getTodayInNewYork() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getNewYorkUnixDayRange(reportDate: string) {
  const start = zonedTimeToUtc(reportDate, 0, 0, 0, 'America/New_York')
  const end = zonedTimeToUtc(reportDate, 23, 59, 59, 'America/New_York')

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  }
}

function zonedTimeToUtc(
  date: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const [year, month, day] = date.split('-').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offset = getTimeZoneOffset(utcGuess, timeZone)
  const firstPass = new Date(utcGuess.getTime() - offset)
  const correctedOffset = getTimeZoneOffset(firstPass, timeZone)

  return new Date(utcGuess.getTime() - correctedOffset)
}

function getTimeZoneOffset(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )

  return zonedAsUtc - date.getTime()
}

function formatAircallDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp * 1000))
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
    server: {
      allowedHosts: ['dharma-campaignreport-1.onrender.com'],
    },
    plugins: [
      react(),
      facebookBudgetApi(env.FACEBOOK_SYSTEM_ACCESS_TOKEN ?? ''),
      respondIoReportMetricsApi(
        env.RESPOND_IO_ACCESS_TOKEN ?? '',
        env.RESPOND_IO_ANALYTICS_ACCESS_TOKEN ?? '',
      ),
      respondIoSampleApi(env.RESPOND_IO_ACCESS_TOKEN ?? ''),
      tiktokAdsManagerApi(),
      aircallMissedCallsApi(env.AIRCALL_API_ID ?? '', env.AIRCALL_API_TOKEN ?? ''),
      callConfirmationApi(
        env.HUBSPOT_ACCESS_TOKEN ?? '',
        env.AIRCALL_API_ID ?? '',
        env.AIRCALL_API_TOKEN ?? '',
      ),
    ],
  }
})
