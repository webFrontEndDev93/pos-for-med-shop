import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { money } from '../lib/format';
import type { Settings } from '../lib/types';
import { Icon } from '../components/Icon';
import { Button, ConfirmDialog, Field, Stat, Switch } from '../components/ui';
import '../styles/pages.css';

export function SettingsPage() {
  const {
    settings, products, batches, customers, recentSales,
    setSettings, notify, reportError, reload, theme, toggleTheme,
  } = useStore();

  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<unknown | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(draft);
      setSettings(updated);
      setDraft(updated);
      notify('success', 'Settings saved', 'New bills will use these details.');
    } catch (error) {
      reportError(error);
    } finally {
      setSaving(false);
    }
  };

  const downloadBackup = async () => {
    try {
      const data = await api.backup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `medipos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify('success', 'Backup downloaded', 'Keep a copy somewhere off this machine.');
    } catch (error) {
      reportError(error);
    }
  };

  const pickRestoreFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setRestoring(JSON.parse(String(reader.result)));
      } catch {
        notify('error', 'That file is not readable', 'Pick a MediPOS backup saved from this screen.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const confirmRestore = async () => {
    setBusy(true);
    try {
      await api.restore(restoring);
      setRestoring(null);
      await reload();
      notify('success', 'Backup restored', 'The shop data has been replaced.');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const liveBatches = batches.filter((b) => b.quantity > 0).length;
  const stockValue = batches.reduce((s, b) => s + Math.max(0, b.quantity) * b.costPrice, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Shop details printed on every bill, plus data backup.</p>
        </div>
        <div className="row">
          {dirty && <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>Unsaved changes</span>}
          <Button onClick={() => setDraft(settings)} disabled={!dirty}>Discard</Button>
          <Button variant="primary" icon="check" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Shop identity</div>
              <div className="cell-sub">Printed at the top of every receipt.</div>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <div className="span-2">
                <Field label="Shop name">
                  <input className="input" value={draft.shopName ?? ''} onChange={(e) => set('shopName', e.target.value)} />
                </Field>
              </div>
              <Field label="Address line 1">
                <input className="input" value={draft.addressLine1 ?? ''} onChange={(e) => set('addressLine1', e.target.value)} />
              </Field>
              <Field label="Address line 2">
                <input className="input" value={draft.addressLine2 ?? ''} onChange={(e) => set('addressLine2', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input className="input" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="input" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="GSTIN">
                <input className="input mono" value={draft.gstin ?? ''} onChange={(e) => set('gstin', e.target.value)} />
              </Field>
              <Field label="Drug licence number">
                <input className="input mono" value={draft.drugLicense ?? ''} onChange={(e) => set('drugLicense', e.target.value)} />
              </Field>
              <div className="span-2">
                <Field label="Registered pharmacist" hint="Shown at the bottom of the bill.">
                  <input className="input" value={draft.pharmacist ?? ''} onChange={(e) => set('pharmacist', e.target.value)} />
                </Field>
              </div>
              <div className="span-2">
                <Field label="Receipt footer note">
                  <textarea className="textarea" value={draft.footerNote ?? ''} onChange={(e) => set('footerNote', e.target.value)} />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Billing behaviour</div>
              <div className="cell-sub">How the till numbers and warns.</div>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Invoice prefix" hint={`Next bill: ${draft.invoicePrefix}-${String(new Date().getFullYear()).slice(-2)}-${String(draft.nextInvoiceSeq ?? 1).padStart(5, '0')}`}>
                <input className="input mono" value={draft.invoicePrefix ?? ''} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Next invoice number">
                <input
                  className="input input--num" type="number" min={1}
                  value={draft.nextInvoiceSeq ?? 1}
                  onChange={(e) => set('nextInvoiceSeq', Number(e.target.value))}
                />
              </Field>
              <Field label="Currency symbol">
                <input className="input" value={draft.currencySymbol ?? ''} onChange={(e) => set('currencySymbol', e.target.value)} />
              </Field>
              <Field label="Low stock threshold" hint="Used when a medicine has no reorder level of its own.">
                <input
                  className="input input--num" type="number" min={0}
                  value={draft.lowStockThreshold ?? 20}
                  onChange={(e) => set('lowStockThreshold', Number(e.target.value))}
                />
              </Field>
              <Field label="Expiry warning window (days)" hint="Batches inside this window show up as expiring soon.">
                <input
                  className="input input--num" type="number" min={1}
                  value={draft.expiryAlertDays ?? 90}
                  onChange={(e) => set('expiryAlertDays', Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="setting-row" style={{ marginTop: 'var(--space-4)' }}>
              <div>
                <div className="setting-name">Round bill totals to the nearest rupee</div>
                <div className="setting-desc">Adds a round-off line to the bill so the customer pays a whole number.</div>
              </div>
              <Switch checked={draft.roundOffTotals !== false} onChange={(next) => set('roundOffTotals', next)} label="" />
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-name">Dark mode</div>
                <div className="setting-desc">Easier on the eyes for a late counter shift. Saved on this device.</div>
              </div>
              <Switch checked={theme === 'dark'} onChange={toggleTheme} label="" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Data</div>
              <div className="cell-sub">Everything lives in a single JSON file on this machine.</div>
            </div>
          </div>
          <div className="card-body">
            <div className="stat-grid" style={{ marginBottom: 'var(--space-5)' }}>
              <Stat label="Medicines" value={products.length} foot={`${liveBatches} batches in stock`} tone="brand" icon="pill" />
              <Stat label="Customers" value={customers.length} foot="Including credit accounts" tone="info" icon="customers" />
              <Stat label="Recent bills" value={recentSales.length} foot="Last 50 kept in memory" tone="neutral" icon="receipt" />
              <Stat label="Stock value" value={money(stockValue)} foot="At purchase cost" tone="success" icon="box" />
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-name">Download a backup</div>
                <div className="setting-desc">
                  Saves medicines, batches, customers, bills and settings as one JSON file. Do this at the
                  end of each day and keep the copy off this machine.
                </div>
              </div>
              <Button icon="download" onClick={downloadBackup}>Download</Button>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-name">Restore from a backup</div>
                <div className="setting-desc">
                  Replaces everything currently in the shop with the contents of the file. The server keeps
                  a copy of the current data first, so a mistaken restore can be undone from
                  <code style={{ margin: '0 4px' }}>server/data/backups</code>.
                </div>
              </div>
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json"
                  className="sr-only"
                  onChange={pickRestoreFile}
                />
                <Button variant="subtle-danger" icon="upload" onClick={() => fileInput.current?.click()}>
                  Choose file
                </Button>
              </>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Keyboard shortcuts</div></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--space-3)' }}>
              {[
                ['F1 – F5', 'Jump between screens'],
                ['/ or Ctrl+K', 'Focus the medicine search'],
                ['↑ ↓ then Enter', 'Pick a medicine from the results'],
                ['F9', 'Take payment for the open bill'],
                ['F8', 'Clear the open bill'],
                ['Esc', 'Close a dialog or clear the search'],
              ].map(([keys, what]) => (
                <div className="row-between" key={keys} style={{ fontSize: 'var(--text-sm)' }}>
                  <span className="secondary">{what}</span>
                  <kbd className="kbd" style={{ padding: '0 var(--space-2)' }}>{keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="muted row" style={{ fontSize: 'var(--text-xs)', gap: 6, justifyContent: 'center', paddingBottom: 'var(--space-5)' }}>
          <Icon name="pill" size={13} />
          MediPOS · runs entirely on this machine · no internet needed
        </p>
      </div>

      {restoring !== null && (
        <ConfirmDialog
          title="Replace all shop data?"
          message="Everything currently in MediPOS — medicines, stock, customers and bills — will be replaced by the contents of this backup file. The current data is copied into server/data/backups first."
          confirmLabel="Restore backup"
          onConfirm={confirmRestore}
          onCancel={() => setRestoring(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
