import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, ChromaticAberration, Vignette, Noise } from '@react-three/postprocessing';
import * as THREE from 'three';
import { StarField } from "@/components/StarField";
import { VISUAL_CONFIG as GLOBAL_VISUAL_CONFIG } from "@/constants";

const queryClient = new QueryClient();

const SceneContent = () => {
  return (
    <>
      <color attach="background" args={["#000000"]} />
      <StarField count={2000} />
      <ambientLight intensity={0.2} />
    </>
  );
};

const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
        <Outlet />
        <Toaster />
        <Sonner position="top-center" expand={false} richColors closeButton />
        
        <div className="fixed inset-0 pointer-events-none z-0">
          <Canvas
            shadows
            camera={{ position: [0, 0, 20], fov: 45 }}
            gl={{ 
              antialias: !isMobile,
              powerPreference: "high-performance",
              alpha: true
            }}
            dpr={isMobile ? [1, 1] : [1, 2]}
          >
            <Suspense fallback={null}>
              <SceneContent />
              {!isMobile && (
                <EffectComposer disableNormalPass multisampling={0}>
                  <Bloom 
                    intensity={GLOBAL_VISUAL_CONFIG.POST_PROCESSING.BLOOM_INTENSITY}
                    luminanceThreshold={GLOBAL_VISUAL_CONFIG.POST_PROCESSING.BLOOM_LUMINANCE_THRESHOLD}
                    luminanceSmoothing={GLOBAL_VISUAL_CONFIG.POST_PROCESSING.BLOOM_LUMINANCE_SMOOTHING}
                  />
                  <ChromaticAberration offset={new THREE.Vector2(GLOBAL_VISUAL_CONFIG.POST_PROCESSING.CHROMATIC_ABERRATION, 0)} />
                  <Vignette eskil={false} offset={0.1} darkness={GLOBAL_VISUAL_CONFIG.POST_PROCESSING.VIGNETTE_DARKNESS} />
                  <Noise opacity={GLOBAL_VISUAL_CONFIG.POST_PROCESSING.NOISE_OPACITY} />
                </EffectComposer>
              )}
            </Suspense>
          </Canvas>
        </div>
      </div>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
