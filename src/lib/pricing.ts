/**
 * Client-side mirror of the server's pricing rules, used only to show live
 * totals while the cart is being built. The server recomputes everything at
 * checkout and its numbers are the ones that get stored.
 *
 * Prices are tax-inclusive, so sales tax is split out of the total rather than
 * added. Pakistan levies one federal sales tax, so there is a single figure.
 */
import type { CartLine } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineTotals {
  gross: number;
  discount: number;
  net: number;
  taxable: number;
  tax: number;
}

export function lineTotals(line: Pick<CartLine, 'batch' | 'qty' | 'discountPct' | 'product'>): LineTotals {
  const gross = round2(line.batch.salePrice * line.qty);
  const discount = round2((gross * line.discountPct) / 100);
  const net = round2(gross - discount);
  const taxable = round2(net / (1 + line.product.taxRate / 100));
  return { gross, discount, net, taxable, tax: round2(net - taxable) };
}

export interface BillTotals {
  gross: number;
  discount: number;
  lineDiscount: number;
  extraDiscount: number;
  taxableValue: number;
  tax: number;
  subtotal: number;
  roundOff: number;
  total: number;
  savings: number;
}

export function billTotals(lines: CartLine[], extraDiscount = 0, roundOff = true): BillTotals {
  const computed = lines.map(lineTotals);
  const gross = round2(computed.reduce((s, c) => s + c.gross, 0));
  const lineDiscount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const net = round2(computed.reduce((s, c) => s + c.net, 0));

  const capped = round2(Math.min(Math.max(extraDiscount || 0, 0), net));
  const factor = net > 0 ? (net - capped) / net : 0;

  const taxable = round2(computed.reduce((s, c) => s + c.taxable * factor, 0));
  const tax = round2(computed.reduce((s, c) => s + c.tax * factor, 0));
  const payable = round2(taxable + tax);
  const rounded = roundOff ? Math.round(payable) : payable;

  // What the customer saved against printed MRP, plus any discount given.
  const mrpTotal = round2(lines.reduce((s, l) => s + l.batch.mrp * l.qty, 0));

  return {
    gross,
    discount: round2(lineDiscount + capped),
    lineDiscount,
    extraDiscount: capped,
    taxableValue: taxable,
    tax,
    subtotal: net,
    roundOff: round2(rounded - payable),
    total: round2(rounded),
    savings: round2(Math.max(0, mrpTotal - rounded)),
  };
}
