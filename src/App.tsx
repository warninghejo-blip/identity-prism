import React, { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { cleanupOverlays } from '@/lib/safeNavigate';

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

  // Dismiss HTML preloader for non-Index routes (verify, compare, home, preview).
  // Index.tsx has its own sophisticated preloader dismissal with curtain animations,
  // so we only auto-dismiss for other child routes.
  useEffect(() => {
    cleanupOverlays();
    const isIndexRoute = location.pathname === '/' || location.pathname.startsWith('/app') || location.pathname === '/share';
    if (isIndexRoute) return; // Index.tsx handles its own preloader
    const el = document.getElementById('app-preloader');
    if (el) el.remove();
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
