import { createBrowserRouter } from 'react-router';
import { CustomerLayout } from './customer/Layout';
import { HomePage } from './customer/HomePage';
import { ShopPage } from './customer/ShopPage';
import { MachinePage } from './customer/MachinePage';
import { ReportPage } from './customer/ReportPage';
import { MyLaundryPage } from './customer/MyLaundryPage';
import { PaymentPage, MockGatewayPage } from './customer/PaymentPage';
import { LegalPage } from './legal/LegalPage';

// The owner dashboard is lazy-loaded so customers never download it.
export const router = createBrowserRouter([
  {
    element: <CustomerLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/s/:slug', element: <ShopPage /> },
      { path: '/m/:qr', element: <MachinePage /> },
      { path: '/m/:qr/report', element: <ReportPage /> },
      { path: '/s/:slug/report', element: <ReportPage /> },
      { path: '/me', element: <MyLaundryPage /> },
      { path: '/pay/:id', element: <PaymentPage /> },
      { path: '/privacy', element: <LegalPage doc="privacy" /> },
      { path: '/terms', element: <LegalPage doc="terms" /> },
    ],
  },
  { path: '/pay/mock/:id', element: <MockGatewayPage /> },
  {
    path: '/owner/*',
    lazy: async () => {
      const m = await import('./owner/OwnerApp');
      return { Component: m.OwnerApp };
    },
  },
]);
