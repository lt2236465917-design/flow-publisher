import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import AccountPage from './pages/AccountPage'
import PublishPage from './pages/PublishPage'
import PublishRecordsPage from './pages/PublishRecordsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import SettingsPage from './pages/SettingsPage'
import ErrorBoundary from './components/common/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/account" replace />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="publish" element={<PublishPage />} />
          <Route path="records" element={<PublishRecordsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
