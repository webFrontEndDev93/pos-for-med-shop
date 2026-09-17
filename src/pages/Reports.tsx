import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { addDays, formatDateTime, money, startOfMonth, todayISO } from '../lib/format';
import type { ReportSummary, Sale } from '../lib/types';
import { Icon } from '../components/Icon';
import { Badge, Button, ConfirmDialog, EmptyState, Modal, Stat } from '../components/ui';
import { HourChart, PaymentMix, TopProducts, TrendChart } from '../components/charts';
import { Receipt } from '../components/Receipt';
import '../styles/pages.css';

type Preset = 'today' | 'week' | 'month' | 'quarter' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'Last 90 days' },
];

function rangeFor(preset: Preset): { from: string; to: string } {
  const today = todayISO();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: addDays(today, -6), to: today };
  if (preset === 'month') return { from: startOfMonth(), to: today };
  return { from: addDays(today, -89), to: today };
}

export function Reports() {
  const { settings, alerts, notify, reportError, reload } = useStore();
  const [preset, setPreset] = useState<Preset>('week');
  const [range, setRange] = useState(() => rangeFor('week'));
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [report, bills] = await Promise.all([
        api.report(range.from, range.to),
        api.sales({ from: range.from, to: range.to, limit: '400' }),
      ]);
      setSummary(report);
      setSales(bills);
    } catch (error) {
      reportError(error);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, reportError]);

  useEffect(() => { void load(); }, [load]);

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') setRange(rangeFor(next));
  };

  const trend = useMemo(() => {
    if (!summary) return [];
    return summary.byDay.map((day) => ({
      label: new Date(`${day.day}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      revenue: day.revenue,
      profit: day.profit,
      bills: day.bills,
    }));
  }, [summary]);

  const filteredSales = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sales;
    return sales.filter(
      (s) => s.invoiceNo.toLowerCase().includes(needle) || s.customerName.toLowerCase().includes(needle),
    );
  }, [sales, query]);

  const margin = summary && summary.totals.revenue > 0
    ? Math.round((summary.totals.profit / summary.totals.revenue) * 1000) / 10
    : 0;

  const cancelBill = async () => {
    if (!voiding) return;
    setBusy(true);
    try {
      await api.voidSale(voiding.id);
      notify('success', 'Bill cancelled', `${voiding.invoiceNo} — stock has been put back.`);
      setVoiding(null);
      await Promise.all([load(), reload()]);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = ['Invoice', 'Date', 'Customer', 'Items', 'Gross', 'Discount', 'Tax', 'Total', 'Paid', 'Due', 'Mode', 'Status'];
    const rows = filteredSales.map((s) => [
      s.invoiceNo,
      new Date(s.at).toISOString(),
      s.customerName,
      s.items.length,
      s.gross,
      s.discount,
      s.tax,
      s.total,
      s.paid,
      s.due,
      s.paymentMode,
      s.status,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `medipos-sales-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('success', 'Exported', `${filteredSales.length} bills written to CSV.`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            {summary ? `${summary.range.from} to ${summary.range.to}` : 'Loading…'}
          </p>
        </div>
        <div className="row">
          <div className="seg">
            {PRESETS.map((item) => (
              <button key={item.key} type="button" aria-pressed={preset === item.key} onClick={() => choosePreset(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <input
            className="input" type="date" style={{ width: 'auto' }}
            value={range.from} max={range.to}
            onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }}
            aria-label="From date"
          />
          <span className="muted">→</span>
          <input
            className="input" type="date" style={{ width: 'auto' }}
            value={range.to} min={range.from} max={todayISO()}
            onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }}
            aria-label="To date"
          />
          <Button icon="refresh" iconOnly onClick={() => void load()} aria-label="Refresh" />
        </div>
      </div>

      {loading && !summary ? (
        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: '6.5rem', borderRadius: 'var(--radius-lg)' }} />)}
        </div>
      ) : !summary ? (
        <EmptyState icon="reports" title="No report to show" text="Try reloading, or check that the server is running." />
      ) : (
        <>
          <div className="stat-grid stat-grid--report" style={{ marginBottom: 'var(--space-4)' }}>
            <Stat
              label="Revenue"
              value={money(summary.totals.revenue)}
              foot={`${summary.totals.bills} bills · ${summary.totals.itemsSold} items`}
              tone="brand"
              icon="wallet"
            />
            <Stat
              label="Gross profit"
              value={money(summary.totals.profit)}
              foot={`${margin}% margin on taxable value`}
              tone={summary.totals.profit >= 0 ? 'success' : 'danger'}
              icon="trendUp"
            />
            <Stat
              label="Average bill"
              value={money(summary.totals.averageBill)}
              foot={`${money(summary.totals.discount)} given as discount`}
              tone="info"
              icon="receipt"
            />
            <Stat
              label="GST collected"
              value={money(summary.totals.tax)}
              foot="CGST + SGST on these bills"
              tone="neutral"
              icon="shield"
            />
            <Stat
              label="Stock on hand"
              value={money(summary.stockValue)}
              foot="Valued at purchase cost"
              tone="brand"
              icon="box"
            />
            <Stat
              label="Udhaar outstanding"
              value={money(summary.creditOutstanding)}
              foot="Owed by customers across all time"
              tone={summary.creditOutstanding > 0 ? 'warning' : 'success'}
              icon="clock"
            />
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Revenue and profit</div>
                  <div className="cell-sub">Both in rupees, on one scale</div>
                </div>
              </div>
              <div className="card-body">
                <TrendChart data={trend} />
              </div>
            </div>

            <div className="report-split">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">Best sellers</div>
                    <div className="cell-sub">By revenue in this period</div>
                  </div>
                </div>
                <div className="card-body"><TopProducts data={summary.topProducts} /></div>
              </div>

              <div style={{ display: 'grid', gap: 'var(--space-4)', alignContent: 'start' }}>
                <div className="card">
                  <div className="card-head">
                    <div>
                      <div className="card-title">How customers paid</div>
                      <div className="cell-sub">Share of takings by method</div>
                    </div>
                  </div>
                  <div className="card-body"><PaymentMix data={summary.byPaymentMode} /></div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <div>
                      <div className="card-title">Needs reordering</div>
                      <div className="cell-sub">At or below reorder level right now</div>
                    </div>
                    {alerts.lowStock.length > 0 && <Badge tone="warning">{alerts.lowStock.length}</Badge>}
                  </div>
                  <div className="card-body card-body--tight">
                    {alerts.lowStock.length === 0 ? (
                      <p className="muted" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>
                        Everything is above its reorder level.
                      </p>
                    ) : (
                      <div style={{ maxHeight: '18rem', overflowY: 'auto' }}>
                        {alerts.lowStock.slice(0, 12).map((item) => (
                          <div className="ledger-row" key={item.productId} style={{ padding: 'var(--space-2) var(--space-2)' }}>
                            <span className="grow" style={{ minWidth: 0 }}>
                              <span className="truncate" style={{ display: 'block', fontWeight: 560, fontSize: 'var(--text-sm)' }}>
                                {item.name} {item.strength && item.strength !== '—' ? item.strength : ''}
                              </span>
                              <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                                reorder at {item.reorderLevel}{item.rack ? ` · rack ${item.rack}` : ''}
                              </span>
                            </span>
                            <Badge tone={item.stock === 0 ? 'danger' : 'warning'}>
                              {item.stock === 0 ? 'out' : `${item.stock} left`}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Busiest hours</div>
                  <div className="cell-sub">When the counter is at its busiest, 7am to 11pm</div>
                </div>
              </div>
              <div className="card-body"><HourChart data={summary.byHour} /></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Bills in this period</div>
              <div className="row">
                <div className="search-slim" style={{ position: 'relative' }}>
                  <Icon name="search" size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: '2.4rem', width: '16rem' }}
                    placeholder="Invoice or customer…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Button icon="download" onClick={exportCsv} disabled={filteredSales.length === 0}>Export CSV</Button>
              </div>
            </div>

            {filteredSales.length === 0 ? (
              <EmptyState icon="receipt" title="No bills here" text="Nothing was sold in this range, or the search matched nothing." />
            ) : (
              <div className="table-wrap" style={{ maxHeight: '32rem' }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>When</th>
                      <th>Customer</th>
                      <th className="right">Items</th>
                      <th className="right">Total</th>
                      <th>Paid by</th>
                      <th style={{ width: '8rem' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.map((sale) => (
                      <tr key={sale.id} style={{ opacity: sale.status === 'void' ? 0.55 : 1 }}>
                        <td className="mono">
                          {sale.invoiceNo}
                          {sale.status === 'void' && <div><Badge tone="danger">cancelled</Badge></div>}
                        </td>
                        <td className="muted">{formatDateTime(sale.at)}</td>
                        <td>
                          {sale.customerName}
                          {sale.prescriptionRef && <div className="cell-sub">Rx {sale.prescriptionRef}</div>}
                        </td>
                        <td className="right num">{sale.items.length}</td>
                        <td className="right num" style={{ fontWeight: 620 }}>
                          {money(sale.total)}
                          {sale.due > 0 && <div className="cell-sub" style={{ color: 'var(--warning)' }}>{money(sale.due)} due</div>}
                        </td>
                        <td>
                          <Badge tone={sale.paymentMode === 'credit' ? 'warning' : 'neutral'}>
                            {sale.paymentMode.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="right">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                            <Button variant="ghost" size="sm" iconOnly icon="receipt" onClick={() => setViewing(sale)} aria-label={`View ${sale.invoiceNo}`} />
                            {sale.status !== 'void' && (
                              <Button variant="ghost" size="sm" iconOnly icon="close" onClick={() => setVoiding(sale)} aria-label={`Cancel ${sale.invoiceNo}`} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {viewing && (
        <Modal
          title={`Bill ${viewing.invoiceNo}`}
          subtitle={`${money(viewing.total)} · ${formatDateTime(viewing.at)}`}
          width="24rem"
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button onClick={() => setViewing(null)}>Close</Button>
              <Button variant="primary" icon="print" onClick={() => window.print()}>Print</Button>
            </>
          }
        >
          <Receipt sale={viewing} settings={settings} />
        </Modal>
      )}

      {voiding && (
        <ConfirmDialog
          title="Cancel this bill?"
          message={
            <>
              <strong>{voiding.invoiceNo}</strong> for {money(voiding.total)} will be marked cancelled.
              Every item on it goes back into stock
              {voiding.due > 0 ? ', and the udhaar it created is written off' : ''}. The bill stays in the
              record so your numbers still add up.
            </>
          }
          confirmLabel="Cancel bill"
          onConfirm={cancelBill}
          onCancel={() => setVoiding(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
