import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Icon } from './Icon';
import { Button } from './ui';
import '../styles/lock.css';

/**
 * The passcode gate. Doubles as first-run setup, because a till that ships
 * unlocked tends to stay unlocked.
 */
export function Lock({
  mode, minLength, onUnlocked,
}: {
  mode: 'setup' | 'login';
  minLength: number;
  onUnlocked: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [staffPasscode, setStaffPasscode] = useState('');
  const [name, setName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, [mode]);

  // Count the lockout down in front of the user rather than leaving them guessing.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = window.setInterval(() => setLockedFor((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [lockedFor]);

  const setup = mode === 'setup';
  const tooShort = passcode.length < minLength;
  const mismatch = setup && confirm.length > 0 && passcode !== confirm;
  const staffTooShort = setup && staffPasscode.length > 0 && staffPasscode.length < minLength;
  const staffSame = setup && staffPasscode.length > 0 && staffPasscode === passcode;
  const blocked =
    busy || lockedFor > 0 || tooShort || staffTooShort || staffSame ||
    (setup && (passcode !== confirm || !name.trim() ||
      (staffPasscode.length > 0 && !staffName.trim())));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (setup) await api.authSetup({ name, passcode, staffName, staffPasscode });
      else await api.authLogin(passcode);
      onUnlocked();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not sign in.';
      setError(message);
      const match = /in (\d+) seconds/.exec(message);
      if (match) setLockedFor(Number(match[1]));
      setPasscode('');
      setConfirm('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-mark"><Icon name="pill" size={24} strokeWidth={2} /></div>

        <h1 className="lock-title">{setup ? 'Set up the till' : 'MediPOS'}</h1>
        <p className="lock-sub">
          {setup
            ? `Your own name and passcode. Every bill records who rang it up, so each person on the till needs their own — at least ${minLength} characters.`
            : 'Enter your passcode to open the counter.'}
        </p>

        {setup && (
          <label className="lock-field">
            <span className="label">Your name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bilal"
              disabled={busy}
              aria-label="Owner name"
              style={{ letterSpacing: 'normal' }}
            />
          </label>
        )}

        <label className="lock-field">
          <span className="label">{setup ? 'Your passcode (owner)' : 'Passcode'}</span>
          <input
            ref={input}
            className="input"
            type="password"
            value={passcode}
            autoComplete={setup ? 'new-password' : 'current-password'}
            onChange={(e) => { setPasscode(e.target.value); setError(null); }}
            disabled={busy || lockedFor > 0}
            aria-label={setup ? 'New passcode' : 'Passcode'}
          />
        </label>

        {setup && (
          <>
            <label className="lock-field">
              <span className="label">Confirm owner passcode</span>
              <input
                className="input"
                type="password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                aria-label="Confirm passcode"
              />
            </label>
            <label className="lock-field">
              <span className="label">Counter person — optional</span>
              <input
                className="input"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="e.g. Ayesha"
                disabled={busy}
                aria-label="Counter name"
                style={{ letterSpacing: 'normal' }}
              />
              <input
                className="input"
                type="password"
                value={staffPasscode}
                autoComplete="new-password"
                onChange={(e) => setStaffPasscode(e.target.value)}
                disabled={busy}
                aria-label="Counter passcode"
                placeholder="Their passcode"
              />
              <span className="hint">
                They can bill and look up stock, but cannot cancel bills, see takings,
                change prices or open Settings. Add more people later in Settings.
              </span>
            </label>
          </>
        )}

        {mismatch && <p className="lock-error">Those two do not match.</p>}
        {staffTooShort && (
          <p className="lock-error">The counter passcode needs at least {minLength} characters too.</p>
        )}
        {staffSame && <p className="lock-error">Each person needs a different passcode — it is how the till tells them apart.</p>}
        {setup && staffPasscode.length > 0 && !staffName.trim() && (
          <p className="lock-error">Give the counter person a name too.</p>
        )}
        {error && <p className="lock-error">{error}</p>}
        {lockedFor > 0 && (
          <p className="lock-error">Locked for {lockedFor} more second{lockedFor === 1 ? '' : 's'}.</p>
        )}

        <Button type="submit" variant="primary" size="lg" block disabled={blocked}>
          {busy ? 'Checking…' : setup ? 'Set passcode and open' : 'Unlock'}
        </Button>

        <p className="lock-foot">
          {setup
            ? 'Write your passcode somewhere safe. There is no way to recover it — you would have to delete server/data/auth.json and start again.'
            : 'Forgot it? Delete server/data/auth.json on this computer and restart MediPOS to set a new one.'}
        </p>
      </form>
    </div>
  );
}
