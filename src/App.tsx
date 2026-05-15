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
    document.body.dataset.ipMounted = '1';
    const preloader = document.getElementById('app-preloader');
    if (preloader) {
      preloader.remove();
    }
  }, []);

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
          {/* Skip-to-content link for keyboard users */}
          <a
            href="#root-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-cyan-500 focus:text-black focus:font-bold focus:text-sm"
          >
            Skip to content
          </a>
          <main id="root-content">
            <Outlet />
          </main>
          <Toaster />
          <Sonner position="top-center" expand={false} closeButton richColors offset={64} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
