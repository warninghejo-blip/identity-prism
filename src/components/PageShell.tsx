import type { ReactNode } from 'react';
import { CosmicStarfield } from '@/components/CosmicStarfield';

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export default function PageShell({ children, className = '' }: PageShellProps) {
  return (
    <div className={`page-shell ${className}`}>
      <CosmicStarfield mode="drift" />
      <div className="page-shell-nebulas">
        <div className="landing-nebula landing-nebula-1" />
        <div className="landing-nebula landing-nebula-2" />
      </div>
      <div className="page-shell-content">{children}</div>
    </div>
  );
}
