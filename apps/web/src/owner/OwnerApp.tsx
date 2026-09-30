import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { ErrorBox, PageLoader } from '../components/ui';
import { OwnerLayout } from './components/Layout';
import { k, errorMessage } from './lib/queries';
import { MeProvider } from './lib/session';
import type { Me } from './lib/types';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ShopLivePage } from './pages/ShopLive';
import { MachineDetailPage } from './pages/MachineDetail';
import { MachineEditPage } from './pages/MachineEdit';
import { MachinesPage } from './pages/Machines';
import { QrSheetPage } from './pages/QrSheet';
import { TicketsPage } from './pages/Tickets';
import { TicketDetailPage } from './pages/TicketDetail';
import { RefundsPage } from './pages/Refunds';
import { AnalyticsPage } from './pages/Analytics';
import { CollectionsPage } from './pages/Collections';
import { MaintenancePage } from './pages/Maintenance';
import { ChecklistsPage } from './pages/Checklists';
import { MorePage } from './pages/More';
import { AlertsPage } from './pages/Alerts';
import { AnnouncementsPage } from './pages/Announcements';
import { DevicesPage } from './pages/Devices';
import { ShopSettingsPage } from './pages/ShopSettings';
import { StaffPage } from './pages/Staff';
import { AuditPage } from './pages/Audit';
import { Guard } from './components/Guard';

/** GET /owner/me; a 401 resolves to null (= signed out) instead of an error. */
function useSession() {
  return useQuery({
    queryKey: k.me,
    queryFn: async () => {
      try {
        return await api.get<Me>('/owner/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function OwnerApp() {
  const session = useSession();
  useEffect(() => {
    document.title = 'DobiMaster · Owner';
  }, []);

  if (session.isPending) return <PageLoader />;
  if (session.isError)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox message={errorMessage(session.error)} onRetry={() => session.refetch()} />
      </div>
    );
  if (!session.data) return <LoginPage />;

  return (
    <MeProvider me={session.data}>
      <Routes>
        {/* Printable sheet renders without the app chrome. */}
        <Route path="shops/:id/qr-sheet" element={<QrSheetPage />} />
        <Route element={<OwnerLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="shops/:id" element={<ShopLivePage />} />
          <Route path="machines" element={<MachinesPage />} />
          <Route path="machines/:id" element={<MachineDetailPage />} />
          <Route
            path="machines/:id/edit"
            element={
              <Guard perm="machines.manage">
                <MachineEditPage />
              </Guard>
            }
          />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route
            path="refunds"
            element={
              <Guard perm="refunds.decide">
                <RefundsPage />
              </Guard>
            }
          />
          <Route
            path="analytics"
            element={
              <Guard perm="revenue.view">
                <AnalyticsPage />
              </Guard>
            }
          />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
          <Route path="checklists" element={<ChecklistsPage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route
            path="settings"
            element={
              <Guard perm="shops.manage">
                <ShopSettingsPage />
              </Guard>
            }
          />
          <Route
            path="staff"
            element={
              <Guard perm="staff.manage">
                <StaffPage />
              </Guard>
            }
          />
          <Route
            path="audit"
            element={
              <Guard perm="audit.view">
                <AuditPage />
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/owner" replace />} />
        </Route>
      </Routes>
    </MeProvider>
  );
}
