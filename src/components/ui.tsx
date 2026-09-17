import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* ---------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'subtle-danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconOnly?: boolean;
  block?: boolean;
  shortcut?: string;
}

export function Button({
  variant = 'default', size = 'md', icon, iconOnly, block, shortcut, children, className = '', ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    iconOnly ? 'btn--icon' : '',
    block ? 'btn--block' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={classes} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {shortcut && <kbd className="kbd">{shortcut}</kbd>}
    </button>
  );
}

/* ----------------------------------------------------------------- badge */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- modal */

interface ModalProps {
  title: string;
  subtitle?: string;
  width?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, subtitle, width = '34rem', onClose, footer, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  // Callers routinely pass an inline arrow for onClose, so its identity changes
  // on every render of the parent. Read it through a ref and keep both effects
  // mount-only: depending on it re-ran the autofocus below on every keystroke,
  // which yanked the caret back to the first field mid-typing.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
      // Keep tabbing inside the dialog while it is open.
      if (event.key === 'Tab' && panel.current) {
        // Disabled and hidden controls never receive focus, so including them
        // meant the "are we on the last one?" check could never match and the
        // trap silently let focus escape — a dialog whose Save button starts
        // disabled leaked on the very first pass.
        const focusable = [
          ...panel.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Focus the first field once, when the dialog opens — and hand focus back to
  // whatever opened it on the way out.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const target = panel.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), textarea, select, button.btn--primary',
      );
      target?.focus();
    }, 40);

    return () => {
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ ['--modal-w' as string]: width }}
      >
        <header className="modal-head">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" iconOnly icon="close" onClick={onClose} aria-label="Close" />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- fields */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <span className="switch" onClick={() => onChange(!checked)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------------- empty */

export function EmptyState({
  icon = 'box', title, text, action,
}: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ stat */

export function Stat({
  label, value, foot, tone = 'brand', icon,
}: { label: string; value: ReactNode; foot?: ReactNode; tone?: BadgeTone; icon?: IconName }) {
  const colors: Record<BadgeTone, string> = {
    neutral: 'var(--text-muted)',
    brand: 'var(--brand)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    info: 'var(--info)',
  };
  return (
    <div className="stat">
      <span className="stat-accent" style={{ background: colors[tone] }} />
      <div className="stat-label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- confirm */

export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onCancel, busy,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      width="26rem"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="secondary" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{message}</p>
    </Modal>
  );
}
