import { useState } from 'react';

interface MapPeer {
  lat: number;
  lon: number;
  country: string;
  city: string;
  subversion: string;
}

interface NodeMapProps {
  peers: MapPeer[];
}

// Equirectangular projection: convert lat/lon to SVG coordinates
// SVG viewBox: 0 0 1000 500
function latLonToSvg(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * 1000;
  const y = ((90 - lat) / 180) * 500;
  return { x, y };
}

// Simplified world map continent outlines (equirectangular projection, viewBox 0 0 1000 500)
const WORLD_PATH = [
  // North America
  'M 60 95 L 80 80 L 130 65 L 175 60 L 200 75 L 230 70 L 260 55 L 280 65 L 275 80 L 260 95 L 250 110 L 225 120 L 195 135 L 175 150 L 155 165 L 140 190 L 130 195 L 120 175 L 100 160 L 85 145 L 65 130 L 55 115 Z',
  // Central America
  'M 130 195 L 140 200 L 150 210 L 155 225 L 145 230 L 140 220 L 135 210 L 125 200 Z',
  // South America
  'M 155 230 L 175 225 L 195 235 L 210 255 L 215 280 L 210 305 L 200 330 L 185 355 L 175 375 L 165 390 L 155 385 L 150 365 L 155 340 L 160 315 L 165 290 L 160 265 L 150 250 Z',
  // Europe
  'M 460 60 L 480 55 L 500 58 L 520 65 L 530 75 L 525 90 L 510 100 L 500 110 L 490 105 L 480 110 L 470 105 L 465 95 L 455 85 L 450 75 Z',
  // Africa
  'M 460 150 L 480 145 L 510 150 L 540 155 L 555 170 L 560 195 L 555 225 L 545 255 L 535 280 L 520 300 L 505 310 L 490 305 L 480 285 L 470 260 L 460 235 L 455 210 L 450 185 L 455 165 Z',
  // Asia
  'M 530 75 L 560 55 L 600 45 L 650 40 L 700 50 L 740 55 L 770 60 L 800 70 L 820 85 L 810 100 L 790 110 L 770 120 L 740 125 L 710 130 L 680 135 L 650 140 L 620 145 L 590 140 L 565 130 L 545 115 L 535 100 L 530 85 Z',
  // India / SE Asia
  'M 640 145 L 660 155 L 675 175 L 670 195 L 655 200 L 640 190 L 635 170 Z',
  'M 700 140 L 720 150 L 735 165 L 740 185 L 730 195 L 715 190 L 705 170 L 695 155 Z',
  // Australia
  'M 760 280 L 790 270 L 825 275 L 850 285 L 860 305 L 850 325 L 830 335 L 800 340 L 775 330 L 760 315 L 755 300 Z',
  // Greenland
  'M 300 30 L 330 25 L 355 30 L 360 45 L 345 55 L 320 55 L 305 48 Z',
  // Japan
  'M 825 95 L 832 85 L 840 90 L 838 105 L 830 110 Z',
  // Indonesia
  'M 740 210 L 760 205 L 785 210 L 800 215 L 790 225 L 765 220 L 745 218 Z',
].join(' ');

export default function NodeMap({ peers }: NodeMapProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; peer: MapPeer } | null>(null);

  return (
    <div className="relative w-full glow-card p-0 overflow-hidden">
      <svg
        viewBox="0 0 1000 500"
        className="w-full h-auto"
        style={{ background: '#0D0B1A' }}
      >
        {/* Grid lines */}
        {Array.from({ length: 9 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={(i + 1) * 50}
            x2={1000}
            y2={(i + 1) * 50}
            stroke="rgba(64, 96, 255, 0.07)"
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: 19 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={(i + 1) * 50}
            y1={0}
            x2={(i + 1) * 50}
            y2={500}
            stroke="rgba(64, 96, 255, 0.07)"
            strokeWidth={0.5}
          />
        ))}

        {/* Continent outlines */}
        <path
          d={WORLD_PATH}
          fill="rgba(64, 96, 255, 0.08)"
          stroke="rgba(64, 96, 255, 0.2)"
          strokeWidth={1}
        />

        {/* Peer dots */}
        {peers.map((peer, i) => {
          const { x, y } = latLonToSvg(peer.lat, peer.lon);
          return (
            <g key={i}>
              {/* Outer glow */}
              <circle cx={x} cy={y} r={8} fill="rgba(224, 64, 160, 0.15)" />
              {/* Dot */}
              <circle
                cx={x}
                cy={y}
                r={4}
                className="neon-dot"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltip({ x, y, peer })}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-10 px-3 py-2 bg-navy-lighter border border-white/10 rounded-lg shadow-glow-purple text-xs font-mono pointer-events-none"
          style={{
            left: `${(tooltip.x / 1000) * 100}%`,
            top: `${(tooltip.y / 500) * 100}%`,
            transform: `translate(${tooltip.x > 750 ? '-100%' : '10px'}, -120%)`,
          }}
        >
          <p className="text-white font-semibold">
            {tooltip.peer.city}, {tooltip.peer.country}
          </p>
          <p className="text-white/50">{tooltip.peer.subversion}</p>
        </div>
      )}
    </div>
  );
}
