// db.js - SQLite Database Schema & Ledger Operations using Node.js native node:sqlite
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode for reliability
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema
function initSchema() {
  db.exec(`
    -- Master: Users & Roles
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('salesman', 'admin', 'production', 'accountant', 'owner')),
      phone TEXT,
      pin TEXT NOT NULL DEFAULT '1234'
    );

    -- Master: Customers (Retailers & Distributors)
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('retailer', 'distributor')),
      gstin TEXT,
      state TEXT NOT NULL,
      state_code TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      credit_limit REAL DEFAULT 50000
    );

    -- Master: Suppliers
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gstin TEXT,
      state TEXT NOT NULL,
      state_code TEXT NOT NULL,
      address TEXT,
      phone TEXT
    );

    -- Master: Items (Raw Materials, Packaging, Finished Goods)
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('raw_material', 'packaging', 'finished_good')),
      unit TEXT NOT NULL CHECK(unit IN ('kg', 'litre', 'piece', 'packet', 'carton')),
      hsn_code TEXT NOT NULL DEFAULT '21069099',
      gst_rate REAL NOT NULL DEFAULT 5.0,
      standard_rate REAL NOT NULL DEFAULT 0.0,
      reorder_level REAL NOT NULL DEFAULT 0.0,
      pack_size_grams REAL DEFAULT 0.0
    );

    -- Master: Bill of Materials (BOM)
    CREATE TABLE IF NOT EXISTS boms (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES items(id),
      name TEXT NOT NULL,
      batch_size_packets REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    );

    -- Master: BOM Items (Standard ingredients per batch)
    CREATE TABLE IF NOT EXISTS bom_items (
      id TEXT PRIMARY KEY,
      bom_id TEXT NOT NULL REFERENCES boms(id),
      item_id TEXT NOT NULL REFERENCES items(id),
      standard_qty REAL NOT NULL,
      unit TEXT NOT NULL
    );

    -- Core: Stock Ledger (Immutable movement records)
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      batch_no TEXT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN (
        'OPENING', 'PURCHASE', 'PROD_ISSUE', 'PROD_OUTPUT', 'PROD_SCRAP', 'SALES_DISPATCH', 'ADJUSTMENT'
      )),
      source_doc_type TEXT NOT NULL CHECK(source_doc_type IN (
        'INITIAL_SETUP', 'PURCHASE_ORDER', 'PRODUCTION_RUN', 'INVOICE', 'MANUAL_ADJUSTMENT'
      )),
      source_doc_id TEXT NOT NULL,
      qty_in REAL NOT NULL DEFAULT 0.0,
      qty_out REAL NOT NULL DEFAULT 0.0,
      unit TEXT NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0.0,
      total_cost REAL NOT NULL DEFAULT 0.0,
      balance_after REAL NOT NULL,
      notes TEXT
    );

    -- Purchases
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_no TEXT UNIQUE NOT NULL,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      date TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      rate REAL NOT NULL,
      taxable_value REAL NOT NULL,
      gst_rate REAL NOT NULL,
      gst_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      invoice_ref TEXT,
      created_at TEXT NOT NULL
    );

    -- Production Runs
    CREATE TABLE IF NOT EXISTS production_runs (
      id TEXT PRIMARY KEY,
      run_no TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES items(id),
      bom_id TEXT NOT NULL REFERENCES boms(id),
      batch_no TEXT NOT NULL,
      mfg_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      expected_output REAL NOT NULL,
      actual_output REAL NOT NULL,
      scrap_pouches REAL NOT NULL DEFAULT 0.0,
      cartons_used REAL NOT NULL DEFAULT 0.0,
      direct_labour_cost REAL NOT NULL DEFAULT 0.0,
      gas_power_cost REAL NOT NULL DEFAULT 0.0,
      other_overheads REAL NOT NULL DEFAULT 0.0,
      raw_material_cost REAL NOT NULL DEFAULT 0.0,
      total_cost REAL NOT NULL DEFAULT 0.0,
      cost_per_packet REAL NOT NULL DEFAULT 0.0,
      yield_variance_pct REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      supervisor_id TEXT REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Production Run Items (Actual vs Standard consumption)
    CREATE TABLE IF NOT EXISTS production_run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES production_runs(id),
      item_id TEXT NOT NULL REFERENCES items(id),
      standard_qty REAL NOT NULL,
      actual_qty REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_rate REAL NOT NULL DEFAULT 0.0,
      total_cost REAL NOT NULL DEFAULT 0.0,
      variance_pct REAL NOT NULL DEFAULT 0.0
    );

    -- Orders (Field Salesman)
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      salesman_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES items(id),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_value REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUBMITTED', 'APPROVED', 'INVOICED', 'DISPATCHED', 'REJECTED')),
      stock_available_at_check REAL NOT NULL DEFAULT 0.0,
      shortage_qty REAL NOT NULL DEFAULT 0.0,
      created_offline INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Invoices (GST-compliant tax invoices)
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE NOT NULL,
      order_id TEXT REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES items(id),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      taxable_value REAL NOT NULL,
      is_inter_state INTEGER NOT NULL DEFAULT 0,
      cgst_rate REAL NOT NULL DEFAULT 0.0,
      cgst_amount REAL NOT NULL DEFAULT 0.0,
      sgst_rate REAL NOT NULL DEFAULT 0.0,
      sgst_amount REAL NOT NULL DEFAULT 0.0,
      igst_rate REAL NOT NULL DEFAULT 0.0,
      igst_amount REAL NOT NULL DEFAULT 0.0,
      total_amount REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0.0,
      balance_due REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('RAISED', 'DISPATCHED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
      dispatched_at TEXT,
      irn_hash TEXT,
      eway_bill_no TEXT,
      created_at TEXT NOT NULL
    );

    -- Payments Received
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      receipt_no TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      invoice_id TEXT REFERENCES invoices(id),
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_mode TEXT NOT NULL CHECK(payment_mode IN ('UPI', 'NEFT', 'Cheque', 'Cash')),
      reference_no TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Audit Logs (Traceability and compliance)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT
    );
  `);
}

// Ensure schema is created on load
initSchema();

// Helper: Calculate item stock strictly from stock_ledger
function getItemStock(itemId) {
  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(qty_in - qty_out), 0.0) AS current_stock
    FROM stock_ledger
    WHERE item_id = ?
  `).get(itemId);
  return Math.round((row?.current_stock || 0) * 1000) / 1000;
}

// Helper: Add entry to stock ledger with automatic balance computation
function appendStockLedger({
  itemId,
  batchNo = null,
  transactionType,
  sourceDocType,
  sourceDocId,
  qtyIn = 0,
  qtyOut = 0,
  unit,
  unitCost = 0,
  totalCost = 0,
  notes = '',
  timestamp = new Date().toISOString()
}) {
  const current = getItemStock(itemId);
  const newBalance = Math.round((current + qtyIn - qtyOut) * 1000) / 1000;

  const stmt = db.prepare(`
    INSERT INTO stock_ledger (
      timestamp, item_id, batch_no, transaction_type, source_doc_type,
      source_doc_id, qty_in, qty_out, unit, unit_cost, total_cost,
      balance_after, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    timestamp,
    itemId,
    batchNo,
    transactionType,
    sourceDocType,
    sourceDocId,
    qtyIn,
    qtyOut,
    unit,
    unitCost,
    totalCost,
    newBalance,
    notes
  );

  return { id: result.lastInsertRowid, balanceAfter: newBalance };
}

// Helper: Log audit action
function logAudit(userId, userRole, action, entity, entityId, details) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (timestamp, user_id, user_role, action, entity, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    new Date().toISOString(),
    userId || 'SYSTEM',
    userRole || 'SYSTEM',
    action,
    entity,
    String(entityId),
    typeof details === 'object' ? JSON.stringify(details) : details
  );
}

// Money calculation utility using paisa rounding
function roundMoney(val) {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

module.exports = {
  db,
  initSchema,
  getItemStock,
  appendStockLedger,
  logAudit,
  roundMoney
};
