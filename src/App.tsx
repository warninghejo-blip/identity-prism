import React, { useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, useLocation } from 'react-router-dom';
import { cleanupOverlays, cleanupWalletModals } from '@/lib/safeNavigate';
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

  // Clean up stuck wallet-adapter / MWA overlays when the window regains focus.
  // Event-driven — zero overhead when idle.
  useEffect(() => {
    const onFocus = () => cleanupWalletModals();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

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
            {/* Direct render — no route-transition fade. The previous AnimatePresence mode="wait"
                faded each page out to opacity 0 (dark) before the next entered, which read as a
                constant flicker on every navigation. Instant swap = clean transition. */}
            <Outlet />
          </main>
          <Toaster />
          <Sonner position="bottom-right" expand={false} closeButton richColors={false} offset={24} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
