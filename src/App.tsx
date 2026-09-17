import { useCallback, useEffect, useState } from 'react';
import { Lock } from './components/Lock';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { Icon } from './components/Icon';
import { Button } from './components/ui';
import { useStore } from './lib/store';
import { ROUTE_TITLES, routeFromHash, type Route } from './routes';
import { Billing } from './pages/Billing';
import { Inventory } from './pages/Inventory';
import { Customers } from './pages/Customers';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';

const SHORTCUTS: Record<string, Route> = {
  F1: 'billing',
  F2: 'inventory',
  F3: 'customers',
  F4: 'reports',
  F5: 'settings',
};

export default function App() {
  const { ready, loadError, reload, settings, lock, minPasscodeLength, unlock } = useStore();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('medipos.sidebar') === 'collapsed',
  );
  const [clock, setClock] = useState(() => new Date());

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    window.location.hash = `#/${next}`;
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    localStorage.setItem('medipos.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // F1–F5 jump between screens the way a till operator expects.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = SHORTCUTS[event.key];
      if (target && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigate(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    document.title = `${ROUTE_TITLES[route]} · ${settings.shopName || 'MediPOS'}`;
  }, [route, settings.shopName]);

  if (!ready) {
    return (
      <div className="boot">
        <span className="spinner" />
        <p style={{ fontSize: 'var(--text-sm)' }}>Opening the shop…</p>
      </div>
    );
  }

  if (lock === 'setup' || lock === 'login') {
    return <Lock mode={lock} minLength={minPasscodeLength} onUnlocked={unlock} />;
  }

  if (loadError) {
    return (
      <div className="boot">
        <div className="card" style={{ maxWidth: '30rem', padding: 'var(--space-6)', textAlign: 'center' }}>
          <span className="empty-icon" style={{ margin: '0 auto var(--space-4)' }}>
            <Icon name="alert" size={22} />
          </span>
          <h1 style={{ fontSize: 'var(--text-md)', color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
            Cannot reach the shop data
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>{loadError}</p>
          <Button variant="primary" icon="refresh" onClick={() => void reload()}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-collapsed={collapsed}>
      <Sidebar
        route={route}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{ROUTE_TITLES[route]}</span>
          <div className="grow" />
          <span className="topbar-clock">
            {clock.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
            {' · '}
            {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </header>

        {route === 'billing' && <Billing />}
        {route === 'inventory' && <Inventory />}
        {route === 'customers' && <Customers />}
        {route === 'reports' && <Reports />}
        {route === 'settings' && <SettingsPage />}
      </div>

      <Toasts />
    </div>
  );
}
