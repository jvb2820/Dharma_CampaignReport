import { useEffect, useState } from 'react'

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

function AgentReport() {
  const [draftDate, setDraftDate] = useState(getNewYorkDate)
  const [reportDate, setReportDate] = useState(getNewYorkDate)
  const [report, setReport] = useState<AgentReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function loadReport() {
      setIsLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ date: reportDate })
        const response = await fetch(getApiUrl(`/api/agent-report?${params}`), {
          signal: controller.signal,
        })
        const payload = (await response.json()) as AgentReportResponse
        if (!response.ok) throw new Error(payload.message ?? 'Unable to load agent report.')
        setReport(payload)
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setError(loadError instanceof Error ? loadError.message : 'Unable to load agent report.')
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }
    loadReport()
    return () => controller.abort()
  }, [reportDate])

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
            <button type="button" onClick={() => setReportDate(draftDate)} disabled={isLoading || !draftDate}>
              {isLoading ? 'Loading…' : 'Apply'}
            </button>
          </div>
        </div>

        {error ? <div className="call-confirmation-message error">{error}</div> : null}
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
                {!report.respondIoAvailable ? <span>respond.io message data unavailable</span> : null}
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
              <p className="agent-report-note">Messages are outgoing respond.io messages. Booking columns require a HubSpot booking definition before they can be calculated.</p>
            </section>
          </>
        ) : null}
      </section>
    </main>
  )
}

export default AgentReport
