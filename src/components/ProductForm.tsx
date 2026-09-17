import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { Product } from '../lib/types';
import { Button, Field, Modal, Switch } from './ui';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Cream', 'Gel', 'Drops', 'Inhaler', 'Spray', 'Powder', 'Lozenge', 'Device', 'Other'];
const CATEGORIES = ['Analgesic', 'Antibiotic', 'Gastro', 'Cardiac', 'Diabetes', 'Respiratory', 'Antihistamine', 'Hormone', 'Supplement', 'Topical', 'Antiseptic', 'Cold & Flu', 'Electrolyte', 'Device', 'Consumable', 'General'];
const blankProduct = (defaultTaxRate: number): Partial<Product> => ({
  name: '', genericName: '', manufacturer: '', category: 'General', form: 'Tablet',
  strength: '', packSize: '', hsCode: '3004', taxRate: defaultTaxRate, unit: 'strip', rack: '',
  reorderLevel: 20, prescriptionRequired: false, barcode: '', notes: '',
});

export function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { settings, setProducts, notify, reportError } = useStore();
  const [draft, setDraft] = useState<Partial<Product>>(
    product ?? blankProduct(settings.defaultTaxRate ?? 0),
  );

  // The shop's own list, set in Settings. A rate already on this product stays
  // selectable even if it has since been removed from the list.
  const taxRates = settings.taxRates ?? [];
  const options = taxRates.some((r) => r.rate === draft.taxRate)
    ? taxRates
    : [...taxRates, { rate: draft.taxRate ?? 0, label: 'In use' }].sort((a, b) => a.rate - b.rate);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Product>(key: K, value: Product[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!draft.name?.trim()) return;
    setSaving(true);
    try {
      if (product) {
        const updated = await api.updateProduct(product.id, draft);
        setProducts((current) => current.map((p) => (p.id === updated.id ? updated : p)));
        notify('success', 'Medicine updated', updated.name);
      } else {
        const created = await api.createProduct(draft);
        setProducts((current) => [...current, created]);
        notify('success', 'Medicine added', `${created.name} — now add a batch to give it stock.`);
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
      title={product ? `Edit ${product.name}` : 'Add a medicine'}
      subtitle="Stock and prices live on batches, which you add separately."
      width="42rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!draft.name?.trim() || saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Add medicine'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-2">
          <Field label="Brand name">
            <input className="input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Panadol 500mg" />
          </Field>
        </div>
        <Field label="Generic name / salt">
          <input className="input" value={draft.genericName ?? ''} onChange={(e) => set('genericName', e.target.value)} placeholder="Paracetamol" />
        </Field>
        <Field label="Manufacturer">
          <input className="input" value={draft.manufacturer ?? ''} onChange={(e) => set('manufacturer', e.target.value)} placeholder="Getz Pharma" />
        </Field>
        <Field label="Category">
          <select className="select" value={draft.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Form">
          <select className="select" value={draft.form} onChange={(e) => set('form', e.target.value)}>
            {FORMS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Strength">
          <input className="input" value={draft.strength ?? ''} onChange={(e) => set('strength', e.target.value)} placeholder="500mg" />
        </Field>
        <Field label="Pack size">
          <input className="input" value={draft.packSize ?? ''} onChange={(e) => set('packSize', e.target.value)} placeholder="10 tablets" />
        </Field>
        <Field label="Sales tax rate" hint="Prices are entered inclusive of this rate. Edit the list in Settings.">
          <select className="select" value={draft.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))}>
            {options.map(({ rate, label }) => (
              <option key={rate} value={rate}>{rate}% — {label}</option>
            ))}
          </select>
        </Field>
        <Field label="HS code">
          <input className="input" value={draft.hsCode ?? ''} onChange={(e) => set('hsCode', e.target.value)} />
        </Field>
        <Field label="Rack / shelf" hint="Where to find it on the wall.">
          <input className="input" value={draft.rack ?? ''} onChange={(e) => set('rack', e.target.value)} placeholder="B3" />
        </Field>
        <Field label="Reorder level" hint="Warn when stock falls to this.">
          <input
            className="input input--num"
            type="number"
            min={0}
            value={draft.reorderLevel ?? 0}
            onChange={(e) => set('reorderLevel', Number(e.target.value))}
          />
        </Field>
        <div className="span-2">
          <Field label="Barcode" hint="Scanning this code finds the medicine at the till.">
            <input className="input mono" value={draft.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
          </Field>
        </div>
        <div className="span-2" style={{ paddingTop: 'var(--space-1)' }}>
          <Switch
            checked={Boolean(draft.prescriptionRequired)}
            onChange={(next) => set('prescriptionRequired', next)}
            label="Prescription only — the till will insist on an Rx reference"
          />
        </div>
      </div>
    </Modal>
  );
}
