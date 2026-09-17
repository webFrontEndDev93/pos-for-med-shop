import { useStore } from '../lib/store';
import { Icon, type IconName } from './Icon';
import { Button } from './ui';
import type { Route } from '../routes';

interface NavEntry {
  route: Route;
  label: string;
  icon: IconName;
  shortcut: string;
  /** Screens the counter passcode cannot open without an owner override. */
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { route: 'billing', label: 'Billing', icon: 'billing', shortcut: 'F1' },
  { route: 'inventory', label: 'Inventory', icon: 'inventory', shortcut: 'F2' },
  { route: 'customers', label: 'Customers', icon: 'customers', shortcut: 'F3' },
  { route: 'reports', label: 'Reports', icon: 'reports', shortcut: 'F4', adminOnly: true },
  { route: 'settings', label: 'Settings', icon: 'settings', shortcut: 'F5', adminOnly: true },
];

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ route, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const { settings, alerts, theme, toggleTheme, isAdmin, role, elevatedFor, dropElevation } = useStore();
  const stockWarnings = alerts.lowStock.length + alerts.expired.length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Icon name="pill" size={18} strokeWidth={2} /></span>
        <div className="brand-text">
          <div className="brand-name">{settings.shopName || 'MediPOS'}</div>
          <div className="brand-tag">Point of sale</div>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        <span className="nav-label">Counter</span>
        {NAV.map((entry) => (
          <button
            key={entry.route}
            type="button"
            className="nav-item"
            aria-current={route === entry.route ? 'page' : undefined}
            onClick={() => onNavigate(entry.route)}
            title={
              entry.adminOnly && !isAdmin
                ? `${entry.label} — needs the owner passcode`
                : collapsed ? `${entry.label} (${entry.shortcut})` : undefined
            }
          >
            <Icon name={entry.icon} size={17} />
            <span>{entry.label}</span>
            {entry.route === 'inventory' && stockWarnings > 0 ? (
              <span className="nav-badge">{stockWarnings > 99 ? '99+' : stockWarnings}</span>
            ) : entry.adminOnly && !isAdmin ? (
              <Icon name="shield" size={13} style={{ marginLeft: 'auto', opacity: 0.55 }} />
            ) : (
              <kbd className="kbd">{entry.shortcut}</kbd>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        {role === 'staff' && (
          elevatedFor > 0 ? (
            <button
              type="button"
              className="role-chip role-chip--elevated"
              onClick={() => void dropElevation()}
              title="End owner access now"
            >
              <Icon name="shield" size={13} />
              {!collapsed && <span className="grow">Owner access · {elevatedFor}s</span>}
            </button>
          ) : (
            <span className="role-chip" title="Signed in with the counter passcode">
              <Icon name="user" size={13} />
              {!collapsed && <span className="grow">Counter</span>}
            </span>
          )
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={theme === 'dark' ? 'sun' : 'moon'}
          onClick={toggleTheme}
          block={!collapsed}
          iconOnly={collapsed}
          aria-label="Toggle colour theme"
        >
          {!collapsed && <span className="grow" style={{ textAlign: 'left' }}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={collapsed ? 'chevronRight' : 'chevronLeft'}
          onClick={onToggleCollapse}
          block={!collapsed}
          iconOnly={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {!collapsed && <span className="grow" style={{ textAlign: 'left' }}>Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}
