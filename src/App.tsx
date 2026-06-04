import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import AccountPage from './pages/AccountPage'
import PublishPage from './pages/PublishPage'
import DataPage from './pages/DataPage'
import SettingsPage from './pages/SettingsPage'
import ErrorBoundary from './components/common/ErrorBoundary'
import GlobalLoading from './components/common/GlobalLoading'

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalLoading />
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/account" replace />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="publish" element={<PublishPage />} />
          <Route path="records" element={<DataPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
