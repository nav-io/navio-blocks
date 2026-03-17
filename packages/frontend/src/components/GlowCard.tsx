import type { ReactNode } from 'react';

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function GlowCard({ children, className = '' }: GlowCardProps) {
  return (
    <div className={`glow-card ${className}`}>
      {children}
    </div>
  );
}
