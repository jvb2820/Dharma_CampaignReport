import { useState } from 'react'

type AgentReportResponse = {
  reportDate: string
  timezone: string
  agents: Array<{
    id: number | null
    name: string
    callLengthSeconds: number
    inbound: number
    outbound: number
    totalCalls: number
  }>
  totals: {
    callLengthSeconds: number
    inbound: number
    outbound: number
    totalCalls: number
  }
  staff: Array<{
    name: string
    messages: number | null
    calls: number | null
    connectedOver30Seconds: number | null
    bookingsByMessages: number | null
    bookingsByCall: number | null
    totalBookings: number | null
  }>
  staffTotals: {
    messages: number
    calls: number
    connectedOver30Seconds: number
    bookingsByMessages: number | null
    bookingsByCall: number | null
    totalBookings: number | null
  }
  respondIoAvailable: boolean
  respondIoError?: string | null
  message?: string
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function getApiUrl(path: string) {
  const base = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '' : apiBaseUrl
  return `${base}${path}`
}

function getNewYorkDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function withoutRemovedAgents(report: AgentReportResponse): AgentReportResponse {
  const agents = report.agents.filter((agent) => agent.name !== 'Diana Villalobos')
  const staff = report.staff.filter((row) => row.name !== 'Diana Villalobos')
  const sumNullable = (values: Array<number | null>) =>
    values.some((value) => value === null)
      ? null
      : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

  return {
    ...report,
    agents,
    totals: {
      callLengthSeconds: agents.reduce((sum, agent) => sum + agent.callLengthSeconds, 0),
      inbound: agents.reduce((sum, agent) => sum + agent.inbound, 0),
      outbound: agents.reduce((sum, agent) => sum + agent.outbound, 0),
      totalCalls: agents.reduce((sum, agent) => sum + agent.totalCalls, 0),
    },
    staff,
    staffTotals: {
      messages: staff.reduce((sum, row) => sum + (row.messages ?? 0), 0),
      calls: staff.reduce((sum, row) => sum + (row.calls ?? 0), 0),
      connectedOver30Seconds: staff.reduce(
        (sum, row) => sum + (row.connectedOver30Seconds ?? 0),
        0,
      ),
      bookingsByMessages: sumNullable(staff.map((row) => row.bookingsByMessages)),
      bookingsByCall: sumNullable(staff.map((row) => row.bookingsByCall)),
      totalBookings: sumNullable(staff.map((row) => row.totalBookings)),
    },
  }
}

function AgentReport() {
  const [draftDate, setDraftDate] = useState(getNewYorkDate)
  const [report, setReport] = useState<AgentReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMode, setLoadingMode] = useState<'saved' | 'live' | null>(null)
  const [isRespondLoginStarting, setIsRespondLoginStarting] = useState(false)
  const [respondLoginMessage, setRespondLoginMessage] = useState('')
  const [error, setError] = useState('')

  async function loadReport(mode: 'saved' | 'live') {
    if (!draftDate) return
    setIsLoading(true)
    setLoadingMode(mode)
    setError('')
    try {
      const params = new URLSearchParams({ date: draftDate, mode })
      const response = await fetch(getApiUrl(`/api/agent-report?${params}`))
      const payload = (await response.json()) as AgentReportResponse
      if (!response.ok) throw new Error(payload.message ?? 'Unable to load agent report.')
      setReport(withoutRemovedAgents(payload))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load agent report.')
    } finally {
      setIsLoading(false)
      setLoadingMode(null)
    }
  }

  async function startRespondLogin() {
    setIsRespondLoginStarting(true)
    setRespondLoginMessage('')
    setError('')
    try {
      const response = await fetch(getApiUrl('/api/agent-report?action=respond-login'))
      const payload = (await response.json()) as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Unable to start respond.io login.')
      setRespondLoginMessage(
        payload.message ??
          'Login window opened. Sign in and leave it on Reports > Conversations.',
      )
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Unable to start respond.io login.',
      )
    } finally {
      setIsRespondLoginStarting(false)
    }
  }

  const primaryAgents = report?.agents.slice(0, 5) ?? []
  const secondaryAgents = report?.agents.slice(5) ?? []

  const renderAgentTable = (agents: AgentReportResponse['agents'], label: string) => (
    <div className="agent-report-table-card" aria-label={label}>
      <div className="agent-report-table-wrap">
        <table className="agent-report-table">
          <thead><tr><th>Agent</th><th>Call length (in call)</th><th>Inbound</th><th>Outbound</th><th>Total numbers</th></tr></thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id ?? agent.name}>
                <th scope="row">{agent.name}</th>
                <td>{formatDuration(agent.callLengthSeconds)}</td>
                <td>{agent.inbound}</td><td>{agent.outbound}</td><td>{agent.totalCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const renderMetric = (value: number | null) => value ?? '—'

  return (
    <main className="dashboard-shell agent-report-page">
      <section className="agent-report-panel" aria-labelledby="agent-report-title">
        <div className="agent-report-heading">
          <div>
            <p className="eyebrow">Aircall analytics</p>
            <h1 id="agent-report-title">Agent Report</h1>
            <p>Total answered call time and call volume by agent.</p>
          </div>
          <div className="agent-report-controls">
            <label>
              <span>Report date</span>
              <input type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} />
            </label>
            <button type="button" onClick={() => loadReport('saved')} disabled={isLoading || !draftDate}>
              {loadingMode === 'saved' ? 'Loading…' : 'Apply'}
            </button>
            <button
              type="button"
              className="agent-report-live-button"
              onClick={() => loadReport('live')}
              disabled={isLoading || !draftDate}
            >
              {loadingMode === 'live' ? 'Fetching…' : 'Fetch Live'}
            </button>
            <button
              type="button"
              className="agent-report-login-button"
              onClick={startRespondLogin}
              disabled={isLoading || isRespondLoginStarting}
            >
              {isRespondLoginStarting ? 'Opening…' : 'Login to respond.io'}
            </button>
          </div>
        </div>

        {error ? <div className="call-confirmation-message error">{error}</div> : null}
        {respondLoginMessage ? (
          <div className="call-confirmation-message">{respondLoginMessage}</div>
        ) : null}
        {isLoading ? <div className="call-confirmation-message loading">Loading agent activity…</div> : null}

        {!isLoading && report ? (
          <>
            <div className="agent-summary-grid">
              <div><span>Total call time</span><strong>{formatDuration(report.totals.callLengthSeconds)}</strong></div>
              <div><span>Inbound</span><strong>{report.totals.inbound}</strong></div>
              <div><span>Outbound</span><strong>{report.totals.outbound}</strong></div>
              <div><span>Total calls</span><strong>{report.totals.totalCalls}</strong></div>
            </div>
            <div className="agent-report-tables">
              {renderAgentTable(primaryAgents, 'Primary agents')}
              {renderAgentTable(secondaryAgents, 'Kathering Silva and Kevin Tinjaca')}
            </div>
            <p className="agent-report-note">Answered talk time only. Dates are interpreted in {report.timezone.replace('_', ' ')}.</p>

            <section className="staff-performance-section" aria-labelledby="staff-performance-title">
              <div className="staff-performance-heading">
                <div>
                  <p className="eyebrow">respond.io + Aircall</p>
                  <h2 id="staff-performance-title">Staff Performance</h2>
                  <p>Outgoing messages and outbound calling activity for the selected date.</p>
                </div>
                {!report.respondIoAvailable ? (
                  <span title={report.respondIoError ?? undefined}>
                    respond.io message data unavailable
                    {report.respondIoError ? `: ${report.respondIoError}` : ''}
                  </span>
                ) : null}
              </div>
              <div className="agent-report-table-wrap">
                <table className="agent-report-table staff-performance-table">
                  <thead>
                    <tr>
                      <th>Staff</th><th>Message</th><th>Calls</th>
                      <th>Call connected for more than 30 seconds</th>
                      <th>Bookings by messages</th><th>Bookings by call</th><th>Total booking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.staff.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">{row.name}</th>
                        <td>{renderMetric(row.messages)}</td><td>{renderMetric(row.calls)}</td>
                        <td>{renderMetric(row.connectedOver30Seconds)}</td>
                        <td>{renderMetric(row.bookingsByMessages)}</td>
                        <td>{renderMetric(row.bookingsByCall)}</td>
                        <td>{renderMetric(row.totalBookings)}</td>
                      </tr>
                    ))}
                    <tr className="staff-performance-total">
                      <th scope="row">Total</th>
                      <td>{report.staffTotals.messages}</td><td>{report.staffTotals.calls}</td>
                      <td>{report.staffTotals.connectedOver30Seconds}</td>
                      <td>{renderMetric(report.staffTotals.bookingsByMessages)}</td>
                      <td>{renderMetric(report.staffTotals.bookingsByCall)}</td>
                      <td>{renderMetric(report.staffTotals.totalBookings)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="agent-report-note">Messages are outgoing respond.io messages. Bookings use HubSpot’s meeting-booked date, channel, and Agent Lead Management fields.</p>
            </section>
          </>
        ) : null}
      </section>
    </main>
  )
}

export default AgentReport
