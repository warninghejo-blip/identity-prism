import React, { Component, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AppWeb from './AppWeb';
import NotFound from './pages-web/NotFound';

/** Error boundary that catches lazy-import failures and retries once. */
class LazyErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; retried: boolean }
> {
  state = { hasError: false, retried: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (!this.state.retried && error.message?.includes('dynamically imported module')) {
      this.setState({ hasError: false, retried: true });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
            <p style={{ marginBottom: 12 }}>Page failed to load.</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, retried: false });
              }}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

const LazyFallback = () => <div className="fixed inset-0 bg-[#05070a] z-[999]" />;

function lazyRoute(element: ReactNode) {
  return (
    <LazyErrorBoundary>
      <React.Suspense fallback={<LazyFallback />}>{element}</React.Suspense>
    </LazyErrorBoundary>
  );
}

const LandingPage = React.lazy(() => import('./pages-web/LandingPage'));
const SybilCheckerPage = React.lazy(() => import('./pages-web/SybilCheckerPage'));
const Compare = React.lazy(() => import('./pages-web/Compare'));
const PreviewDeck = React.lazy(() => import('./pages-web/PreviewDeck'));
const IdentityWeb = React.lazy(() => import('./pages-web/IdentityWeb'));
const BlackHoleWeb = React.lazy(() => import('./pages-web/BlackHoleWeb'));

const routerOptions: Parameters<typeof createBrowserRouter>[1] = {
  future: {
    v7_relativeSplatPath: true,
  },
};

const webRoutes = [
  {
    path: '/',
    element: <AppWeb />,
    children: [
      { index: true, element: lazyRoute(<LandingPage />) },
      { path: 'identity', element: lazyRoute(<IdentityWeb />) },
      { path: 'blackhole', element: lazyRoute(<BlackHoleWeb />) },
      { path: 'sybil-check', element: lazyRoute(<SybilCheckerPage />) },
      { path: 'compare', element: lazyRoute(<Compare />) },
      { path: 'preview', element: lazyRoute(<PreviewDeck />) },
      { path: 'preview/:tier', element: lazyRoute(<PreviewDeck />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(webRoutes, routerOptions);

export default function AppShellWeb() {
  return (
    <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#05070a', zIndex: 999998 }} />}>
      <RouterProvider router={router} />
    </React.Suspense>
  );
}
