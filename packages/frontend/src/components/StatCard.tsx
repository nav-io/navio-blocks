import GlowCard from './GlowCard';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  subValue?: string;
}

export default function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <GlowCard className="text-center">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold gradient-text">{value}</p>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </GlowCard>
  );
}
