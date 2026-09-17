/**
 * Pricing and stock rules.
 *
 * Money convention: `salePrice` and `mrp` are GST-INCLUSIVE rupee amounts, which
 * is how medicine is priced and billed in India. Tax is therefore back-calculated
 * out of the line total rather than added on top of it.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Days from today until `isoDate`. Negative once the date has passed. */
export function daysUntil(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  const now = new Date(`${todayISO()}T00:00:00`);
  return Math.round((d - now) / 86_400_000);
}

export const isExpired = (isoDate) => daysUntil(isoDate) < 0;

/**
 * Totals for one cart line.
 * `discountPct` applies to the gross line amount before tax is split out.
 */
export function lineTotals({ salePrice, qty, taxRate = 0, discountPct = 0 }) {
  const gross = round2(Number(salePrice) * Number(qty));
  const discount = round2((gross * Number(discountPct)) / 100);
  const net = round2(gross - discount);
  const taxable = round2(net / (1 + Number(taxRate) / 100));
  const tax = round2(net - taxable);
  return { gross, discount, net, taxable, tax };
}

/**
 * Bill totals. `extraDiscount` is a flat rupee amount taken off the whole bill
 * and is spread across lines proportionally so the tax split stays honest.
 */
export function billTotals(lines, { extraDiscount = 0, roundOff = true } = {}) {
  const computed = lines.map((l) => lineTotals(l));
  const gross = round2(computed.reduce((s, c) => s + c.gross, 0));
  const lineDiscount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const net = round2(computed.reduce((s, c) => s + c.net, 0));

  const capped = round2(Math.min(Math.max(Number(extraDiscount) || 0, 0), net));
  const factor = net > 0 ? (net - capped) / net : 0;

  const taxable = round2(computed.reduce((s, c) => s + c.taxable * factor, 0));
  const tax = round2(computed.reduce((s, c) => s + c.tax * factor, 0));
  const payable = round2(taxable + tax);

  const rounded = roundOff ? Math.round(payable) : payable;
  const roundOffAmount = round2(rounded - payable);

  return {
    gross,
    discount: round2(lineDiscount + capped),
    lineDiscount,
    extraDiscount: capped,
    taxableValue: taxable,
    tax,
    subtotal: net,
    roundOff: roundOffAmount,
    total: round2(rounded),
  };
}

/** Quantity on hand for a product across all of its non-expired batches. */
export function sellableStock(batches, productId) {
  return batches
    .filter((b) => b.productId === productId && b.quantity > 0 && !isExpired(b.expiry))
    .reduce((s, b) => s + b.quantity, 0);
}

/** Batches that can actually be sold, oldest expiry first (FEFO). */
export function sellableBatches(batches, productId) {
  return batches
    .filter((b) => b.productId === productId && b.quantity > 0 && !isExpired(b.expiry))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

export function nextInvoiceNo(settings) {
  const seq = String(settings.nextInvoiceSeq ?? 1).padStart(5, '0');
  const yy = new Date().getFullYear().toString().slice(-2);
  return `${settings.invoicePrefix || 'INV'}-${yy}-${seq}`;
}
