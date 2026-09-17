/** One selectable row in the shop's sales-tax rate list. */
export interface TaxRateOption {
  rate: number;
  label: string;
}

export interface Settings {
  shopName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  ntn: string;
  strn: string;
  drugLicense: string;
  pharmacist: string;
  currency: string;
  currencySymbol: string;
  invoicePrefix: string;
  nextInvoiceSeq: number;
  lowStockThreshold: number;
  expiryAlertDays: number;
  defaultTaxRate: number;
  taxRates: TaxRateOption[];
  roundOffTotals: boolean;
  backupEnabled: boolean;
  backupIntervalHours: number;
  backupKeep: number;
  backupFolder: string;
  footerNote: string;
}

export interface Product {
  id: string;
  name: string;
  genericName: string;
  manufacturer: string;
  category: string;
  form: string;
  strength: string;
  packSize: string;
  hsCode: string;
  taxRate: number;
  unit: string;
  rack: string;
  reorderLevel: number;
  prescriptionRequired: boolean;
  barcode: string;
  notes: string;
  createdAt?: string;
}

export interface Batch {
  id: string;
  productId: string;
  batchNo: string;
  expiry: string;
  mrp: number;
  salePrice: number;
  costPrice: number;
  quantity: number;
  supplier: string;
  receivedAt: string;
  createdAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  doctor: string;
  notes: string;
  creditBalance: number;
  createdAt?: string;
}

export interface SaleItem {
  productId: string;
  batchId: string;
  name: string;
  strength: string;
  form: string;
  batchNo: string;
  expiry: string;
  hsCode: string;
  unit: string;
  qty: number;
  mrp: number;
  salePrice: number;
  costPrice: number;
  taxRate: number;
  discountPct: number;
}

/** `credit` is udhaar — the bill goes on the customer's account, not a card. */
export type PaymentMode = 'cash' | 'card' | 'digital' | 'credit';

export interface User {
  id: string;
  name: string;
  role: 'admin' | 'staff';
  active: boolean;
  createdAt?: string;
  lastSignInAt?: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  summary: string;
  by: string;
  byId: string | null;
  role: 'admin' | 'staff' | null;
  /** Set when the action went through a manager override. */
  authorisedBy: string | null;
  invoiceNo?: string;
  amount?: number;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  at: string;
  items: SaleItem[];
  gross: number;
  discount: number;
  lineDiscount: number;
  extraDiscount: number;
  taxableValue: number;
  tax: number;
  subtotal: number;
  roundOff: number;
  total: number;
  cost: number;
  profit: number;
  paymentMode: PaymentMode;
  paid: number;
  due: number;
  customerId: string | null;
  customerName: string;
  doctorName: string;
  prescriptionRef: string;
  note: string;
  status: 'completed' | 'void';
  /** Who was at the till. Kept as a name so the bill never changes retroactively. */
  soldBy?: string;
  soldById?: string | null;
  voidedAt?: string;
  voidedBy?: string;
  voidedById?: string | null;
  /** The owner who approved the cancellation, when done under a manager override. */
  voidedAuthorisedBy?: string | null;
}

export interface Payment {
  id: string;
  customerId: string;
  amount: number;
  mode: 'cash' | 'card' | 'digital';
  note: string;
  at: string;
}

export interface LowStockAlert {
  productId: string;
  name: string;
  strength: string;
  stock: number;
  reorderLevel: number;
  rack: string;
}

export interface ExpiryAlert {
  batchId: string;
  productId: string;
  name: string;
  strength: string;
  batchNo: string;
  expiry: string;
  quantity: number;
  daysLeft: number;
  value: number;
}

export interface Alerts {
  lowStock: LowStockAlert[];
  expiringSoon: ExpiryAlert[];
  expired: ExpiryAlert[];
}

export interface Bootstrap {
  settings: Settings;
  products: Product[];
  batches: Batch[];
  customers: Customer[];
  recentSales: Sale[];
  alerts: Alerts;
}

export interface ReportSummary {
  range: { from: string; to: string };
  totals: {
    revenue: number;
    profit: number;
    tax: number;
    discount: number;
    bills: number;
    itemsSold: number;
    averageBill: number;
  };
  byDay: { day: string; revenue: number; profit: number; bills: number }[];
  topProducts: { productId: string; name: string; qty: number; revenue: number; profit: number }[];
  byPaymentMode: { mode: PaymentMode; amount: number; bills: number }[];
  byUser: { name: string; revenue: number; bills: number; items: number }[];
  byHour: { hour: number; revenue: number; bills: number }[];
  stockValue: number;
  creditOutstanding: number;
}

/** A line in the in-progress bill, before it is sent to the server. */
export interface CartLine {
  key: string;
  product: Product;
  batch: Batch;
  qty: number;
  discountPct: number;
}
