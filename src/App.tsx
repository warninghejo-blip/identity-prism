import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";

const queryClient = new QueryClient();

const App = () => {

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-[#050505] text-white selection:bg-cyan-500/30">
          <Outlet />
          <Toaster />
          <Sonner
            position="bottom-center"
            expand={false}
            richColors
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
