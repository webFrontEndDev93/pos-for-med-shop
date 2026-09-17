import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { money, todayISO } from '../lib/format';
import type { Batch, Product } from '../lib/types';
import { Button, Field, Modal } from './ui';

export function BatchForm({
  product, batch, onClose,
}: {
  product: Product;
  batch: Batch | null;
  onClose: () => void;
}) {
  const { setBatches, notify, reportError } = useStore();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Batch>>(
    batch ?? {
      productId: product.id,
      batchNo: '',
      expiry: '',
      mrp: 0,
      salePrice: 0,
      costPrice: 0,
      quantity: 0,
      supplier: '',
      receivedAt: todayISO(),
    },
  );

  const set = <K extends keyof Batch>(key: K, value: Batch[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const margin = useMemo(() => {
    const sale = Number(draft.salePrice) || 0;
    const cost = Number(draft.costPrice) || 0;
    if (sale <= 0 || cost <= 0) return null;
    return Math.round(((sale - cost) / sale) * 1000) / 10;
  }, [draft.salePrice, draft.costPrice]);

  const invalid =
    !draft.batchNo?.trim() ||
    !draft.expiry ||
    !(Number(draft.mrp) > 0) ||
    !(Number(draft.salePrice) > 0) ||
    Number(draft.salePrice) > Number(draft.mrp);

  const save = async () => {
    setSaving(true);
    try {
      if (batch) {
        const updated = await api.updateBatch(batch.id, draft);
        setBatches((current) => current.map((b) => (b.id === updated.id ? updated : b)));
        notify('success', 'Batch updated', `${product.name} · ${updated.batchNo}`);
      } else {
        const created = await api.createBatch({ ...draft, productId: product.id });
        setBatches((current) => [...current, created]);
        notify('success', 'Stock received', `${created.quantity} × ${product.name} (${created.batchNo})`);
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
      title={batch ? `Edit batch ${batch.batchNo}` : `Receive stock — ${product.name}`}
      subtitle="MRP and sale price include sales tax, exactly as printed on the pack."
      width="38rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={invalid || saving}>
            {saving ? 'Saving…' : batch ? 'Save batch' : 'Add to stock'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Batch number">
          <input
            className="input mono"
            value={draft.batchNo ?? ''}
            onChange={(e) => set('batchNo', e.target.value.toUpperCase())}
            placeholder="PAN2417"
          />
        </Field>
        <Field
          label="Expiry date"
          error={draft.expiry && draft.expiry < todayISO() ? 'This date has already passed.' : undefined}
        >
          <input
            className="input"
            type="date"
            value={draft.expiry ?? ''}
            onChange={(e) => set('expiry', e.target.value)}
          />
        </Field>
        <Field label="Printed MRP">
          <input
            className="input input--num"
            type="number"
            step="0.01"
            min={0}
            value={draft.mrp || ''}
            onChange={(e) => set('mrp', Number(e.target.value))}
          />
        </Field>
        <Field
          label="Sale price"
          error={Number(draft.salePrice) > Number(draft.mrp) ? 'Cannot be more than the MRP.' : undefined}
          hint="Leave equal to MRP if you do not discount."
        >
          <input
            className="input input--num"
            type="number"
            step="0.01"
            min={0}
            value={draft.salePrice || ''}
            onChange={(e) => set('salePrice', Number(e.target.value))}
          />
        </Field>
        <Field label="Purchase cost" hint={margin === null ? 'Used for profit reporting.' : `Margin: ${margin}%`}>
          <input
            className="input input--num"
            type="number"
            step="0.01"
            min={0}
            value={draft.costPrice || ''}
            onChange={(e) => set('costPrice', Number(e.target.value))}
          />
        </Field>
        <Field label="Quantity">
          <input
            className="input input--num"
            type="number"
            min={0}
            value={draft.quantity ?? 0}
            onChange={(e) => set('quantity', Number(e.target.value))}
          />
        </Field>
        <Field label="Supplier">
          <input
            className="input"
            value={draft.supplier ?? ''}
            onChange={(e) => set('supplier', e.target.value)}
            placeholder="Muller &amp; Phipps Pakistan"
          />
        </Field>
        <Field label="Received on">
          <input
            className="input"
            type="date"
            value={draft.receivedAt ?? todayISO()}
            onChange={(e) => set('receivedAt', e.target.value)}
          />
        </Field>
        <div className="span-2">
          <div
            className="row-between"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <span className="secondary">Stock value at cost</span>
            <strong className="num">
              {money((Number(draft.quantity) || 0) * (Number(draft.costPrice) || 0))}
            </strong>
          </div>
        </div>
      </div>
    </Modal>
  );
}
