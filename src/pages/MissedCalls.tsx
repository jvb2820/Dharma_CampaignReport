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

type CallConfirmationResponse = {
  reportDate: string
  timezone: string
  totalNumbers: number
  notCalled: number
  notCalledPercent: number
  numbers: Array<{
    phone: string
    assignedTo: string
    called: boolean
    calledBy: string[]
    callCount: number
  }>
  rows?: Array<{
    reportDate: string
    outsideBusinessHours: boolean
    totalNumbers: number
    notCalled: number
    notCalledPercent: number
    numbers: CallConfirmationResponse['numbers']
  }>
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
  const [selectedDateDraft, setSelectedDateDraft] = useState(getTodayInNewYork)
  const [missedCallsRequestId, setMissedCallsRequestId] = useState(0)
  const [calls, setCalls] = useState<MissedCall[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmationDate, setConfirmationDate] = useState(getTodayInNewYork)
  const [confirmationDateDraft, setConfirmationDateDraft] = useState(getTodayInNewYork)
  const [confirmationRequestId, setConfirmationRequestId] = useState(0)
  const [confirmation, setConfirmation] = useState<CallConfirmationResponse | null>(null)
  const [isConfirmationLoading, setIsConfirmationLoading] = useState(false)
  const [confirmationError, setConfirmationError] = useState('')
  const [notCalledRowIndex, setNotCalledRowIndex] = useState<number | null>(null)

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
  }, [selectedDate, missedCallsRequestId])

  useEffect(() => {
    const controller = new AbortController()

    async function loadCallConfirmation() {
      setIsConfirmationLoading(true)
      setConfirmationError('')

      try {
        const params = new URLSearchParams({ date: confirmationDate })
        const response = await fetch(getApiUrl(`/api/call-confirmation?${params.toString()}`), {
          signal: controller.signal,
        })
        const payload = (await response.json()) as CallConfirmationResponse

        if (!response.ok) {
          throw new Error(payload.message ?? `Unable to confirm calls (${response.status}).`)
        }

        setConfirmation(payload)
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setConfirmationError(
          fetchError instanceof Error ? fetchError.message : 'Unable to confirm calls.',
        )
        setConfirmation(null)
      } finally {
        setIsConfirmationLoading(false)
      }
    }

    loadCallConfirmation()
    return () => controller.abort()
  }, [confirmationDate, confirmationRequestId])

  useEffect(() => {
    if (notCalledRowIndex === null) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNotCalledRowIndex(null)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [notCalledRowIndex])

  const callCountLabel = useMemo(() => {
    if (isLoading) {
      return 'Loading'
    }

    return `${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`
  }, [calls.length, isLoading])
  const confirmationRows =
    confirmation?.rows ??
    (confirmation
      ? [
          {
            reportDate: confirmation.reportDate,
            outsideBusinessHours: false,
            totalNumbers: confirmation.totalNumbers,
            notCalled: confirmation.notCalled,
            notCalledPercent: confirmation.notCalledPercent,
            numbers: confirmation.numbers,
          },
        ]
      : [])
  const selectedConfirmationRow =
    notCalledRowIndex === null ? null : confirmationRows[notCalledRowIndex] ?? null

  return (
    <main className="dashboard-shell missed-calls-page">
      <section className="missed-calls-panel" aria-labelledby="missed-calls-title">
        <div>
          <p className="eyebrow">Call intelligence</p>
          <h1 id="missed-calls-title">Missed Calls</h1>
          <p>Review inbound calls that rang and were not answered by the user.</p>
        </div>

        <div className="missed-calls-controls">
          <label className="missed-calls-filter">
            <span>Calendar</span>
            <input
              aria-label="Missed calls date"
              onChange={(event) => setSelectedDateDraft(event.target.value)}
              type="date"
              value={selectedDateDraft}
            />
          </label>
          <button
            className="call-confirmation-apply"
            type="button"
            onClick={() => {
              setSelectedDate(selectedDateDraft)
              setMissedCallsRequestId((requestId) => requestId + 1)
            }}
            disabled={isLoading || !selectedDateDraft}
          >
            {isLoading ? (
              <>
                <span className="report-loader-spinner" aria-hidden="true" />
                Loading reports...
              </>
            ) : (
              'Apply'
            )}
          </button>
        </div>
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

      <section className="call-confirmation-report" aria-labelledby="call-confirmation-title">
        <div className="call-confirmation-heading">
          <div>
            <p className="eyebrow">HubSpot + Aircall</p>
            <h2 id="call-confirmation-title">Call Confirmation</h2>
            <p>Confirms HubSpot "Missed calls" tasks against outbound Aircall calls.</p>
          </div>
          <div className="call-confirmation-controls">
            <label className="missed-calls-filter">
              <span>Confirmation day</span>
              <input
                aria-label="Call confirmation date"
                onChange={(event) => setConfirmationDateDraft(event.target.value)}
                type="date"
                value={confirmationDateDraft}
              />
            </label>
            <button
              className="call-confirmation-apply"
              type="button"
              onClick={() => {
                setNotCalledRowIndex(null)
                setConfirmationDate(confirmationDateDraft)
                setConfirmationRequestId((requestId) => requestId + 1)
              }}
              disabled={isConfirmationLoading || !confirmationDateDraft}
            >
              {isConfirmationLoading ? (
                <>
                  <span className="report-loader-spinner" aria-hidden="true" />
                  Loading reports...
                </>
              ) : (
                'Apply'
              )}
            </button>
          </div>
        </div>

        {confirmationError ? (
          <div className="call-confirmation-message error">{confirmationError}</div>
        ) : null}
        {isConfirmationLoading ? (
          <div className="call-confirmation-message loading" role="status" aria-live="polite">
            <span className="report-loader-spinner" aria-hidden="true" />
            <span>
              <strong>Loading call confirmation</strong>
              Checking HubSpot tasks and outbound Aircall calls...
            </span>
          </div>
        ) : null}

        {!isConfirmationLoading && confirmation ? (
          <>
            <div className="call-confirmation-table-wrap">
              <table className="call-confirmation-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Total Numbers</th>
                    <th>Not Called</th>
                    <th>(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmationRows.map((row, rowIndex) => (
                    <tr key={`${row.reportDate}-${row.outsideBusinessHours ? 'outside' : 'regular'}`}>
                      <td>
                        {formatConfirmationDate(row.reportDate)}
                        {row.outsideBusinessHours ? '*' : ''}
                      </td>
                      <td>{row.totalNumbers}</td>
                      <td>
                        <button
                          className="not-called-drilldown-button"
                          type="button"
                          onClick={() =>
                            setNotCalledRowIndex((currentIndex) =>
                              currentIndex === rowIndex ? null : rowIndex,
                            )
                          }
                          aria-expanded={notCalledRowIndex === rowIndex}
                          aria-controls="not-called-number-list"
                        >
                          {row.notCalled}
                        </button>
                      </td>
                      <td>{row.notCalledPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedConfirmationRow ? (
              <div
                className="not-called-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setNotCalledRowIndex(null)
                }}
              >
                <section
                  className="not-called-drilldown"
                  id="not-called-number-list"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="not-called-modal-title"
                >
                  <div className="not-called-drilldown-heading">
                    <div>
                      <strong id="not-called-modal-title">Numbers not called</strong>
                      <span>{selectedConfirmationRow.notCalled} unmatched</span>
                    </div>
                    <button
                      className="not-called-modal-close"
                      type="button"
                      onClick={() => setNotCalledRowIndex(null)}
                      aria-label="Close not called numbers"
                    >
                      ×
                    </button>
                  </div>
                  {selectedConfirmationRow.notCalled === 0 ? (
                    <p>Every HubSpot missed-call task was confirmed in Aircall.</p>
                  ) : (
                    <ul>
                      {selectedConfirmationRow.numbers
                        .filter((number) => !number.called)
                        .map((number) => (
                          <li key={number.phone}>
                            <a href={`tel:+${number.phone}`}>+{number.phone}</a>
                            <span>Assigned to {number.assignedTo}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}
            <p className="call-confirmation-note">
              * Previous-day calls received on Saturday or at or after 7:00 PM. HubSpot and
              Aircall are compared in {confirmation.timezone.replace('_', ' ')}.
            </p>
          </>
        ) : null}
      </section>
    </main>
  )
}

function formatConfirmationDate(value: string) {
  const [, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}`
}

export default MissedCalls
