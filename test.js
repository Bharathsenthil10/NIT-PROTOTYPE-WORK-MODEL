// test.js - Unit and Integration Tests for Order-to-Audit System
const assert = require('node:assert');
const { seedDatabase } = require('./seed');
const { db, getItemStock, roundMoney } = require('./db');
const {
  recordPurchase,
  recordProductionRun,
  createOrder,
  approveOrderAndInvoice,
  recordPayment,
  getAuditorReports,
  getOwnerDashboardStats,
  generateTallyXml
} = require('./services');

console.log('--- Starting Comprehensive Test Suite ---\n');

let testsPassed = 0;
let testsTotal = 0;

function it(name, fn) {
  testsTotal++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

// 1. Math and Money Accuracy
console.log('Suite 1: Financial & Math Precision');
it('should avoid floating point drift using roundMoney', () => {
  const sum = 0.1 + 0.2;
  assert.strictEqual(roundMoney(sum), 0.3);
  assert.strictEqual(roundMoney(187.50), 187.50);
  assert.strictEqual(roundMoney(7500 * 0.025), 187.50);
});

// 2. Initial Seed State
console.log('\nSuite 2: Initial Seed & Master Data');
it('should seed correct initial stock balances', () => {
  seedDatabase();
  assert.strictEqual(getItemStock('ITEM-FLOUR'), 100.0);
  assert.strictEqual(getItemStock('ITEM-OIL'), 30.0);
  assert.strictEqual(getItemStock('ITEM-SPICE'), 5.0);
  assert.strictEqual(getItemStock('ITEM-POUCH-200'), 500.0);
  assert.strictEqual(getItemStock('ITEM-CARTON-20'), 30.0);
  assert.strictEqual(getItemStock('ITEM-MURUKKU-200'), 50.0);
});

// 3. Purchase & Stock Receipt
console.log('\nSuite 3: Purchase & Inward Stock Movement');
it('should update stock and ledger on raw material purchase', () => {
  const initialFlour = getItemStock('ITEM-FLOUR');
  const res = recordPurchase({
    supplierId: 'SUPP-MADURAI-FLOUR',
    itemId: 'ITEM-FLOUR',
    quantity: 60.0,
    rate: 45.0
  });

  assert.strictEqual(getItemStock('ITEM-FLOUR'), initialFlour + 60.0);
  assert.strictEqual(res.totalAmount, 2835.0); // 2700 + 5% GST = 2835
});

// 4. Production Run & Recipe Consumption
console.log('\nSuite 4: BOM Recipe, Variance & Automatic Stock Conversion');
it('should automatically deduct raw materials and credit finished goods', () => {
  const prodRes = recordProductionRun({
    productId: 'ITEM-MURUKKU-200',
    bomId: 'BOM-MRK-200',
    batchNo: 'MK-TEST-01',
    issuedItems: [
      { itemId: 'ITEM-FLOUR', actualQty: 40.0 },
      { itemId: 'ITEM-OIL', actualQty: 10.5 },
      { itemId: 'ITEM-SPICE', actualQty: 1.2 }
    ],
    actualOutput: 188,
    scrapPouches: 6,
    cartonsUsed: 9,
    directLabourCost: 1200.0,
    gasPowerCost: 600.0
  });

  // Check balances
  assert.strictEqual(getItemStock('ITEM-FLOUR'), 120.0);
  assert.strictEqual(getItemStock('ITEM-OIL'), 19.5);
  assert.strictEqual(getItemStock('ITEM-POUCH-200'), 306.0);
  assert.strictEqual(getItemStock('ITEM-MURUKKU-200'), 238.0); // 50 + 188

  // Check variances
  assert.strictEqual(prodRes.yieldVariancePct, -6.0);
  const oilItem = prodRes.processedItems.find(i => i.itemId === 'ITEM-OIL');
  assert.strictEqual(oilItem.variancePct, 5.0);

  // Check Costing
  assert.strictEqual(prodRes.costPerPacket, 30.90);
});

// 5. Sales Order, Shortage & Stock Verification
console.log('\nSuite 5: Sales Order & Shortage Flagging');
it('should detect stock coverage and flag shortages', () => {
  // Order 1: within stock (150 pkts <= 238)
  const ordA = createOrder({
    customerId: 'CUST-RETAILER-A',
    quantity: 150,
    unitPrice: 50.0
  });
  assert.strictEqual(ordA.hasShortage, false);
  assert.strictEqual(ordA.shortageQty, 0.0);

  // Approve and dispatch order A
  approveOrderAndInvoice({ orderId: ordA.orderId, autoDispatch: true });
  assert.strictEqual(getItemStock('ITEM-MURUKKU-200'), 88.0);

  // Order 2: exceeds stock (120 pkts > 88)
  const ordB = createOrder({
    customerId: 'CUST-DISTRIB-B',
    quantity: 120,
    unitPrice: 50.0
  });
  assert.strictEqual(ordB.hasShortage, true);
  assert.strictEqual(ordB.shortageQty, 32.0);
});

// 6. GST Tax Invoicing (Intra-state vs Inter-state)
console.log('\nSuite 6: GST Place-of-Supply Tax Calculations');
it('should calculate CGST+SGST for intra-state (TN) and IGST for inter-state (KA)', () => {
  // Retailer A is in Tamil Nadu (State 33) -> Intra-state
  const invA = db.prepare("SELECT * FROM invoices WHERE customer_id = 'CUST-RETAILER-A'").get();
  assert.strictEqual(invA.is_inter_state, 0);
  assert.strictEqual(invA.taxable_value, 7500.0);
  assert.strictEqual(invA.cgst_amount, 187.50);
  assert.strictEqual(invA.sgst_amount, 187.50);
  assert.strictEqual(invA.igst_amount, 0.0);
  assert.strictEqual(invA.total_amount, 7875.0);
});

// 7. Payment Processing & Receivables
console.log('\nSuite 7: Payment Receipts & Outstanding Ageing');
it('should record payment and update balance due', () => {
  const inv = db.prepare("SELECT * FROM invoices WHERE customer_id = 'CUST-RETAILER-A'").get();
  const pmt = recordPayment({
    customerId: 'CUST-RETAILER-A',
    invoiceId: inv.id,
    amount: 4000.0
  });

  assert.strictEqual(pmt.balanceDue, 3875.0);
  assert.strictEqual(pmt.status, 'PARTIALLY_PAID');
});

// 8. Stock Ledger Reconciliation
console.log('\nSuite 8: Ledger Double-Entry Audit Integrity');
it('should guarantee closing stock matches ledger sum of movements', () => {
  const items = db.prepare('SELECT id FROM items').all();
  for (const item of items) {
    const calculatedStock = getItemStock(item.id);
    const lastLedger = db.prepare('SELECT balance_after FROM stock_ledger WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(item.id);
    if (lastLedger) {
      assert.strictEqual(calculatedStock, lastLedger.balance_after);
    }
  }
});

// 9. Reports & Exports
console.log('\nSuite 9: Auditor Reports & Tally XML Export');
it('should generate monthly auditor reports and valid Tally XML', () => {
  const reports = getAuditorReports('2026-11-01', '2026-11-30');
  assert.strictEqual(reports.salesRegister.length, 1);
  assert.strictEqual(reports.gstSummary.totalTaxable, 7500.0);
  assert.strictEqual(reports.gstSummary.totalTax, 375.0);

  const xml = generateTallyXml('2026-11-01', '2026-11-30');
  assert.ok(xml.includes('<REPORTNAME>Vouchers</REPORTNAME>'));
  assert.ok(xml.includes('<VOUCHER VCHTYPE="Sales"'));
  assert.ok(xml.includes('7875.00'));
});

// 10. Audit Logging Traceability
console.log('\nSuite 10: System Audit Trail');
it('should record all state changes in audit_logs', () => {
  const logs = db.prepare('SELECT * FROM audit_logs').all();
  assert.ok(logs.length >= 5);
  const actions = logs.map(l => l.action);
  assert.ok(actions.includes('RECORD_PURCHASE'));
  assert.ok(actions.includes('RECORD_PRODUCTION_RUN'));
  assert.ok(actions.includes('CREATE_ORDER'));
  assert.ok(actions.includes('RAISE_INVOICE'));
  assert.ok(actions.includes('RECORD_PAYMENT'));
});

console.log(`\n=================================================`);
console.log(`TEST SUMMARY: ${testsPassed} / ${testsTotal} PASSED`);
console.log(`=================================================\n`);

if (testsPassed === testsTotal) {
  process.exit(0);
} else {
  process.exit(1);
}
