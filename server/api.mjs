import { readDb, writeDb, replaceDb, backup, id, DEFAULT_TAX_RATES } from './db.mjs';
import {
  round2,
  todayISO,
  daysUntil,
  isExpired,
  billTotals,
  sellableStock,
  nextInvoiceNo,
} from './domain.mjs';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg) => new HttpError(404, msg);
export { HttpError };

const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ products */

function productPayload(body, settings) {
  const name = str(body.name);
  if (!name) throw bad('Product name is required.');
  return {
    name,
    genericName: str(body.genericName),
    manufacturer: str(body.manufacturer),
    category: str(body.category, 'General'),
    form: str(body.form, 'Tablet'),
    strength: str(body.strength),
    packSize: str(body.packSize),
    hsCode: str(body.hsCode),
    taxRate: Math.min(Math.max(num(body.taxRate, settings?.defaultTaxRate ?? 0), 0), 100),
    unit: str(body.unit, 'strip'),
    rack: str(body.rack),
    reorderLevel: Math.max(0, Math.round(num(body.reorderLevel, 20))),
    prescriptionRequired: Boolean(body.prescriptionRequired),
    barcode: str(body.barcode),
    notes: str(body.notes),
  };
}

function batchPayload(body, db) {
  const productId = str(body.productId);
  if (!db.products.some((p) => p.id === productId)) throw bad('Unknown product for this batch.');
  const batchNo = str(body.batchNo);
  if (!batchNo) throw bad('Batch number is required.');
  const expiry = str(body.expiry);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw bad('Expiry must be a date (YYYY-MM-DD).');
  const mrp = round2(num(body.mrp));
  if (mrp <= 0) throw bad('MRP must be greater than zero.');
  const salePrice = round2(num(body.salePrice, mrp));
  if (salePrice <= 0) throw bad('Sale price must be greater than zero.');
  if (salePrice > mrp) throw bad('Sale price cannot exceed the printed MRP.');
  return {
    productId,
    batchNo,
    expiry,
    mrp,
    salePrice,
    costPrice: round2(num(body.costPrice, round2(salePrice * 0.78))),
    quantity: Math.max(0, Math.round(num(body.quantity))),
    supplier: str(body.supplier),
    receivedAt: str(body.receivedAt, todayISO()),
  };
}

function customerPayload(body) {
  const name = str(body.name);
  if (!name) throw bad('Customer name is required.');
  const phone = str(body.phone);
  if (phone && !/^[\d+\-\s()]{6,20}$/.test(phone)) throw bad('Phone number looks invalid.');
  return {
    name,
    phone,
    email: str(body.email),
    address: str(body.address),
    doctor: str(body.doctor),
    notes: str(body.notes),
  };
}

/**
 * Cleans up the shop's editable rate list: drops junk rows, clamps each rate to
 * 0-100, collapses duplicates, sorts, and never returns an empty list — a
 * product form with no rates to choose from would be a dead end.
 */
function normaliseTaxRates(input) {
  if (!Array.isArray(input)) return DEFAULT_TAX_RATES.map((r) => ({ ...r }));

  const seen = new Map();
  for (const row of input.slice(0, 20)) {
    if (!row || typeof row !== 'object') continue;
    const rate = Math.round(Math.min(Math.max(num(row.rate, -1), 0), 100) * 100) / 100;
    if (rate < 0 || !Number.isFinite(rate)) continue;
    if (num(row.rate, -1) < 0) continue;
    const label = str(row.label).slice(0, 48) || `${rate}%`;
    if (!seen.has(rate)) seen.set(rate, { rate, label });
  }

  const cleaned = [...seen.values()].sort((a, b) => a.rate - b.rate);
  return cleaned.length > 0 ? cleaned : DEFAULT_TAX_RATES.map((r) => ({ ...r }));
}

/* ------------------------------------------------------------------ checkout */

/**
 * Turns a cart into a persisted sale: validates every line against live stock,
 * decrements the batches it draws from, and recomputes all money server-side so
 * a tampered or stale client can never decide the bill.
 */
function createSale(db, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw bad('Cannot bill an empty cart.');

  const prepared = items.map((raw, index) => {
    const batch = db.batches.find((b) => b.id === str(raw.batchId));
    if (!batch) throw bad(`Line ${index + 1}: that batch no longer exists.`);
    const product = db.products.find((p) => p.id === batch.productId);
    if (!product) throw bad(`Line ${index + 1}: that product no longer exists.`);
    if (isExpired(batch.expiry)) {
      throw bad(`${product.name} batch ${batch.batchNo} expired on ${batch.expiry} and cannot be sold.`);
    }
    const qty = Math.round(num(raw.qty));
    if (qty <= 0) throw bad(`Line ${index + 1}: quantity must be at least 1.`);
    if (qty > batch.quantity) {
      throw bad(`Only ${batch.quantity} left of ${product.name} batch ${batch.batchNo}.`);
    }
    const discountPct = Math.min(Math.max(num(raw.discountPct), 0), 100);
    return {
      batch,
      product,
      line: {
        productId: product.id,
        batchId: batch.id,
        name: product.name,
        strength: product.strength,
        form: product.form,
        batchNo: batch.batchNo,
        expiry: batch.expiry,
        hsCode: product.hsCode,
        unit: product.unit,
        qty,
        mrp: batch.mrp,
        salePrice: batch.salePrice,
        costPrice: batch.costPrice,
        taxRate: product.taxRate,
        discountPct,
      },
    };
  });

  const lines = prepared.map((p) => p.line);
  const totals = billTotals(lines, {
    extraDiscount: num(body.extraDiscount),
    roundOff: db.settings.roundOffTotals !== false,
  });

  const paymentMode = ['cash', 'card', 'digital', 'credit'].includes(str(body.paymentMode))
    ? str(body.paymentMode)
    : 'cash';
  const paid = paymentMode === 'credit' ? round2(num(body.paid)) : totals.total;
  if (paid < 0) throw bad('Amount paid cannot be negative.');
  if (paid > totals.total) throw bad('Amount paid is more than the bill total.');
  const due = round2(totals.total - paid);

  let customer = null;
  if (body.customerId) {
    customer = db.customers.find((c) => c.id === str(body.customerId)) ?? null;
    if (!customer) throw bad('That customer no longer exists.');
  }
  if (due > 0 && !customer) throw bad('Select a customer before putting a bill on credit.');

  const rxRequired = prepared.some((p) => p.product.prescriptionRequired);
  const prescriptionRef = str(body.prescriptionRef);
  if (rxRequired && !prescriptionRef) {
    throw bad('This bill has prescription-only medicine — record a prescription reference.');
  }

  // Everything validated; commit the stock movement.
  for (const { batch, line } of prepared) batch.quantity -= line.qty;

  const cost = round2(lines.reduce((s, l) => s + l.costPrice * l.qty, 0));
  const sale = {
    id: id('sale'),
    invoiceNo: nextInvoiceNo(db.settings),
    at: new Date().toISOString(),
    items: lines,
    ...totals,
    cost,
    profit: round2(totals.taxableValue - cost),
    paymentMode,
    paid,
    due,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? str(body.customerName, 'Walk-in'),
    doctorName: str(body.doctorName),
    prescriptionRef,
    note: str(body.note),
    status: 'completed',
  };

  db.settings.nextInvoiceSeq = (db.settings.nextInvoiceSeq ?? 1) + 1;
  if (customer && due > 0) customer.creditBalance = round2((customer.creditBalance ?? 0) + due);
  db.sales.unshift(sale);
  return sale;
}

/** Reverses a sale: puts stock back and clears any credit it created. */
function voidSale(db, saleId) {
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale) throw notFound('Sale not found.');
  if (sale.status === 'void') throw bad('That bill is already cancelled.');
  for (const item of sale.items) {
    const batch = db.batches.find((b) => b.id === item.batchId);
    if (batch) batch.quantity += item.qty;
  }
  if (sale.customerId && sale.due > 0) {
    const customer = db.customers.find((c) => c.id === sale.customerId);
    if (customer) customer.creditBalance = round2(Math.max(0, (customer.creditBalance ?? 0) - sale.due));
  }
  sale.status = 'void';
  sale.voidedAt = new Date().toISOString();
  return sale;
}

/* ------------------------------------------------------------------- reports */

function reportSummary(db, from, to) {
  const start = from || todayISO();
  const end = to || todayISO();
  const inRange = (iso) => {
    const day = iso.slice(0, 10);
    return day >= start && day <= end;
  };

  const sales = db.sales.filter((s) => s.status !== 'void' && inRange(s.at));
  const revenue = round2(sales.reduce((s, x) => s + x.total, 0));
  const profit = round2(sales.reduce((s, x) => s + (x.profit ?? 0), 0));
  const tax = round2(sales.reduce((s, x) => s + x.tax, 0));
  const discount = round2(sales.reduce((s, x) => s + x.discount, 0));
  const itemsSold = sales.reduce((s, x) => s + x.items.reduce((n, i) => n + i.qty, 0), 0);

  const byDay = new Map();
  for (const sale of sales) {
    const day = sale.at.slice(0, 10);
    const bucket = byDay.get(day) ?? { day, revenue: 0, profit: 0, bills: 0 };
    bucket.revenue = round2(bucket.revenue + sale.total);
    bucket.profit = round2(bucket.profit + (sale.profit ?? 0));
    bucket.bills += 1;
    byDay.set(day, bucket);
  }

  const byProduct = new Map();
  for (const sale of sales) {
    for (const item of sale.items) {
      const bucket = byProduct.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
        profit: 0,
      };
      bucket.qty += item.qty;
      bucket.revenue = round2(bucket.revenue + item.salePrice * item.qty);
      bucket.profit = round2(bucket.profit + (item.salePrice - item.costPrice) * item.qty);
      byProduct.set(item.productId, bucket);
    }
  }

  const byPaymentMode = ['cash', 'card', 'digital', 'credit'].map((mode) => ({
    mode,
    amount: round2(sales.filter((s) => s.paymentMode === mode).reduce((sum, s) => sum + s.total, 0)),
    bills: sales.filter((s) => s.paymentMode === mode).length,
  }));

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, bills: 0 }));
  for (const sale of sales) {
    const h = new Date(sale.at).getHours();
    hours[h].revenue = round2(hours[h].revenue + sale.total);
    hours[h].bills += 1;
  }

  return {
    range: { from: start, to: end },
    totals: {
      revenue,
      profit,
      tax,
      discount,
      bills: sales.length,
      itemsSold,
      averageBill: sales.length ? round2(revenue / sales.length) : 0,
    },
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    topProducts: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    byPaymentMode,
    byHour: hours,
    stockValue: round2(db.batches.reduce((s, b) => s + b.quantity * b.costPrice, 0)),
    creditOutstanding: round2(db.customers.reduce((s, c) => s + (c.creditBalance ?? 0), 0)),
  };
}

/** Low stock, near expiry and already-expired batches — the shop's daily worry list. */
function alerts(db) {
  const expiryWindow = db.settings.expiryAlertDays ?? 90;
  const lowStock = db.products
    .map((p) => ({ product: p, stock: sellableStock(db.batches, p.id) }))
    .filter(({ product, stock }) => stock <= (product.reorderLevel || db.settings.lowStockThreshold || 20))
    .map(({ product, stock }) => ({
      productId: product.id,
      name: product.name,
      strength: product.strength,
      stock,
      reorderLevel: product.reorderLevel,
      rack: product.rack,
    }))
    .sort((a, b) => a.stock - b.stock);

  const decorate = (b) => {
    const product = db.products.find((p) => p.id === b.productId);
    return {
      batchId: b.id,
      productId: b.productId,
      name: product?.name ?? 'Unknown',
      strength: product?.strength ?? '',
      batchNo: b.batchNo,
      expiry: b.expiry,
      quantity: b.quantity,
      daysLeft: daysUntil(b.expiry),
      value: round2(b.quantity * b.costPrice),
    };
  };

  const live = db.batches.filter((b) => b.quantity > 0);
  return {
    lowStock,
    expiringSoon: live
      .filter((b) => !isExpired(b.expiry) && daysUntil(b.expiry) <= expiryWindow)
      .map(decorate)
      .sort((a, b) => a.daysLeft - b.daysLeft),
    expired: live.filter((b) => isExpired(b.expiry)).map(decorate).sort((a, b) => a.daysLeft - b.daysLeft),
  };
}

/* -------------------------------------------------------------------- routes */

/** [method, path pattern, handler]. `:param` segments are captured. */
export const routes = [
  ['GET', '/api/health', () => ({ ok: true, at: new Date().toISOString() })],

  ['GET', '/api/bootstrap', () => {
    const db = readDb();
    return {
      settings: db.settings,
      products: db.products,
      batches: db.batches,
      customers: db.customers,
      recentSales: [...db.sales].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
      alerts: alerts(db),
    };
  }],

  ['GET', '/api/alerts', () => alerts(readDb())],

  ['GET', '/api/products', () => readDb().products],
  ['POST', '/api/products', (_p, body) =>
    writeDb((db) => {
      const product = { id: id('prd'), createdAt: new Date().toISOString(), ...productPayload(body, db.settings) };
      db.products.push(product);
      return product;
    })],
  ['PUT', '/api/products/:id', (p, body) =>
    writeDb((db) => {
      const product = db.products.find((x) => x.id === p.id);
      if (!product) throw notFound('Product not found.');
      Object.assign(product, productPayload({ ...product, ...body }, db.settings));
      return product;
    })],
  ['DELETE', '/api/products/:id', (p) =>
    writeDb((db) => {
      const index = db.products.findIndex((x) => x.id === p.id);
      if (index === -1) throw notFound('Product not found.');
      if (db.sales.some((s) => s.items.some((i) => i.productId === p.id))) {
        throw bad('This medicine appears on past bills, so it cannot be deleted. Set its stock to zero instead.');
      }
      db.batches = db.batches.filter((b) => b.productId !== p.id);
      const [removed] = db.products.splice(index, 1);
      return removed;
    })],

  ['GET', '/api/batches', () => readDb().batches],
  ['POST', '/api/batches', (_p, body) =>
    writeDb((db) => {
      const batch = { id: id('bch'), createdAt: new Date().toISOString(), ...batchPayload(body, db) };
      db.batches.push(batch);
      return batch;
    })],
  ['PUT', '/api/batches/:id', (p, body) =>
    writeDb((db) => {
      const batch = db.batches.find((x) => x.id === p.id);
      if (!batch) throw notFound('Batch not found.');
      Object.assign(batch, batchPayload({ ...batch, ...body }, db));
      return batch;
    })],
  ['DELETE', '/api/batches/:id', (p) =>
    writeDb((db) => {
      const index = db.batches.findIndex((x) => x.id === p.id);
      if (index === -1) throw notFound('Batch not found.');
      if (db.sales.some((s) => s.items.some((i) => i.batchId === p.id))) {
        throw bad('This batch appears on past bills, so it cannot be deleted. Set its quantity to zero instead.');
      }
      const [removed] = db.batches.splice(index, 1);
      return removed;
    })],

  ['GET', '/api/customers', () => readDb().customers],
  ['POST', '/api/customers', (_p, body) =>
    writeDb((db) => {
      const payload = customerPayload(body);
      if (payload.phone && db.customers.some((c) => c.phone === payload.phone)) {
        throw bad('A customer with that phone number already exists.');
      }
      const customer = { id: id('cus'), createdAt: new Date().toISOString(), creditBalance: 0, ...payload };
      db.customers.push(customer);
      return customer;
    })],
  ['PUT', '/api/customers/:id', (p, body) =>
    writeDb((db) => {
      const customer = db.customers.find((x) => x.id === p.id);
      if (!customer) throw notFound('Customer not found.');
      Object.assign(customer, customerPayload({ ...customer, ...body }));
      return customer;
    })],
  ['DELETE', '/api/customers/:id', (p) =>
    writeDb((db) => {
      const index = db.customers.findIndex((x) => x.id === p.id);
      if (index === -1) throw notFound('Customer not found.');
      if (round2(db.customers[index].creditBalance ?? 0) > 0) {
        throw bad('This customer still owes money. Settle the balance before removing them.');
      }
      const [removed] = db.customers.splice(index, 1);
      return removed;
    })],
  ['GET', '/api/customers/:id/ledger', (p) => {
    const db = readDb();
    const customer = db.customers.find((c) => c.id === p.id);
    if (!customer) throw notFound('Customer not found.');
    return {
      customer,
      sales: db.sales.filter((s) => s.customerId === p.id).sort((a, b) => b.at.localeCompare(a.at)),
      payments: db.payments.filter((x) => x.customerId === p.id),
    };
  }],

  ['GET', '/api/sales', (_p, _b, query) => {
    const db = readDb();
    // Newest first by bill time, not by insertion order.
    let sales = [...db.sales].sort((a, b) => b.at.localeCompare(a.at));
    if (query.from) sales = sales.filter((s) => s.at.slice(0, 10) >= query.from);
    if (query.to) sales = sales.filter((s) => s.at.slice(0, 10) <= query.to);
    if (query.customerId) sales = sales.filter((s) => s.customerId === query.customerId);
    if (query.q) {
      const needle = query.q.toLowerCase();
      sales = sales.filter(
        (s) =>
          s.invoiceNo.toLowerCase().includes(needle) ||
          (s.customerName ?? '').toLowerCase().includes(needle),
      );
    }
    return sales.slice(0, Number(query.limit) || 200);
  }],
  ['GET', '/api/sales/:id', (p) => {
    const sale = readDb().sales.find((s) => s.id === p.id);
    if (!sale) throw notFound('Sale not found.');
    return sale;
  }],
  ['POST', '/api/sales', (_p, body) => writeDb((db) => createSale(db, body))],
  ['POST', '/api/sales/:id/void', (p) => writeDb((db) => voidSale(db, p.id))],

  ['POST', '/api/payments', (_p, body) =>
    writeDb((db) => {
      const customer = db.customers.find((c) => c.id === str(body.customerId));
      if (!customer) throw notFound('Customer not found.');
      const amount = round2(num(body.amount));
      if (amount <= 0) throw bad('Payment amount must be greater than zero.');
      const owed = round2(customer.creditBalance ?? 0);
      if (amount > owed) {
        throw bad(`That is more than the ${db.settings.currencySymbol ?? 'Rs'} ${owed} outstanding.`);
      }
      customer.creditBalance = round2(owed - amount);
      const payment = {
        id: id('pay'),
        customerId: customer.id,
        amount,
        mode: ['cash', 'card', 'digital'].includes(str(body.mode)) ? str(body.mode) : 'cash',
        note: str(body.note),
        at: new Date().toISOString(),
      };
      db.payments.unshift(payment);
      return { payment, customer };
    })],

  ['GET', '/api/reports/summary', (_p, _b, query) => reportSummary(readDb(), query.from, query.to)],

  ['GET', '/api/settings', () => readDb().settings],
  ['PUT', '/api/settings', (_p, body) =>
    writeDb((db) => {
      const next = { ...db.settings, ...body };
      next.lowStockThreshold = Math.max(0, Math.round(num(next.lowStockThreshold, 20)));
      next.expiryAlertDays = Math.max(1, Math.round(num(next.expiryAlertDays, 90)));
      next.nextInvoiceSeq = Math.max(1, Math.round(num(next.nextInvoiceSeq, 1)));
      next.defaultTaxRate = Math.min(Math.max(num(next.defaultTaxRate, 0), 0), 100);
      next.taxRates = normaliseTaxRates(next.taxRates);
      db.settings = next;
      return db.settings;
    })],

  ['GET', '/api/backup', () => readDb()],
  ['POST', '/api/backup', async () => ({ file: await backup('manual') })],
  ['POST', '/api/restore', async (_p, body) => {
    if (!body || !Array.isArray(body.products)) throw bad('That file does not look like a MediPOS backup.');
    await replaceDb(body);
    return { ok: true };
  }],
];
