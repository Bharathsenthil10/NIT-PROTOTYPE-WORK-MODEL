// seed.js - Seeds initial master data and opening stock per Section 5 Benchmark
const { db, appendStockLedger, logAudit } = require('./db');

function seedDatabase() {
  console.log('--- Resetting and Seeding Database ---');

  // Disable FK temporarily for clean wipe
  db.exec('PRAGMA foreign_keys = OFF;');

  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM payments;
    DELETE FROM invoices;
    DELETE FROM orders;
    DELETE FROM production_run_items;
    DELETE FROM production_runs;
    DELETE FROM purchases;
    DELETE FROM stock_ledger;
    DELETE FROM bom_items;
    DELETE FROM boms;
    DELETE FROM items;
    DELETE FROM suppliers;
    DELETE FROM customers;
    DELETE FROM users;
  `);

  db.exec('PRAGMA foreign_keys = ON;');

  // 1. Seed Users
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, name, role, phone, pin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('USER-SALESMAN-A', 'salesman_a', 'Salesman A (Arun - TN Region)', 'salesman', '9876543210', '1234');
  insertUser.run('USER-SALESMAN-B', 'salesman_b', 'Salesman B (Balaji - KA Region)', 'salesman', '9876543211', '1234');
  insertUser.run('USER-ADMIN', 'admin', 'Factory Admin (Priya)', 'admin', '9876543220', '1234');
  insertUser.run('USER-PRODUCTION', 'production', 'Production Supervisor (Muthu)', 'production', '9876543230', '1234');
  insertUser.run('USER-AUDITOR', 'auditor', 'External Auditor (CA Ramesh & Co)', 'accountant', '9876543240', '1234');
  insertUser.run('USER-OWNER', 'owner', 'Managing Director (Sundaram)', 'owner', '9876543250', '1234');

  // 2. Seed Customers
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, code, name, type, gstin, state, state_code, address, phone, email, credit_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCustomer.run(
    'CUST-RETAILER-A',
    'RET-001',
    'Retailer A (Sri Murugan Provision Store)',
    'retailer',
    '33AABCS1429B1ZB',
    'Tamil Nadu',
    '33',
    '45 Big Bazaar Street, Tiruchirappalli, Tamil Nadu - 620002',
    '+91 98421 23456',
    'murugan.stores@example.com',
    50000
  );

  insertCustomer.run(
    'CUST-DISTRIB-B',
    'DST-002',
    'Distributor B (Karnataka Wholesale Traders)',
    'distributor',
    '29AABCU9603R1ZQ',
    'Karnataka',
    '29',
    '12 Avenue Road, Chickpet, Bangalore, Karnataka - 560002',
    '+91 99801 78901',
    'ka.wholesale@example.com',
    100000
  );

  // 3. Seed Supplier
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (id, code, name, gstin, state, state_code, address, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSupplier.run(
    'SUPP-MADURAI-FLOUR',
    'SUP-001',
    'Madurai Flour & Agro Mills Pvt Ltd',
    '33AAACM4589K1ZS',
    'Tamil Nadu',
    '33',
    '102 Industrial Estate, Madurai, Tamil Nadu - 625010',
    '+91 94432 11223'
  );

  // 4. Seed Items
  const insertItem = db.prepare(`
    INSERT INTO items (id, code, name, category, unit, hsn_code, gst_rate, standard_rate, reorder_level, pack_size_grams)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Raw Materials
  insertItem.run('ITEM-FLOUR', 'RM-FLR', 'Flour (Rice/Gram Flour)', 'raw_material', 'kg', '11061000', 5.0, 42.0, 50.0, 0);
  insertItem.run('ITEM-OIL', 'RM-OIL', 'Cooking Oil', 'raw_material', 'litre', '15159020', 5.0, 140.0, 15.0, 0);
  insertItem.run('ITEM-SPICE', 'RM-SPC', 'Salt and Spice Mix', 'raw_material', 'kg', '21039090', 5.0, 200.0, 2.0, 0);

  // Packaging Materials
  insertItem.run('ITEM-POUCH-200', 'PM-PCH-200', '200g Printed Pouch', 'packaging', 'piece', '39232100', 18.0, 2.50, 200.0, 0);
  insertItem.run('ITEM-CARTON-20', 'PM-CTN-20', 'Carton Box (Holds 20 Packets)', 'packaging', 'piece', '48191010', 12.0, 15.00, 15.0, 0);

  // Finished Goods
  insertItem.run('ITEM-MURUKKU-200', 'FG-MRK-200', 'Murukku 200 g', 'finished_good', 'packet', '21069099', 5.0, 50.00, 50.0, 200.0);

  // 5. Seed BOM for Murukku 200 g (Standard batch: 200 packets)
  const insertBom = db.prepare(`
    INSERT INTO boms (id, product_id, name, batch_size_packets, active, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertBom.run(
    'BOM-MRK-200',
    'ITEM-MURUKKU-200',
    'Standard Recipe - Murukku 200 g (200 pkts / batch)',
    200.0,
    1,
    'Standard batch yield: 200 packets of 200g each'
  );

  const insertBomItem = db.prepare(`
    INSERT INTO bom_items (id, bom_id, item_id, standard_qty, unit)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertBomItem.run('BOMI-1', 'BOM-MRK-200', 'ITEM-FLOUR', 40.0, 'kg');
  insertBomItem.run('BOMI-2', 'BOM-MRK-200', 'ITEM-OIL', 10.0, 'litre');
  insertBomItem.run('BOMI-3', 'BOM-MRK-200', 'ITEM-SPICE', 1.2, 'kg');
  insertBomItem.run('BOMI-4', 'BOM-MRK-200', 'ITEM-POUCH-200', 200.0, 'piece');
  insertBomItem.run('BOMI-5', 'BOM-MRK-200', 'ITEM-CARTON-20', 10.0, 'piece');

  // 6. Seed Opening Stock in Stock Ledger (Section 5 Benchmark Initial State)
  const openingTimestamp = '2026-11-01T08:00:00.000Z';

  // Flour: 100 kg @ ₹42
  appendStockLedger({
    itemId: 'ITEM-FLOUR',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 100.0,
    unit: 'kg',
    unitCost: 42.0,
    totalCost: 4200.0,
    notes: 'Opening stock per Section 5 benchmark',
    timestamp: openingTimestamp
  });

  // Cooking Oil: 30 L @ ₹140
  appendStockLedger({
    itemId: 'ITEM-OIL',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 30.0,
    unit: 'litre',
    unitCost: 140.0,
    totalCost: 4200.0,
    notes: 'Opening stock per Section 5 benchmark',
    timestamp: openingTimestamp
  });

  // Spice Mix: 5 kg @ ₹200
  appendStockLedger({
    itemId: 'ITEM-SPICE',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 5.0,
    unit: 'kg',
    unitCost: 200.0,
    totalCost: 1000.0,
    notes: 'Opening stock per Section 5 benchmark',
    timestamp: openingTimestamp
  });

  // 200g Pouches: 500 pcs @ ₹2.50
  appendStockLedger({
    itemId: 'ITEM-POUCH-200',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 500.0,
    unit: 'piece',
    unitCost: 2.50,
    totalCost: 1250.0,
    notes: 'Opening stock per Section 5 benchmark',
    timestamp: openingTimestamp
  });

  // Cartons: 30 pcs @ ₹15.00
  appendStockLedger({
    itemId: 'ITEM-CARTON-20',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 30.0,
    unit: 'piece',
    unitCost: 15.0,
    totalCost: 450.0,
    notes: 'Opening stock per Section 5 benchmark',
    timestamp: openingTimestamp
  });

  // Finished Goods: Murukku 200g: 50 packets @ ₹31.00 standard cost
  appendStockLedger({
    itemId: 'ITEM-MURUKKU-200',
    batchNo: 'BATCH-OPENING',
    transactionType: 'OPENING',
    sourceDocType: 'INITIAL_SETUP',
    sourceDocId: 'OPENING-2026-11-01',
    qtyIn: 50.0,
    unit: 'packet',
    unitCost: 31.0,
    totalCost: 1550.0,
    notes: 'Opening stock per Section 5 benchmark (50 pkts)',
    timestamp: openingTimestamp
  });

  logAudit('SYSTEM', 'SYSTEM', 'SEED_MASTER_DATA', 'ALL', 'INITIAL', 'Loaded master data and opening stock per Section 5');
  console.log('Seeding completed successfully!');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
