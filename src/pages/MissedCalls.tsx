import { useEffect, useMemo, useState } from 'react'

type MissedCall = {
  id: number
  direction: string
  status: string
  missedCallReason: string
  startedAt: string
  startedAtNewYork: string
  endedAt: string
  durationSeconds: number
  clientNumber: string
  displayClientNumber: string
  aircallNumberName: string
  aircallNumberDigits: string
  missedByName: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  tags: string[]
  commentsCount: number
  recordingUrl: string | null
  voicemailUrl: string | null
  archived: boolean
}

type MissedCallsResponse = {
  reportDate: string
  timezone: string
  calls: MissedCall[]
  message?: string
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function getActiveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return apiBaseUrl
  }

  return ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '' : apiBaseUrl
}

function getApiUrl(path: string) {
  return `${getActiveApiBaseUrl()}${path}`
}

function getTodayInNewYork() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatCallDate(value: string) {
  return value.replace(',', '')
}

function getCallDateParts(value: string) {
  const [date, time] = formatCallDate(value).split(' ')

  return {
    date: date ?? '',
    time: time ?? '',
  }
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60

  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function MissedCalls() {
  const [selectedDate, setSelectedDate] = useState(getTodayInNewYork)
  const [calls, setCalls] = useState<MissedCall[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadMissedCalls() {
      setIsLoading(true)
      setError('')

      try {
        const params = new URLSearchParams({ date: selectedDate })
        const response = await fetch(getApiUrl(`/api/missed-calls?${params.toString()}`), {
          signal: controller.signal,
        })
        const payload = (await response.json()) as MissedCallsResponse

        if (!response.ok) {
          throw new Error(payload.message ?? `Unable to fetch missed calls (${response.status}).`)
        }

        setCalls(payload.calls)
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
          return
        }

        setError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch missed calls.')
        setCalls([])
      } finally {
        setIsLoading(false)
      }
    }

    loadMissedCalls()

    return () => controller.abort()
  }, [selectedDate])

  const callCountLabel = useMemo(() => {
    if (isLoading) {
      return 'Loading'
    }

    return `${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`
  }, [calls.length, isLoading])

  return (
    <main className="dashboard-shell missed-calls-page">
      <section className="missed-calls-panel" aria-labelledby="missed-calls-title">
        <div>
          <p className="eyebrow">Call intelligence</p>
          <h1 id="missed-calls-title">Missed Calls</h1>
          <p>Review inbound calls that rang and were not answered by the user.</p>
        </div>

        <label className="missed-calls-filter">
          <span>Calendar</span>
          <input
            aria-label="Missed calls date"
            onChange={(event) => setSelectedDate(event.target.value)}
            type="date"
            value={selectedDate}
          />
        </label>
      </section>

      <section className="missed-calls-results" aria-label="Missed calls results">
        <div className="missed-calls-board-heading">
          <div className="missed-calls-title-lockup">
            <img alt="" src="/logo1.png" />
            <strong>MISSED CALLS:</strong>
          </div>
          <span>{callCountLabel}</span>
        </div>

        {error ? <div className="missed-calls-message error">{error}</div> : null}

        {!error && !isLoading && calls.length === 0 ? (
          <div className="missed-calls-message">No missed call for the day 🙂</div>
        ) : null}

        <div className="missed-call-list" aria-busy={isLoading}>
          {calls.map((call) => {
            const missedBy = call.missedByName || call.assigneeName || 'unassigned'
            const callDate = getCallDateParts(call.startedAtNewYork)

            return (
              <article className="missed-call-item" key={call.id}>
                <dl className="missed-call-details">
                  <div>
                    <dt>Line</dt>
                    <dd>{call.aircallNumberName || 'Unknown line'}</dd>
                  </div>
                  <div>
                    <dt>Aircall number</dt>
                    <dd>{call.aircallNumberDigits || 'No number'}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatDuration(call.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{call.archived ? 'Archived' : call.status}</dd>
                  </div>
                </dl>

                <div className="missed-call-strip">
                  <span>
                    <small>Date</small>
                    {callDate.date}
                  </span>
                  <span>
                    <small>Time</small>
                    {callDate.time}
                  </span>
                  <span>
                    <small>Call ID</small>
                    {call.id}
                  </span>
                  <span>
                    <small>Number</small>
                    {call.displayClientNumber}
                  </span>
                  <span>
                    <small>Type</small>
                    Missed Call
                  </span>
                  <span>
                    <small>Name</small>
                    {missedBy}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default MissedCalls
