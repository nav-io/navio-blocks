export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

export function satsToCoin(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

export function formatDifficulty(d: number): string {
  if (d >= 1e12) return (d / 1e12).toFixed(2) + 'T';
  if (d >= 1e9) return (d / 1e9).toFixed(2) + 'G';
  if (d >= 1e6) return (d / 1e6).toFixed(2) + 'M';
  if (d >= 1e3) return (d / 1e3).toFixed(2) + 'K';
  return d.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB';
  return bytes + ' B';
}

export function formatUSD(n: number): string {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatBTC(n: number): string {
  return n.toFixed(8) + ' BTC';
}

export function formatPercent(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

export function satsToCoinShort(sats: number): string {
  const nav = sats / 1e8;
  if (nav >= 1e6) return (nav / 1e6).toFixed(2) + 'M';
  if (nav >= 1e3) return (nav / 1e3).toFixed(2) + 'K';
  return nav.toFixed(2);
}
