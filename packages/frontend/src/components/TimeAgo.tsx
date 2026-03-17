import { timeAgo } from '../utils';

interface TimeAgoProps {
  timestamp: number;
  className?: string;
}

export default function TimeAgo({ timestamp, className = '' }: TimeAgoProps) {
  return <span className={className}>{timeAgo(timestamp)}</span>;
}
