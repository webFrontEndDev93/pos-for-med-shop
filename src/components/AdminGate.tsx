import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Icon } from './Icon';
import { Button, Field, Modal } from './ui';

/**
 * Manager override.
 *
 * A counter session asks the owner to type their passcode, and the action goes
 * through without anyone signing out mid-queue — which is how a shop actually
 * handles "this bill needs cancelling".
 */
export function AdminGate({
  action, onClose, onElevated,
}: {
  /** What the owner is approving, e.g. "cancel this bill". */
  action: string;
  onClose: () => void;
  onElevated: () => void;
}) {
  const { refreshRole, notify } = useStore();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.authElevate(passcode);
      await refreshRole();
      notify('info', 'Owner access granted', 'It lapses again in a few minutes.');
      onElevated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check that passcode.');
      setPasscode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Owner passcode needed"
      subtitle={`The counter passcode cannot ${action}.`}
      width="26rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || passcode.length < 4}>
            {busy ? 'Checking…' : 'Approve'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <p className="row" style={{
          gap: 6, fontSize: 'var(--text-xs)', fontWeight: 550,
          color: 'var(--info)', background: 'var(--info-soft)',
          border: '1px solid var(--info-border)', borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2) var(--space-3)',
        }}>
          <Icon name="shield" size={13} />
          Ask the owner to enter their passcode — nobody needs to sign out.
        </p>
        <Field label="Owner passcode">
          <input
            className="input"
            type="password"
            autoFocus
            value={passcode}
            onChange={(e) => { setPasscode(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && passcode.length >= 4) void submit(); }}
            aria-label="Owner passcode"
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * Wraps an admin-only action. Owners get the plain callback; counter staff get
 * the override dialog first.
 */
export function useAdminAction() {
  const { isAdmin } = useStore();
  const [pending, setPending] = useState<{ action: string; run: () => void } | null>(null);

  const guard = (action: string, run: () => void) => () => {
    if (isAdmin) run();
    else setPending({ action, run });
  };

  const gate = pending ? (
    <AdminGate
      action={pending.action}
      onClose={() => setPending(null)}
      onElevated={() => { pending.run(); setPending(null); }}
    />
  ) : null;

  return { guard, gate };
}
