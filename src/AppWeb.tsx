import { useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, useLocation } from 'react-router-dom';
import { cleanupOverlays } from '@/lib/safeNavigate';
import { trackPageView } from '@/lib/analytics';

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

/**
 * Web-only App wrapper — drops useChallengeNotifier (requires wallet context)
 * and any APK-only side effects. Marketing site only.
 */
const AppWeb = () => {
  const location = useLocation();

  useEffect(() => {
    document.body.dataset.ipMounted = '1';
    const preloader = document.getElementById('app-preloader');
    if (preloader) {
      preloader.remove();
    }
  }, []);

  useEffect(() => {
    cleanupOverlays();
    trackPageView(location.pathname);
  }, [location.pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-[#050505] text-white selection:bg-cyan-500/30">
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
          <Sonner position="bottom-right" expand={false} closeButton richColors={false} offset={24} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default AppWeb;
