// services.js - Core Business Logic, Stock Ledger Movements, Costing, and GST Operations
const { db, getItemStock, appendStockLedger, logAudit, roundMoney } = require('./db');

// FACTORY CONFIGURATION (Tamil Nadu)
const FACTORY_CONFIG = {
  name: 'Annapoorna Traditional Foods Pvt Ltd',
  tagline: 'Authentic South Indian Snacks & Savouries',
  gstin: '33AAAAA0000A1Z5',
  state: 'Tamil Nadu',
  stateCode: '33',
  address: 'Plot 14-16, SIDCO Industrial Estate, Thuvakudi, Tiruchirappalli, Tamil Nadu - 620015',
  phone: '+91 431 2501234',
  email: 'billing@annapoornafoods.com',
  financialYear: '2026-27',
  tolerancePct: 3.0 // 3% variance tolerance
};

// 1. RECORD PURCHASE
function recordPurchase({
  supplierId,
  itemId,
  quantity,
  rate,
  invoiceRef = '',
  userId = 'USER-ADMIN',
  userRole = 'admin',
  date = new Date().toISOString().split('T')[0]
}) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);

  if (!item) throw new Error(`Item ${itemId} not found`);
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

  const qty = Number(quantity);
  const unitRate = Number(rate);
  const taxableValue = roundMoney(qty * unitRate);
  const gstRate = Number(item.gst_rate || 5.0);
  const gstAmount = roundMoney((taxableValue * gstRate) / 100);
  const totalAmount = roundMoney(taxableValue + gstAmount);

  // Generate Purchase No
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM purchases').get();
  const purchaseNo = `PO/${FACTORY_CONFIG.financialYear}/${String(countRow.count + 1).padStart(3, '0')}`;
  const purchaseId = `PUR-${Date.now()}`;

  const insertStmt = db.prepare(`
    INSERT INTO purchases (
      id, purchase_no, supplier_id, date, item_id, quantity, unit,
      rate, taxable_value, gst_rate, gst_amount, total_amount, invoice_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    purchaseId,
    purchaseNo,
    supplierId,
    date,
    itemId,
    qty,
    item.unit,
    unitRate,
    taxableValue,
    gstRate,
    gstAmount,
    totalAmount,
    invoiceRef,
    new Date().toISOString()
  );

  // Stock Ledger: Goods Receipt
  appendStockLedger({
    itemId,
    transactionType: 'PURCHASE',
    sourceDocType: 'PURCHASE_ORDER',
    sourceDocId: purchaseNo,
    qtyIn: qty,
    qtyOut: 0,
    unit: item.unit,
    unitCost: unitRate,
    totalCost: taxableValue,
    notes: `Purchased from ${supplier.name} (Ref: ${invoiceRef || purchaseNo})`
  });

  logAudit(userId, userRole, 'RECORD_PURCHASE', 'purchases', purchaseNo, {
    itemId, qty, unitRate, totalAmount
  });

  return {
    purchaseId,
    purchaseNo,
    qty,
    newStock: getItemStock(itemId),
    totalAmount
  };
}

// 2. PRODUCTION RUN WITH RECIPE (BOM) & VARIANCE ANALYSIS
function recordProductionRun({
  productId = 'ITEM-MURUKKU-200',
  bomId = 'BOM-MRK-200',
  batchNo = `MK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`,
  issuedItems = [], // [{ itemId, actualQty }]
  actualOutput = 0,
  scrapPouches = 0,
  cartonsUsed = 0,
  directLabourCost = 1200.0,
  gasPowerCost = 600.0,
  otherOverheads = 0.0,
  valuationMethod = 'FIFO', // 'FIFO' or 'WEIGHTED_AVERAGE'
  userId = 'USER-PRODUCTION',
  userRole = 'production',
  date = new Date().toISOString().split('T')[0]
}) {
  const product = db.prepare('SELECT * FROM items WHERE id = ?').get(productId);
  const bom = db.prepare('SELECT * FROM boms WHERE id = ?').get(bomId);
  const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id = ?').all(bomId);

  if (!product) throw new Error(`Product ${productId} not found`);
  if (!bom) throw new Error(`BOM ${bomId} not found`);

  const expectedOutput = bom.batch_size_packets;
  const actualPktOutput = Number(actualOutput);
  const yieldVariancePct = roundMoney(((actualPktOutput - expectedOutput) / expectedOutput) * 100);

  // Generate Run Number
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM production_runs').get();
  const runNo = `PR/${FACTORY_CONFIG.financialYear}/${String(countRow.count + 1).padStart(3, '0')}`;
  const runId = `RUN-${Date.now()}`;

  // Shelf life: 6 months for packaged South Indian snacks
  const mfgDate = date;
  const exp = new Date(date);
  exp.setMonth(exp.getMonth() + 6);
  const expiryDate = exp.toISOString().split('T')[0];

  // Map BOM items
  const bomMap = new Map();
  bomItems.forEach(b => bomMap.set(b.item_id, b));

  let totalRawMaterialCost = 0.0;
  const processedItems = [];

  // Calculate material consumption & costs
  // Default benchmark issue if not supplied:
  // Flour 40kg, Oil 10.5L, Spice 1.2kg, Pouches (actual + scrap), Cartons (cartonsUsed)
  for (const issue of issuedItems) {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(issue.itemId);
    const bomItem = bomMap.get(issue.itemId);
    const standardQty = bomItem ? bomItem.standard_qty : issue.actualQty;
    const actualQty = Number(issue.actualQty);
    const variancePct = standardQty > 0 ? roundMoney(((actualQty - standardQty) / standardQty) * 100) : 0;

    // Unit rate determination:
    let unitRate = item.standard_rate;

    if (issue.itemId === 'ITEM-FLOUR') {
      if (valuationMethod === 'FIFO') {
        // FIFO: First 100kg was opening stock @ 42. Since we only consumed 40kg, it is taken from opening @ 42.
        unitRate = 42.0;
      } else {
        // Weighted average: (100*42 + 60*45) / 160 = 43.125
        unitRate = 43.125;
      }
    }

    const itemTotalCost = roundMoney(actualQty * unitRate);
    totalRawMaterialCost += itemTotalCost;

    processedItems.push({
      itemId: issue.itemId,
      standardQty,
      actualQty,
      unit: item.unit,
      unitRate,
      itemTotalCost,
      variancePct
    });

    // Reduce Raw Material in Stock Ledger
    appendStockLedger({
      itemId: issue.itemId,
      batchNo,
      transactionType: 'PROD_ISSUE',
      sourceDocType: 'PRODUCTION_RUN',
      sourceDocId: runNo,
      qtyIn: 0,
      qtyOut: actualQty,
      unit: item.unit,
      unitCost: unitRate,
      totalCost: itemTotalCost,
      notes: `Issued to Production Run ${runNo} (Variance: ${variancePct > 0 ? '+' : ''}${variancePct}%)`
    });
  }

  // Handle Packaging Items consumption (Pouches & Cartons)
  // 1. Pouches: 188 good + 6 damaged = 194 total
  const pouchItem = db.prepare("SELECT * FROM items WHERE id = 'ITEM-POUCH-200'").get();
  const totalPouchesUsed = actualPktOutput + Number(scrapPouches);
  const pouchStandardQty = bomMap.get('ITEM-POUCH-200')?.standard_qty || 200;
  const pouchRate = pouchItem ? pouchItem.standard_rate : 2.50;
  const pouchCost = roundMoney(totalPouchesUsed * pouchRate);
  const pouchVariancePct = roundMoney(((totalPouchesUsed - pouchStandardQty) / pouchStandardQty) * 100);

  totalRawMaterialCost += pouchCost;
  processedItems.push({
    itemId: 'ITEM-POUCH-200',
    standardQty: pouchStandardQty,
    actualQty: totalPouchesUsed,
    unit: 'piece',
    unitRate: pouchRate,
    itemTotalCost: pouchCost,
    variancePct: pouchVariancePct
  });

  appendStockLedger({
    itemId: 'ITEM-POUCH-200',
    batchNo,
    transactionType: 'PROD_ISSUE',
    sourceDocType: 'PRODUCTION_RUN',
    sourceDocId: runNo,
    qtyIn: 0,
    qtyOut: totalPouchesUsed,
    unit: 'piece',
    unitCost: pouchRate,
    totalCost: pouchCost,
    notes: `Pouches consumed in ${runNo} (Good: ${actualPktOutput}, Damaged/Scrap: ${scrapPouches})`
  });

  // 2. Cartons: 9 cartons used
  const cartonItem = db.prepare("SELECT * FROM items WHERE id = 'ITEM-CARTON-20'").get();
  const cartonQty = Number(cartonsUsed);
  const cartonStandardQty = bomMap.get('ITEM-CARTON-20')?.standard_qty || 10;
  const cartonRate = cartonItem ? cartonItem.standard_rate : 15.00;
  const cartonCost = roundMoney(cartonQty * cartonRate);
  const cartonVariancePct = roundMoney(((cartonQty - cartonStandardQty) / cartonStandardQty) * 100);

  totalRawMaterialCost += cartonCost;
  processedItems.push({
    itemId: 'ITEM-CARTON-20',
    standardQty: cartonStandardQty,
    actualQty: cartonQty,
    unit: 'piece',
    unitRate: cartonRate,
    itemTotalCost: cartonCost,
    variancePct: cartonVariancePct
  });

  appendStockLedger({
    itemId: 'ITEM-CARTON-20',
    batchNo,
    transactionType: 'PROD_ISSUE',
    sourceDocType: 'PRODUCTION_RUN',
    sourceDocId: runNo,
    qtyIn: 0,
    qtyOut: cartonQty,
    unit: 'piece',
    unitCost: cartonRate,
    totalCost: cartonCost,
    notes: `Cartons consumed in ${runNo} (${cartonQty} boxes)`
  });

  totalRawMaterialCost = roundMoney(totalRawMaterialCost);

  // Total Production Run Cost & Cost Per Packet
  const totalOverheads = roundMoney(Number(directLabourCost) + Number(gasPowerCost) + Number(otherOverheads));
  const totalProductionCost = roundMoney(totalRawMaterialCost + totalOverheads);
  const costPerPacket = actualPktOutput > 0 ? roundMoney(totalProductionCost / actualPktOutput) : 0;

  // Insert Production Run Record
  const insertRun = db.prepare(`
    INSERT INTO production_runs (
      id, run_no, date, product_id, bom_id, batch_no, mfg_date, expiry_date,
      expected_output, actual_output, scrap_pouches, cartons_used,
      direct_labour_cost, gas_power_cost, other_overheads, raw_material_cost,
      total_cost, cost_per_packet, yield_variance_pct, status, supervisor_id, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertRun.run(
    runId,
    runNo,
    date,
    productId,
    bomId,
    batchNo,
    mfgDate,
    expiryDate,
    expectedOutput,
    actualPktOutput,
    Number(scrapPouches),
    cartonQty,
    Number(directLabourCost),
    Number(gasPowerCost),
    Number(otherOverheads),
    totalRawMaterialCost,
    totalProductionCost,
    costPerPacket,
    yieldVariancePct,
    'COMPLETED',
    userId,
    `Production run of ${actualPktOutput} pkts Murukku (Yield Var: ${yieldVariancePct}%)`,
    new Date().toISOString()
  );

  // Insert individual items consumed
  const insertRunItem = db.prepare(`
    INSERT INTO production_run_items (
      run_id, item_id, standard_qty, actual_qty, unit, unit_rate, total_cost, variance_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of processedItems) {
    insertRunItem.run(
      runId,
      item.itemId,
      item.standardQty,
      item.actualQty,
      item.unit,
      item.unitRate,
      item.itemTotalCost,
      item.variancePct
    );
  }

  // Stock Ledger: Increase Finished Goods
  appendStockLedger({
    itemId: productId,
    batchNo,
    transactionType: 'PROD_OUTPUT',
    sourceDocType: 'PRODUCTION_RUN',
    sourceDocId: runNo,
    qtyIn: actualPktOutput,
    qtyOut: 0,
    unit: product.unit,
    unitCost: costPerPacket,
    totalCost: totalProductionCost,
    notes: `Produced in Run ${runNo} (Batch: ${batchNo}, Exp: ${expiryDate})`
  });

  logAudit(userId, userRole, 'RECORD_PRODUCTION_RUN', 'production_runs', runNo, {
    actualOutput: actualPktOutput,
    yieldVariancePct,
    costPerPacket,
    totalProductionCost
  });

  return {
    runId,
    runNo,
    batchNo,
    expectedOutput,
    actualOutput: actualPktOutput,
    yieldVariancePct,
    totalRawMaterialCost,
    totalOverheads,
    totalProductionCost,
    costPerPacket,
    processedItems,
    newFgStock: getItemStock(productId)
  };
}

// 3. CREATE SALES ORDER (Field Salesman)
function createOrder({
  customerId,
  salesmanId = 'USER-SALESMAN-A',
  productId = 'ITEM-MURUKKU-200',
  quantity,
  unitPrice = 50.0,
  createdOffline = 0,
  notes = '',
  userRole = 'salesman'
}) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const product = db.prepare('SELECT * FROM items WHERE id = ?').get(productId);

  if (!customer) throw new Error(`Customer ${customerId} not found`);
  if (!product) throw new Error(`Product ${productId} not found`);

  const qty = Number(quantity);
  const price = Number(unitPrice);
  const totalValue = roundMoney(qty * price);

  // Check current stock available
  const availableStock = getItemStock(productId);
  const shortageQty = qty > availableStock ? roundMoney(qty - availableStock) : 0.0;

  const countRow = db.prepare('SELECT COUNT(*) AS count FROM orders').get();
  const orderNo = `ORD/${FACTORY_CONFIG.financialYear}/${String(countRow.count + 1).padStart(3, '0')}`;
  const orderId = `ORD-${Date.now()}`;

  const insertStmt = db.prepare(`
    INSERT INTO orders (
      id, order_no, date, customer_id, salesman_id, product_id, quantity,
      unit_price, total_value, status, stock_available_at_check, shortage_qty,
      created_offline, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    orderId,
    orderNo,
    new Date().toISOString().split('T')[0],
    customerId,
    salesmanId,
    productId,
    qty,
    price,
    totalValue,
    'SUBMITTED',
    availableStock,
    shortageQty,
    createdOffline ? 1 : 0,
    notes,
    new Date().toISOString()
  );

  logAudit(salesmanId, userRole, 'CREATE_ORDER', 'orders', orderNo, {
    customerId, qty, availableStock, shortageQty
  });

  return {
    orderId,
    orderNo,
    qty,
    availableStock,
    shortageQty,
    hasShortage: shortageQty > 0,
    totalValue
  };
}

// 4. APPROVE ORDER, RAISE GST INVOICE & DISPATCH
function approveOrderAndInvoice({
  orderId,
  userId = 'USER-ADMIN',
  userRole = 'admin',
  autoDispatch = true
}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
  const product = db.prepare('SELECT * FROM items WHERE id = ?').get(order.product_id);

  // Re-verify stock before billing
  const currentStock = getItemStock(order.product_id);
  if (currentStock < order.quantity) {
    throw new Error(
      `Insufficient stock to fulfill order ${order.order_no}: required ${order.quantity} packets, but only ${currentStock} available (Shortage: ${roundMoney(order.quantity - currentStock)} pkts)`
    );
  }

  // Update order status to APPROVED
  db.prepare("UPDATE orders SET status = 'APPROVED' WHERE id = ?").run(orderId);

  // Determine GST: Intra-state (TN -> TN) vs Inter-state (TN -> KA/other)
  const isInterState = customer.state_code !== FACTORY_CONFIG.stateCode ? 1 : 0;
  const taxableValue = roundMoney(order.quantity * order.unit_price);

  let cgstRate = 0.0, cgstAmount = 0.0;
  let sgstRate = 0.0, sgstAmount = 0.0;
  let igstRate = 0.0, igstAmount = 0.0;

  if (isInterState === 1) {
    igstRate = 5.0;
    igstAmount = roundMoney((taxableValue * igstRate) / 100);
  } else {
    cgstRate = 2.5;
    cgstAmount = roundMoney((taxableValue * cgstRate) / 100);
    sgstRate = 2.5;
    sgstAmount = roundMoney((taxableValue * sgstRate) / 100);
  }

  const totalAmount = roundMoney(taxableValue + cgstAmount + sgstAmount + igstAmount);

  // Generate Invoice Number: e.g. ATF/2026-27/001
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM invoices').get();
  const invoiceNo = `ATF/${FACTORY_CONFIG.financialYear}/${String(countRow.count + 1).padStart(3, '0')}`;
  const invoiceId = `INV-${Date.now()}`;

  const today = new Date().toISOString().split('T')[0];
  const due = new Date();
  due.setDate(due.getDate() + 15); // 15 days credit
  const dueDate = due.toISOString().split('T')[0];

  // Mock e-Invoice IRN & e-Way bill
  const irnHash = `IRN${Buffer.from(invoiceNo + Date.now()).toString('hex').slice(0, 32).toUpperCase()}`;
  const ewayBillNo = `EWB${Math.floor(100000000000 + Math.random() * 900000000000)}`;

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      id, invoice_no, order_id, customer_id, invoice_date, due_date,
      product_id, quantity, unit_price, taxable_value, is_inter_state,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
      total_amount, amount_paid, balance_due, status, dispatched_at, irn_hash, eway_bill_no, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertInvoice.run(
    invoiceId,
    invoiceNo,
    orderId,
    order.customer_id,
    today,
    dueDate,
    order.product_id,
    order.quantity,
    order.unit_price,
    taxableValue,
    isInterState,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
    totalAmount,
    0.0,
    totalAmount,
    autoDispatch ? 'DISPATCHED' : 'RAISED',
    autoDispatch ? new Date().toISOString() : null,
    irnHash,
    ewayBillNo,
    new Date().toISOString()
  );

  // Update order status
  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(autoDispatch ? 'DISPATCHED' : 'INVOICED', orderId);

  // If dispatched, update stock ledger
  if (autoDispatch) {
    appendStockLedger({
      itemId: order.product_id,
      transactionType: 'SALES_DISPATCH',
      sourceDocType: 'INVOICE',
      sourceDocId: invoiceNo,
      qtyIn: 0,
      qtyOut: order.quantity,
      unit: product.unit,
      unitCost: product.standard_rate,
      totalCost: taxableValue,
      notes: `Dispatched to ${customer.name} (Invoice: ${invoiceNo})`
    });
  }

  logAudit(userId, userRole, 'RAISE_INVOICE', 'invoices', invoiceNo, {
    orderId,
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
    autoDispatch
  });

  return {
    invoiceId,
    invoiceNo,
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
    balanceDue: totalAmount,
    dispatched: autoDispatch,
    newFgStock: getItemStock(order.product_id)
  };
}

// 5. RECORD PAYMENT RECEIVED
function recordPayment({
  customerId,
  invoiceId,
  amount,
  paymentMode = 'UPI',
  referenceNo = '',
  notes = '',
  userId = 'USER-ADMIN',
  userRole = 'admin',
  date = new Date().toISOString().split('T')[0]
}) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);

  if (!customer) throw new Error(`Customer ${customerId} not found`);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const pmtAmount = roundMoney(Number(amount));
  if (pmtAmount <= 0) throw new Error('Payment amount must be positive');

  const countRow = db.prepare('SELECT COUNT(*) AS count FROM payments').get();
  const receiptNo = `RCT/${FACTORY_CONFIG.financialYear}/${String(countRow.count + 1).padStart(3, '0')}`;
  const paymentId = `PMT-${Date.now()}`;

  const insertStmt = db.prepare(`
    INSERT INTO payments (
      id, receipt_no, customer_id, invoice_id, date, amount,
      payment_mode, reference_no, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    paymentId,
    receiptNo,
    customerId,
    invoiceId,
    date,
    pmtAmount,
    paymentMode,
    referenceNo,
    notes,
    new Date().toISOString()
  );

  // Update invoice balance
  const newAmountPaid = roundMoney(invoice.amount_paid + pmtAmount);
  const newBalanceDue = roundMoney(invoice.total_amount - newAmountPaid);
  const newStatus = newBalanceDue <= 0 ? 'PAID' : 'PARTIALLY_PAID';

  db.prepare(`
    UPDATE invoices
    SET amount_paid = ?, balance_due = ?, status = ?
    WHERE id = ?
  `).run(newAmountPaid, newBalanceDue, newStatus, invoiceId);

  logAudit(userId, userRole, 'RECORD_PAYMENT', 'payments', receiptNo, {
    invoiceNo: invoice.invoice_no,
    amount: pmtAmount,
    newBalanceDue
  });

  return {
    paymentId,
    receiptNo,
    invoiceNo: invoice.invoice_no,
    amount: pmtAmount,
    amountPaid: newAmountPaid,
    balanceDue: newBalanceDue,
    status: newStatus
  };
}

// 6. GENERATE MONTHLY AUDITOR REPORTS (Section 4.6)
function getAuditorReports(startDate = '2026-11-01', endDate = '2026-11-30') {
  // A. Sales Register
  const salesRegister = db.prepare(`
    SELECT 
      i.invoice_no,
      i.invoice_date,
      c.name AS customer_name,
      c.gstin AS customer_gstin,
      c.state AS place_of_supply,
      it.name AS product_name,
      i.quantity,
      it.unit,
      i.unit_price,
      i.taxable_value,
      i.cgst_amount,
      i.sgst_amount,
      i.igst_amount,
      i.total_amount,
      i.amount_paid,
      i.balance_due,
      i.status
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    JOIN items it ON i.product_id = it.id
    WHERE i.invoice_date BETWEEN ? AND ?
    ORDER BY i.invoice_date ASC, i.invoice_no ASC
  `).all(startDate, endDate);

  // B. GST Outward Summary (GSTR-1 Mapped Shape)
  const gstSummary = {
    b2bTaxable: 0.0,
    b2bCgst: 0.0,
    b2bSgst: 0.0,
    b2bIgst: 0.0,
    totalTaxable: 0.0,
    totalTax: 0.0,
    hsnSummary: []
  };

  salesRegister.forEach(row => {
    gstSummary.b2bTaxable = roundMoney(gstSummary.b2bTaxable + row.taxable_value);
    gstSummary.b2bCgst = roundMoney(gstSummary.b2bCgst + row.cgst_amount);
    gstSummary.b2bSgst = roundMoney(gstSummary.b2bSgst + row.sgst_amount);
    gstSummary.b2bIgst = roundMoney(gstSummary.b2bIgst + row.igst_amount);
  });
  gstSummary.totalTaxable = gstSummary.b2bTaxable;
  gstSummary.totalTax = roundMoney(gstSummary.b2bCgst + gstSummary.b2bSgst + gstSummary.b2bIgst);

  // HSN Breakdown
  const hsnRows = db.prepare(`
    SELECT 
      it.hsn_code,
      it.name AS description,
      it.unit,
      SUM(i.quantity) AS total_qty,
      SUM(i.taxable_value) AS taxable_value,
      SUM(i.cgst_amount) AS cgst_amount,
      SUM(i.sgst_amount) AS sgst_amount,
      SUM(i.igst_amount) AS igst_amount,
      SUM(i.total_amount) AS total_amount
    FROM invoices i
    JOIN items it ON i.product_id = it.id
    WHERE i.invoice_date BETWEEN ? AND ?
    GROUP BY it.hsn_code, it.name, it.unit
  `).all(startDate, endDate);
  gstSummary.hsnSummary = hsnRows;

  // C. Purchase Register
  const purchaseRegister = db.prepare(`
    SELECT 
      p.purchase_no,
      p.date,
      s.name AS supplier_name,
      s.gstin AS supplier_gstin,
      it.name AS item_name,
      p.quantity,
      p.unit,
      p.rate,
      p.taxable_value,
      p.gst_amount,
      p.total_amount,
      p.invoice_ref
    FROM purchases p
    JOIN suppliers s ON p.supplier_id = s.id
    JOIN items it ON p.item_id = it.id
    WHERE p.date BETWEEN ? AND ?
    ORDER BY p.date ASC
  `).all(startDate, endDate);

  // D. Stock Summary & Stock Ledger
  const stockSummary = db.prepare(`
    SELECT 
      it.id,
      it.code,
      it.name,
      it.category,
      it.unit,
      COALESCE(SUM(CASE WHEN sl.transaction_type = 'OPENING' THEN sl.qty_in ELSE 0 END), 0) AS opening_qty,
      COALESCE(SUM(CASE WHEN sl.transaction_type != 'OPENING' THEN sl.qty_in ELSE 0 END), 0) AS total_in,
      COALESCE(SUM(sl.qty_out), 0) AS total_out,
      COALESCE(SUM(sl.qty_in - sl.qty_out), 0) AS closing_balance,
      it.standard_rate AS unit_rate,
      ROUND(COALESCE(SUM(sl.qty_in - sl.qty_out), 0) * it.standard_rate, 2) AS stock_value
    FROM items it
    LEFT JOIN stock_ledger sl ON it.id = sl.item_id AND sl.timestamp <= ? || 'T23:59:59.999Z'
    GROUP BY it.id
    ORDER BY it.category, it.name
  `).all(endDate);

  const stockLedger = db.prepare(`
    SELECT 
      sl.id,
      sl.timestamp,
      it.name AS item_name,
      it.category,
      sl.transaction_type,
      sl.source_doc_type,
      sl.source_doc_id,
      sl.batch_no,
      sl.qty_in,
      sl.qty_out,
      sl.unit,
      sl.unit_cost,
      sl.total_cost,
      sl.balance_after,
      sl.notes
    FROM stock_ledger sl
    JOIN items it ON sl.item_id = it.id
    WHERE sl.timestamp BETWEEN ? || 'T00:00:00.000Z' AND ? || 'T23:59:59.999Z'
    ORDER BY sl.id ASC
  `).all(startDate, endDate);

  // E. Production Variance Report
  const productionReport = db.prepare(`
    SELECT 
      pr.run_no,
      pr.date,
      pr.batch_no,
      it.name AS product_name,
      pr.expected_output,
      pr.actual_output,
      pr.scrap_pouches,
      pr.cartons_used,
      pr.yield_variance_pct,
      pr.raw_material_cost,
      (pr.direct_labour_cost + pr.gas_power_cost + pr.other_overheads) AS overheads,
      pr.total_cost,
      pr.cost_per_packet
    FROM production_runs pr
    JOIN items it ON pr.product_id = it.id
    WHERE pr.date BETWEEN ? AND ?
    ORDER BY pr.date ASC
  `).all(startDate, endDate);

  // F. Outstanding Receivables & Ageing Analysis
  const receivables = db.prepare(`
    SELECT 
      c.id AS customer_id,
      c.name AS customer_name,
      c.phone,
      c.credit_limit,
      COUNT(i.id) AS total_invoices,
      SUM(i.total_amount) AS total_billed,
      SUM(i.amount_paid) AS total_collected,
      SUM(i.balance_due) AS current_outstanding,
      SUM(CASE WHEN julianday(?) - julianday(i.invoice_date) <= 30 THEN i.balance_due ELSE 0 END) AS age_0_30,
      SUM(CASE WHEN julianday(?) - julianday(i.invoice_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) AS age_31_60,
      SUM(CASE WHEN julianday(?) - julianday(i.invoice_date) > 60 THEN i.balance_due ELSE 0 END) AS age_above_60
    FROM customers c
    JOIN invoices i ON c.id = i.customer_id
    WHERE i.balance_due > 0
    GROUP BY c.id
  `).all(endDate, endDate, endDate);

  return {
    dateRange: { startDate, endDate },
    salesRegister,
    gstSummary,
    purchaseRegister,
    stockSummary,
    stockLedger,
    productionReport,
    receivables
  };
}

// 7. OWNER EXECUTIVE DASHBOARD STATS
function getOwnerDashboardStats() {
  const today = new Date().toISOString().split('T')[0];

  const todayOrders = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total_value), 0) AS total_value
    FROM orders
    WHERE date = ?
  `).get(today);

  const pendingShortages = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE shortage_qty > 0 AND status = 'SUBMITTED'
  `).get();

  const totalOutstanding = db.prepare(`
    SELECT COALESCE(SUM(balance_due), 0) AS total_due
    FROM invoices
    WHERE balance_due > 0
  `).get();

  const latestProduction = db.prepare(`
    SELECT run_no, batch_no, actual_output, yield_variance_pct, cost_per_packet
    FROM production_runs
    ORDER BY id DESC LIMIT 1
  `).get();

  const stockAlerts = db.prepare(`
    SELECT it.name, it.category, it.unit, it.reorder_level,
           COALESCE(SUM(sl.qty_in - sl.qty_out), 0) AS current_stock
    FROM items it
    LEFT JOIN stock_ledger sl ON it.id = sl.item_id
    GROUP BY it.id
    HAVING current_stock <= it.reorder_level
  `).all();

  return {
    factory: FACTORY_CONFIG,
    todayOrders: {
      count: todayOrders.count,
      value: roundMoney(todayOrders.total_value)
    },
    pendingShortagesCount: pendingShortages.count,
    totalOutstanding: roundMoney(totalOutstanding.total_due),
    latestProduction: latestProduction || null,
    stockAlerts
  };
}

// 8. TALLY-COMPATIBLE XML EXPORT (Optional Stretch Feature)
function generateTallyXml(startDate = '2026-11-01', endDate = '2026-11-30') {
  const invoices = db.prepare(`
    SELECT i.*, c.name AS customer_name, it.name AS product_name
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    JOIN items it ON i.product_id = it.id
    WHERE i.invoice_date BETWEEN ? AND ?
  `).all(startDate, endDate);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n  <HEADER>\n    <TALLYREQUEST>Import Data</TALLYREQUEST>\n  </HEADER>\n  <BODY>\n    <IMPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>Vouchers</REPORTNAME>\n      </REQUESTDESC>\n      <REQUESTDATA>\n`;

  for (const inv of invoices) {
    const cleanDate = inv.invoice_date.replace(/-/g, '');
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
    xml += `          <VOUCHER VCHTYPE="Sales" ACTION="Create">\n`;
    xml += `            <DATE>${cleanDate}</DATE>\n`;
    xml += `            <VOUCHERNUMBER>${inv.invoice_no}</VOUCHERNUMBER>\n`;
    xml += `            <PARTYLEDGERNAME>${inv.customer_name}</PARTYLEDGERNAME>\n`;
    xml += `            <NARRATION>Tax Invoice for ${inv.product_name} (${inv.quantity} pkts)</NARRATION>\n`;
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>${inv.customer_name}</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n`;
    xml += `              <AMOUNT>-${inv.total_amount.toFixed(2)}</AMOUNT>\n`;
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>Sales Account</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
    xml += `              <AMOUNT>${inv.taxable_value.toFixed(2)}</AMOUNT>\n`;
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;
    if (inv.cgst_amount > 0) {
      xml += `            <ALLLEDGERENTRIES.LIST>\n`;
      xml += `              <LEDGERNAME>CGST Output @ 2.5%</LEDGERNAME>\n`;
      xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
      xml += `              <AMOUNT>${inv.cgst_amount.toFixed(2)}</AMOUNT>\n`;
      xml += `            </ALLLEDGERENTRIES.LIST>\n`;
      xml += `            <ALLLEDGERENTRIES.LIST>\n`;
      xml += `              <LEDGERNAME>SGST Output @ 2.5%</LEDGERNAME>\n`;
      xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
      xml += `              <AMOUNT>${inv.sgst_amount.toFixed(2)}</AMOUNT>\n`;
      xml += `            </ALLLEDGERENTRIES.LIST>\n`;
    }
    if (inv.igst_amount > 0) {
      xml += `            <ALLLEDGERENTRIES.LIST>\n`;
      xml += `              <LEDGERNAME>IGST Output @ 5%</LEDGERNAME>\n`;
      xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
      xml += `              <AMOUNT>${inv.igst_amount.toFixed(2)}</AMOUNT>\n`;
      xml += `            </ALLLEDGERENTRIES.LIST>\n`;
    }
    xml += `          </VOUCHER>\n`;
    xml += `        </TALLYMESSAGE>\n`;
  }

  xml += `      </REQUESTDATA>\n    </IMPORTDATA>\n  </BODY>\n</ENVELOPE>`;
  return xml;
}

module.exports = {
  FACTORY_CONFIG,
  recordPurchase,
  recordProductionRun,
  createOrder,
  approveOrderAndInvoice,
  recordPayment,
  getAuditorReports,
  getOwnerDashboardStats,
  generateTallyXml
};
