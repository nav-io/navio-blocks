import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface SearchBarProps {
  className?: string;
  compact?: boolean;
}

export function SearchBar({ className = '', compact = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setSearching(true);
    setError('');
    try {
      const result = await api.search(q);
      if (result.type === 'block' && result.block) {
        navigate(`/block/${result.block.height}`);
      } else if (result.type === 'transaction' && result.transaction) {
        navigate(`/tx/${result.transaction.txid}`);
      } else if (result.type === 'output' && result.output_hash) {
        navigate(`/output/${result.output_hash}`);
      } else {
        setError('No results found');
      }
    } catch {
      setError('Search failed. Try a block height, hash, txid, or output hash.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setError(''); }}
        placeholder="Block height/hash, txid, or output hash..."
        className={`w-full bg-navy-light/90 border border-white/15 rounded-xl text-white placeholder-white/35 focus:outline-none focus:border-neon-blue/60 focus:ring-1 focus:ring-neon-blue/30 transition-all font-mono ${
          compact ? 'pl-4 pr-24 py-2.5 text-xs' : 'pl-5 pr-28 py-4 text-sm'
        }`}
      />
      <button
        type="submit"
        disabled={searching}
        className={`absolute right-2 top-1/2 -translate-y-1/2 bg-gradient-to-r from-neon-blue to-neon-purple rounded-lg text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-5 py-2 text-sm'
        }`}
      >
        {searching ? 'Searching...' : 'Search'}
      </button>
      {error && (
        <p className="absolute -bottom-6 left-0 text-sm text-neon-pink">{error}</p>
      )}
    </form>
  );
}
