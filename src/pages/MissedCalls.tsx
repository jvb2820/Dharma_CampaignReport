function MissedCalls() {
  return (
    <main className="dashboard-shell missed-calls-page">
      <section className="missed-calls-panel" aria-labelledby="missed-calls-title">
        <div>
          <p className="eyebrow">Call intelligence</p>
          <h1 id="missed-calls-title">Missed Calls</h1>
          <p>
            Track missed-call activity here without changing the campaign reporting workflow.
          </p>
        </div>

        <div className="missed-calls-empty" role="status">
          <strong>No missed-call data connected yet</strong>
          <span>This page is ready for missed-call metrics, tables, and integrations.</span>
        </div>
      </section>
    </main>
  )
}

export default MissedCalls
