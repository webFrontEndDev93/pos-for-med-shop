import { useMemo, useRef, useState } from 'react';
import { compactMoney, money } from '../lib/format';
import '../styles/viz.css';

/* ------------------------------------------------------------------ scale */

/** Rounds a maximum up to a friendly axis top (1 / 2 / 5 × 10ⁿ). */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="viz-tooltip-title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div className="viz-tooltip-row" key={row.label}>
          <span className="row" style={{ gap: 6 }}>
            {row.color && <span className="swatch" style={{ background: row.color }} />}
            <span className="muted">{row.label}</span>
          </span>
          <span className="val">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span
            className="legend-swatch"
            style={{
              background: item.dashed
                ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`
                : item.color,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- line area */

export interface TrendPoint {
  label: string;
  revenue: number;
  profit: number;
  bills: number;
}

/**
 * Revenue and profit over time. Both are rupee amounts so they share one axis —
 * never a second scale. Profit is dashed as well as differently coloured, so the
 * two series stay apart without relying on hue.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const W = 760;
  const H = 240;
  const pad = { top: 16, right: 18, bottom: 28, left: 54 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const max = useMemo(() => niceMax(Math.max(1, ...data.map((d) => d.revenue))), [data]);

  if (data.length === 0) return <div className="viz-empty">No sales in this period.</div>;

  const x = (index: number) => pad.left + (data.length === 1 ? plotW / 2 : (index / (data.length - 1)) * plotW);
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;

  const path = (key: 'revenue' | 'profit') =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');

  const area = `${path('revenue')} L${x(data.length - 1).toFixed(1)},${pad.top + plotH} L${x(0).toFixed(1)},${pad.top + plotH} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    const point = data[index];
    const host = wrap.current?.getBoundingClientRect();
    if (!host) return;
    setHoverIndex(index);
    setTip({
      x: ((x(index) / W) * host.width),
      y: ((y(point.revenue) / H) * host.height),
      title: point.label,
      rows: [
        { label: 'Revenue', value: money(point.revenue), color: 'var(--series-1)' },
        { label: 'Profit', value: money(point.profit), color: 'var(--series-3)' },
        { label: 'Bills', value: String(point.bills) },
      ],
    });
  };

  return (
    <div className="viz viz-figure">
      <div className="viz-plot" ref={wrap}>
        <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and profit by day">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid-line" x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis-text" x={pad.left - 8} y={y(tick) + 3.5} textAnchor="end">
                {compactMoney(tick)}
              </text>
            </g>
          ))}

          {data.map((point, index) =>
            index % labelEvery === 0 || index === data.length - 1 ? (
              <text
                key={point.label}
                className="chart-axis-text"
                x={x(index)}
                y={H - 10}
                textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
              >
                {point.label}
              </text>
            ) : null,
          )}

          <path d={area} fill="url(#trend-fill)" />
          <path d={path('revenue')} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path('profit')} fill="none" stroke="var(--series-3)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />

          {hoverIndex !== null && (
            <g>
              <line
                className="chart-grid-line"
                x1={x(hoverIndex)} x2={x(hoverIndex)} y1={pad.top} y2={pad.top + plotH}
                stroke="var(--text-muted)" strokeDasharray="3 3"
              />
              <circle cx={x(hoverIndex)} cy={y(data[hoverIndex].revenue)} r={4.5} fill="var(--series-1)" stroke="var(--viz-surface)" strokeWidth={2} />
              <circle cx={x(hoverIndex)} cy={y(data[hoverIndex].profit)} r={4.5} fill="var(--series-3)" stroke="var(--viz-surface)" strokeWidth={2} />
            </g>
          )}

          <rect
            x={pad.left} y={pad.top} width={plotW} height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => { setTip(null); setHoverIndex(null); }}
          />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <Legend
        items={[
          { label: 'Revenue', color: 'var(--series-1)' },
          { label: 'Profit', color: 'var(--series-3)', dashed: true },
        ]}
      />
    </div>
  );
}

/* --------------------------------------------------------------- hour bars */

export function HourChart({ data }: { data: { hour: number; revenue: number; bills: number }[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Shops are shut overnight; showing 24 empty columns wastes the plot.
  const active = data.filter((d) => d.hour >= 7 && d.hour <= 23);
  const max = niceMax(Math.max(1, ...active.map((d) => d.revenue)));

  const W = 760;
  const H = 180;
  const pad = { top: 12, right: 8, bottom: 26, left: 54 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / active.length;
  const barW = Math.max(6, slot - 6);

  if (active.every((d) => d.revenue === 0)) return <div className="viz-empty">No sales in this period.</div>;

  return (
    <div className="viz viz-figure">
      <div className="viz-plot" ref={wrap}>
        <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue by hour of day">
          {[0, 0.5, 1].map((fraction) => {
            const value = fraction * max;
            const y = pad.top + plotH - fraction * plotH;
            return (
              <g key={fraction}>
                <line className="chart-grid-line" x1={pad.left} x2={W - pad.right} y1={y} y2={y} />
                <text className="chart-axis-text" x={pad.left - 8} y={y + 3.5} textAnchor="end">{compactMoney(value)}</text>
              </g>
            );
          })}

          {active.map((point, index) => {
            const height = (point.revenue / max) * plotH;
            const x = pad.left + index * slot + (slot - barW) / 2;
            const y = pad.top + plotH - height;
            const label = `${point.hour % 12 === 0 ? 12 : point.hour % 12}${point.hour < 12 ? 'am' : 'pm'}`;
            return (
              <g key={point.hour}>
                <rect
                  x={x} y={y} width={barW} height={Math.max(height, point.revenue > 0 ? 2 : 0)}
                  rx={3} fill="var(--series-1)" opacity={0.9}
                />
                {index % 2 === 0 && (
                  <text className="chart-axis-text" x={x + barW / 2} y={H - 8} textAnchor="middle">{label}</text>
                )}
                <rect
                  className="chart-hit"
                  x={pad.left + index * slot} y={pad.top} width={slot} height={plotH}
                  onMouseEnter={(event) => {
                    const host = wrap.current?.getBoundingClientRect();
                    const box = event.currentTarget.getBoundingClientRect();
                    if (!host) return;
                    setTip({
                      x: box.left - host.left + box.width / 2,
                      y: box.top - host.top + (plotH / H) * host.height * (1 - point.revenue / max),
                      title: label,
                      rows: [
                        { label: 'Revenue', value: money(point.revenue), color: 'var(--series-1)' },
                        { label: 'Bills', value: String(point.bills) },
                      ],
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- payment mix */

const MODE_COLORS: Record<string, string> = {
  cash: 'var(--series-1)',
  card: 'var(--series-2)',
  digital: 'var(--series-3)',
  credit: 'var(--series-4)',
};
const MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  digital: 'Digital',
  credit: 'Udhaar',
};

/**
 * Share of takings by payment method. Every segment carries a written label and
 * amount, which is also the relief the light-mode contrast warning requires.
 */
export function PaymentMix({ data }: { data: { mode: string; amount: number; bills: number }[] }) {
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  if (total <= 0) return <div className="viz-empty">No payments in this period.</div>;

  return (
    <div className="viz viz-figure">
      <div className="stack-bar">
        {data
          .filter((d) => d.amount > 0)
          .map((d) => (
            <div
              key={d.mode}
              className="stack-seg"
              style={{ width: `${(d.amount / total) * 100}%`, background: MODE_COLORS[d.mode] }}
              title={`${MODE_LABELS[d.mode] ?? d.mode} — ${money(d.amount)}`}
            />
          ))}
      </div>

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {data.map((d) => (
          <div className="row-between" key={d.mode} style={{ fontSize: 'var(--text-sm)' }}>
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="legend-swatch" style={{ background: MODE_COLORS[d.mode] }} />
              <span>{MODE_LABELS[d.mode] ?? d.mode}</span>
              <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                {d.bills} bill{d.bills === 1 ? '' : 's'}
              </span>
            </span>
            <span className="num" style={{ fontWeight: 620 }}>
              {money(d.amount)}
              <span className="muted" style={{ fontWeight: 500, marginLeft: 6 }}>
                {Math.round((d.amount / total) * 100)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ top products */

export function TopProducts({
  data,
}: {
  data: { productId: string; name: string; qty: number; revenue: number; profit: number }[];
}) {
  if (data.length === 0) return <div className="viz-empty">No sales in this period.</div>;
  const max = Math.max(...data.map((d) => d.revenue));

  return (
    <div className="viz" style={{ display: 'grid', gap: 'var(--space-1)' }}>
      {data.map((item, index) => (
        <div className="rank-row" key={item.productId}>
          <span className="rank-no">{index + 1}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row-between">
              <span className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 560 }}>{item.name}</span>
              <span className="num" style={{ fontSize: 'var(--text-sm)', fontWeight: 620 }}>{money(item.revenue)}</span>
            </div>
            <div className="rank-bar">
              <span style={{ width: `${Math.max(2, (item.revenue / max) * 100)}%`, background: 'var(--series-1)' }} />
            </div>
            <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 3 }}>
              {item.qty} sold · {money(item.profit)} profit
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
