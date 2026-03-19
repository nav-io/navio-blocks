import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SearchBar } from '../components/SearchBar';
import { PriceTicker } from '../components/PriceTicker';

const NAVIO_LOGO_URL = '/navio-logo.svg';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/blocks', label: 'Blocks' },
  { to: '/outputs', label: 'Outputs' },
  { to: '/tokens', label: 'Tokens' },
  { to: '/network', label: 'Network' },
  { to: '/supply', label: 'Supply' },
  { to: '/price', label: 'Price' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-navy/85 backdrop-blur-xl shadow-[0_8px_30px_rgba(2,6,23,0.45)]">
      <div className="max-w-7xl mx-auto px-4 h-[72px] flex items-center justify-between gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="shrink-0 flex items-center rounded-xl border border-transparent hover:border-white/15 transition-colors px-2 py-1"
          aria-label="Navio Home"
        >
          <img
            src={NAVIO_LOGO_URL}
            alt="Navio"
            className="h-8 w-auto drop-shadow-[0_2px_8px_rgba(79,179,255,0.25)]"
            loading="eager"
            decoding="async"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {navLinks.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  isActive
                    ? 'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Search + Ticker (desktop) */}
        <div className="hidden md:flex items-center gap-3 ml-auto">
          <SearchBar className="w-80" compact />
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <PriceTicker />
          </div>
        </div>

        {/* Hamburger (mobile) */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-white/70 hover:text-white rounded-lg border border-white/10 bg-white/5 transition-colors"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/10 bg-navy/95 backdrop-blur-xl px-4 pb-4">
          <nav className="flex flex-col gap-1 py-2">
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'text-white bg-gradient-to-r from-neon-blue/30 to-neon-purple/25'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 px-3 pt-3 border-t border-white/10">
            <SearchBar className="flex-1" compact />
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <PriceTicker />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
