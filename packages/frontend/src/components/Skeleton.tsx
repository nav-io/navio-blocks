interface SkeletonProps {
  className?: string;
  lines?: number;
}

export default function Skeleton({ className = '', lines = 1 }: SkeletonProps) {
  if (lines === 1) {
    return <div className={`skeleton h-4 ${className}`} />;
  }
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'} ${className}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`glow-card animate-pulse ${className}`}>
      <div className="skeleton h-3 w-1/3 mb-3" />
      <div className="skeleton h-8 w-2/3 mb-2" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div
              key={j}
              className={`skeleton h-5 flex-1 ${j === 0 ? 'max-w-[80px]' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
