import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import './App.css'

type CampaignBudget = {
  campaignId: string
  campaignName: string
  status: string
  effectiveStatus: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  budgetRemaining: number | null
  spendYesterday: number | null
  impressionsYesterday: number | null
  clicksYesterday: number | null
  resultsYesterday?: number | null
}

type BudgetResponse = {
  reportDate: string
  timezone: string
  fetchedAt: string
  accountName: string
  accountId: string
  currency: string
  campaigns: CampaignBudget[]
  metaTotalSpending?: number | null
  metaLeadsTotal?: number | null
  tiktokTotalSpending?: number | null
  tiktokLeadsTotal?: number | null
}

type RespondIoReportMetrics = {
  newRespondMeta: number | null
  totalRespondMeta: number | null
  newRespondTiktok: number | null
  totalRespondTiktok: number | null
}

type RespondIoReportResponse = {
  reportDate: string
  timezone: string
  excludedTiktokChannel?: {
    id: number
    name: string
    source: string
  }
  metrics: RespondIoReportMetrics
}

type RespondIoConversationRow = {
  report_date: string
  timezone: string | null
  meta: number | null
  total_resp_meta: number | null
  new_respond_meta: number | null
  total_resp_tiktok: number | null
  new_tiktok: number | null
  average: number | null
  meta_and_tiktok: number | null
  new_meta_and_tiktok: number | null
  excluded_tiktok_channel: RespondIoReportResponse['excludedTiktokChannel'] | null
  fetched_at: string | null
}

type MetaBudgetReportRow = {
  report_date: string
  timezone: string
  fetched_at: string
  account_name: string
  account_id: string
  currency: string
  meta_total_spending: number | null
  meta_leads_total: number | null
  tiktok_total_spending: number | null
  tiktok_leads_total: number | null
  average_respond_leads: number | null
  meta_cpr: number | null
  tiktok_cpr: number | null
  respond_cpr: number | null
  campaigns: CampaignBudget[]
}

type RespondIoPlatform = 'meta' | 'tiktok'

type FetchProgressState = {
  isRunning: boolean
  currentStep: number
  completedSteps: number
  startedAt: number | null
  label: string
  detail: string
  etaSeconds: number
}

type ReportEntryField =
  | 'meta'
  | 'totalRespondMeta'
  | 'newRespondMeta'
  | 'totalRespondTiktok'
  | 'newRespondTiktok'
  | 'average'

type ReportEntry = Record<ReportEntryField, string>

type ReportEntriesByDate = Record<string, ReportEntry>

type SpanishReportRow = {
  reportDate: string
  date: string
  metaSpend: string
  metaLeads: string
  averageRespondLeads: string
  metaCpr: string
  tiktokCpr: string
  respondCpr: string
}

type HeroChartPoint = {
  reportDate: string
  label: string
  metaLeads: number
  tiktokLeads: number
  totalLeads: number
  newLeads: number
  metaCpr: number | null
  tiktokCpr: number | null
  respondCpr: number | null
}

const emptyReportEntry: ReportEntry = {
  meta: '',
  totalRespondMeta: '',
  newRespondMeta: '',
  totalRespondTiktok: '',
  newRespondTiktok: '',
  average: '',
}

const chartPageSize = 7

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const numberFormatter = new Intl.NumberFormat('en-US')
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const totalFetchSteps = 3
const emptyFetchProgress: FetchProgressState = {
  isRunning: false,
  currentStep: 0,
  completedSteps: 0,
  startedAt: null,
  label: '',
  detail: '',
  etaSeconds: 0,
}

function getSupabaseRestUrl(path: string, params?: URLSearchParams) {
  if (!supabaseUrl) {
    return null
  }

  const baseUrl = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`
  const url = new URL(path, baseUrl)

  if (params) {
    params.forEach((value, key) => url.searchParams.set(key, value))
  }

  return url
}

async function supabaseRequest<T>(
  path: string,
  options: RequestInit = {},
  params?: URLSearchParams,
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const url = getSupabaseRestUrl(path, params)

  if (!url) {
    return null
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(responseText || `Supabase request failed with ${response.status}.`)
  }

  if (response.status === 204 || !responseText) {
    return null
  }

  return JSON.parse(responseText) as T
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  const responseText = await response.text()

  if (!responseText) {
    throw new Error(fallbackMessage)
  }

  return JSON.parse(responseText) as T & { message?: string }
}

function formatMoney(value: number | null) {
  return value === null ? 'No value' : currencyFormatter.format(value)
}

function formatMetric(value: number | null | undefined) {
  return value === null || value === undefined ? 'Waiting' : numberFormatter.format(value)
}

function parseEntryNumber(value: string) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

function formatSheetNumber(value: number) {
  return value ? numberFormatter.format(value) : '0'
}

function parseNullableEntryNumber(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

function parseNullableSheetNumber(value: string) {
  const normalizedValue = value.replace(/[$,]/g, '').trim()

  if (!normalizedValue) {
    return null
  }

  const parsed = Number(normalizedValue)

  return Number.isFinite(parsed) ? parsed : null
}

function getDayLabel(dateValue: string) {
  if (!dateValue) {
    return 'Select date'
  }

  const date = new Date(`${dateValue}T00:00:00`)

  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    weekday: 'short',
  })
}

function getShortDateLabel(dateValue: string) {
  if (!dateValue) {
    return ''
  }

  const date = new Date(`${dateValue}T00:00:00`)

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'numeric',
  })
}

function getMonthDayLabel(dateValue: string) {
  if (!dateValue) {
    return 'No date'
  }

  const date = new Date(`${dateValue}T00:00:00`)

  return date
    .toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
    })
    .toUpperCase()
}

function getYesterdayInNewYorkDateInputValue() {
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

function isRespondIoSessionError(message: string) {
  return message.toLowerCase().includes('saved respond.io session')
}

function mergeRespondIoReport(
  currentReport: RespondIoReportResponse | null,
  nextReport: RespondIoReportResponse,
) {
  return {
    ...nextReport,
    metrics: {
      newRespondMeta:
        nextReport.metrics.newRespondMeta ?? currentReport?.metrics.newRespondMeta ?? null,
      totalRespondMeta:
        nextReport.metrics.totalRespondMeta ?? currentReport?.metrics.totalRespondMeta ?? null,
      newRespondTiktok:
        nextReport.metrics.newRespondTiktok ?? currentReport?.metrics.newRespondTiktok ?? null,
      totalRespondTiktok:
        nextReport.metrics.totalRespondTiktok ?? currentReport?.metrics.totalRespondTiktok ?? null,
    },
  }
}

function buildRespondIoReportFromRow(row: RespondIoConversationRow): RespondIoReportResponse {
  return {
    reportDate: row.report_date,
    timezone: row.timezone ?? 'America/New_York',
    excludedTiktokChannel: row.excluded_tiktok_channel ?? undefined,
    metrics: {
      newRespondMeta: row.new_respond_meta,
      totalRespondMeta: row.total_resp_meta,
      newRespondTiktok: row.new_tiktok,
      totalRespondTiktok: row.total_resp_tiktok,
    },
  }
}

function buildBudgetResponseFromRow(row: MetaBudgetReportRow): BudgetResponse {
  return {
    reportDate: row.report_date,
    timezone: row.timezone,
    fetchedAt: row.fetched_at,
    accountName: row.account_name,
    accountId: row.account_id,
    currency: row.currency,
    campaigns: row.campaigns ?? [],
    metaTotalSpending: row.meta_total_spending,
    metaLeadsTotal: row.meta_leads_total,
    tiktokTotalSpending: row.tiktok_total_spending,
    tiktokLeadsTotal: row.tiktok_leads_total,
  }
}

function getBudgetTotals(report: BudgetResponse | null) {
  const campaigns = report?.campaigns ?? []

  return campaigns.reduce(
    (summary, campaign) => ({
      dailyBudget: summary.dailyBudget + (campaign.dailyBudget ?? 0),
      budgetRemaining: summary.budgetRemaining + (campaign.budgetRemaining ?? 0),
      spendYesterday: summary.spendYesterday + (campaign.spendYesterday ?? 0),
      resultsYesterday: summary.resultsYesterday + (campaign.resultsYesterday ?? 0),
    }),
    { dailyBudget: 0, budgetRemaining: 0, spendYesterday: 0, resultsYesterday: 0 },
  )
}

function getMetaLeadsTotal(report: BudgetResponse) {
  return report.metaLeadsTotal ?? getBudgetTotals(report).resultsYesterday
}

function getMetaTotalSpending(report: BudgetResponse) {
  return report.metaTotalSpending ?? getBudgetTotals(report).spendYesterday
}

function formatCostPerResult(spend: number | null | undefined, leads: number | null | undefined) {
  if (!spend || !leads) {
    return ''
  }

  return formatMoney(spend / leads)
}

function getCostPerResultValue(
  spend: number | null | undefined,
  leads: number | null | undefined,
) {
  if (!spend || !leads) {
    return null
  }

  return spend / leads
}

function buildSpanishReportRow(report: BudgetResponse, respondIoEntry?: ReportEntry): SpanishReportRow {
  const metaSpend = getMetaTotalSpending(report)
  const metaLeads = getMetaLeadsTotal(report)
  const averageRespondLeadsValue = respondIoEntry
    ? getReportEntryTotals(respondIoEntry).totalMetaAndTiktok
    : null
  const averageRespondLeads =
    averageRespondLeadsValue === null ? '' : formatSheetNumber(averageRespondLeadsValue)
  const totalRespondSpend = metaSpend + (report.tiktokTotalSpending ?? 0)

  return {
    reportDate: report.reportDate,
    date: getShortDateLabel(report.reportDate),
    metaSpend: formatMoney(metaSpend),
    metaLeads: formatSheetNumber(metaLeads),
    averageRespondLeads,
    metaCpr: formatCostPerResult(metaSpend, metaLeads),
    tiktokCpr: formatCostPerResult(report.tiktokTotalSpending, report.tiktokLeadsTotal),
    respondCpr: formatCostPerResult(totalRespondSpend, averageRespondLeadsValue),
  }
}

function buildHeroChartPoint(report: BudgetResponse, respondIoEntry?: ReportEntry): HeroChartPoint {
  const metaSpend = getMetaTotalSpending(report)
  const metaLeads = getMetaLeadsTotal(report)
  const totalsForEntry = respondIoEntry
    ? getReportEntryTotals(respondIoEntry)
    : { totalMetaAndTiktok: 0, newMetaAndTiktok: 0 }
  const totalRespondSpend = metaSpend + (report.tiktokTotalSpending ?? 0)

  return {
    reportDate: report.reportDate,
    label: getShortDateLabel(report.reportDate),
    metaLeads,
    tiktokLeads: report.tiktokLeadsTotal ?? 0,
    totalLeads: totalsForEntry.totalMetaAndTiktok,
    newLeads: totalsForEntry.newMetaAndTiktok,
    metaCpr: getCostPerResultValue(metaSpend, metaLeads),
    tiktokCpr: getCostPerResultValue(report.tiktokTotalSpending, report.tiktokLeadsTotal),
    respondCpr: getCostPerResultValue(totalRespondSpend, totalsForEntry.totalMetaAndTiktok),
  }
}

function upsertBudgetReport(currentReports: BudgetResponse[], nextReport: BudgetResponse) {
  const reportsByDate = new Map(currentReports.map((report) => [report.reportDate, report]))
  reportsByDate.set(nextReport.reportDate, nextReport)

  return Array.from(reportsByDate.values()).sort((left, right) =>
    left.reportDate.localeCompare(right.reportDate),
  )
}

function getReportEntryTotals(entry: ReportEntry) {
  return {
    totalMetaAndTiktok:
      parseEntryNumber(entry.totalRespondMeta) + parseEntryNumber(entry.totalRespondTiktok),
    newMetaAndTiktok:
      parseEntryNumber(entry.newRespondMeta) + parseEntryNumber(entry.newRespondTiktok),
  }
}

function getAverageMetaValue(entries: ReportEntriesByDate, reportDates: string[]) {
  const values = reportDates
    .map((reportDate) => parseNullableSheetNumber(entries[reportDate]?.meta ?? ''))
    .filter((value): value is number => value !== null)

  if (!values.length) {
    return 0
  }

  return values.reduce((total, value) => total + value, 0) / values.length
}

function formatAverage(value: number) {
  return value ? value.toFixed(2) : '0.0'
}

function formatChartMoney(value: number | null) {
  return value === null ? '--' : currencyFormatter.format(value)
}

function getPointX(index: number, total: number, left: number, width: number) {
  if (total <= 1) {
    return left + width / 2
  }

  return left + (index * width) / (total - 1)
}

function PerformanceBarChart({
  activeReportDate,
  points,
}: {
  activeReportDate: string
  points: HeroChartPoint[]
}) {
  const selectedPointIndex = points.findIndex((point) => point.reportDate === activeReportDate)
  const selectedPoint =
    selectedPointIndex >= 0 ? points[selectedPointIndex] : points[points.length - 1]
  const previousPoint = selectedPointIndex > 0 ? points[selectedPointIndex - 1] : null
  const tiktokDelta =
    selectedPoint && previousPoint ? selectedPoint.tiktokLeads - previousPoint.tiktokLeads : null
  const metaDelta =
    selectedPoint && previousPoint ? selectedPoint.metaLeads - previousPoint.metaLeads : null
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [
      point.tiktokLeads,
      point.metaLeads,
      point.newLeads,
      point.totalLeads,
    ]),
  )
  const chartWidth = 330
  const chartHeight = 176
  const chartLeft = 30
  const chartTop = 16
  const chartAreaWidth = chartWidth - 46
  const chartAreaHeight = 116
  const series = [
    { key: 'tiktokLeads', label: 'TikTok Total', color: '#e67e6c' },
    { key: 'metaLeads', label: 'FB Total', color: '#3ba56f' },
    { key: 'newLeads', label: 'Total New Leads', color: '#e6a740' },
    { key: 'totalLeads', label: 'Total Leads', color: '#183c2e' },
  ] as const
  const newLeadPercent =
    selectedPoint && selectedPoint.totalLeads
      ? Math.round((selectedPoint.newLeads / selectedPoint.totalLeads) * 100)
      : 0
  const paddedLength = Math.max(7, points.length)
  const barWidth = Math.min(8, Math.max(5, chartAreaWidth / paddedLength / 7))
  const halfGroupWidth = ((series.length - 1) / 2) * (barWidth + 2) + barWidth / 2
  const xLeft = chartLeft + halfGroupWidth + 4
  const xRight = chartWidth - 14 - halfGroupWidth - 4

  function DeltaBadge({ delta }: { delta: number | null }) {
    if (delta === null) return null
    const up = delta >= 0
    return (
      <span
        style={{
          marginLeft: 5,
          color: up ? '#41b879' : '#f0475e',
          fontWeight: 900,
          fontSize: 11,
          letterSpacing: 0,
        }}
      >
        {up ? '▲' : '▼'} {Math.abs(delta)}
      </span>
    )
  }

  return (
    <article className="report-chart-card">
      <div className="chart-summary">
        <strong>{selectedPoint ? getMonthDayLabel(selectedPoint.reportDate) : 'No reports yet'}</strong>
        <span>
          TikTok Total {selectedPoint ? formatSheetNumber(selectedPoint.tiktokLeads) : '0'}
          <DeltaBadge delta={tiktokDelta} />
        </span>
        <span>
          FB Total {selectedPoint ? formatSheetNumber(selectedPoint.metaLeads) : '0'}
          <DeltaBadge delta={metaDelta} />
        </span>
        <span>
          Total New Leads (Meta &amp; TikTok) ={' '}
          {selectedPoint ? formatSheetNumber(selectedPoint.newLeads) : '0'} ({newLeadPercent}%)
        </span>
        <span>
          Total Leads (Meta &amp; TikTok) ={' '}
          {selectedPoint ? formatSheetNumber(selectedPoint.totalLeads) : '0'}
        </span>
      </div>
      <div className="chart-legend" aria-hidden="true">
        {series.map((item) => (
          <span key={item.key} style={{ '--dot-color': item.color } as CSSProperties}>
            {item.label}
          </span>
        ))}
      </div>
      <svg
        className="mini-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label="Lead totals by report date"
      >
        {[0, 1, 2].map((line) => {
          const y = chartTop + (line * chartAreaHeight) / 2

          return <line key={line} x1={chartLeft} x2={chartWidth - 14} y1={y} y2={y} />
        })}
        {points.length === 0 ? (
          <text
            x={chartWidth / 2}
            y={chartTop + chartAreaHeight / 2 + 6}
            textAnchor="middle"
            className="chart-empty-label"
          >
            No data yet — fetch a date to populate
          </text>
        ) : (
          points.map((point, pointIndex) => {
            const x = getPointX(pointIndex, paddedLength, xLeft, xRight - xLeft)

            return (
              <g key={point.reportDate}>
                {series.map((item, seriesIndex) => {
                  const value = point[item.key]
                  const height = (value / maxValue) * chartAreaHeight
                  const barX = x + (seriesIndex - 1.5) * (barWidth + 2)
                  const barY = chartTop + chartAreaHeight - height

                  return (
                    <rect
                      key={item.key}
                      x={barX}
                      y={barY}
                      width={barWidth}
                      height={height}
                      rx="2"
                      fill={item.color}
                    />
                  )
                })}
                <text x={x} y={chartTop + chartAreaHeight + 18} textAnchor="middle">
                  {point.label}
                </text>
              </g>
            )
          })
        )}
      </svg>
    </article>
  )
}

function CprLineChart({
  activeReportDate,
  points,
}: {
  activeReportDate: string
  points: HeroChartPoint[]
}) {
  const selectedPoint =
    points.find((point) => point.reportDate === activeReportDate) ?? points[points.length - 1]
  const chartWidth = 330
  const chartHeight = 176
  const chartLeft = 34
  const chartTop = 16
  const chartAreaWidth = chartWidth - 54
  const chartAreaHeight = 116
  const series = [
    { key: 'metaCpr', label: 'SP Meta', color: '#3ba56f' },
    { key: 'tiktokCpr', label: 'SP TikTok', color: '#e6a740' },
    { key: 'respondCpr', label: 'SP Respond Average', color: '#183c2e' },
  ] as const
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => series.map((item) => point[item.key] ?? 0)),
  )
  const getY = (value: number) => chartTop + chartAreaHeight - (value / maxValue) * chartAreaHeight

  return (
    <article className="report-chart-card">
      <div className="chart-summary compact">
        <strong>Spend Per Lead - {selectedPoint ? getMonthDayLabel(selectedPoint.reportDate) : 'No reports'}</strong>
        <span>Meta {formatChartMoney(selectedPoint?.metaCpr ?? null)}</span>
        <span>TikTok {formatChartMoney(selectedPoint?.tiktokCpr ?? null)}</span>
        <span>Respond {formatChartMoney(selectedPoint?.respondCpr ?? null)}</span>
      </div>
      <div className="chart-legend" aria-hidden="true">
        {series.map((item) => (
          <span key={item.key} style={{ '--dot-color': item.color } as CSSProperties}>
            {item.label}
          </span>
        ))}
      </div>
      <svg
        className="mini-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label="CPR trend by report date"
      >
        {[0, 1, 2].map((line) => {
          const y = chartTop + (line * chartAreaHeight) / 2

          return <line key={line} x1={chartLeft} x2={chartWidth - 14} y1={y} y2={y} />
        })}
        {points.length === 0 ? (
          <text
            x={chartWidth / 2}
            y={chartTop + chartAreaHeight / 2 + 6}
            textAnchor="middle"
            className="chart-empty-label"
          >
            No data yet — fetch a date to populate
          </text>
        ) : (
          <>
            {series.map((item) => {
              const paddedLength = Math.max(7, points.length)
              const linePoints = points
                .map((point, pointIndex) => {
                  const value = point[item.key]

                  if (value === null) {
                    return null
                  }

                  return {
                    x: getPointX(pointIndex, paddedLength, chartLeft + 10, chartAreaWidth),
                    y: getY(value),
                    value,
                  }
                })
                .filter((point): point is { x: number; y: number; value: number } => point !== null)

              return (
                <g key={item.key}>
                  <polyline
                    fill="none"
                    points={linePoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    stroke={item.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                  {linePoints.map((point) => (
                    <circle key={`${item.key}-${point.x}`} cx={point.x} cy={point.y} r="3" fill={item.color} />
                  ))}
                </g>
              )
            })}
            {points.map((point, pointIndex) => {
              const paddedLength = Math.max(7, points.length)
              const x = getPointX(pointIndex, paddedLength, chartLeft + 10, chartAreaWidth)

              return (
                <text key={point.reportDate} x={x} y={chartTop + chartAreaHeight + 18} textAnchor="middle">
                  {point.label}
                </text>
              )
            })}
          </>
        )}
      </svg>
    </article>
  )
}

function mergeReportToEntry(entry: ReportEntry, report: RespondIoReportResponse) {
  return {
    ...entry,
    totalRespondMeta:
      report.metrics.totalRespondMeta === null
        ? entry.totalRespondMeta
        : String(report.metrics.totalRespondMeta),
    newRespondMeta:
      report.metrics.newRespondMeta === null
        ? entry.newRespondMeta
        : String(report.metrics.newRespondMeta),
    totalRespondTiktok:
      report.metrics.totalRespondTiktok === null
        ? entry.totalRespondTiktok
        : String(report.metrics.totalRespondTiktok),
    newRespondTiktok:
      report.metrics.newRespondTiktok === null
        ? entry.newRespondTiktok
        : String(report.metrics.newRespondTiktok),
  }
}

function buildRespondIoEntryFromRow(row: RespondIoConversationRow): ReportEntry {
  return {
    meta: row.meta === null ? '' : String(row.meta),
    totalRespondMeta: row.total_resp_meta === null ? '' : String(row.total_resp_meta),
    newRespondMeta: row.new_respond_meta === null ? '' : String(row.new_respond_meta),
    totalRespondTiktok: row.total_resp_tiktok === null ? '' : String(row.total_resp_tiktok),
    newRespondTiktok: row.new_tiktok === null ? '' : String(row.new_tiktok),
    average: row.average === null ? '' : String(row.average),
  }
}

async function loadSavedRespondIoConversationRows() {
  const params = new URLSearchParams({
    select: '*',
    order: 'report_date.asc',
  })
  const rows = await supabaseRequest<RespondIoConversationRow[]>(
    'respond_io_conversations',
    {},
    params,
  )

  return rows ?? []
}

async function loadRespondIoConversationRow(reportDate: string) {
  const params = new URLSearchParams({
    select: '*',
    report_date: `eq.${reportDate}`,
    limit: '1',
  })
  const rows = await supabaseRequest<RespondIoConversationRow[]>(
    'respond_io_conversations',
    {},
    params,
  )

  return rows?.[0] ?? null
}

async function saveRespondIoReport(
  report: RespondIoReportResponse,
  entry: ReportEntry,
  currentRow?: RespondIoConversationRow | null,
) {
  const body = {
    report_date: report.reportDate,
    timezone: report.timezone,
    meta: parseNullableEntryNumber(entry.meta) ?? currentRow?.meta ?? null,
    total_resp_meta:
      report.metrics.totalRespondMeta ?? currentRow?.total_resp_meta ?? null,
    new_respond_meta:
      report.metrics.newRespondMeta ?? currentRow?.new_respond_meta ?? null,
    total_resp_tiktok:
      report.metrics.totalRespondTiktok ?? currentRow?.total_resp_tiktok ?? null,
    new_tiktok:
      report.metrics.newRespondTiktok ?? currentRow?.new_tiktok ?? null,
    average: parseNullableEntryNumber(entry.average) ?? currentRow?.average ?? null,
    excluded_tiktok_channel:
      report.excludedTiktokChannel ?? currentRow?.excluded_tiktok_channel ?? null,
    fetched_at: new Date().toISOString(),
  }

  await supabaseRequest(
    'respond_io_conversations?on_conflict=report_date',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        Prefer: 'resolution=merge-duplicates',
      },
    },
  )
}

async function loadSavedMetaBudgetReports() {
  const params = new URLSearchParams({
    select: '*',
    order: 'report_date.asc',
  })
  const rows = await supabaseRequest<MetaBudgetReportRow[]>('meta_budget_reports', {}, params)

  return rows?.map(buildBudgetResponseFromRow) ?? []
}

async function saveMetaBudgetReport(
  report: BudgetResponse,
  metaTotalSpending: number,
  metaLeadsTotal: number,
) {
  const body = {
    report_date: report.reportDate,
    timezone: report.timezone,
    fetched_at: report.fetchedAt,
    account_name: report.accountName,
    account_id: report.accountId,
    currency: report.currency,
    meta_total_spending: metaTotalSpending,
    meta_leads_total: metaLeadsTotal,
    tiktok_total_spending: report.tiktokTotalSpending ?? null,
    tiktok_leads_total: report.tiktokLeadsTotal ?? null,
    campaigns: report.campaigns,
  }

  await supabaseRequest(
    'meta_budget_reports?on_conflict=report_date',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        Prefer: 'resolution=merge-duplicates',
      },
    },
  )
}

function useLoadingTick(isLoading: boolean) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isLoading) {
      return
    }

    const intervalId = window.setInterval(() => {
      setTick((currentTick) => currentTick + 1)
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [isLoading])

  return tick
}

function getRemainingEta(startedAt: number | null, estimatedSeconds: number) {
  if (!startedAt) {
    return estimatedSeconds
  }

  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)

  return Math.max(1, estimatedSeconds - elapsedSeconds)
}

function FetchProgressPanel({
  completedSteps,
  currentStep,
  detail,
  etaSeconds,
  isRunning,
  label,
  totalSteps,
}: FetchProgressState & { totalSteps: number }) {
  const progressPercent = Math.round((completedSteps / totalSteps) * 100)

  return (
    <div className="fetch-progress-panel" role="status" aria-live="polite">
      <div className="fetch-progress-top">
        <div>
          <strong>{isRunning ? label : 'Fetch complete'}</strong>
          <span>{isRunning ? detail : `${totalSteps}/${totalSteps} fetches completed.`}</span>
        </div>
        <em>{isRunning ? `ETA ${etaSeconds}s` : 'Done'}</em>
      </div>
      <div className="fetch-progress-track" aria-hidden="true">
        <span style={{ '--progress': `${progressPercent}%` } as CSSProperties} />
      </div>
      <p>
        {completedSteps}/{totalSteps} fetch completed
        {completedSteps === 1 ? '' : 's'}
        {isRunning ? ` - step ${currentStep + 1}/${totalSteps}` : ''}
      </p>
    </div>
  )
}

function App() {
  const [data, setData] = useState<BudgetResponse | null>(null)
  const [metaReports, setMetaReports] = useState<BudgetResponse[]>([])
  const [respondIoReport, setRespondIoReport] = useState<RespondIoReportResponse | null>(null)
  const [respondIoReportDate, setRespondIoReportDate] = useState('2026-06-02')
  const [metaBudgetDate, setMetaBudgetDate] = useState(getYesterdayInNewYorkDateInputValue)
  const [respondIoEntries, setRespondIoEntries] = useState<ReportEntriesByDate>({})
  const [isLoading, setIsLoading] = useState(false)
  const [respondIoReportLoadingPlatform, setRespondIoReportLoadingPlatform] =
    useState<RespondIoPlatform | null>(null)
  const [isRespondIoLoginOpening, setIsRespondIoLoginOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [respondIoReportError, setRespondIoReportError] = useState<string | null>(null)
  const [shouldShowRespondIoLogin, setShouldShowRespondIoLogin] = useState(false)
  const [fetchProgress, setFetchProgress] = useState<FetchProgressState>(emptyFetchProgress)
  const [chartPageIndex, setChartPageIndex] = useState(0)
  useLoadingTick(isLoading)
  useLoadingTick(respondIoReportLoadingPlatform !== null)
  useLoadingTick(fetchProgress.isRunning)
  const unifiedFetchEtaSeconds = getRemainingEta(
    fetchProgress.startedAt,
    fetchProgress.etaSeconds,
  )

  useEffect(() => {
    let isMounted = true

    async function loadReports() {
      try {
        const [savedReports, savedRespondIoRows] = await Promise.all([
          loadSavedMetaBudgetReports(),
          loadSavedRespondIoConversationRows(),
        ])

        if (!isMounted) {
          return
        }

        if (savedReports.length) {
          setMetaReports(savedReports)
          setData((currentData) => currentData ?? savedReports[savedReports.length - 1])
        }

        if (savedRespondIoRows.length) {
          setRespondIoEntries((currentEntries) => {
            const nextEntries = { ...currentEntries }

            savedRespondIoRows.forEach((row) => {
              nextEntries[row.report_date] = {
                ...(nextEntries[row.report_date] ?? emptyReportEntry),
                ...buildRespondIoEntryFromRow(row),
              }
            })

            return nextEntries
          })
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load saved reports.')
      }
    }

    loadReports()

    return () => {
      isMounted = false
    }
  }, [])

  const totals = useMemo(() => getBudgetTotals(data), [data])

  const spanishReportRows = useMemo<SpanishReportRow[]>(
    () => metaReports.map((report) => buildSpanishReportRow(report, respondIoEntries[report.reportDate])),
    [metaReports, respondIoEntries],
  )
  const heroChartPoints = useMemo<HeroChartPoint[]>(
    () => metaReports.map((report) => buildHeroChartPoint(report, respondIoEntries[report.reportDate])),
    [metaReports, respondIoEntries],
  )
  const heroChartPages = useMemo(() => {
    const pages: HeroChartPoint[][] = []

    for (let index = 0; index < heroChartPoints.length; index += chartPageSize) {
      pages.push(heroChartPoints.slice(index, index + chartPageSize))
    }

    return pages
  }, [heroChartPoints])
  const visibleHeroChartPoints = heroChartPages[chartPageIndex] ?? []
  const chartRangeLabel = visibleHeroChartPoints.length
    ? `${getShortDateLabel(visibleHeroChartPoints[0].reportDate)} - ${getShortDateLabel(
        visibleHeroChartPoints[visibleHeroChartPoints.length - 1].reportDate,
      )}`
    : 'No saved dates'

  const respondIoSheetDates = useMemo(() => {
    const dates = new Set(metaReports.map((report) => report.reportDate))

    Object.keys(respondIoEntries).forEach((reportDate) => dates.add(reportDate))

    if (respondIoReportDate) {
      dates.add(respondIoReportDate)
    }

    return Array.from(dates).sort()
  }, [metaReports, respondIoEntries, respondIoReportDate])
  const averageMetaValue = useMemo(
    () => getAverageMetaValue(respondIoEntries, respondIoSheetDates),
    [respondIoEntries, respondIoSheetDates],
  )

  useEffect(() => {
    setRespondIoEntries((currentEntries) => {
      const nextEntries = { ...currentEntries }

      metaReports.forEach((report) => {
        const currentEntry = nextEntries[report.reportDate] ?? emptyReportEntry
        const metaLeadsTotal = getMetaLeadsTotal(report)

        nextEntries[report.reportDate] = {
          ...currentEntry,
          meta:
            !currentEntry.meta || currentEntry.meta === '0'
              ? String(metaLeadsTotal)
              : currentEntry.meta,
        }
      })

      return nextEntries
    })
  }, [metaReports])

  useEffect(() => {
    if (!heroChartPages.length) {
      setChartPageIndex(0)
      return
    }

    const selectedPageIndex = heroChartPages.findIndex((page) =>
      page.some((point) => point.reportDate === metaBudgetDate),
    )

    setChartPageIndex((currentIndex) => {
      if (selectedPageIndex >= 0) {
        return selectedPageIndex
      }

      return Math.min(currentIndex, heroChartPages.length - 1)
    })
  }, [heroChartPages, metaBudgetDate])

  function updateRespondIoEntry(reportDate: string, field: ReportEntryField, value: string) {
    setRespondIoEntries((currentEntries) => ({
      ...currentEntries,
      [reportDate]: {
        ...(currentEntries[reportDate] ?? emptyReportEntry),
        [field]: value,
      },
    }))
  }

  function changeRespondIoReportDate(value: string) {
    setRespondIoReportDate(value)
    setRespondIoReport(null)
    setRespondIoReportError(null)
  }

  function changeSelectedReportDate(value: string) {
    setMetaBudgetDate(value)
    changeRespondIoReportDate(value)
  }

  function applyReportToEntry(report: RespondIoReportResponse) {
    setRespondIoEntries((currentEntries) => ({
      ...currentEntries,
      [report.reportDate]: mergeReportToEntry(
        currentEntries[report.reportDate] ?? emptyReportEntry,
        report,
      ),
    }))
  }

  async function fetchBudgets({
    reportDate = metaBudgetDate,
    shouldManageLoading = true,
  } = {}) {
    if (shouldManageLoading) {
      setIsLoading(true)
    }
    setError(null)

    try {
      const params = new URLSearchParams()

      if (reportDate) {
        params.set('date', reportDate)
      }

      params.set('timezone', 'America/New_York')

      const response = await fetch(`/api/smg-campaign-budgets?${params.toString()}`)
      const payload = await readJsonResponse<BudgetResponse>(
        response,
        'Facebook data fetch returned an empty response.',
      )

      if (!response.ok) {
        throw new Error(payload?.message ?? 'Facebook data fetch failed.')
      }

      const metaTotalSpending = (payload.campaigns ?? []).reduce(
        (total: number, campaign: CampaignBudget) => total + (campaign.spendYesterday ?? 0),
        0,
      )
      const nextMetaLeadsTotal = (payload.campaigns ?? []).reduce(
        (total: number, campaign: CampaignBudget) => total + (campaign.resultsYesterday ?? 0),
        0,
      )
      const nextReport = {
        ...payload,
        metaTotalSpending,
        metaLeadsTotal: nextMetaLeadsTotal,
        tiktokTotalSpending: metaReports.find((report) => report.reportDate === payload.reportDate)
          ?.tiktokTotalSpending,
        tiktokLeadsTotal: metaReports.find((report) => report.reportDate === payload.reportDate)
          ?.tiktokLeadsTotal,
      }

      setData(nextReport)
      setMetaReports((currentReports) => upsertBudgetReport(currentReports, nextReport))
      await saveMetaBudgetReport(nextReport, metaTotalSpending, nextMetaLeadsTotal)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Something went wrong.')
      throw fetchError
    } finally {
      if (shouldManageLoading) {
        setIsLoading(false)
      }
    }
  }

  async function saveManualTikTokField(reportDate: string) {
    const report = metaReports.find((currentReport) => currentReport.reportDate === reportDate)

    if (!report) {
      return
    }

    try {
      await saveMetaBudgetReport(report, getMetaTotalSpending(report), getMetaLeadsTotal(report))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save TikTok values.')
    }
  }

  function updateManualTikTokField(
    reportDate: string,
    field: 'tiktokTotalSpending' | 'tiktokLeadsTotal',
    value: string,
  ) {
    const parsedValue = parseNullableSheetNumber(value)
    let nextSelectedReport: BudgetResponse | null = null

    setMetaReports((currentReports) =>
      currentReports.map((report) => {
        if (report.reportDate !== reportDate) {
          return report
        }

        const nextReport = {
          ...report,
          [field]: parsedValue,
        }

        nextSelectedReport = nextReport
        return nextReport
      }),
    )

    if (data?.reportDate === reportDate && nextSelectedReport) {
      setData(nextSelectedReport)
    }
  }

  async function fetchAllForSelectedDate() {
    const selectedDate = metaBudgetDate
    const startedAt = Date.now()
    const steps = [
      {
        label: 'Fetching Meta budgets',
        detail: 'Adding active SMG campaign spend and Meta leads.',
        etaSeconds: 12,
        run: () => fetchBudgets({ reportDate: selectedDate, shouldManageLoading: false }),
      },
      {
        label: 'Fetching respond.io Meta',
        detail: 'Collecting Meta conversation totals.',
        etaSeconds: 30,
        run: () =>
          fetchRespondIoReport('meta', {
            reportDate: selectedDate,
            shouldManageLoading: false,
          }),
      },
      {
        label: 'Fetching respond.io TikTok',
        detail: 'Collecting TikTok conversation totals.',
        etaSeconds: 30,
        run: () =>
          fetchRespondIoReport('tiktok', {
            reportDate: selectedDate,
            shouldManageLoading: false,
          }),
      },
    ]

    setMetaBudgetDate(selectedDate)
    setRespondIoReportDate(selectedDate)
    setIsLoading(true)
    setRespondIoReportLoadingPlatform('meta')
    setFetchProgress({
      isRunning: true,
      currentStep: 0,
      completedSteps: 0,
      startedAt,
      label: steps[0].label,
      detail: steps[0].detail,
      etaSeconds: steps[0].etaSeconds,
    })

    try {
      for (const [stepIndex, step] of steps.entries()) {
        setRespondIoReportLoadingPlatform(
          stepIndex === 0 ? null : stepIndex === 1 ? 'meta' : 'tiktok',
        )
        setFetchProgress({
          isRunning: true,
          currentStep: stepIndex,
          completedSteps: stepIndex,
          startedAt: Date.now(),
          label: step.label,
          detail: step.detail,
          etaSeconds: step.etaSeconds,
        })

        await step.run()

        setFetchProgress((currentProgress) => ({
          ...currentProgress,
          completedSteps: stepIndex + 1,
        }))
      }

      setFetchProgress({
        isRunning: false,
        currentStep: totalFetchSteps - 1,
        completedSteps: totalFetchSteps,
        startedAt: null,
        label: 'Fetch complete',
        detail: `${totalFetchSteps}/${totalFetchSteps} fetches completed.`,
        etaSeconds: 0,
      })
    } catch {
      setFetchProgress((currentProgress) => ({
        ...currentProgress,
        isRunning: false,
      }))
    } finally {
      setIsLoading(false)
      setRespondIoReportLoadingPlatform(null)
    }
  }

  async function fetchRespondIoReport(
    platform: RespondIoPlatform,
    {
      reportDate = respondIoReportDate,
      shouldManageLoading = true,
    } = {},
  ) {
    if (shouldManageLoading) {
      setRespondIoReportLoadingPlatform(platform)
    }
    setRespondIoReportError(null)
    setShouldShowRespondIoLogin(false)

    try {
      const existingRow = await loadRespondIoConversationRow(reportDate)

      const params = new URLSearchParams()

      if (reportDate) {
        params.set('date', reportDate)
      }

      params.set('platform', platform)

      const response = await fetch(`/api/respondio-report-metrics?${params.toString()}`)
      const payload = await readJsonResponse<RespondIoReportResponse>(
        response,
        'respond.io report fetch returned an empty response.',
      )

      if (!response.ok) {
        if (payload?.metrics) {
          setRespondIoReport(payload)
          applyReportToEntry(payload)
        }

        throw new Error(payload?.message ?? 'respond.io report fetch failed.')
      }

      const baseReport = existingRow ? buildRespondIoReportFromRow(existingRow) : respondIoReport
      const nextReport = mergeRespondIoReport(baseReport, payload)
      const currentEntry = respondIoEntries[nextReport.reportDate] ?? emptyReportEntry
      const nextEntry = {
        ...mergeReportToEntry(currentEntry, nextReport),
        average: formatAverage(
          getAverageMetaValue(
            {
              ...respondIoEntries,
              [nextReport.reportDate]: mergeReportToEntry(currentEntry, nextReport),
            },
            respondIoSheetDates.includes(nextReport.reportDate)
              ? respondIoSheetDates
              : [...respondIoSheetDates, nextReport.reportDate],
          ),
        ),
      }

      setRespondIoReport(nextReport)
      setRespondIoEntries((currentEntries) => ({
        ...currentEntries,
        [nextReport.reportDate]: nextEntry,
      }))
      await saveRespondIoReport(nextReport, nextEntry, existingRow)
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Something went wrong.'

      setShouldShowRespondIoLogin(isRespondIoSessionError(message))
      setRespondIoReportError(
        isRespondIoSessionError(message)
          ? 'Login to respond.io to unlock automated report fetching.'
          : message,
      )
      throw fetchError
    } finally {
      if (shouldManageLoading) {
        setRespondIoReportLoadingPlatform(null)
      }
    }
  }

  async function openRespondIoLogin() {
    setIsRespondIoLoginOpening(true)
    setRespondIoReportError(null)

    try {
      const response = await fetch('/api/respondio-login')
      const payload = await readJsonResponse<{ message?: string }>(
        response,
        'respond.io login returned an empty response.',
      )

      if (!response.ok) {
        throw new Error(payload?.message ?? 'Unable to open respond.io login.')
      }

      setRespondIoReportError(
        'A respond.io login window opened. Log in, open Reports > Conversations, close that window, then fetch again.',
      )
    } catch (loginError) {
      setRespondIoReportError(
        loginError instanceof Error ? loginError.message : 'Unable to open respond.io login.',
      )
    } finally {
      setIsRespondIoLoginOpening(false)
    }
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-header">
        <div className="header-content">
          <div className="brand-lockup">
            <img src="/logo1.png" alt="" />
            <h1>Dharma Campaign Report</h1>
          </div>
          <div className="header-actions">
            <label className="header-date-control">
              Report date
              <input
                type="date"
                value={metaBudgetDate}
                onChange={(event) => changeSelectedReportDate(event.target.value)}
              />
            </label>
            <button
              className="fetch-button"
              type="button"
              onClick={fetchAllForSelectedDate}
              disabled={fetchProgress.isRunning}
            >
              {fetchProgress.isRunning ? 'Fetching...' : 'Fetch Data'}
            </button>
            <span className="live-chip">Daily spend intelligence</span>
          </div>
        </div>

        <div className="health-panel" aria-hidden="true">
          <div className="health-panel-top">
            <div className="health-brand">
              <img src="/logo1.png" alt="" />
              <span>Dharma Campaign Report</span>
            </div>
            <div className="animated-mini-chart">
              <span className="bar-1" />
              <span className="bar-2" />
              <span className="bar-3" />
              <span className="bar-4" />
            </div>
          </div>
          <div className="pulse-grid">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="panel-bars">
            <span style={{ '--bar-size': '72%' } as CSSProperties} />
            <span style={{ '--bar-size': '48%' } as CSSProperties} />
            <span style={{ '--bar-size': '86%' } as CSSProperties} />
          </div>
        </div>
      </section>

      <section className="report-chart-section" aria-label="Campaign report charts">
        <div className="report-chart-heading">
          <div>
            <p className="eyebrow">7-day graph view</p>
            <h2>Campaign performance graphs</h2>
            <p>{chartRangeLabel}</p>
          </div>
          <div className="chart-page-controls">
            <button
              className="chart-arrow-button"
              type="button"
              onClick={() => {
                const idx = heroChartPoints.findIndex((p) => p.reportDate === metaBudgetDate)
                const prev = heroChartPoints[idx - 1]
                if (prev) changeSelectedReportDate(prev.reportDate)
              }}
              disabled={heroChartPoints.length === 0 || heroChartPoints[0]?.reportDate === metaBudgetDate}
              aria-label="Show previous day"
            >
              &lt;
            </button>
            <span>
              {heroChartPoints.length === 0
                ? 'No data'
                : (() => {
                    const idx = heroChartPoints.findIndex((p) => p.reportDate === metaBudgetDate)
                    const point = heroChartPoints[idx] ?? heroChartPoints[heroChartPoints.length - 1]
                    return `${point?.label ?? '—'}  ${idx >= 0 ? idx + 1 : heroChartPoints.length}/${heroChartPoints.length}`
                  })()}
            </span>
            <button
              className="chart-arrow-button"
              type="button"
              onClick={() => {
                const idx = heroChartPoints.findIndex((p) => p.reportDate === metaBudgetDate)
                const next = heroChartPoints[idx + 1]
                if (next) changeSelectedReportDate(next.reportDate)
              }}
              disabled={
                heroChartPoints.length === 0 ||
                heroChartPoints[heroChartPoints.length - 1]?.reportDate === metaBudgetDate
              }
              aria-label="Show next day"
            >
              &gt;
            </button>
          </div>
        </div>
        <div className="report-chart-grid">
          <PerformanceBarChart
            activeReportDate={metaBudgetDate}
            points={visibleHeroChartPoints}
          />
          <CprLineChart activeReportDate={metaBudgetDate} points={visibleHeroChartPoints} />
        </div>
      </section>

      {fetchProgress.isRunning || fetchProgress.completedSteps === totalFetchSteps ? (
        <FetchProgressPanel
          {...fetchProgress}
          etaSeconds={unifiedFetchEtaSeconds}
          totalSteps={totalFetchSteps}
        />
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="report-sheet" aria-label="respond.io report sheet">
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">respond.io Reports</p>
            <h2>Respond Meta and TikTok</h2>
            <p>Fetch each platform for the selected day, then fill or adjust the sheet row.</p>
          </div>

        </div>

        {respondIoReportError ? (
          <div className="error-banner compact">{respondIoReportError}</div>
        ) : null}

        {shouldShowRespondIoLogin ? (
          <div className="login-prompt">
            <div>
              <strong>respond.io login required</strong>
              <span>Log in, open Reports &gt; Conversations, close the login window, then fetch again.</span>
            </div>
            <button
              className="fetch-button secondary"
              type="button"
              onClick={openRespondIoLogin}
              disabled={isRespondIoLoginOpening}
            >
              {isRespondIoLoginOpening ? 'Opening...' : 'Login to respond.io'}
            </button>
          </div>
        ) : null}

        <div className="sheet-table-wrap">
          <table className="entry-sheet">
            <caption>New Conversation Opened Respond I.O</caption>
            <thead>
              <tr>
                <th>Day</th>
                <th>Meta</th>
                <th>Total RespMeta</th>
                <th>New respond Meta</th>
                <th>Total Resp TikTok</th>
                <th>New TikTok</th>
                <th>Average</th>
                <th>Meta &amp; TikTok</th>
                <th>New Meta &amp; TikTok</th>
              </tr>
            </thead>
            <tbody>
              {respondIoSheetDates.map((sheetDate) => {
                const entry = respondIoEntries[sheetDate] ?? emptyReportEntry
                const totalsForEntry = getReportEntryTotals(entry)

                return (
                  <tr key={sheetDate}>
                    <th scope="row">{getDayLabel(sheetDate)}</th>
                    <td>
                      <input
                        aria-label={`Meta ${sheetDate}`}
                        inputMode="numeric"
                        value={entry.meta}
                        onChange={(event) =>
                          updateRespondIoEntry(sheetDate, 'meta', event.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Total RespMeta ${sheetDate}`}
                        inputMode="numeric"
                        value={entry.totalRespondMeta}
                        onChange={(event) =>
                          updateRespondIoEntry(sheetDate, 'totalRespondMeta', event.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`New respond Meta ${sheetDate}`}
                        inputMode="numeric"
                        value={entry.newRespondMeta}
                        onChange={(event) =>
                          updateRespondIoEntry(sheetDate, 'newRespondMeta', event.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Total Resp TikTok ${sheetDate}`}
                        inputMode="numeric"
                        value={entry.totalRespondTiktok}
                        onChange={(event) =>
                          updateRespondIoEntry(sheetDate, 'totalRespondTiktok', event.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`New TikTok ${sheetDate}`}
                        inputMode="numeric"
                        value={entry.newRespondTiktok}
                        onChange={(event) =>
                          updateRespondIoEntry(sheetDate, 'newRespondTiktok', event.target.value)
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="calculated-cell">
                      {formatAverage(averageMetaValue)}
                    </td>
                    <td className="calculated-cell">
                      {formatSheetNumber(totalsForEntry.totalMetaAndTiktok)}
                    </td>
                    <td className="calculated-cell">
                      {formatSheetNumber(totalsForEntry.newMetaAndTiktok)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {respondIoReport ? (
          <section className="respond-metric-grid" aria-label="Fetched respond report metrics">
            <div className="metric compact-metric">
              <span>Fetched Total Meta</span>
              <strong>{formatMetric(respondIoReport.metrics.totalRespondMeta)}</strong>
            </div>
            <div className="metric compact-metric">
              <span>Fetched New Meta</span>
              <strong>{formatMetric(respondIoReport.metrics.newRespondMeta)}</strong>
            </div>
            <div className="metric compact-metric">
              <span>Fetched Total TikTok</span>
              <strong>{formatMetric(respondIoReport.metrics.totalRespondTiktok)}</strong>
            </div>
            <div className="metric compact-metric">
              <span>Fetched New TikTok</span>
              <strong>{formatMetric(respondIoReport.metrics.newRespondTiktok)}</strong>
            </div>
          </section>
        ) : null}

        {respondIoReport ? (
          <p className="sheet-note">
            {`${respondIoReport.reportDate} - ${respondIoReport.timezone} - Meta excludes channel: ${
              respondIoReport.excludedTiktokChannel?.name ?? 'not found'
            }; TikTok includes it.`}
          </p>
        ) : null}
      </section>

      {data ? (
        <>
          <section className="summary-grid" aria-label="Budget summary">
            <div className="metric">
              <span>Total Daily Budget</span>
              <strong>{formatMoney(totals.dailyBudget)}</strong>
              <i style={{ '--progress': '78%' } as CSSProperties} />
            </div>
            <div className="metric">
              <span>Budget Remaining</span>
              <strong>{formatMoney(totals.budgetRemaining)}</strong>
              <i style={{ '--progress': '58%' } as CSSProperties} />
            </div>
            <div className="metric">
              <span>Yesterday Spend</span>
              <strong>{formatMoney(totals.spendYesterday)}</strong>
              <i style={{ '--progress': '42%' } as CSSProperties} />
            </div>
            <div className="metric">
              <span>Report Date</span>
              <strong>{data.reportDate}</strong>
              <i style={{ '--progress': '64%' } as CSSProperties} />
            </div>
          </section>
        </>
      ) : null}

      <section className="table-section">
        <div className="table-heading">
          <div>
            <h2>Meta Budget Sheet</h2>
            <p>
              {data
                ? `${data.accountName} (${data.accountId}) - ${data.timezone}`
                : 'Fetch Meta budgets to populate the sheet.'}
            </p>
          </div>
          {data ? <span>Fetched {new Date(data.fetchedAt).toLocaleString()}</span> : null}
        </div>

        <div className="table-wrap">
          <table className="meta-budget-table">
            <caption>Campaign Performance Sheet</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Meta Total Spending</th>
                <th>Meta Leads Total</th>
                <th>TikTok Total Spending</th>
                <th>TikTok Leads Total</th>
                <th>Average RESPOND Leads (TikTok &amp; Meta)</th>
                <th>Meta CPR</th>
                <th>TikTok CPR</th>
                <th>Respond CPR (TikTok &amp; Meta)</th>
              </tr>
            </thead>
            <tbody>
              {spanishReportRows.map((row) => (
                <tr key={row.reportDate}>
                  <td>{row.date}</td>
                  <td>{row.metaSpend}</td>
                  <td>{row.metaLeads}</td>
                  <td>
                    <input
                      aria-label={`TikTok Total Spending ${row.reportDate}`}
                      inputMode="decimal"
                      value={
                        metaReports.find((report) => report.reportDate === row.reportDate)
                          ?.tiktokTotalSpending ?? ''
                      }
                      onChange={(event) =>
                        updateManualTikTokField(
                          row.reportDate,
                          'tiktokTotalSpending',
                          event.target.value,
                        )
                      }
                      onBlur={() => saveManualTikTokField(row.reportDate)}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`TikTok Leads Total ${row.reportDate}`}
                      inputMode="numeric"
                      value={
                        metaReports.find((report) => report.reportDate === row.reportDate)
                          ?.tiktokLeadsTotal ?? ''
                      }
                      onChange={(event) =>
                        updateManualTikTokField(
                          row.reportDate,
                          'tiktokLeadsTotal',
                          event.target.value,
                        )
                      }
                      onBlur={() => saveManualTikTokField(row.reportDate)}
                      placeholder="0"
                    />
                  </td>
                  <td>{row.averageRespondLeads}</td>
                  <td>{row.metaCpr}</td>
                  <td>{row.tiktokCpr}</td>
                  <td>{row.respondCpr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
