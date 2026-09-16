import { useStore } from '../lib/store';
import { Icon, type IconName } from './Icon';

const ICONS: Record<string, IconName> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'sparkles',
};

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} onClick={() => dismissToast(toast.id)}>
          <Icon name={ICONS[toast.tone]} size={16} style={{ marginTop: 2 }} />
          <div className="grow">
            <div className="toast-title">{toast.title}</div>
            {toast.message && <div className="toast-msg">{toast.message}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
