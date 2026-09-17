import type {
  Alerts, AuditEntry, Batch, Bootstrap, Customer, Payment, Product, ReportSummary,
  Sale, Settings, User,
} from './types';

/** Error carrying the server's human-readable message, so the UI can just show it. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Called whenever the server says the session is gone, so the UI can re-lock. */
let onUnauthenticated: (() => void) | null = null;
export const setUnauthenticatedHandler = (fn: (() => void) | null) => {
  onUnauthenticated = fn;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the MediPOS server. Is it still running?');
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    // A dropped session anywhere in the app sends the whole till back to the lock screen.
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthenticated?.();
    throw new ApiError(response.status, data?.error ?? `Request failed (${response.status}).`);
  }
  return data as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export interface CheckoutPayload {
  items: { batchId: string; qty: number; discountPct: number }[];
  extraDiscount: number;
  paymentMode: string;
  paid: number;
  customerId: string | null;
  customerName: string;
  doctorName: string;
  prescriptionRef: string;
  note: string;
}

export type Role = 'admin' | 'staff';

export interface AuthStatus {
  required: boolean;
  configured: boolean;
  authenticated: boolean;
  user: { id: string; name: string; role: Role } | null;
  role: Role | null;
  isAdmin: boolean;
  elevatedForSeconds: number;
  elevatedBy: string | null;
  elevationSeconds: number;
  userCount: number;
  minLength: number;
  lockedForSeconds: number;
}

export interface BackupListing {
  folder: string;
  writable: boolean;
  error?: string;
  files: { name: string; size: number; at: string }[];
  last: { ok: boolean; at: string; file?: string; error?: string; reason: string } | null;
}

export const api = {
  authStatus: () => request<AuthStatus>('/auth/status'),
  authSetup: (body: { name: string; passcode: string; staffName: string; staffPasscode: string }) =>
    post<{ ok: true; user: User }>('/auth/setup', body),
  authLogin: (passcode: string) => post<{ ok: true; user: User }>('/auth/login', { passcode }),
  authLogout: () => post<{ ok: true }>('/auth/logout'),
  authElevate: (passcode: string) =>
    post<{ ok: true; elevatedForSeconds: number; approvedBy: string }>('/auth/elevate', { passcode }),

  users: () => request<User[]>('/users'),
  createUser: (body: { name: string; role: Role; passcode: string }) => post<User>('/users', body),
  updateUser: (id: string, body: Partial<User> & { passcode?: string }) => put<User>(`/users/${id}`, body),
  deleteUser: (id: string) => del<{ id: string }>(`/users/${id}`),

  audit: (query: Record<string, string> = {}) =>
    request<AuditEntry[]>(`/audit?${new URLSearchParams(query)}`),
  authDropElevation: () => post<{ ok: true }>('/auth/drop-elevation'),

  backups: () => request<BackupListing>('/backups'),
  runBackup: () => post<{ ok: boolean; file?: string; error?: string }>('/backup'),

  bootstrap: () => request<Bootstrap>('/bootstrap'),
  alerts: () => request<Alerts>('/alerts'),

  createProduct: (body: Partial<Product>) => post<Product>('/products', body),
  updateProduct: (id: string, body: Partial<Product>) => put<Product>(`/products/${id}`, body),
  deleteProduct: (id: string) => del<Product>(`/products/${id}`),

  createBatch: (body: Partial<Batch>) => post<Batch>('/batches', body),
  updateBatch: (id: string, body: Partial<Batch>) => put<Batch>(`/batches/${id}`, body),
  deleteBatch: (id: string) => del<Batch>(`/batches/${id}`),

  createCustomer: (body: Partial<Customer>) => post<Customer>('/customers', body),
  updateCustomer: (id: string, body: Partial<Customer>) => put<Customer>(`/customers/${id}`, body),
  deleteCustomer: (id: string) => del<Customer>(`/customers/${id}`),
  ledger: (id: string) =>
    request<{ customer: Customer; sales: Sale[]; payments: Payment[] }>(`/customers/${id}/ledger`),

  sales: (query: Record<string, string> = {}) =>
    request<Sale[]>(`/sales?${new URLSearchParams(query)}`),
  checkout: (body: CheckoutPayload) => post<Sale>('/sales', body),
  voidSale: (id: string) => post<Sale>(`/sales/${id}/void`),

  settleCredit: (body: { customerId: string; amount: number; mode: string; note: string }) =>
    post<{ payment: Payment; customer: Customer }>('/payments', body),

  report: (from: string, to: string) =>
    request<ReportSummary>(`/reports/summary?${new URLSearchParams({ from, to })}`),

  settings: () => request<Settings>('/settings'),
  updateSettings: (body: Partial<Settings>) => put<Settings>('/settings', body),

  backup: () => request<unknown>('/backup'),
  restore: (body: unknown) => post<{ ok: true }>('/restore', body),
};
