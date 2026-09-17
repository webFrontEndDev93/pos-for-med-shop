import { Fragment, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { stockFor, useStore } from '../lib/store';
import { daysUntil, expiryLabel, formatDate, fuzzyScore, money, moneyShort, todayISO } from '../lib/format';
import type { Batch, Product } from '../lib/types';
import { Icon } from '../components/Icon';
import { Badge, Button, ConfirmDialog, EmptyState, Stat } from '../components/ui';
import { useAdminAction } from '../components/AdminGate';
import { ProductForm } from '../components/ProductForm';
import { BatchForm } from '../components/BatchForm';
import '../styles/pages.css';

type Lens = 'all' | 'low' | 'expiring' | 'expired' | 'out';
type SortKey = 'name' | 'stock' | 'value' | 'expiry';

const LENS_LABEL: Record<Lens, string> = {
  all: 'All medicines',
  low: 'Low stock',
  expiring: 'Expiring soon',
  expired: 'Expired',
  out: 'Out of stock',
};

interface Row {
  product: Product;
  batches: Batch[];
  stock: number;
  expiredQty: number;
  value: number;
  nearestExpiry: string | null;
}

export function Inventory() {
  const { products, batches, settings, alerts, setProducts, setBatches, notify, reportError, isAdmin } = useStore();
  // Prices and the catalogue are owner territory; staff are offered the override.
  const { guard, gate } = useAdminAction();
  const today = todayISO();

  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<Lens>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [batchTarget, setBatchTarget] = useState<{ product: Product; batch: Batch | null } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'product' | 'batch'; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(products.map((p) => p.category))).sort()],
    [products],
  );

  const rows = useMemo<Row[]>(() => {
    const window = settings.expiryAlertDays ?? 90;

    const built = products.map((product) => {
      const own = batches
        .filter((b) => b.productId === product.id)
        .sort((a, b) => a.expiry.localeCompare(b.expiry));
      const live = own.filter((b) => b.quantity > 0);
      return {
        product,
        batches: own,
        stock: stockFor(batches, product.id, today),
        expiredQty: live.filter((b) => b.expiry < today).reduce((s, b) => s + b.quantity, 0),
        value: live.reduce((s, b) => s + b.quantity * b.costPrice, 0),
        nearestExpiry: live.find((b) => b.expiry >= today)?.expiry ?? null,
      };
    });

    const filtered = built.filter((row) => {
      if (category !== 'all' && row.product.category !== category) return false;

      if (lens === 'low' && !(row.stock > 0 && row.stock <= (row.product.reorderLevel || settings.lowStockThreshold))) return false;
      if (lens === 'out' && row.stock > 0) return false;
      if (lens === 'expired' && row.expiredQty === 0) return false;
      if (lens === 'expiring') {
        const days = row.nearestExpiry ? daysUntil(row.nearestExpiry) : Infinity;
        if (!(days <= window)) return false;
      }

      if (query.trim()) {
        const best = [row.product.name, row.product.genericName, row.product.manufacturer, row.product.barcode]
          .filter(Boolean)
          .map((hay) => fuzzyScore(hay, query))
          .filter((score) => score >= 0);
        if (best.length === 0) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === 'stock') return a.stock - b.stock;
      if (sort === 'value') return b.value - a.value;
      if (sort === 'expiry') {
        if (!a.nearestExpiry) return 1;
        if (!b.nearestExpiry) return -1;
        return a.nearestExpiry.localeCompare(b.nearestExpiry);
      }
      return a.product.name.localeCompare(b.product.name);
    });
  }, [products, batches, query, lens, category, sort, today, settings]);

  const stockValue = useMemo(
    () => batches.reduce((s, b) => s + Math.max(0, b.quantity) * b.costPrice, 0),
    [batches],
  );
  const expiredValue = useMemo(
    () => alerts.expired.reduce((s, a) => s + a.value, 0),
    [alerts.expired],
  );

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      if (deleting.kind === 'product') {
        await api.deleteProduct(deleting.id);
        setProducts((current) => current.filter((p) => p.id !== deleting.id));
        setBatches((current) => current.filter((b) => b.productId !== deleting.id));
      } else {
        await api.deleteBatch(deleting.id);
        setBatches((current) => current.filter((b) => b.id !== deleting.id));
      }
      notify('success', 'Removed', deleting.label);
      setDeleting(null);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleLens = (next: Lens) => setLens((current) => (current === next ? 'all' : next));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-sub">
            {products.length} medicines · {batches.filter((b) => b.quantity > 0).length} live batches ·{' '}
            {money(stockValue)} at cost
          </p>
        </div>
        <div className="row">
          <Button
            icon={isAdmin ? 'plus' : 'shield'}
            variant="primary"
            onClick={guard('add a medicine', () => setAddingProduct(true))}
          >
            Add medicine
          </Button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <Stat label="Stock value" value={moneyShort(stockValue)} foot="At purchase cost" tone="brand" icon="box" />
        <Stat
          label="Low stock"
          value={alerts.lowStock.length}
          foot="At or below reorder level"
          tone={alerts.lowStock.length ? 'warning' : 'success'}
          icon="trendDown"
        />
        <Stat
          label={`Expiring in ${settings.expiryAlertDays ?? 90} days`}
          value={alerts.expiringSoon.length}
          foot="Batches to move or return"
          tone={alerts.expiringSoon.length ? 'warning' : 'success'}
          icon="clock"
        />
        <Stat
          label="Expired stock"
          value={alerts.expired.length}
          foot={expiredValue > 0 ? `${money(expiredValue)} to write off` : 'Nothing expired'}
          tone={alerts.expired.length ? 'danger' : 'success'}
          icon="alert"
        />
      </div>

      {(alerts.expired.length > 0 || alerts.lowStock.length > 0 || alerts.expiringSoon.length > 0) && (
        <div className="alert-strip">
          {alerts.expired.length > 0 && (
            <button
              type="button"
              className="alert-card alert-card--danger"
              aria-pressed={lens === 'expired'}
              onClick={() => toggleLens('expired')}
            >
              <Icon name="alert" size={18} />
              <span className="grow">
                <span className="alert-count">{alerts.expired.length}</span>
                <span className="alert-text" style={{ display: 'block' }}>
                  expired batches still on the shelf — pull them today
                </span>
              </span>
            </button>
          )}
          {alerts.expiringSoon.length > 0 && (
            <button
              type="button"
              className="alert-card alert-card--warning"
              aria-pressed={lens === 'expiring'}
              onClick={() => toggleLens('expiring')}
            >
              <Icon name="clock" size={18} />
              <span className="grow">
                <span className="alert-count">{alerts.expiringSoon.length}</span>
                <span className="alert-text" style={{ display: 'block' }}>
                  batches expiring within {settings.expiryAlertDays ?? 90} days
                </span>
              </span>
            </button>
          )}
          {alerts.lowStock.length > 0 && (
            <button
              type="button"
              className="alert-card alert-card--info"
              aria-pressed={lens === 'low'}
              onClick={() => toggleLens('low')}
            >
              <Icon name="trendDown" size={18} />
              <span className="grow">
                <span className="alert-count">{alerts.lowStock.length}</span>
                <span className="alert-text" style={{ display: 'block' }}>
                  medicines at or below reorder level
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      <div className="toolbar">
        <div className="search-slim">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder="Search medicines…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="seg">
          {(['all', 'low', 'expiring', 'expired', 'out'] as Lens[]).map((value) => (
            <button key={value} type="button" aria-pressed={lens === value} onClick={() => setLens(value)}>
              {LENS_LABEL[value]}
            </button>
          ))}
        </div>

        <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>

        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="name">Sort: name</option>
          <option value="stock">Sort: least stock</option>
          <option value="value">Sort: highest value</option>
          <option value="expiry">Sort: nearest expiry</option>
        </select>

        <div className="grow" />
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{rows.length} shown</span>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <EmptyState
            icon="inventory"
            title="Nothing matches those filters"
            text="Try clearing the search or switching back to all medicines."
            action={<Button onClick={() => { setQuery(''); setLens('all'); setCategory('all'); }}>Reset filters</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Medicine</th>
                  <th>Category</th>
                  <th className="right">Stock</th>
                  <th>Nearest expiry</th>
                  <th className="right">Price</th>
                  <th className="right">Value</th>
                  <th style={{ width: '9rem' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const low = row.stock > 0 && row.stock <= (row.product.reorderLevel || settings.lowStockThreshold);
                  const sellable = row.batches.find((b) => b.quantity > 0 && b.expiry >= today);
                  const open = expanded === row.product.id;
                  const days = row.nearestExpiry ? daysUntil(row.nearestExpiry) : null;

                  return (
                    <Fragment key={row.product.id}>
                      <tr>
                        <td>
                          <div className="cell-title row" style={{ gap: 'var(--space-2)' }}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm btn--icon"
                              onClick={() => setExpanded(open ? null : row.product.id)}
                              aria-label={open ? 'Hide batches' : 'Show batches'}
                              aria-expanded={open}
                            >
                              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                            </button>
                            <span className="truncate">{row.product.name}</span>
                            {row.product.strength && row.product.strength !== '—' && (
                              <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--text-xs)' }}>
                                {row.product.strength}
                              </span>
                            )}
                            {row.product.prescriptionRequired && <Badge tone="info">Rx</Badge>}
                          </div>
                          <div className="cell-sub" style={{ paddingLeft: '2.4rem' }}>
                            {row.product.genericName || '—'} · {row.product.manufacturer}
                            {row.product.rack && ` · Rack ${row.product.rack}`}
                          </div>
                        </td>

                        <td><Badge tone="neutral">{row.product.category}</Badge></td>

                        <td className="right">
                          <div className="num" style={{ fontWeight: 620 }}>{row.stock}</div>
                          <div className="cell-sub">
                            {row.stock === 0 ? (
                              <span style={{ color: 'var(--danger)' }}>out of stock</span>
                            ) : low ? (
                              <span style={{ color: 'var(--warning)' }}>reorder at {row.product.reorderLevel}</span>
                            ) : (
                              `${row.product.unit}s`
                            )}
                          </div>
                        </td>

                        <td>
                          {row.nearestExpiry ? (
                            <>
                              <div>{formatDate(row.nearestExpiry)}</div>
                              <div className="cell-sub">{expiryLabel(row.nearestExpiry)}</div>
                              <div className="expiry-bar">
                                <span
                                  style={{
                                    width: `${Math.max(4, Math.min(100, ((days ?? 0) / 365) * 100))}%`,
                                    background:
                                      (days ?? 0) <= 30 ? 'var(--danger)' : (days ?? 0) <= 90 ? 'var(--warning)' : 'var(--success)',
                                  }}
                                />
                              </div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {row.expiredQty > 0 && (
                            <div style={{ marginTop: 4 }}>
                              <Badge tone="danger">{row.expiredQty} expired</Badge>
                            </div>
                          )}
                        </td>

                        <td className="right num">{sellable ? money(sellable.salePrice) : <span className="muted">—</span>}</td>
                        <td className="right num">{money(row.value)}</td>

                        <td className="right">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                            <Button
                              size="sm"
                              icon={isAdmin ? 'plus' : 'shield'}
                              onClick={guard('receive stock', () => setBatchTarget({ product: row.product, batch: null }))}
                            >
                              Stock
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              iconOnly
                              icon="edit"
                              onClick={guard('edit a medicine', () => setEditingProduct(row.product))}
                              aria-label={`Edit ${row.product.name}`}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              iconOnly
                              icon="trash"
                              onClick={guard('delete a medicine', () => setDeleting({ kind: 'product', id: row.product.id, label: row.product.name }))}
                              aria-label={`Delete ${row.product.name}`}
                            />
                          </div>
                        </td>
                      </tr>

                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--surface-2)', padding: 0 }}>
                            <div style={{ padding: 'var(--space-4) var(--space-5) var(--space-4) 3.5rem' }}>
                              {row.batches.length === 0 ? (
                                <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                                  No batches yet — use “Stock” to receive the first one.
                                </p>
                              ) : (
                                <table className="data" style={{ background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
                                  <thead>
                                    <tr>
                                      <th>Batch</th>
                                      <th>Expiry</th>
                                      <th>Supplier</th>
                                      <th className="right">Qty</th>
                                      <th className="right">Cost</th>
                                      <th className="right">MRP</th>
                                      <th className="right">Sale</th>
                                      <th style={{ width: '5rem' }} />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.batches.map((batch) => {
                                      const expired = batch.expiry < today;
                                      const left = daysUntil(batch.expiry);
                                      return (
                                        <tr key={batch.id}>
                                          <td className="mono">{batch.batchNo}</td>
                                          <td>
                                            <Badge tone={expired ? 'danger' : left <= 90 ? 'warning' : 'success'}>
                                              {formatDate(batch.expiry)}
                                            </Badge>
                                          </td>
                                          <td className="muted">{batch.supplier || '—'}</td>
                                          <td className="right num">{batch.quantity}</td>
                                          <td className="right num">{money(batch.costPrice)}</td>
                                          <td className="right num">{money(batch.mrp)}</td>
                                          <td className="right num" style={{ fontWeight: 600 }}>{money(batch.salePrice)}</td>
                                          <td className="right">
                                            <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                iconOnly
                                                icon="edit"
                                                onClick={guard('change a price', () => setBatchTarget({ product: row.product, batch }))}
                                                aria-label={`Edit batch ${batch.batchNo}`}
                                              />
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                iconOnly
                                                icon="trash"
                                                onClick={guard('delete a batch', () =>
                                                  setDeleting({
                                                    kind: 'batch',
                                                    id: batch.id,
                                                    label: `${row.product.name} · batch ${batch.batchNo}`,
                                                  }),
                                                )}
                                                aria-label={`Delete batch ${batch.batchNo}`}
                                              />
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {gate}

      {(addingProduct || editingProduct) && (
        <ProductForm
          product={editingProduct}
          onClose={() => { setAddingProduct(false); setEditingProduct(null); }}
        />
      )}

      {batchTarget && (
        <BatchForm
          product={batchTarget.product}
          batch={batchTarget.batch}
          onClose={() => setBatchTarget(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={deleting.kind === 'product' ? 'Delete this medicine?' : 'Delete this batch?'}
          message={
            <>
              <strong>{deleting.label}</strong> will be removed
              {deleting.kind === 'product' ? ', along with all of its batches' : ''}. Anything already
              billed keeps its record. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
