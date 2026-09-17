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
  const blocked = busy || lockedFor > 0 || tooShort || (setup && passcode !== confirm);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (setup) await api.authSetup(passcode);
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

        <h1 className="lock-title">{setup ? 'Set a passcode' : 'MediPOS'}</h1>
        <p className="lock-sub">
          {setup
            ? `Choose a passcode for this till — at least ${minLength} characters. Everyone who uses the counter will need it.`
            : 'Enter the shop passcode to open the counter.'}
        </p>

        <label className="lock-field">
          <span className="label">{setup ? 'New passcode' : 'Passcode'}</span>
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
          <label className="lock-field">
            <span className="label">Confirm passcode</span>
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
        )}

        {mismatch && <p className="lock-error">Those two do not match.</p>}
        {error && <p className="lock-error">{error}</p>}
        {lockedFor > 0 && (
          <p className="lock-error">Locked for {lockedFor} more second{lockedFor === 1 ? '' : 's'}.</p>
        )}

        <Button type="submit" variant="primary" size="lg" block disabled={blocked}>
          {busy ? 'Checking…' : setup ? 'Set passcode and open' : 'Unlock'}
        </Button>

        <p className="lock-foot">
          {setup
            ? 'Write it somewhere safe. There is no way to recover it — you would have to delete server/data/auth.json and set a new one.'
            : 'Forgot it? Delete server/data/auth.json on this computer and restart MediPOS to set a new one.'}
        </p>
      </form>
    </div>
  );
}
