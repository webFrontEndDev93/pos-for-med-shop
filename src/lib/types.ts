export interface Settings {
  shopName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  gstin: string;
  drugLicense: string;
  pharmacist: string;
  currency: string;
  currencySymbol: string;
  invoicePrefix: string;
  nextInvoiceSeq: number;
  lowStockThreshold: number;
  expiryAlertDays: number;
  roundOffTotals: boolean;
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
  hsn: string;
  gstRate: number;
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
  hsn: string;
  unit: string;
  qty: number;
  mrp: number;
  salePrice: number;
  costPrice: number;
  gstRate: number;
  discountPct: number;
}

export type PaymentMode = 'cash' | 'card' | 'upi' | 'credit';

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
  cgst: number;
  sgst: number;
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
  voidedAt?: string;
}

export interface Payment {
  id: string;
  customerId: string;
  amount: number;
  mode: 'cash' | 'card' | 'upi';
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
