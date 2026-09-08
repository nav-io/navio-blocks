import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { SearchBar } from '../components/SearchBar';
import { PriceTicker } from '../components/PriceTicker';
import { useNetwork, rememberNetwork, switchNetworkHref, type Network } from '../network';

const NAVIO_LOGO_URL = '/navio-logo.svg';

const NETWORK_OPTIONS: { value: Network; label: string }[] = [
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'testnet', label: 'Testnet' },
];

/** Segmented Mainnet/Testnet switch. Switching is a full navigation since the
 *  API base and router basename both change with the network. */
function NetworkToggle({ className = '' }: { className?: string }) {
  const active = useNetwork();
  return (
    <div
      className={`flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1 ${className}`}
      role="group"
      aria-label="Select network"
    >
      {NETWORK_OPTIONS.map(({ value, label }) => {
        const isActive = value === active;
        return (
          <a
            key={value}
            href={switchNetworkHref(value)}
            onClick={() => rememberNetwork(value)}
            aria-current={isActive ? 'true' : undefined}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
              isActive
                ? value === 'testnet'
                  ? 'text-amber-200 bg-amber-400/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                  : 'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            {label}
          </a>
        );
      })}
    </div>
  );
}

type NavItem = { to: string; label: string; hint?: string };
type NavEntry =
  | { kind: 'link'; to: string; label: string }
  | { kind: 'group'; label: string; items: NavItem[] };

// Kept deliberately short: the logo is the Home link, and the long-tail pages
// live in two dropdowns so the bar fits next to search, ticker and network toggle.
const NAV: NavEntry[] = [
  { kind: 'link', to: '/blocks', label: 'Blocks' },
  { kind: 'link', to: '/outputs', label: 'Outputs' },
  { kind: 'link', to: '/tokens', label: 'Tokens' },
  {
    kind: 'group',
    label: 'Network',
    items: [
      { to: '/network', label: 'Nodes', hint: 'peers, map, node stats' },
      { to: '/staking', label: 'Staking', hint: 'staked set & cold staking' },
      { to: '/overlay', label: 'P2P Overlay', hint: 'aggregation & RFQ bus' },
    ],
  },
  {
    kind: 'group',
    label: 'Economy',
    items: [
      { to: '/supply', label: 'Supply', hint: 'issuance & burns' },
      { to: '/price', label: 'Price', hint: 'market history' },
    ],
  },
];

const PILL_ACTIVE =
  'text-white bg-gradient-to-r from-neon-blue/30 via-neon-purple/25 to-neon-pink/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]';
const PILL_IDLE = 'text-white/60 hover:text-white hover:bg-white/5';

function isPathActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Desktop dropdown: opens on hover or click, closes on outside click / route change. */
function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = items.some((i) => isPathActive(pathname, i.to));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
          active ? PILL_ACTIVE : open ? 'text-white bg-white/5' : PILL_IDLE
        }`}
      >
        {label}
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full pt-2 min-w-[220px]"
        >
          <div className="rounded-xl border border-white/10 bg-navy/95 backdrop-blur-xl shadow-[0_12px_40px_rgba(2,6,23,0.6)] p-1.5">
            {items.map((item) => {
              const isActive = isPathActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  role="menuitem"
                  className={`block px-3 py-2 rounded-lg transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  {item.hint && (
                    <span className="block text-[11px] text-white/40 font-mono">{item.hint}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-navy/85 backdrop-blur-xl shadow-[0_8px_30px_rgba(2,6,23,0.45)]">
      <div className="max-w-7xl mx-auto px-4 h-[72px] flex items-center justify-between gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="shrink-0 flex items-center gap-2 rounded-xl border border-transparent hover:border-white/15 transition-colors px-2 py-1"
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
          {NAV.map((entry) =>
            entry.kind === 'link' ? (
              <NavLink
                key={entry.to}
                to={entry.to}
                className={({ isActive }) =>
                  `px-4 py-1.5 text-sm font-medium rounded-full transition-all ${isActive ? PILL_ACTIVE : PILL_IDLE}`
                }
              >
                {entry.label}
              </NavLink>
            ) : (
              <NavGroup key={entry.label} label={entry.label} items={entry.items} />
            ),
          )}
        </nav>

        {/* Search + Ticker + Network toggle (desktop) */}
        <div className="hidden md:flex items-center gap-2 ml-auto min-w-0">
          <SearchBar className="w-48 lg:w-64 min-w-0" compact />
          <Link
            to="/price"
            className="hidden lg:block shrink-0 rounded-lg border border-white/10 bg-white/[0.03] hover:border-white/20 transition-colors px-3 py-2"
            aria-label="NAV price history"
          >
            <PriceTicker />
          </Link>
          <NetworkToggle className="shrink-0" />
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
            {[{ kind: 'link', to: '/', label: 'Home' } as NavEntry, ...NAV].map((entry) =>
              entry.kind === 'link' ? (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'text-white bg-gradient-to-r from-neon-blue/30 to-neon-purple/25'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`
                  }
                >
                  {entry.label}
                </NavLink>
              ) : (
                <div key={entry.label} className="pt-2">
                  <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-white/35">{entry.label}</p>
                  {entry.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                          isActive
                            ? 'text-white bg-gradient-to-r from-neon-blue/30 to-neon-purple/25'
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ),
            )}
          </nav>
          <div className="flex items-center gap-3 px-3 pt-3 border-t border-white/10">
            <SearchBar className="flex-1" compact />
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <PriceTicker />
            </div>
          </div>
          <div className="px-3 pt-3">
            <NetworkToggle className="w-full justify-center" />
          </div>
        </div>
      )}
    </header>
  );
}
