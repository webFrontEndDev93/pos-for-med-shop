import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { formatDate, formatDateTime, money, moneyShort, relativeTime } from '../lib/format';
import type { Customer, Payment, Sale } from '../lib/types';
import { Icon } from '../components/Icon';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, Stat } from '../components/ui';
import { Receipt } from '../components/Receipt';
import { useAdminAction } from '../components/AdminGate';
import '../styles/pages.css';

type Lens = 'all' | 'credit';

export function Customers() {
  const { customers, settings, setCustomers, notify, reportError, isAdmin } = useStore();
  const { guard, gate } = useAdminAction();
  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<Lens>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ sales: Sale[]; payments: Payment[] } | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = customers.find((c) => c.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customers
      .filter((c) => (lens === 'credit' ? c.creditBalance > 0 : true))
      .filter((c) =>
        !needle ||
        c.name.toLowerCase().includes(needle) ||
        c.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, '')) ||
        c.doctor.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.creditBalance - a.creditBalance || a.name.localeCompare(b.name));
  }, [customers, query, lens]);

  const outstanding = useMemo(() => customers.reduce((s, c) => s + c.creditBalance, 0), [customers]);
  const withCredit = customers.filter((c) => c.creditBalance > 0).length;

  useEffect(() => {
    if (!selectedId) {
      setLedger(null);
      return;
    }
    let cancelled = false;
    setLoadingLedger(true);
    api.ledger(selectedId)
      .then((data) => !cancelled && setLedger({ sales: data.sales, payments: data.payments }))
      .catch(() => !cancelled && setLedger({ sales: [], payments: [] }))
      .finally(() => !cancelled && setLoadingLedger(false));
    return () => { cancelled = true; };
  }, [selectedId]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteCustomer(deleting.id);
      setCustomers((current) => current.filter((c) => c.id !== deleting.id));
      if (selectedId === deleting.id) setSelectedId(null);
      notify('success', 'Customer removed', deleting.name);
      setDeleting(null);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const spend = useMemo(() => {
    if (!ledger) return { total: 0, bills: 0, lastAt: null as string | null };
    const live = ledger.sales.filter((s) => s.status !== 'void');
    return {
      total: live.reduce((s, x) => s + x.total, 0),
      bills: live.length,
      lastAt: live[0]?.at ?? null,
    };
  }, [ledger]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">{customers.length} on file · {withCredit} with an outstanding balance</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add customer</Button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <Stat label="Udhaar outstanding" value={moneyShort(outstanding)} foot="Money owed to the shop" tone={outstanding > 0 ? 'warning' : 'success'} icon="wallet" />
        <Stat label="On udhaar" value={withCredit} foot="Customers with a balance" tone="info" icon="customers" />
        <Stat label="Total customers" value={customers.length} foot="Including walk-ins you saved" tone="brand" icon="user" />
      </div>

      <div className="panel-grid">
        <div className="card">
          <div className="card-head">
            <div className="toolbar" style={{ margin: 0, flex: 1 }}>
              <div className="search-slim">
                <Icon name="search" size={15} />
                <input
                  className="input"
                  placeholder="Search by name, phone or doctor…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="seg">
                <button type="button" aria-pressed={lens === 'all'} onClick={() => setLens('all')}>Everyone</button>
                <button type="button" aria-pressed={lens === 'credit'} onClick={() => setLens('credit')}>Owes money</button>
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="customers"
              title={lens === 'credit' ? 'Nobody owes anything' : 'No customers match'}
              text={lens === 'credit' ? 'Every udhaar bill has been settled.' : 'Try a different search, or add them now.'}
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Doctor</th>
                    <th className="right">Balance</th>
                    <th style={{ width: '10rem' }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() => setSelectedId(customer.id)}
                      style={{ cursor: 'pointer', background: selectedId === customer.id ? 'var(--brand-soft)' : undefined }}
                    >
                      <td>
                        <div className="row">
                          <span className="customer-avatar" style={{ width: '1.75rem', height: '1.75rem' }}>
                            {customer.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <div className="cell-title">{customer.name}</div>
                            <div className="cell-sub">{customer.address || 'No address'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{customer.phone || <span className="muted">—</span>}</td>
                      <td className="muted">{customer.doctor || '—'}</td>
                      <td className="right">
                        {customer.creditBalance > 0 ? (
                          <Badge tone="warning">{money(customer.creditBalance)}</Badge>
                        ) : (
                          <span className="muted">Settled</span>
                        )}
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                          {customer.creditBalance > 0 && (
                            <Button size="sm" icon="wallet" onClick={(e) => { e.stopPropagation(); setSettling(customer); }}>
                              Settle
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm" iconOnly icon="edit"
                            onClick={(e) => { e.stopPropagation(); setEditing(customer); }}
                            aria-label={`Edit ${customer.name}`}
                          />
                          <Button
                            variant="ghost" size="sm" iconOnly icon={isAdmin ? 'trash' : 'shield'}
                            onClick={(e) => { e.stopPropagation(); guard('remove a customer', () => setDeleting(customer))(); }}
                            aria-label={`Delete ${customer.name}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- ledger */}
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          {!selected ? (
            <EmptyState
              icon="receipt"
              title="Pick a customer"
              text="Their purchase history, prescriptions and udhaar ledger appear here."
            />
          ) : (
            <>
              <div className="card-head">
                <div className="row">
                  <span className="customer-avatar">{selected.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <div className="card-title">{selected.name}</div>
                    <div className="cell-sub">{selected.phone || 'No phone on file'}</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" iconOnly icon="close" onClick={() => setSelectedId(null)} aria-label="Close panel" />
              </div>

              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div>
                    <div className="stat-label">Lifetime spend</div>
                    <div style={{ fontWeight: 660, fontVariantNumeric: 'tabular-nums' }}>{money(spend.total)}</div>
                  </div>
                  <div>
                    <div className="stat-label">Bills</div>
                    <div style={{ fontWeight: 660 }}>{spend.bills}</div>
                  </div>
                  <div>
                    <div className="stat-label">Balance</div>
                    <div style={{ fontWeight: 660, color: selected.creditBalance > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {money(selected.creditBalance)}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Last visit</div>
                    <div style={{ fontWeight: 560, fontSize: 'var(--text-sm)' }}>
                      {spend.lastAt ? relativeTime(spend.lastAt) : '—'}
                    </div>
                  </div>
                </div>

                {selected.creditBalance > 0 && (
                  <Button variant="primary" icon="wallet" block onClick={() => setSettling(selected)}>
                    Settle {money(selected.creditBalance)}
                  </Button>
                )}

                <div>
                  <div className="tender-heading" style={{ marginBottom: 'var(--space-2)' }}>
                    <span>Recent activity</span>
                  </div>

                  {loadingLedger ? (
                    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: '2.5rem' }} />)}
                    </div>
                  ) : !ledger || (ledger.sales.length === 0 && ledger.payments.length === 0) ? (
                    <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>No purchases recorded yet.</p>
                  ) : (
                    <div style={{ maxHeight: '22rem', overflowY: 'auto' }}>
                      {[
                        ...ledger.sales.map((s) => ({ kind: 'sale' as const, at: s.at, sale: s })),
                        ...ledger.payments.map((p) => ({ kind: 'payment' as const, at: p.at, payment: p })),
                      ]
                        .sort((a, b) => b.at.localeCompare(a.at))
                        .slice(0, 30)
                        .map((entry) =>
                          entry.kind === 'sale' ? (
                            <button
                              key={entry.sale.id}
                              type="button"
                              className="ledger-row"
                              style={{ width: '100%', textAlign: 'left' }}
                              onClick={() => setViewingSale(entry.sale)}
                            >
                              <span
                                className="ledger-icon"
                                style={{ background: 'var(--brand-soft)', color: 'var(--brand-text)' }}
                              >
                                <Icon name="receipt" size={14} />
                              </span>
                              <span className="grow">
                                <span style={{ display: 'block', fontWeight: 560 }}>
                                  {entry.sale.invoiceNo}
                                  {entry.sale.status === 'void' && <Badge tone="danger">cancelled</Badge>}
                                </span>
                                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                                  {formatDate(entry.sale.at)} · {entry.sale.items.length} item(s)
                                  {entry.sale.prescriptionRef && ` · ${entry.sale.prescriptionRef}`}
                                </span>
                              </span>
                              <span className="num" style={{ fontWeight: 600 }}>{money(entry.sale.total)}</span>
                            </button>
                          ) : (
                            <div key={entry.payment.id} className="ledger-row">
                              <span
                                className="ledger-icon"
                                style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
                              >
                                <Icon name="check" size={14} />
                              </span>
                              <span className="grow">
                                <span style={{ display: 'block', fontWeight: 560 }}>Payment received</span>
                                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                                  {formatDateTime(entry.payment.at)} · {entry.payment.mode.toUpperCase()}
                                </span>
                              </span>
                              <span className="num" style={{ fontWeight: 600, color: 'var(--success)' }}>
                                −{money(entry.payment.amount)}
                              </span>
                            </div>
                          ),
                        )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {gate}

      {(adding || editing) && (
        <CustomerForm customer={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}

      {settling && (
        <SettleDialog
          customer={settling}
          onClose={() => setSettling(null)}
          onSettled={() => setSelectedId((id) => id)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove this customer?"
          message={<><strong>{deleting.name}</strong> will be removed from the customer list. Their past bills stay on record.</>}
          confirmLabel="Remove"
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
          busy={busy}
        />
      )}

      {viewingSale && (
        <Modal
          title={`Bill ${viewingSale.invoiceNo}`}
          subtitle={`${money(viewingSale.total)} · ${formatDateTime(viewingSale.at)}`}
          width="24rem"
          onClose={() => setViewingSale(null)}
          footer={
            <>
              <Button onClick={() => setViewingSale(null)}>Close</Button>
              <Button variant="primary" icon="print" onClick={() => window.print()}>Print</Button>
            </>
          }
        >
          <Receipt sale={viewingSale} settings={settings} />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { setCustomers, notify, reportError } = useStore();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Customer>>(
    customer ?? { name: '', phone: '', email: '', address: '', doctor: '', notes: '' },
  );
  const set = <K extends keyof Customer>(key: K, value: Customer[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!draft.name?.trim()) return;
    setSaving(true);
    try {
      if (customer) {
        const updated = await api.updateCustomer(customer.id, draft);
        setCustomers((current) => current.map((c) => (c.id === updated.id ? updated : c)));
        notify('success', 'Customer updated', updated.name);
      } else {
        const created = await api.createCustomer(draft);
        setCustomers((current) => [...current, created]);
        notify('success', 'Customer added', created.name);
      }
      onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={customer ? `Edit ${customer.name}` : 'Add a customer'}
      width="34rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!draft.name?.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name">
          <input className="input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+92 300 1234567" />
        </Field>
        <Field label="Referring doctor">
          <input className="input" value={draft.doctor ?? ''} onChange={(e) => set('doctor', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <div className="span-2">
          <Field label="Address">
            <input className="input" value={draft.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Notes" hint="Allergies, chronic conditions, anything worth remembering.">
            <textarea className="textarea" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function SettleDialog({
  customer, onClose, onSettled,
}: {
  customer: Customer;
  onClose: () => void;
  onSettled: () => void;
}) {
  const { setCustomers, notify, reportError } = useStore();
  const [amount, setAmount] = useState(String(customer.creditBalance));
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > customer.creditBalance;

  const submit = async () => {
    setSaving(true);
    try {
      const { customer: updated } = await api.settleCredit({ customerId: customer.id, amount: value, mode, note });
      setCustomers((current) => current.map((c) => (c.id === updated.id ? updated : c)));
      notify('success', 'Payment recorded', `${money(value)} from ${customer.name}`);
      onSettled();
      onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Settle udhaar — ${customer.name}`}
      subtitle={`Outstanding balance ${money(customer.creditBalance)}`}
      width="28rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={invalid || saving}>
            {saving ? 'Saving…' : `Record ${money(value)}`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Field
          label="Amount received"
          error={value > customer.creditBalance ? 'More than the outstanding balance.' : undefined}
        >
          <input
            className="input input--num"
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Paid by">
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Credit / debit card</option>
            <option value="digital">Digital (EasyPaisa, JazzCash, QR)</option>
          </select>
        </Field>
        <Field label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}
