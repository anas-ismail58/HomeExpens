import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const StatusPage = lazy(() => import('@/pages/StatusPage/StatusPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage/NotFoundPage'));

function PageFallback() {
  const { t } = useTranslation();
  return (
    <p role="status" style={{ padding: '2rem', textAlign: 'center' }}>
      {t('common.loading')}
    </p>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Phase 6: AuthLayout (/login, /register, /forgot-password, /reset-password) */}
          {/* Phase 10: DashboardLayout (/dashboard, /transactions, /children, ...) */}
          <Route path="/" element={<StatusPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
