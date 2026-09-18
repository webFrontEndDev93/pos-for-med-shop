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

/**
 * A Pakistani retail pharmacy's shelf, with rupee MRPs in the right ballpark.
 * Columns: name, generic, manufacturer, category, form, strength, pack,
 * salesTaxRate, MRP, prescriptionOnly.
 *
 * Tax rate: 1% is the concessional rate for drugs registered under the Drugs
 * Act 1976; devices, consumables and antiseptics sit at the 18% standard rate.
 * Confirm both against the current Finance Act before trading on them.
 */
const CATALOGUE = [
  ['Panadol 500mg', 'Paracetamol', 'Haleon Pakistan', 'Analgesic', 'Tablet', '500mg', '10 tablets', 1, 45.0],
  ['Panadol Extra', 'Paracetamol + Caffeine', 'Haleon Pakistan', 'Analgesic', 'Tablet', '500mg/65mg', '10 tablets', 1, 92.0],
  ['Calpol Syrup', 'Paracetamol', 'GSK Pakistan', 'Analgesic', 'Syrup', '120mg/5ml', '60 ml', 1, 124.0],
  ['Brufen 400mg', 'Ibuprofen', 'Abbott Pakistan', 'Analgesic', 'Tablet', '400mg', '10 tablets', 1, 96.0],
  ['Ponstan 500mg', 'Mefenamic Acid', 'Pfizer Pakistan', 'Analgesic', 'Tablet', '500mg', '10 tablets', 1, 186.0],
  ['Nuberol Forte', 'Paracetamol + Orphenadrine', 'Searle', 'Analgesic', 'Tablet', '650mg/50mg', '10 tablets', 1, 338.0],
  ['Disprin', 'Aspirin', 'Reckitt Pakistan', 'Analgesic', 'Tablet', '300mg', '10 tablets', 1, 42.0],
  ['Augmentin 625mg', 'Amoxicillin + Clavulanate', 'GSK Pakistan', 'Antibiotic', 'Tablet', '625mg', '6 tablets', 1, 712.0, true],
  ['Amoxil 500mg', 'Amoxicillin', 'GSK Pakistan', 'Antibiotic', 'Capsule', '500mg', '10 capsules', 1, 352.0, true],
  ['Azomax 500mg', 'Azithromycin', 'Zafa Pharmaceutical', 'Antibiotic', 'Tablet', '500mg', '3 tablets', 1, 324.0, true],
  ['Ciproxin 500mg', 'Ciprofloxacin', 'Bayer Pakistan', 'Antibiotic', 'Tablet', '500mg', '10 tablets', 1, 604.0, true],
  ['Velosef 500mg', 'Cephradine', 'Ferozsons', 'Antibiotic', 'Capsule', '500mg', '12 capsules', 1, 486.0, true],
  ['Flagyl 400mg', 'Metronidazole', 'Sanofi Pakistan', 'Antibiotic', 'Tablet', '400mg', '20 tablets', 1, 224.0, true],
  ['Risek 20mg', 'Omeprazole', 'Getz Pharma', 'Gastro', 'Capsule', '20mg', '14 capsules', 1, 428.0],
  ['Nexum 40mg', 'Esomeprazole', 'Getz Pharma', 'Gastro', 'Capsule', '40mg', '14 capsules', 1, 706.0],
  ['Motilium 10mg', 'Domperidone', 'Highnoon Laboratories', 'Gastro', 'Tablet', '10mg', '30 tablets', 1, 258.0],
  ['Gaviscon Liquid', 'Alginate Antacid', 'Reckitt Pakistan', 'Gastro', 'Syrup', '120ml', '120 ml', 1, 486.0],
  ['Mucaine Suspension', 'Antacid + Oxetacaine', 'Pfizer Pakistan', 'Gastro', 'Syrup', '120ml', '120 ml', 1, 264.0],
  ['Softin 10mg', 'Cetirizine', 'Hilton Pharma', 'Antihistamine', 'Tablet', '10mg', '10 tablets', 1, 94.0],
  ['Telfast 120mg', 'Fexofenadine', 'Sanofi Pakistan', 'Antihistamine', 'Tablet', '120mg', '10 tablets', 1, 424.0],
  ['Montiget 10mg', 'Montelukast', 'Getz Pharma', 'Respiratory', 'Tablet', '10mg', '14 tablets', 1, 608.0, true],
  ['Ventolin Inhaler', 'Salbutamol', 'GSK Pakistan', 'Respiratory', 'Inhaler', '100mcg', '200 doses', 1, 612.0, true],
  ['Ventolin Syrup', 'Salbutamol', 'GSK Pakistan', 'Respiratory', 'Syrup', '2mg/5ml', '120 ml', 1, 152.0],
  ['Actifed Syrup', 'Triprolidine + Pseudoephedrine', 'GSK Pakistan', 'Cold & Flu', 'Syrup', '60ml', '60 ml', 1, 206.0],
  ['Arinac Forte', 'Ibuprofen + Pseudoephedrine', 'Abbott Pakistan', 'Cold & Flu', 'Tablet', '400mg/60mg', '10 tablets', 1, 232.0],
  ['Strepsils Honey Lemon', 'Amylmetacresol', 'Reckitt Pakistan', 'Cold & Flu', 'Lozenge', '—', '24 lozenges', 18, 284.0],
  ['Glucophage 500mg', 'Metformin', 'Merck Pakistan', 'Diabetes', 'Tablet', '500mg', '30 tablets', 1, 204.0, true],
  ['Glucophage XR 500mg', 'Metformin ER', 'Merck Pakistan', 'Diabetes', 'Tablet', '500mg', '30 tablets', 1, 346.0, true],
  ['Diamicron MR 60mg', 'Gliclazide', 'Servier Pakistan', 'Diabetes', 'Tablet', '60mg', '30 tablets', 1, 702.0, true],
  ['NovoMix 30 FlexPen', 'Insulin Aspart', 'Novo Nordisk', 'Diabetes', 'Injection', '100IU/ml', '3 ml pen', 1, 2415.0, true],
  ['Concor 5mg', 'Bisoprolol', 'Merck Pakistan', 'Cardiac', 'Tablet', '5mg', '14 tablets', 1, 384.0, true],
  ['Tenormin 50mg', 'Atenolol', 'Highnoon Laboratories', 'Cardiac', 'Tablet', '50mg', '14 tablets', 1, 236.0, true],
  ['Norvasc 5mg', 'Amlodipine', 'Pfizer Pakistan', 'Cardiac', 'Tablet', '5mg', '14 tablets', 1, 428.0, true],
  ['Lipiget 10mg', 'Atorvastatin', 'Getz Pharma', 'Cardiac', 'Tablet', '10mg', '14 tablets', 1, 356.0, true],
  ['Thyrox 50mcg', 'Levothyroxine', 'Highnoon Laboratories', 'Hormone', 'Tablet', '50mcg', '100 tablets', 1, 552.0, true],
  ['Surbex Z', 'Multivitamin + Zinc', 'Abbott Pakistan', 'Supplement', 'Tablet', '—', '30 tablets', 1, 604.0],
  ['Neurobion Tablets', 'Vitamin B Complex', 'Merck Pakistan', 'Supplement', 'Tablet', '—', '30 tablets', 1, 482.0],
  ['CaC-1000 Plus', 'Calcium + Vitamin C', 'Pfizer Pakistan', 'Supplement', 'Tablet', '1000mg', '10 tablets', 1, 348.0],
  ['Qalsan D', 'Calcium + Vitamin D3', 'Hilton Pharma', 'Supplement', 'Tablet', '—', '30 tablets', 1, 286.0],
  ['Peditral ORS', 'Oral Rehydration Salts', 'Searle', 'Electrolyte', 'Powder', '—', '1 sachet', 1, 62.0],
  ['Pyodine Solution', 'Povidone Iodine', 'Brookes Pharma', 'Antiseptic', 'Liquid', '10%', '60 ml', 1, 184.0],
  ['Polyfax Ointment', 'Polymyxin B + Bacitracin', 'GSK Pakistan', 'Topical', 'Ointment', '—', '20 g', 1, 356.0],
  ['Betnovate-N Cream', 'Betamethasone + Neomycin', 'GSK Pakistan', 'Topical', 'Cream', '—', '20 g', 1, 262.0, true],
  ['Dettol Antiseptic', 'Chloroxylenol', 'Reckitt Pakistan', 'Antiseptic', 'Liquid', '250ml', '250 ml', 18, 452.0],
  ['Glucometer Strips', 'Blood Glucose Test Strips', 'Accu-Chek', 'Device', 'Strips', '—', '25 strips', 18, 1620.0],
  ['Digital Thermometer', 'Thermometer', 'Dr. Morepen', 'Device', 'Device', '—', '1 unit', 18, 905.0],
  ['Surgical Face Mask', 'Face Mask', 'Shield Pakistan', 'Consumable', 'Mask', '—', '1 unit', 18, 22.0],
  ['Surgical Gloves', 'Latex Gloves', 'Shield Pakistan', 'Consumable', 'Gloves', 'Medium', '1 pair', 18, 46.0],
  ['Cotton Roll 100g', 'Absorbent Cotton', 'Shield Pakistan', 'Consumable', 'Roll', '100g', '100 g', 18, 224.0],
  ['Insulin Syringe', 'Insulin Syringe 31G', 'BD Pakistan', 'Consumable', 'Syringe', '1ml', '1 unit', 18, 38.0],
];

const CUSTOMERS = [
  ['Muhammad Asif', '+92 300 4412876', 'Dr. S. Abbasi', 'G-9 Markaz'],
  ['Ayesha Siddiqui', '+92 321 5523987', 'Dr. N. Qureshi', 'F-11 Markaz'],
  ['Bilal Ahmed Khan', '+92 333 6634098', 'Dr. S. Abbasi', 'I-8/3'],
  ['Fatima Noor', '+92 345 7745109', 'Dr. F. Malik', 'E-11/2'],
  ['Usman Ghani', '+92 301 8856210', '', 'Bahria Town Phase 4'],
  ['Hina Shahzad', '+92 322 9967321', 'Dr. N. Qureshi', 'DHA Phase 2'],
  ['Kamran Yousaf', '+92 334 1078432', '', 'G-11/3'],
  ['Nadia Baig', '+92 346 2189543', 'Dr. F. Malik', 'F-10 Markaz'],
  ['Tariq Mehmood', '+92 302 3290654', 'Dr. A. Chaudhry', 'Saddar, Rawalpindi'],
  ['Zainab Rizvi', '+92 323 4301765', '', 'F-7/2'],
  ['Saad Iqbal', '+92 335 5412876', 'Dr. A. Chaudhry', 'Chaklala Scheme 3'],
  ['Mariam Javed', '+92 347 6523987', '', 'G-13/1'],
];

const SUPPLIERS = ['Muller & Phipps Pakistan', 'United Distributors Pakistan', 'Premier Agency', 'Islamabad Drug House'];

const isoDay = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/** The shelf itself, which is the same whichever way a shop starts. */
function buildProducts(rand, between) {
  return CATALOGUE.map(
    ([name, genericName, manufacturer, category, form, strength, packSize, taxRate, mrp, rx]) => ({
      id: id('prd'),
      name,
      genericName,
      manufacturer,
      category,
      form,
      strength,
      packSize,
      hsCode: '3004',
      taxRate,
      unit: form === 'Tablet' || form === 'Capsule' ? 'strip' : 'unit',
      rack: `${String.fromCharCode(65 + between(0, 7))}${between(1, 6)}`,
      reorderLevel: between(10, 30),
      prescriptionRequired: Boolean(rx),
      barcode: String(8_960_000_000_000 + between(100000, 999999)),
      notes: '',
      createdAt: new Date().toISOString(),
      _mrp: mrp,
    }),
  );
}

/**
 * A shop mid-life: stock on the shelves, regulars on the books and ten weeks of
 * trade behind it. This is for looking at the app, not for opening one — every
 * number in it is invented. Reach it with --demo.
 */
export function buildDemo() {
  const rand = rng();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const db = emptyDb();
  const products = buildProducts(rand, between);

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
    address: `${address}, Islamabad`,
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
          hsCode: product.hsCode,
          unit: product.unit,
          qty,
          mrp: batch.mrp,
          salePrice: batch.salePrice,
          costPrice: batch.costPrice,
          taxRate: product.taxRate,
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
      // Cash still dominates a Pakistani counter, with digital wallets a clear second.
      const mode = !customer
        ? pick(['cash', 'cash', 'cash', 'digital', 'card'])
        : pick(['cash', 'cash', 'digital', 'digital', 'card', 'credit']);
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
        // The demo history is split between the two people a fresh install
        // creates, so the attribution columns have something to show.
        soldBy: rand() < 0.65 ? 'Counter' : 'Owner',
        soldById: null,
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
      mode: pick(['cash', 'cash', 'digital']),
      note: share === 1 ? 'Account cleared' : 'Part payment',
      at: when.toISOString(),
    });
  }
  db.payments = payments.sort((a, b) => b.at.localeCompare(a.at));

  return db;
}

/**
 * What a new shop actually opens with: the catalogue, and one empty batch per
 * medicine holding a starting price. No customers, no bills, no takings —
 * those belong to whoever trades here, not to a demo.
 *
 * The batches are priced but carry no stock on purpose. Nothing can be sold
 * from a batch with no quantity, so the first thing anyone does with a medicine
 * is open its batch and enter what is on the shelf — which is the same moment
 * they replace the OPENING placeholder with the real batch number and expiry.
 * A count nobody counted never reaches a report that way, and no expiry alert
 * fires for a box the shop never bought.
 */
export function buildStarter() {
  const rand = rng();
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const db = emptyDb();
  const products = buildProducts(rand, between);

  const batches = products.map((product) => ({
    id: id('bch'),
    productId: product.id,
    batchNo: 'OPENING',
    expiry: isoDay(730),
    mrp: round2(product._mrp),
    salePrice: round2(product._mrp),
    costPrice: round2(product._mrp * 0.78),
    quantity: 0,
    supplier: '',
    receivedAt: isoDay(0),
    createdAt: new Date().toISOString(),
  }));
  for (const product of products) delete product._mrp;

  db.products = products;
  db.batches = batches;
  return db;
}

/**
 * Writes the starting data only when there is no database yet, or when --force
 * is passed. --demo asks for the invented shop instead of a clean catalogue.
 */
export function ensureSeed() {
  const force = process.argv.includes('--force');
  const demo = process.argv.includes('--demo');
  const exists = fs.existsSync(DB_FILE);
  if (exists && !force) {
    const db = readDb();
    if (db.products.length > 0) return false;
  }
  const seeded = demo ? buildDemo() : buildStarter();
  resetCache();
  // Returned, not fired and forgotten: the caller awaits this so a data folder
  // it cannot write to becomes a clear startup message rather than an
  // unhandled rejection.
  const written = writeDb((db) => {
    Object.assign(db, seeded);
  }).then(() => {
    console.log(
      demo
        ? `[seed] demo shop ready — ${seeded.products.length} medicines, ${seeded.batches.length} batches, ${seeded.sales.length} bills, ${seeded.payments.length} credit settlements.`
        : `[seed] starter catalogue ready — ${seeded.products.length} medicines priced, no stock, no customers, no sales. Enter what is on the shelf to begin.`,
    );
    return true;
  });
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeed();
}
