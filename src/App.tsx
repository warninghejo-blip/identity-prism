import React, { useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, useLocation } from 'react-router-dom';
import { cleanupOverlays } from '@/lib/safeNavigate';
import { trackPageView } from '@/lib/analytics';
import { useChallengeNotifier } from '@/lib/useChallengeNotifier';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  const location = useLocation();
  useChallengeNotifier();

  // Dismiss HTML preloader and stale overlays on route change.
  // Index.tsx has its own preloader dismissal — cleanupOverlays handles
  // app-preloader removal for all other routes.
  useEffect(() => {
    const isIndexRoute =
      location.pathname === '/' || location.pathname.startsWith('/app') || location.pathname === '/share';
    if (!isIndexRoute) {
      cleanupOverlays();
    }
    trackPageView(location.pathname);
  }, [location.pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-[#050505] text-white selection:bg-cyan-500/30">
          <Outlet />
          <Toaster />
          <Sonner
            position="bottom-center"
            expand={false}
            closeButton
            offset={{ bottom: 16 }}
            mobileOffset={{ bottom: 12, left: 16, right: 16 }}
          />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
