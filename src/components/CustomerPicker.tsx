import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { money } from '../lib/format';
import type { Customer } from '../lib/types';
import { Icon } from './Icon';
import { Badge, Button, Field, Modal } from './ui';

/** Attach a customer to the bill, creating one inline if they are new. */
export function CustomerPicker({
  onPick, onClose,
}: {
  onPick: (customer: Customer | null) => void;
  onClose: () => void;
}) {
  const { customers, setCustomers, notify, reportError } = useStore();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', doctor: '', address: '' });

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers.slice(0, 40);
    return customers
      .filter((c) => c.name.toLowerCase().includes(needle) || c.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, '')))
      .slice(0, 40);
  }, [customers, query]);

  const save = async () => {
    setSaving(true);
    try {
      const created = await api.createCustomer(draft);
      setCustomers((current) => [...current, created]);
      notify('success', 'Customer added', created.name);
      onPick(created);
      onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <Modal
        title="New customer"
        subtitle="Only a name is required — the rest can be filled in later."
        width="30rem"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Back</Button>
            <Button variant="primary" onClick={save} disabled={!draft.name.trim() || saving}>
              {saving ? 'Saving…' : 'Add customer'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Field label="Full name">
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Ramesh Kulkarni"
            />
          </Field>
          <Field label="Phone" hint="Used to find the customer next time.">
            <input
              className="input"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+92 300 1234567"
            />
          </Field>
          <Field label="Referring doctor">
            <input
              className="input"
              value={draft.doctor}
              onChange={(e) => setDraft({ ...draft, doctor: e.target.value })}
              placeholder="Dr. S. Nair"
            />
          </Field>
          <Field label="Address">
            <input
              className="input"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Attach customer"
      subtitle="Needed for udhaar bills and for keeping a purchase history."
      width="32rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => { onPick(null); onClose(); }}>Walk-in (no record)</Button>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New customer</Button>
        </>
      }
    >
      <input
        className="input"
        placeholder="Search by name or phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 'var(--space-4)' }}
        autoComplete="off"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {matches.length === 0 && (
          <p className="muted" style={{ fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-5)' }}>
            No customer matches that. Use “New customer” to add them.
          </p>
        )}
        {matches.map((customer) => (
          <button
            key={customer.id}
            type="button"
            className="customer-chip"
            onClick={() => { onPick(customer); onClose(); }}
          >
            <span className="customer-avatar">{customer.name.slice(0, 1).toUpperCase()}</span>
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 580, fontSize: 'var(--text-sm)' }}>{customer.name}</span>
              <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                {customer.phone || 'No phone on file'}
                {customer.doctor && ` · ${customer.doctor}`}
              </span>
            </span>
            {customer.creditBalance > 0 && <Badge tone="warning">{money(customer.creditBalance)} due</Badge>}
            <Icon name="chevronRight" size={15} className="muted" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
