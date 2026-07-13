import './App.css'
import CampaignDashboard from './pages/CampaignDashboard'
import MissedCalls from './pages/MissedCalls'

type AppRoute = {
  path: string
  label: string
}

const routes: AppRoute[] = [
  { path: '/campaign', label: 'Campaign' },
  { path: '/missed-calls', label: 'Missed Calls' },
]

function getActiveRoute() {
  const pathname = window.location.pathname.replace(/\/$/, '') || '/'

  if (pathname === '/' || pathname === '/campaign') {
    return '/campaign'
  }

  if (pathname === '/missed-calls') {
    return '/missed-calls'
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

      {activeRoute === '/missed-calls' ? <MissedCalls /> : <CampaignDashboard />}
    </>
  )
}

export default App
