import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { api, ApiError, setUnauthenticatedHandler, type Role } from './api';
import { setCurrencySymbol } from './format';
import type { Alerts, Batch, Bootstrap, Customer, Product, Sale, Settings } from './types';

export type Theme = 'light' | 'dark';
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

export type LockState = 'checking' | 'setup' | 'login' | 'open';

interface Store {
  ready: boolean;
  loadError: string | null;
  lock: LockState;
  minPasscodeLength: number;
  /** Who is signed in, by name. Null before the first check. */
  user: { id: string; name: string; role: Role } | null;
  role: Role | null;
  /** True for an owner session, or a counter session under manager override. */
  isAdmin: boolean;
  /** Seconds left on a manager override, 0 when not elevated. */
  elevatedFor: number;
  /** The owner who approved the current manager override. */
  elevatedBy: string | null;
  refreshRole: () => Promise<void>;
  dropElevation: () => Promise<void>;
  unlock: () => void;
  signOut: () => Promise<void>;
  settings: Settings;
  products: Product[];
  batches: Batch[];
  customers: Customer[];
  recentSales: Sale[];
  alerts: Alerts;

  theme: Theme;
  toggleTheme: () => void;

  toasts: Toast[];
  notify: (tone: ToastTone, title: string, message?: string) => void;
  dismissToast: (id: number) => void;
  /** Shows an API failure as an error toast and returns false, for `if (!await guard())`. */
  reportError: (error: unknown, fallback?: string) => void;

  reload: () => Promise<void>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setBatches: React.Dispatch<React.SetStateAction<Batch[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  registerSale: (sale: Sale) => void;
}

const StoreContext = createContext<Store | null>(null);

const EMPTY_ALERTS: Alerts = { lowStock: [], expiringSoon: [], expired: [] };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState>('checking');
  const [minPasscodeLength, setMinPasscodeLength] = useState(4);
  const [user, setUser] = useState<{ id: string; name: string; role: Role } | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [elevatedFor, setElevatedFor] = useState(0);
  const [elevatedBy, setElevatedBy] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({} as Settings);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [alerts, setAlerts] = useState<Alerts>(EMPTY_ALERTS);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('dawakhana.theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dawakhana.theme', theme);
  }, [theme]);

  const toastId = useRef(0);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((tone: ToastTone, title: string, message?: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-3), { id, tone, title, message }]);
    window.setTimeout(() => dismissToast(id), tone === 'error' ? 6500 : 3800);
  }, [dismissToast]);

  const reportError = useCallback((error: unknown, fallback = 'Something went wrong.') => {
    const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
    notify('error', 'Could not complete that', message);
  }, [notify]);

  const applyBootstrap = useCallback((data: Bootstrap) => {
    setSettings(data.settings);
    setCurrencySymbol(data.settings.currencySymbol);
    setProducts(data.products);
    setBatches(data.batches);
    setCustomers(data.customers);
    setRecentSales(data.recentSales);
    setAlerts(data.alerts ?? EMPTY_ALERTS);
  }, []);

  const reload = useCallback(async () => {
    try {
      applyBootstrap(await api.bootstrap());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load shop data.');
      throw error;
    }
  }, [applyBootstrap]);

  const loadShop = useCallback(async () => {
    try {
      applyBootstrap(await api.bootstrap());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load shop data.');
    }
  }, [applyBootstrap]);

  // Ask who we are before asking for data: an unlocked till loads straight
  // through, a fresh one goes to passcode setup.
  const checkLock = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setMinPasscodeLength(status.minLength);
      setUser(status.user);
      setRole(status.role);
      setIsAdmin(status.isAdmin);
      setElevatedFor(status.elevatedForSeconds);
      setElevatedBy(status.elevatedBy);
      if (!status.required || status.authenticated) {
        setLock('open');
        await loadShop();
      } else {
        setLock(status.configured ? 'login' : 'setup');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not reach the Dawakhana server.');
      setLock('open');
    } finally {
      setReady(true);
    }
  }, [loadShop]);

  useEffect(() => { void checkLock(); }, [checkLock]);

  // Any 401 from anywhere drops the whole till back to the lock screen.
  useEffect(() => {
    setUnauthenticatedHandler(() => setLock('login'));
    return () => setUnauthenticatedHandler(null);
  }, []);

  const refreshRole = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setUser(status.user);
      setRole(status.role);
      setIsAdmin(status.isAdmin);
      setElevatedFor(status.elevatedForSeconds);
      setElevatedBy(status.elevatedBy);
    } catch {
      /* the next gated call will surface it */
    }
  }, []);

  const dropElevation = useCallback(async () => {
    await api.authDropElevation().catch(() => undefined);
    await refreshRole();
  }, [refreshRole]);

  // Count the manager override down so the till visibly returns to staff.
  useEffect(() => {
    if (elevatedFor <= 0) return;
    const timer = window.setInterval(() => {
      setElevatedFor((seconds) => {
        if (seconds <= 1) {
          setIsAdmin(role === 'admin');
          setElevatedBy(null);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [elevatedFor, role]);

  const unlock = useCallback(() => {
    setLock('open');
    void refreshRole();
    void loadShop();
  }, [loadShop, refreshRole]);

  const signOut = useCallback(async () => {
    await api.authLogout().catch(() => undefined);
    setUser(null);
    setRole(null);
    setIsAdmin(false);
    setElevatedFor(0);
    setElevatedBy(null);
    setLock('login');
  }, []);

  // Stock and credit move on every sale, so refresh the derived alert lists.
  const refreshAlerts = useCallback(() => {
    api.alerts().then(setAlerts).catch(() => undefined);
  }, []);

  const registerSale = useCallback((sale: Sale) => {
    setRecentSales((current) => [sale, ...current].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50));
    setBatches((current) =>
      current.map((batch) => {
        const sold = sale.items.filter((i) => i.batchId === batch.id).reduce((s, i) => s + i.qty, 0);
        return sold ? { ...batch, quantity: batch.quantity - sold } : batch;
      }),
    );
    if (sale.customerId && sale.due > 0) {
      setCustomers((current) =>
        current.map((c) =>
          c.id === sale.customerId ? { ...c, creditBalance: Math.round((c.creditBalance + sale.due) * 100) / 100 } : c,
        ),
      );
    }
    setSettings((current) => ({ ...current, nextInvoiceSeq: current.nextInvoiceSeq + 1 }));
    refreshAlerts();
  }, [refreshAlerts]);

  useEffect(() => {
    if (settings.currencySymbol) setCurrencySymbol(settings.currencySymbol);
  }, [settings.currencySymbol]);

  const value = useMemo<Store>(() => ({
    ready, loadError, lock, minPasscodeLength, unlock, signOut,
    user, role, isAdmin, elevatedFor, elevatedBy, refreshRole, dropElevation,
    settings, products, batches, customers, recentSales, alerts,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    toasts, notify, dismissToast, reportError,
    reload, setProducts, setBatches, setCustomers, setSettings, registerSale,
  }), [
    ready, loadError, lock, minPasscodeLength, unlock, signOut,
    user, role, isAdmin, elevatedFor, elevatedBy, refreshRole, dropElevation,
    settings, products, batches, customers, recentSales, alerts,
    theme, toasts, notify, dismissToast, reportError, reload, registerSale,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <AppProvider>.');
  return store;
}

/** Live stock for a product across every sellable (unexpired, in-stock) batch. */
export function stockFor(batches: Batch[], productId: string, today: string) {
  return batches.reduce(
    (sum, b) => (b.productId === productId && b.quantity > 0 && b.expiry >= today ? sum + b.quantity : sum),
    0,
  );
}

/** Sellable batches for a product, nearest expiry first so old stock moves first. */
export function batchesFor(batches: Batch[], productId: string, today: string) {
  return batches
    .filter((b) => b.productId === productId && b.quantity > 0 && b.expiry >= today)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}
