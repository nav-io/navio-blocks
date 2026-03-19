import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type AreaSeriesOptions,
  type LineSeriesOptions,
  type DeepPartial,
} from 'lightweight-charts';

interface PriceChartProps {
  data: { timestamp: number; value: number }[];
  color?: string;
  emaData?: { timestamp: number; value: number }[];
  emaColor?: string;
  medianData?: { timestamp: number; value: number }[];
  medianColor?: string;
  projectionData?: { timestamp: number; value: number }[];
  projectionColor?: string;
}

function toChartData(data: { timestamp: number; value: number }[]): Array<{
  time: import('lightweight-charts').UTCTimestamp;
  value: number;
}> {
  const sorted = data
    .filter((d) => Number.isFinite(d.timestamp) && Number.isFinite(d.value))
    .map((d) => ({
      time: d.timestamp as import('lightweight-charts').UTCTimestamp,
      value: d.value,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));

  // lightweight-charts requires strictly ascending unique timestamps.
  // If multiple points land on the same second, keep the latest one.
  const chartData: Array<{
    time: import('lightweight-charts').UTCTimestamp;
    value: number;
  }> = [];
  for (const point of sorted) {
    const last = chartData[chartData.length - 1];
    if (last && (last.time as number) === (point.time as number)) {
      chartData[chartData.length - 1] = point;
    } else {
      chartData.push(point);
    }
  }

  return chartData;
}

export default function PriceChart({
  data,
  color = '#E040A0',
  emaData,
  emaColor = 'rgba(255, 255, 255, 0.75)',
  medianData,
  medianColor = 'rgba(255, 255, 255, 0.45)',
  projectionData,
  projectionColor = 'rgba(79, 179, 255, 0.9)',
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const medianSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const projectionSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0D0B1A' },
        textColor: 'rgba(255, 255, 255, 0.4)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(64, 96, 255, 0.06)' },
        horzLines: { color: 'rgba(64, 96, 255, 0.06)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255, 255, 255, 0.2)', labelBackgroundColor: '#1A1830' },
        horzLine: { color: 'rgba(255, 255, 255, 0.2)', labelBackgroundColor: '#1A1830' },
      },
      timeScale: {
        borderColor: 'rgba(64, 96, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(64, 96, 255, 0.1)',
      },
      handleScroll: { vertTouchDrag: false },
      width: containerRef.current.clientWidth,
      height: 300,
    });

    const seriesOptions: DeepPartial<AreaSeriesOptions> = {
      lineColor: color,
      topColor: `${color}40`,
      bottomColor: `${color}05`,
      lineWidth: 2,
      crosshairMarkerBackgroundColor: color,
      crosshairMarkerBorderColor: '#fff',
      crosshairMarkerRadius: 4,
    };
    const emaOptions: DeepPartial<LineSeriesOptions> = {
      color: emaColor,
      lineWidth: 2,
      lineStyle: 2, // dashed
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    };
    const medianOptions: DeepPartial<LineSeriesOptions> = {
      color: medianColor,
      lineWidth: 2,
      lineStyle: 1, // dotted
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    };
    const projectionOptions: DeepPartial<LineSeriesOptions> = {
      color: projectionColor,
      lineWidth: 2,
      lineStyle: 2, // dashed
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    };

    const series = chart.addAreaSeries(seriesOptions);
    const emaSeries = chart.addLineSeries(emaOptions);
    const medianSeries = chart.addLineSeries(medianOptions);
    const projectionSeries = chart.addLineSeries(projectionOptions);
    chartRef.current = chart;
    seriesRef.current = series;
    emaSeriesRef.current = emaSeries;
    medianSeriesRef.current = medianSeries;
    projectionSeriesRef.current = projectionSeries;

    // Handle resize
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaSeriesRef.current = null;
      medianSeriesRef.current = null;
      projectionSeriesRef.current = null;
    };
  }, [color, emaColor, medianColor, projectionColor]);

  // Update data when it changes
  useEffect(() => {
    if (!seriesRef.current) return;

    const areaData = toChartData(data);
    seriesRef.current.setData(areaData);

    if (emaSeriesRef.current) {
      if (emaData && emaData.length > 0) {
        emaSeriesRef.current.setData(toChartData(emaData));
      } else {
        emaSeriesRef.current.setData([]);
      }
    }
    if (medianSeriesRef.current) {
      if (medianData && medianData.length > 0) {
        medianSeriesRef.current.setData(toChartData(medianData));
      } else {
        medianSeriesRef.current.setData([]);
      }
    }
    if (projectionSeriesRef.current) {
      if (projectionData && projectionData.length > 0) {
        projectionSeriesRef.current.setData(toChartData(projectionData));
      } else {
        projectionSeriesRef.current.setData([]);
      }
    }

    if (areaData.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [data, emaData, medianData, projectionData]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-xl overflow-hidden border border-white/5"
    />
  );
}
