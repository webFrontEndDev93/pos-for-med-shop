import fs from 'node:fs';
import { DB_FILE, emptyDb, writeDb, readDb, resetCache, id } from './db.mjs';
import { round2, billTotals, nextInvoiceNo } from './domain.mjs';

/** Deterministic PRNG so a fresh clone always seeds the same demo shop. */
function rng(seed = 20260916) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CATALOGUE = [
  ['Paracetamol 650mg', 'Paracetamol', 'Cipla', 'Analgesic', 'Tablet', '650mg', '15 tablets', 12, 24.5],
  ['Dolo 650', 'Paracetamol', 'Micro Labs', 'Analgesic', 'Tablet', '650mg', '15 tablets', 12, 31.5],
  ['Combiflam', 'Ibuprofen + Paracetamol', 'Sanofi', 'Analgesic', 'Tablet', '400mg/325mg', '20 tablets', 12, 58.0],
  ['Azithral 500', 'Azithromycin', 'Alembic', 'Antibiotic', 'Tablet', '500mg', '5 tablets', 12, 118.0, true],
  ['Augmentin 625 Duo', 'Amoxicillin + Clavulanate', 'GSK', 'Antibiotic', 'Tablet', '625mg', '10 tablets', 12, 205.0, true],
  ['Amoxil 500', 'Amoxicillin', 'Cipla', 'Antibiotic', 'Capsule', '500mg', '10 capsules', 12, 96.0, true],
  ['Pan 40', 'Pantoprazole', 'Alkem', 'Gastro', 'Tablet', '40mg', '15 tablets', 12, 142.0],
  ['Omez 20', 'Omeprazole', 'Dr. Reddy’s', 'Gastro', 'Capsule', '20mg', '20 capsules', 12, 78.0],
  ['Digene Gel', 'Antacid Suspension', 'Abbott', 'Gastro', 'Syrup', '200ml', '200 ml', 12, 132.0],
  ['Cetirizine 10mg', 'Cetirizine', 'Sun Pharma', 'Antihistamine', 'Tablet', '10mg', '10 tablets', 12, 18.0],
  ['Montair LC', 'Montelukast + Levocetirizine', 'Cipla', 'Respiratory', 'Tablet', '10mg/5mg', '10 tablets', 12, 198.0, true],
  ['Asthalin Inhaler', 'Salbutamol', 'Cipla', 'Respiratory', 'Inhaler', '100mcg', '200 doses', 12, 148.0, true],
  ['Ascoril LS Syrup', 'Levosalbutamol + Ambroxol', 'Glenmark', 'Respiratory', 'Syrup', '100ml', '100 ml', 12, 124.0],
  ['Metformin 500mg', 'Metformin', 'USV', 'Diabetes', 'Tablet', '500mg', '20 tablets', 5, 42.0, true],
  ['Glycomet GP 1', 'Metformin + Glimepiride', 'USV', 'Diabetes', 'Tablet', '500mg/1mg', '15 tablets', 5, 96.0, true],
  ['Human Mixtard 30/70', 'Insulin', 'Novo Nordisk', 'Diabetes', 'Injection', '100IU/ml', '10 ml vial', 5, 385.0, true],
  ['Telma 40', 'Telmisartan', 'Glenmark', 'Cardiac', 'Tablet', '40mg', '15 tablets', 5, 168.0, true],
  ['Amlodipine 5mg', 'Amlodipine', 'Cipla', 'Cardiac', 'Tablet', '5mg', '15 tablets', 5, 38.0, true],
  ['Ecosprin 75', 'Aspirin', 'USV', 'Cardiac', 'Tablet', '75mg', '14 tablets', 5, 12.5, true],
  ['Atorva 10', 'Atorvastatin', 'Zydus', 'Cardiac', 'Tablet', '10mg', '15 tablets', 5, 92.0, true],
  ['Thyronorm 50mcg', 'Thyroxine', 'Abbott', 'Hormone', 'Tablet', '50mcg', '120 tablets', 5, 168.0, true],
  ['Shelcal 500', 'Calcium + Vitamin D3', 'Torrent', 'Supplement', 'Tablet', '500mg', '15 tablets', 12, 112.0],
  ['Becosules', 'Vitamin B Complex', 'Pfizer', 'Supplement', 'Capsule', '—', '20 capsules', 12, 48.0],
  ['Neurobion Forte', 'Vitamin B Complex', 'Merck', 'Supplement', 'Tablet', '—', '30 tablets', 12, 42.0],
  ['Zincovit', 'Multivitamin', 'Apex', 'Supplement', 'Tablet', '—', '15 tablets', 12, 108.0],
  ['Limcee 500', 'Vitamin C', 'Abbott', 'Supplement', 'Tablet', '500mg', '15 tablets', 12, 28.0],
  ['ORS Orange', 'Oral Rehydration Salts', 'FDC', 'Electrolyte', 'Powder', '21.8g', '1 sachet', 5, 22.0],
  ['Betadine Ointment', 'Povidone Iodine', 'Win-Medicare', 'Topical', 'Ointment', '5%', '20 g', 12, 96.0],
  ['Volini Gel', 'Diclofenac Topical', 'Sun Pharma', 'Topical', 'Gel', '30g', '30 g', 12, 145.0],
  ['Soframycin Cream', 'Framycetin', 'Sanofi', 'Topical', 'Cream', '1%', '30 g', 12, 62.0],
  ['Moov Spray', 'Analgesic Spray', 'Reckitt', 'Topical', 'Spray', '80g', '80 g', 18, 285.0],
  ['Dettol Antiseptic', 'Chloroxylenol', 'Reckitt', 'Antiseptic', 'Liquid', '550ml', '550 ml', 18, 245.0],
  ['Crocin Advance', 'Paracetamol', 'GSK', 'Analgesic', 'Tablet', '500mg', '15 tablets', 12, 30.0],
  ['Sinarest', 'Paracetamol + Phenylephrine', 'Centaur', 'Cold & Flu', 'Tablet', '—', '10 tablets', 12, 88.0],
  ['Vicks Action 500', 'Cold Relief', 'P&G', 'Cold & Flu', 'Tablet', '—', '10 tablets', 12, 46.0],
  ['Otrivin Nasal Spray', 'Xylometazoline', 'GSK', 'Cold & Flu', 'Spray', '0.1%', '10 ml', 12, 128.0],
  ['Strepsils Lemon', 'Amylmetacresol', 'Reckitt', 'Cold & Flu', 'Lozenge', '—', '8 lozenges', 18, 45.0],
  ['Glucometer Strips', 'Test Strips', 'Accu-Chek', 'Device', 'Strips', '—', '25 strips', 12, 615.0],
  ['Digital Thermometer', 'Thermometer', 'Dr. Morepen', 'Device', 'Device', '—', '1 unit', 18, 185.0],
  ['N95 Mask', 'Respirator Mask', 'Venus', 'Consumable', 'Mask', '—', '1 unit', 5, 45.0],
  ['Surgical Gloves', 'Latex Gloves', 'Medline', 'Consumable', 'Gloves', 'Medium', '1 pair', 12, 18.0],
  ['Cotton Roll 100g', 'Absorbent Cotton', 'Lupin', 'Consumable', 'Roll', '100g', '100 g', 5, 68.0],
];

const CUSTOMERS = [
  ['Ramesh Kulkarni', '+91 98860 11234', 'Dr. S. Nair', 'Jayanagar 4th Block'],
  ['Anita Desai', '+91 99001 22345', 'Dr. P. Menon', 'Indiranagar, 12th Main'],
  ['Mohammed Irfan', '+91 98452 33456', 'Dr. S. Nair', 'Shivajinagar'],
  ['Lakshmi Narayan', '+91 97418 44567', 'Dr. K. Iyer', 'Basavanagudi'],
  ['Suresh Prabhu', '+91 99640 55678', '', 'Malleshwaram'],
  ['Farida Begum', '+91 98803 66789', 'Dr. P. Menon', 'Frazer Town'],
  ['Vikram Shetty', '+91 90080 77890', '', 'Koramangala 5th Block'],
  ['Deepa Rajan', '+91 96320 88901', 'Dr. K. Iyer', 'HSR Layout'],
  ['Joseph Mathew', '+91 94480 99012', 'Dr. A. Bose', 'Cooke Town'],
  ['Nandini Gowda', '+91 88840 10123', '', 'Rajajinagar'],
  ['Arjun Reddy', '+91 89040 21234', 'Dr. A. Bose', 'Whitefield'],
  ['Shalini Verma', '+91 97390 32345', '', 'Banashankari'],
];

const SUPPLIERS = ['Karnataka Medical Agencies', 'Sri Venkateshwara Distributors', 'Apex Pharma Supply', 'Bengaluru Drug House'];

const isoDay = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export function buildSeed() {
  const rand = rng();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const db = emptyDb();

  const products = CATALOGUE.map(
    ([name, genericName, manufacturer, category, form, strength, packSize, gstRate, mrp, rx]) => ({
      id: id('prd'),
      name,
      genericName,
      manufacturer,
      category,
      form,
      strength,
      packSize,
      hsn: '3004',
      gstRate,
      unit: form === 'Tablet' || form === 'Capsule' ? 'strip' : 'unit',
      rack: `${String.fromCharCode(65 + between(0, 7))}${between(1, 6)}`,
      reorderLevel: between(10, 30),
      prescriptionRequired: Boolean(rx),
      barcode: String(8_900_000_000_000 + between(100000, 999999)),
      notes: '',
      createdAt: new Date().toISOString(),
      _mrp: mrp,
    }),
  );

  const batches = [];
  for (const product of products) {
    const count = between(1, 3);
    for (let i = 0; i < count; i += 1) {
      // A handful of batches are deliberately expired or close to it, so the
      // expiry alerts and sale-blocking are visible the moment you open the app.
      const roll = rand();
      const expiryOffset = roll < 0.05 ? between(-120, -5) : roll < 0.22 ? between(5, 85) : between(150, 900);
      const mrp = round2(product._mrp * (1 + (i * between(2, 6)) / 100));
      const salePrice = round2(mrp * (rand() < 0.35 ? 0.95 : 1));
      batches.push({
        id: id('bch'),
        productId: product.id,
        batchNo: `${product.name.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')}${between(1000, 9999)}`,
        expiry: isoDay(expiryOffset),
        mrp,
        salePrice,
        costPrice: round2(salePrice * (0.68 + rand() * 0.14)),
        quantity: between(8, 140),
        supplier: pick(SUPPLIERS),
        receivedAt: isoDay(-between(20, 240)),
        createdAt: new Date().toISOString(),
      });
    }
  }
  for (const product of products) delete product._mrp;

  const customers = CUSTOMERS.map(([name, phone, doctor, address]) => ({
    id: id('cus'),
    name,
    phone,
    email: '',
    address: `${address}, Bengaluru`,
    doctor,
    notes: '',
    creditBalance: 0,
    createdAt: new Date().toISOString(),
  }));

  db.products = products;
  db.batches = batches;
  db.customers = customers;

  // Replay ~75 days of trade so the reports open with a real-looking history.
  const sales = [];
  for (let dayOffset = 75; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - dayOffset);
    const weekend = [0, 6].includes(date.getDay());
    const billCount = between(weekend ? 4 : 7, weekend ? 10 : 18);

    for (let b = 0; b < billCount; b += 1) {
      const lines = [];
      const lineCount = between(1, 4);
      for (let l = 0; l < lineCount; l += 1) {
        const product = pick(products);
        const options = batches.filter(
          (x) => x.productId === product.id && x.quantity > 4 && x.expiry > date.toISOString().slice(0, 10),
        );
        if (options.length === 0) continue;
        const batch = options[0];
        const qty = between(1, Math.min(4, batch.quantity));
        batch.quantity -= qty;
        lines.push({
          productId: product.id,
          batchId: batch.id,
          name: product.name,
          strength: product.strength,
          form: product.form,
          batchNo: batch.batchNo,
          expiry: batch.expiry,
          hsn: product.hsn,
          unit: product.unit,
          qty,
          mrp: batch.mrp,
          salePrice: batch.salePrice,
          costPrice: batch.costPrice,
          gstRate: product.gstRate,
          discountPct: rand() < 0.2 ? pick([5, 10]) : 0,
        });
      }
      if (lines.length === 0) continue;

      const totals = billTotals(lines, { extraDiscount: 0, roundOff: true });
      const hour = between(9, 20);
      date.setHours(hour, between(0, 59), between(0, 59), 0);

      const hasCustomer = rand() < 0.55;
      const customer = hasCustomer ? pick(customers) : null;
      const rxRequired = lines.some((l) => products.find((p) => p.id === l.productId)?.prescriptionRequired);
      const mode = !customer ? pick(['cash', 'cash', 'upi', 'card']) : pick(['cash', 'upi', 'card', 'upi', 'credit']);
      const paid = mode === 'credit' ? round2(totals.total * pick([0, 0, 0.5])) : totals.total;
      const due = round2(totals.total - paid);
      const cost = round2(lines.reduce((s, x) => s + x.costPrice * x.qty, 0));

      if (customer && due > 0) customer.creditBalance = round2(customer.creditBalance + due);

      sales.push({
        id: id('sale'),
        invoiceNo: nextInvoiceNo(db.settings),
        at: date.toISOString(),
        items: lines,
        ...totals,
        cost,
        profit: round2(totals.taxableValue - cost),
        paymentMode: due > 0 ? 'credit' : mode,
        paid,
        due,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? 'Walk-in',
        doctorName: customer?.doctor ?? '',
        prescriptionRef: rxRequired ? `RX-${between(10000, 99999)}` : '',
        note: '',
        status: 'completed',
      });
      db.settings.nextInvoiceSeq += 1;
    }
  }

  db.sales = sales.sort((a, b) => b.at.localeCompare(a.at));

  // Most credit gets paid off; leaving every customer in debt would be a
  // caricature of a shop, and it hides the payments ledger entirely.
  const payments = [];
  for (const customer of customers) {
    if (customer.creditBalance <= 0) continue;
    const roll = rand();
    // ~45% settle in full, ~30% settle part of it, the rest still owe everything.
    const share = roll < 0.45 ? 1 : roll < 0.75 ? 0.4 + rand() * 0.4 : 0;
    if (share === 0) continue;

    const amount = round2(customer.creditBalance * share);
    if (amount <= 0) continue;
    const when = new Date();
    when.setDate(when.getDate() - between(1, 30));
    when.setHours(between(10, 19), between(0, 59), 0, 0);

    customer.creditBalance = round2(customer.creditBalance - amount);
    payments.push({
      id: id('pay'),
      customerId: customer.id,
      amount,
      mode: pick(['cash', 'cash', 'upi']),
      note: share === 1 ? 'Account cleared' : 'Part payment',
      at: when.toISOString(),
    });
  }
  db.payments = payments.sort((a, b) => b.at.localeCompare(a.at));

  return db;
}

/** Writes demo data only when there is no database yet (or --force is passed). */
export function ensureSeed() {
  const force = process.argv.includes('--force');
  const exists = fs.existsSync(DB_FILE);
  if (exists && !force) {
    const db = readDb();
    if (db.products.length > 0) return false;
  }
  const seeded = buildSeed();
  resetCache();
  writeDb((db) => {
    Object.assign(db, seeded);
  });
  console.log(
    `[seed] demo shop ready — ${seeded.products.length} medicines, ${seeded.batches.length} batches, ${seeded.sales.length} bills, ${seeded.payments.length} credit settlements.`,
  );
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeed();
}
