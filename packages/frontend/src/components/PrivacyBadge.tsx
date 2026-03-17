interface PrivacyBadgeProps {
  isBlsct: boolean;
  className?: string;
}

export default function PrivacyBadge({ isBlsct, className = '' }: PrivacyBadgeProps) {
  if (!isBlsct) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neon-purple/20 text-neon-purple border border-neon-purple/30 ${className}`}
    >
      BLSCT
    </span>
  );
}
