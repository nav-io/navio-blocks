import { useState } from 'react';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';

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

// Natural Earth land data → GeoJSON → SVG path (equirectangular, 1000×500)
const projection = geoEquirectangular()
  .scale(1000 / (2 * Math.PI))
  .translate([500, 250]);
const pathGenerator = geoPath().projection(projection);
// world-atlas TopoJSON: convert to GeoJSON then to SVG path
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const landGeo = feature(land110 as any, (land110 as any).objects.land);
const WORLD_PATH = pathGenerator(landGeo) ?? '';

export default function NodeMap({ peers }: NodeMapProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; peer: MapPeer } | null>(null);

  return (
    <div className="relative w-full glow-card p-0 overflow-hidden">
      <svg
        viewBox="0 0 1000 500"
        className="w-full h-auto"
        style={{ background: '#1a1d2e' }}
      >
        {/* Grid lines */}
        {Array.from({ length: 9 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={(i + 1) * 50}
            x2={1000}
            y2={(i + 1) * 50}
            stroke="rgba(100, 130, 255, 0.12)"
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
            stroke="rgba(100, 130, 255, 0.12)"
            strokeWidth={0.5}
          />
        ))}

        {/* Continent outlines - Natural Earth 110m, improved contrast */}
        <path
          d={WORLD_PATH}
          fill="rgba(80, 120, 200, 0.22)"
          stroke="rgba(100, 150, 255, 0.45)"
          strokeWidth={0.8}
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
