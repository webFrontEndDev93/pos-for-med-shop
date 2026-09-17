import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { billTotals, lineTotals } from '../lib/pricing';
import { useStore } from '../lib/store';
import { expiryLabel, formatMonthYear, money, todayISO } from '../lib/format';
import type { Batch, CartLine, Customer, PaymentMode, Product, Sale } from '../lib/types';
import { Icon, type IconName } from '../components/Icon';
import { Badge, Button, EmptyState, Field, Modal } from '../components/ui';
import { ProductSearch, type SearchHandle } from '../components/ProductSearch';
import { BatchPicker } from '../components/BatchPicker';
import { CustomerPicker } from '../components/CustomerPicker';
import { Receipt } from '../components/Receipt';
import '../styles/billing.css';

/**
 * `title` carries the full meaning on hover and to screen readers; the button
 * face stays short enough for four tiles across the tender panel.
 *
 * 'credit' is udhaar — the bill goes on the customer's account. It is kept
 * distinct from 'card' so "Credit/Debit Card" can never be confused with it.
 */
const MODES: { mode: PaymentMode; label: string; title: string; icon: IconName }[] = [
  { mode: 'cash', label: 'Cash', title: 'Cash', icon: 'cash' },
  { mode: 'card', label: 'Card', title: 'Credit or debit card', icon: 'card' },
  { mode: 'digital', label: 'Digital', title: 'EasyPaisa, JazzCash, QR or bank transfer', icon: 'qr' },
  { mode: 'credit', label: 'Udhaar', title: 'Udhaar — put the bill on the customer’s account', icon: 'wallet' },
];

/** Notes a Pakistani till actually holds. */
const QUICK_CASH = [100, 500, 1000, 5000];

export function Billing() {
  const { settings, batches, notify, reportError, registerSale } = useStore();
  const today = todayISO();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [doctorName, setDoctorName] = useState('');
  const [prescriptionRef, setPrescriptionRef] = useState('');
  const [extraDiscount, setExtraDiscount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [tendered, setTendered] = useState('');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [batchFor, setBatchFor] = useState<CartLine | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  const searchRef = useRef<SearchHandle>(null);
  const keyCounter = useRef(0);

  const totals = useMemo(
    () => billTotals(lines, extraDiscount, settings.roundOffTotals !== false),
    [lines, extraDiscount, settings.roundOffTotals],
  );

  const rxRequired = useMemo(() => lines.some((l) => l.product.prescriptionRequired), [lines]);
  const cartCount = lines.reduce((sum, l) => sum + l.qty, 0);

  /** Live stock for a batch, minus whatever this bill has already claimed. */
  const availableFor = useCallback(
    (batch: Batch, excludeKey?: string) => {
      const live = batches.find((b) => b.id === batch.id)?.quantity ?? 0;
      const claimed = lines
        .filter((l) => l.batch.id === batch.id && l.key !== excludeKey)
        .reduce((s, l) => s + l.qty, 0);
      return live - claimed;
    },
    [batches, lines],
  );

  const addToCart = useCallback((product: Product, batch: Batch) => {
    setLines((current) => {
      const existing = current.find((l) => l.batch.id === batch.id);
      const live = batches.find((b) => b.id === batch.id)?.quantity ?? 0;
      const claimed = current.filter((l) => l.batch.id === batch.id).reduce((s, l) => s + l.qty, 0);

      if (claimed >= live) {
        notify('warning', 'No more stock', `Only ${live} of ${product.name} batch ${batch.batchNo} on hand.`);
        return current;
      }
      if (existing) {
        setFocusedKey(existing.key);
        return current.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + 1 } : l));
      }
      keyCounter.current += 1;
      const key = `line_${keyCounter.current}`;
      setFocusedKey(key);
      return [...current, { key, product, batch, qty: 1, discountPct: 0 }];
    });
  }, [batches, notify]);

  const setQty = (key: string, qty: number) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const ceiling = availableFor(line.batch, key);
        const next = Math.max(1, Math.min(Math.round(qty) || 1, Math.max(1, ceiling)));
        if (qty > ceiling && ceiling > 0) {
          notify('warning', 'Stock limit reached', `Only ${ceiling} left in batch ${line.batch.batchNo}.`);
        }
        return { ...line, qty: next };
      }),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((l) => l.key !== key));
    setFocusedKey((k) => (k === key ? null : k));
  };

  const clearBill = useCallback(() => {
    setLines([]);
    setCustomer(null);
    setDoctorName('');
    setPrescriptionRef('');
    setExtraDiscount(0);
    setPaymentMode('cash');
    setTendered('');
    setNote('');
    setFocusedKey(null);
  }, []);

  const checkout = useCallback(async () => {
    if (lines.length === 0) {
      notify('warning', 'Nothing to bill', 'Add at least one medicine first.');
      searchRef.current?.focus();
      return;
    }
    if (rxRequired && !prescriptionRef.trim()) {
      notify('warning', 'Prescription reference needed', 'This bill contains prescription-only medicine.');
      return;
    }
    if (paymentMode === 'credit' && !customer) {
      notify('warning', 'Customer required', 'Attach a customer before putting a bill on udhaar.');
      setPickingCustomer(true);
      return;
    }

    const paidNow = paymentMode === 'credit'
      ? Math.min(Math.max(Number(tendered) || 0, 0), totals.total)
      : totals.total;

    setBusy(true);
    try {
      const sale = await api.checkout({
        items: lines.map((l) => ({ batchId: l.batch.id, qty: l.qty, discountPct: l.discountPct })),
        extraDiscount,
        paymentMode,
        paid: paidNow,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? 'Walk-in',
        doctorName: doctorName || customer?.doctor || '',
        prescriptionRef,
        note,
      });
      registerSale(sale);
      setLastSale(sale);
      clearBill();
      notify('success', `Bill ${sale.invoiceNo} saved`, `${money(sale.total)} · ${sale.items.length} item(s)`);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [
    lines, rxRequired, prescriptionRef, paymentMode, customer, tendered, totals.total,
    extraDiscount, doctorName, note, notify, registerSale, clearBill, reportError,
  ]);

  // Counter shortcuts: F9 pay, F8 clear, / focus search, Esc drop focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

      if (event.key === 'F9') {
        event.preventDefault();
        void checkout();
      } else if (event.key === 'F8') {
        event.preventDefault();
        clearBill();
      } else if ((event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkout, clearBill]);

  const changeDue = paymentMode !== 'credit' && Number(tendered) > 0
    ? Math.max(0, Number(tendered) - totals.total)
    : 0;
  const creditDue = paymentMode === 'credit'
    ? Math.max(0, totals.total - Math.min(Number(tendered) || 0, totals.total))
    : 0;

  return (
    <div className="page page--flush">
      <div className="billing">
        {/* ------------------------------------------------------ cart side */}
        <section className="billing-left">
          <ProductSearch ref={searchRef} onPick={addToCart} cartCount={cartCount} />

          <div className="cart-scroll">
            {lines.length === 0 ? (
              <EmptyState
                icon="billing"
                title="No items in this bill yet"
                text="Search for a medicine above, or scan its barcode. Press ↑ ↓ to browse the results and Enter to add."
                action={
                  <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                    <span className="row" style={{ fontSize: 'var(--text-xs)' }}><kbd className="kbd">/</kbd> search</span>
                    <span className="row" style={{ fontSize: 'var(--text-xs)' }}><kbd className="kbd">F9</kbd> pay</span>
                    <span className="row" style={{ fontSize: 'var(--text-xs)' }}><kbd className="kbd">F8</kbd> clear</span>
                  </div>
                }
              />
            ) : (
              <table className="cart">
                <thead>
                  <tr>
                    <th style={{ width: '38%' }}>Medicine</th>
                    <th className="center" style={{ width: '7.5rem' }}>Qty</th>
                    <th className="right">Rate</th>
                    <th className="center" style={{ width: '5rem' }}>Disc %</th>
                    <th className="right">Amount</th>
                    <th style={{ width: '2.5rem' }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const computed = lineTotals(line);
                    const ceiling = availableFor(line.batch, line.key);
                    const days = Math.round(
                      (new Date(`${line.batch.expiry}T00:00:00`).getTime() -
                        new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
                    );
                    return (
                      <tr
                        key={line.key}
                        data-focused={focusedKey === line.key}
                        onClick={() => setFocusedKey(line.key)}
                      >
                        <td>
                          <div className="cart-name">
                            <span className="truncate">{line.product.name}</span>
                            {line.product.strength && line.product.strength !== '—' && (
                              <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--text-xs)' }}>
                                {line.product.strength}
                              </span>
                            )}
                            {line.product.prescriptionRequired && <Badge tone="info">Rx</Badge>}
                          </div>
                          <button
                            type="button"
                            className="cart-batch"
                            onClick={() => setBatchFor(line)}
                            title="Change batch"
                          >
                            B:{line.batch.batchNo} · Exp {formatMonthYear(line.batch.expiry)}
                            {days <= 90 && (
                              <span style={{ color: days <= 30 ? 'var(--danger)' : 'var(--warning)', fontWeight: 600 }}>
                                ({expiryLabel(line.batch.expiry)})
                              </span>
                            )}
                            <Icon name="edit" size={11} />
                          </button>
                        </td>

                        <td className="center">
                          <div className="stepper">
                            <button
                              type="button"
                              onClick={() => setQty(line.key, line.qty - 1)}
                              disabled={line.qty <= 1}
                              aria-label="Decrease quantity"
                            >
                              <Icon name="minus" size={13} />
                            </button>
                            <input
                              type="number"
                              value={line.qty}
                              min={1}
                              max={ceiling}
                              onChange={(e) => setQty(line.key, Number(e.target.value))}
                              aria-label={`Quantity of ${line.product.name}`}
                            />
                            <button
                              type="button"
                              onClick={() => setQty(line.key, line.qty + 1)}
                              disabled={line.qty >= ceiling}
                              aria-label="Increase quantity"
                            >
                              <Icon name="plus" size={13} />
                            </button>
                          </div>
                          <div className="cell-sub">{ceiling - line.qty} more in stock</div>
                        </td>

                        <td className="right num">
                          <div>{money(line.batch.salePrice)}</div>
                          {line.batch.salePrice < line.batch.mrp && (
                            <div className="cell-sub" style={{ textDecoration: 'line-through' }}>
                              {money(line.batch.mrp)}
                            </div>
                          )}
                        </td>

                        <td className="center">
                          <input
                            className="disc-input"
                            type="number"
                            min={0}
                            max={100}
                            value={line.discountPct || ''}
                            placeholder="0"
                            onChange={(e) =>
                              setLines((current) =>
                                current.map((l) =>
                                  l.key === line.key
                                    ? { ...l, discountPct: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) }
                                    : l,
                                ),
                              )
                            }
                            aria-label={`Discount percent on ${line.product.name}`}
                          />
                        </td>

                        <td className="right num" style={{ fontWeight: 620 }}>
                          {money(computed.net)}
                          {computed.discount > 0 && (
                            <div className="cell-sub" style={{ color: 'var(--success)' }}>
                              −{money(computed.discount)}
                            </div>
                          )}
                        </td>

                        <td className="right">
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            icon="trash"
                            onClick={() => removeLine(line.key)}
                            aria-label={`Remove ${line.product.name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="cart-foot">
            <span>{lines.length} line{lines.length === 1 ? '' : 's'} · {cartCount} unit{cartCount === 1 ? '' : 's'}</span>
            <div className="grow" />
            {totals.savings > 0 && (
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                Customer saves {money(totals.savings)}
              </span>
            )}
            {lines.length > 0 && (
              <Button variant="ghost" size="sm" icon="trash" onClick={clearBill} shortcut="F8">
                Clear
              </Button>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------- tender side */}
        <aside className="tender">
          <div className="tender-scroll">
            <section className="tender-section">
              <div className="tender-heading">
                <span>Customer</span>
                {customer && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setCustomer(null)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <button type="button" className="customer-chip" onClick={() => setPickingCustomer(true)}>
                <span className="customer-avatar">
                  {customer ? customer.name.slice(0, 1).toUpperCase() : <Icon name="user" size={14} />}
                </span>
                <span className="grow">
                  <span style={{ display: 'block', fontWeight: 580, fontSize: 'var(--text-sm)' }}>
                    {customer?.name ?? 'Walk-in customer'}
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {customer ? customer.phone || 'No phone on file' : 'Tap to attach a customer'}
                  </span>
                </span>
                {customer && customer.creditBalance > 0 && (
                  <Badge tone="warning">{money(customer.creditBalance)} due</Badge>
                )}
                <Icon name="chevronRight" size={15} className="muted" />
              </button>

              {rxRequired && (
                <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  <p
                    className="row"
                    style={{
                      gap: 6, fontSize: 'var(--text-xs)', fontWeight: 560,
                      color: 'var(--info)', background: 'var(--info-soft)',
                      border: '1px solid var(--info-border)', borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2) var(--space-3)',
                    }}
                  >
                    <Icon name="rx" size={13} />
                    This bill has prescription-only medicine.
                  </p>
                  <Field label="Prescription reference *">
                    <input
                      className="input"
                      placeholder="e.g. RX-99881"
                      value={prescriptionRef}
                      onChange={(e) => setPrescriptionRef(e.target.value)}
                      aria-invalid={!prescriptionRef.trim()}
                      aria-label="Prescription reference"
                    />
                  </Field>
                  <Field label="Prescribing doctor">
                    <input
                      className="input"
                      placeholder="Dr. S. Nair"
                      value={doctorName}
                      onChange={(e) => setDoctorName(e.target.value)}
                      aria-label="Prescribing doctor"
                    />
                  </Field>
                </div>
              )}
            </section>

            <section className="tender-section">
              <div className="tender-heading"><span>Bill summary</span></div>
              <div className="totals">
                <div className="totals-row">
                  <span>Gross</span><span className="value">{money(totals.gross)}</span>
                </div>
                {totals.lineDiscount > 0 && (
                  <div className="totals-row">
                    <span>Line discounts</span>
                    <span className="value" style={{ color: 'var(--success)' }}>−{money(totals.lineDiscount)}</span>
                  </div>
                )}
                <div className="totals-row">
                  <span>Bill discount</span>
                  <input
                    className="input input--num"
                    type="number"
                    min={0}
                    step="1"
                    value={extraDiscount || ''}
                    placeholder="0"
                    onChange={(e) => setExtraDiscount(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: '6rem', height: '2rem' }}
                    aria-label="Extra discount on the whole bill"
                  />
                </div>
                <div className="totals-divider" />
                <div className="totals-row totals-row--muted">
                  <span>Taxable value</span><span className="value">{money(totals.taxableValue)}</span>
                </div>
                <div className="totals-row totals-row--muted">
                  <span>Sales tax</span><span className="value">{money(totals.tax)}</span>
                </div>
                {totals.roundOff !== 0 && (
                  <div className="totals-row totals-row--muted">
                    <span>Round off</span><span className="value">{money(totals.roundOff)}</span>
                  </div>
                )}
              </div>

              <div className="grand">
                <span className="grand-label">Payable</span>
                <span className="grand-value">{money(totals.total)}</span>
              </div>
            </section>

            <section className="tender-section">
              <div className="tender-heading"><span>Payment</span></div>
              <div className="pay-modes">
                {MODES.map(({ mode, label, title, icon }) => (
                  <button
                    key={mode}
                    type="button"
                    className="pay-mode"
                    title={title}
                    aria-label={title}
                    aria-pressed={paymentMode === mode}
                    onClick={() => { setPaymentMode(mode); setTendered(''); }}
                  >
                    <Icon name={icon} size={16} />
                    {label}
                  </button>
                ))}
              </div>

              {paymentMode === 'digital' && (
                <p className="hint row" style={{ gap: 6 }}>
                  <Icon name="qr" size={12} />
                  EasyPaisa, JazzCash, QR or bank transfer — collected in full.
                </p>
              )}
              {paymentMode === 'card' && (
                <p className="hint row" style={{ gap: 6 }}>
                  <Icon name="card" size={12} />
                  Credit or debit card — collected in full.
                </p>
              )}

              {paymentMode === 'cash' && (
                <>
                  <Field label="Cash received">
                    <input
                      className="input input--num"
                      type="number"
                      placeholder="0"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                      aria-label="Cash received"
                    />
                  </Field>
                  <div className="quick-cash">
                    {QUICK_CASH.map((value) => (
                      <Button key={value} size="sm" onClick={() => setTendered(String(value))}>
                        {money(value).replace('.00', '')}
                      </Button>
                    ))}
                    <Button size="sm" onClick={() => setTendered(String(totals.total))}>Exact</Button>
                  </div>
                  {changeDue > 0 && (
                    <div className="totals-row" style={{ fontWeight: 650, color: 'var(--success)' }}>
                      <span>Return change</span><span className="value">{money(changeDue)}</span>
                    </div>
                  )}
                </>
              )}

              {paymentMode === 'credit' && (
                <>
                  <Field label="Paying now" hint="Leave at 0 to put the whole bill on udhaar.">
                    <input
                      className="input input--num"
                      type="number"
                      placeholder="0"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                      aria-label="Amount paid now"
                    />
                  </Field>
                  <div className="totals-row" style={{ fontWeight: 650, color: 'var(--warning)' }}>
                    <span>Goes on udhaar</span><span className="value">{money(creditDue)}</span>
                  </div>
                </>
              )}

              <input
                className="input"
                placeholder="Note on this bill (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Bill note"
              />
            </section>
          </div>

          <div className="tender-foot">
            <Button
              variant="primary"
              size="lg"
              block
              icon="check"
              shortcut="F9"
              onClick={() => void checkout()}
              disabled={busy || lines.length === 0}
            >
              {busy ? 'Saving…' : `Take payment · ${money(totals.total)}`}
            </Button>
            {lastSale && (
              <Button variant="ghost" size="sm" block icon="receipt" onClick={() => setLastSale(lastSale)}>
                Reprint {lastSale.invoiceNo}
              </Button>
            )}
          </div>
        </aside>
      </div>

      {batchFor && (
        <BatchPicker
          product={batchFor.product}
          currentBatchId={batchFor.batch.id}
          onPick={(batch) =>
            setLines((current) =>
              current.map((l) =>
                l.key === batchFor.key
                  ? { ...l, batch, qty: Math.min(l.qty, batch.quantity) }
                  : l,
              ),
            )
          }
          onClose={() => setBatchFor(null)}
        />
      )}

      {pickingCustomer && (
        <CustomerPicker
          onPick={(picked) => {
            setCustomer(picked);
            if (picked?.doctor && !doctorName) setDoctorName(picked.doctor);
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}

      {lastSale && (
        <Modal
          title={`Bill ${lastSale.invoiceNo}`}
          subtitle={`${money(lastSale.total)} · ${lastSale.customerName}`}
          width="24rem"
          onClose={() => setLastSale(null)}
          footer={
            <>
              <Button onClick={() => setLastSale(null)}>Close</Button>
              <Button variant="primary" icon="print" onClick={() => window.print()}>Print</Button>
            </>
          }
        >
          <Receipt sale={lastSale} settings={settings} />
        </Modal>
      )}
    </div>
  );
}
