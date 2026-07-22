import './App.css'
import AgentReport from './pages/AgentReport'
import CampaignDashboard from './pages/CampaignDashboard'
import MissedCalls from './pages/MissedCalls'

type AppRoute = {
  path: string
  label: string
}

const routes: AppRoute[] = [
  { path: '/campaign', label: 'Campaign' },
  { path: '/missed-calls', label: 'Missed Calls' },
  { path: '/agent-report', label: 'Agent Report' },
]

function getActiveRoute() {
  const pathname = window.location.pathname.replace(/\/$/, '') || '/'

  if (pathname === '/' || pathname === '/campaign') {
    return '/campaign'
  }

  if (routes.some((route) => route.path === pathname)) {
    return pathname
  }

  return '/campaign'
}

function App() {
  const activeRoute = getActiveRoute()

  return (
    <>
      <nav className="dashboard-nav" aria-label="Dashboard sections">
        <div className="dashboard-nav-inner">
          <a className="dashboard-nav-brand" href="/campaign">
            Dharma Dashboard
          </a>
          <div className="dashboard-nav-links">
            {routes.map((route) => (
              <a
                aria-current={activeRoute === route.path ? 'page' : undefined}
                className="dashboard-nav-link"
                href={route.path}
                key={route.path}
              >
                {route.label}
              </a>
            ))}
          </div>
        </div>
      </nav>

      {activeRoute === '/missed-calls' ? (
        <MissedCalls />
      ) : activeRoute === '/agent-report' ? (
        <AgentReport />
      ) : (
        <CampaignDashboard />
      )}
    </>
  )
}

export default App
