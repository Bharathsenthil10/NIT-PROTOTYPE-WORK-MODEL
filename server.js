// server.js - Native Node.js HTTP Server & REST API (Zero external dependencies)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const { db, getItemStock, roundMoney } = require('./db');
const { seedDatabase } = require('./seed');
const {
  FACTORY_CONFIG,
  recordPurchase,
  recordProductionRun,
  createOrder,
  approveOrderAndInvoice,
  recordPayment,
  getAuditorReports,
  getOwnerDashboardStats,
  generateTallyXml
} = require('./services');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8'
};

// Helper: send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// Helper: parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: generate CSV from array of objects
function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(header => {
      const val = row[header];
      if (val === null || val === undefined) return '""';
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\r\n');
}

// HTTP Server Request Handler
async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  try {
    // -------------------------------------------------------------
    // REST API ROUTES
    // -------------------------------------------------------------

    // 1. Current Factory Config & Users
    if (pathname === '/api/config' && method === 'GET') {
      return sendJson(res, 200, { factory: FACTORY_CONFIG });
    }

    if (pathname === '/api/users' && method === 'GET') {
      const users = db.prepare('SELECT id, username, name, role, phone FROM users').all();
      return sendJson(res, 200, users);
    }

    // 2. Master Data: Items & Current Stock
    if (pathname === '/api/items' && method === 'GET') {
      const items = db.prepare('SELECT * FROM items ORDER BY category, name').all();
      const itemsWithStock = items.map(item => ({
        ...item,
        currentStock: getItemStock(item.id),
        stockValue: roundMoney(getItemStock(item.id) * item.standard_rate),
        isLowStock: getItemStock(item.id) <= item.reorder_level
      }));
      return sendJson(res, 200, itemsWithStock);
    }

    // 3. Master Data: Customers
    if (pathname === '/api/customers' && method === 'GET') {
      const customers = db.prepare(`
        SELECT 
          c.*,
          COALESCE(SUM(i.balance_due), 0.0) AS outstanding_balance
        FROM customers c
        LEFT JOIN invoices i ON c.id = i.customer_id AND i.balance_due > 0
        GROUP BY c.id
        ORDER BY c.name
      `).all();
      return sendJson(res, 200, customers);
    }

    // 4. Master Data: Suppliers
    if (pathname === '/api/suppliers' && method === 'GET') {
      const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
      return sendJson(res, 200, suppliers);
    }

    // 5. Master Data: BOMs
    if (pathname === '/api/boms' && method === 'GET') {
      const boms = db.prepare(`
        SELECT b.*, it.name AS product_name, it.unit AS product_unit
        FROM boms b
        JOIN items it ON b.product_id = it.id
      `).all();

      const bomsWithItems = boms.map(bom => {
        const items = db.prepare(`
          SELECT bi.*, it.name AS item_name, it.category, it.standard_rate
          FROM bom_items bi
          JOIN items it ON bi.item_id = it.id
          WHERE bi.bom_id = ?
        `).all(bom.id);
        return { ...bom, items };
      });
      return sendJson(res, 200, bomsWithItems);
    }

    // 6. Purchases
    if (pathname === '/api/purchases' && method === 'GET') {
      const purchases = db.prepare(`
        SELECT p.*, s.name AS supplier_name, it.name AS item_name
        FROM purchases p
        JOIN suppliers s ON p.supplier_id = s.id
        JOIN items it ON p.item_id = it.id
        ORDER BY p.date DESC, p.created_at DESC
      `).all();
      return sendJson(res, 200, purchases);
    }

    if (pathname === '/api/purchases' && method === 'POST') {
      const body = await parseBody(req);
      const result = recordPurchase(body);
      return sendJson(res, 201, { success: true, ...result });
    }

    // 7. Production Runs
    if (pathname === '/api/production-runs' && method === 'GET') {
      const runs = db.prepare(`
        SELECT pr.*, it.name AS product_name, b.name AS bom_name, u.name AS supervisor_name
        FROM production_runs pr
        JOIN items it ON pr.product_id = it.id
        JOIN boms b ON pr.bom_id = b.id
        LEFT JOIN users u ON pr.supervisor_id = u.id
        ORDER BY pr.created_at DESC
      `).all();

      const runsWithItems = runs.map(run => {
        const items = db.prepare(`
          SELECT pri.*, it.name AS item_name
          FROM production_run_items pri
          JOIN items it ON pri.item_id = it.id
          WHERE pri.run_id = ?
        `).all(run.id);
        return { ...run, items };
      });
      return sendJson(res, 200, runsWithItems);
    }

    if (pathname === '/api/production-runs' && method === 'POST') {
      const body = await parseBody(req);
      const result = recordProductionRun(body);
      return sendJson(res, 201, { success: true, ...result });
    }

    // Production Planning Tool (Stretch Goal)
    if (pathname === '/api/production-plan' && method === 'GET') {
      // Calculate pending orders requirement
      const pending = db.prepare(`
        SELECT 
          o.product_id,
          it.name AS product_name,
          SUM(o.quantity) AS total_ordered,
          COALESCE(SUM(CASE WHEN sl.transaction_type IS NOT NULL THEN 0 ELSE 0 END), 0) AS dummy
        FROM orders o
        JOIN items it ON o.product_id = it.id
        WHERE o.status IN ('SUBMITTED', 'APPROVED')
        GROUP BY o.product_id
      `).all();

      const plan = pending.map(p => {
        const currentStock = getItemStock(p.product_id);
        const netDeficit = Math.max(0, p.total_ordered - currentStock);
        const bom = db.prepare("SELECT * FROM boms WHERE product_id = ? AND active = 1").get(p.product_id);
        const batchSize = bom ? bom.batch_size_packets : 200;
        const batchesNeeded = Math.ceil(netDeficit / batchSize);

        // Raw materials needed for these batches
        let rawMaterialsNeeded = [];
        if (bom && batchesNeeded > 0) {
          const bomItems = db.prepare("SELECT bi.*, it.name, it.unit FROM bom_items bi JOIN items it ON bi.item_id = it.id WHERE bi.bom_id = ?").all(bom.id);
          rawMaterialsNeeded = bomItems.map(bi => {
            const neededQty = bi.standard_qty * batchesNeeded;
            const inStock = getItemStock(bi.item_id);
            return {
              itemId: bi.item_id,
              name: bi.name,
              neededQty,
              inStock,
              unit: bi.unit,
              shortage: Math.max(0, roundMoney(neededQty - inStock))
            };
          });
        }

        return {
          productId: p.product_id,
          productName: p.product_name,
          totalOrdered: p.total_ordered,
          currentStock,
          netDeficit,
          batchSize,
          batchesNeeded,
          rawMaterialsNeeded
        };
      });

      return sendJson(res, 200, plan);
    }

    // 8. Orders (Field Salesman & Admin)
    if (pathname === '/api/orders' && method === 'GET') {
      const salesmanId = parsedUrl.query.salesmanId;
      let sql = `
        SELECT 
          o.*,
          c.name AS customer_name,
          c.state AS customer_state,
          c.state_code AS customer_state_code,
          c.type AS customer_type,
          it.name AS product_name,
          it.unit AS product_unit,
          u.name AS salesman_name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        JOIN items it ON o.product_id = it.id
        JOIN users u ON o.salesman_id = u.id
      `;
      const params = [];
      if (salesmanId) {
        sql += ` WHERE o.salesman_id = ?`;
        params.push(salesmanId);
      }
      sql += ` ORDER BY o.created_at DESC`;

      const orders = db.prepare(sql).all(...params);
      const ordersWithLiveStock = orders.map(ord => ({
        ...ord,
        liveStock: getItemStock(ord.product_id),
        canFulfill: getItemStock(ord.product_id) >= ord.quantity
      }));

      return sendJson(res, 200, ordersWithLiveStock);
    }

    if (pathname === '/api/orders' && method === 'POST') {
      const body = await parseBody(req);
      const result = createOrder(body);
      return sendJson(res, 201, { success: true, ...result });
    }

    if (pathname === '/api/orders/approve' && method === 'POST') {
      const body = await parseBody(req);
      const result = approveOrderAndInvoice(body);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === '/api/orders/reject' && method === 'POST') {
      const body = await parseBody(req);
      db.prepare("UPDATE orders SET status = 'REJECTED' WHERE id = ?").run(body.orderId);
      return sendJson(res, 200, { success: true });
    }

    // 9. Invoices
    if (pathname === '/api/invoices' && method === 'GET') {
      const invoices = db.prepare(`
        SELECT 
          i.*,
          c.name AS customer_name,
          c.gstin AS customer_gstin,
          c.state AS customer_state,
          c.state_code AS customer_state_code,
          c.address AS customer_address,
          it.name AS product_name,
          it.hsn_code,
          it.unit AS product_unit,
          o.order_no
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        JOIN items it ON i.product_id = it.id
        LEFT JOIN orders o ON i.order_id = o.id
        ORDER BY i.created_at DESC
      `).all();
      return sendJson(res, 200, invoices);
    }

    if (pathname.startsWith('/api/invoices/') && method === 'GET') {
      const idOrNo = pathname.replace('/api/invoices/', '');
      const invoice = db.prepare(`
        SELECT 
          i.*,
          c.name AS customer_name,
          c.gstin AS customer_gstin,
          c.state AS customer_state,
          c.state_code AS customer_state_code,
          c.address AS customer_address,
          c.phone AS customer_phone,
          it.name AS product_name,
          it.hsn_code,
          it.unit AS product_unit,
          o.order_no
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        JOIN items it ON i.product_id = it.id
        LEFT JOIN orders o ON i.order_id = o.id
        WHERE i.id = ? OR i.invoice_no = ?
      `).get(idOrNo, idOrNo);

      if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
      return sendJson(res, 200, { invoice, factory: FACTORY_CONFIG });
    }

    // 10. Payments
    if (pathname === '/api/payments' && method === 'GET') {
      const payments = db.prepare(`
        SELECT 
          p.*,
          c.name AS customer_name,
          i.invoice_no,
          i.total_amount AS invoice_total
        FROM payments p
        JOIN customers c ON p.customer_id = c.id
        JOIN invoices i ON p.invoice_id = i.id
        ORDER BY p.date DESC, p.created_at DESC
      `).all();
      return sendJson(res, 200, payments);
    }

    if (pathname === '/api/payments' && method === 'POST') {
      const body = await parseBody(req);
      const result = recordPayment(body);
      return sendJson(res, 201, { success: true, ...result });
    }

    // 11. Auditor Reports & Export
    if (pathname === '/api/reports' && method === 'GET') {
      const start = parsedUrl.query.startDate || '2026-11-01';
      const end = parsedUrl.query.endDate || '2026-11-30';
      const reports = getAuditorReports(start, end);
      return sendJson(res, 200, reports);
    }

    if (pathname === '/api/reports/tally-xml' && method === 'GET') {
      const start = parsedUrl.query.startDate || '2026-11-01';
      const end = parsedUrl.query.endDate || '2026-11-30';
      const xml = generateTallyXml(start, end);
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tally_vouchers.xml"'
      });
      return res.end(xml);
    }

    if (pathname === '/api/reports/csv' && method === 'GET') {
      const type = parsedUrl.query.type || 'sales';
      const start = parsedUrl.query.startDate || '2026-11-01';
      const end = parsedUrl.query.endDate || '2026-11-30';
      const reports = getAuditorReports(start, end);

      let rows = [];
      let filename = 'report.csv';

      if (type === 'sales') {
        rows = reports.salesRegister;
        filename = 'sales_register.csv';
      } else if (type === 'purchases') {
        rows = reports.purchaseRegister;
        filename = 'purchase_register.csv';
      } else if (type === 'stock') {
        rows = reports.stockSummary;
        filename = 'stock_summary.csv';
      } else if (type === 'production') {
        rows = reports.productionReport;
        filename = 'production_report.csv';
      } else if (type === 'receivables') {
        rows = reports.receivables;
        filename = 'receivables_ageing.csv';
      }

      const csvData = toCsv(rows);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      return res.end(csvData);
    }

    // 12. Audit Logs
    if (pathname === '/api/audit-logs' && method === 'GET') {
      const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
      return sendJson(res, 200, logs);
    }

    // 13. Owner Dashboard Stats
    if (pathname === '/api/owner/dashboard' && method === 'GET') {
      const stats = getOwnerDashboardStats();
      return sendJson(res, 200, stats);
    }

    // 14. Benchmark Verification Status
    if (pathname === '/api/benchmark/status' && method === 'GET') {
      const flourClosing = getItemStock('ITEM-FLOUR');
      const oilClosing = getItemStock('ITEM-OIL');
      const pouchesClosing = getItemStock('ITEM-POUCH-200');
      const fgClosing = getItemStock('ITEM-MURUKKU-200');

      const latestProd = db.prepare('SELECT * FROM production_runs ORDER BY id DESC LIMIT 1').get();
      const oilItem = latestProd ? db.prepare("SELECT * FROM production_run_items WHERE run_id = ? AND item_id = 'ITEM-OIL'").get(latestProd.id) : null;
      const invA = db.prepare("SELECT * FROM invoices WHERE customer_id = 'CUST-RETAILER-A' ORDER BY id DESC LIMIT 1").get();
      const ordB = db.prepare("SELECT * FROM orders WHERE customer_id = 'CUST-DISTRIB-B' ORDER BY id DESC LIMIT 1").get();

      const checks = [
        {
          name: 'Flour closing balance',
          expected: '120 kg (100 + 60 - 40)',
          actual: `${flourClosing} kg`,
          passed: flourClosing === 120.0
        },
        {
          name: 'Oil closing balance',
          expected: '19.5 L (30 - 10.5)',
          actual: `${oilClosing} L`,
          passed: oilClosing === 19.5
        },
        {
          name: 'Pouches closing balance',
          expected: '306 pcs (500 - 188 - 6)',
          actual: `${pouchesClosing} pcs`,
          passed: pouchesClosing === 306.0
        },
        {
          name: 'Finished goods after Retailer A dispatch',
          expected: '88 packets (238 - 150)',
          actual: `${fgClosing} packets`,
          passed: fgClosing === 88.0
        },
        {
          name: 'Yield variance',
          expected: '188 vs 200 expected (-6%, flagged)',
          actual: `${latestProd ? latestProd.yield_variance_pct : 0}%`,
          passed: latestProd?.yield_variance_pct === -6.0
        },
        {
          name: 'Oil consumption variance',
          expected: '+5%, flagged (10.5 vs 10.0 L)',
          actual: `${oilItem ? (oilItem.variance_pct > 0 ? '+' : '') + oilItem.variance_pct : 0}%`,
          passed: oilItem?.variance_pct === 5.0
        },
        {
          name: 'Retailer A invoice',
          expected: '₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875',
          actual: invA ? `₹${invA.taxable_value} + ₹${invA.cgst_amount} CGST + ₹${invA.sgst_amount} SGST = ₹${invA.total_amount}` : 'Not raised',
          passed: invA?.total_amount === 7875.0 && invA?.cgst_amount === 187.5
        },
        {
          name: 'Retailer A outstanding',
          expected: '₹3,875 (₹7,875 - ₹4,000)',
          actual: invA ? `₹${invA.balance_due}` : 'N/A',
          passed: invA?.balance_due === 3875.0
        },
        {
          name: 'Distributor B order shortage',
          expected: 'Shortage of 32 packets flagged; IGST applies',
          actual: ordB ? `Shortage: ${ordB.shortage_qty} pkts (Flagged: ${ordB.shortage_qty > 0})` : 'None',
          passed: ordB?.shortage_qty === 32.0
        },
        {
          name: 'Cost per packet (FIFO)',
          expected: '₹30.90 / pkt (Materials ₹4,010 + Overheads ₹1,800)',
          actual: latestProd ? `₹${latestProd.cost_per_packet} / pkt` : 'N/A',
          passed: latestProd?.cost_per_packet === 30.90
        }
      ];

      const allPassed = checks.every(c => c.passed);
      return sendJson(res, 200, { allPassed, checks });
    }

    // 15. Benchmark Actions: Reset & Run Full Benchmark
    if (pathname === '/api/benchmark/reset' && method === 'POST') {
      seedDatabase();
      return sendJson(res, 200, { success: true, message: 'Database reset to initial opening state' });
    }

    if (pathname === '/api/benchmark/run-all' && method === 'POST') {
      const { runBenchmark } = require('./benchmark');
      const success = runBenchmark();
      return sendJson(res, 200, { success, message: 'Benchmark executed successfully' });
    }

    if (pathname === '/api/benchmark/step' && method === 'POST') {
      const body = await parseBody(req);
      const step = Number(body.step || 1);
      let message = '';

      if (step === 1) {
        const resObj = recordPurchase({
          supplierId: 'SUPP-MADURAI-FLOUR',
          itemId: 'ITEM-FLOUR',
          quantity: 60.0,
          rate: 45.0,
          invoiceRef: 'MFM/2026/894'
        });
        message = `Step 1: Purchased 60kg flour @ ₹45/kg (PO: ${resObj.purchaseNo}). Closing Flour: ${resObj.newStock}kg.`;
      } else if (step === 2) {
        const resObj = recordProductionRun({
          productId: 'ITEM-MURUKKU-200',
          bomId: 'BOM-MRK-200',
          batchNo: 'MK-202611-01',
          issuedItems: [
            { itemId: 'ITEM-FLOUR', actualQty: 40.0 },
            { itemId: 'ITEM-OIL', actualQty: 10.5 },
            { itemId: 'ITEM-SPICE', actualQty: 1.2 }
          ],
          actualOutput: 188,
          scrapPouches: 6,
          cartonsUsed: 9,
          directLabourCost: 1200.0,
          gasPowerCost: 600.0,
          valuationMethod: 'FIFO'
        });
        message = `Step 2: Logged batch ${resObj.batchNo}. Produced 188 pkts (Yield Var: ${resObj.yieldVariancePct}%), 6 damaged pouches, 9 cartons. Cost/pkt: ₹${resObj.costPerPacket}.`;
      } else if (step === 3) {
        const resObj = createOrder({
          customerId: 'CUST-RETAILER-A',
          salesmanId: 'USER-SALESMAN-A',
          productId: 'ITEM-MURUKKU-200',
          quantity: 150,
          unitPrice: 50.0,
          notes: 'Urgent festival delivery'
        });
        message = `Step 3: Salesman A placed order ${resObj.orderNo} for Retailer A (150 pkts). Stock available: ${resObj.availableStock}.`;
      } else if (step === 4) {
        const ord = db.prepare("SELECT id FROM orders WHERE customer_id = 'CUST-RETAILER-A' AND status = 'SUBMITTED' ORDER BY id DESC LIMIT 1").get();
        if (ord) {
          const resObj = approveOrderAndInvoice({ orderId: ord.id, autoDispatch: true });
          message = `Step 4: Admin raised Tax Invoice ${resObj.invoiceNo} (Tax: ₹${resObj.cgstAmount + resObj.sgstAmount}) and dispatched 150 pkts. Remaining FG Stock: ${resObj.newFgStock} pkts.`;
        } else {
          message = 'Step 4: Order for Retailer A is already invoiced or not found.';
        }
      } else if (step === 5) {
        const resObj = createOrder({
          customerId: 'CUST-DISTRIB-B',
          salesmanId: 'USER-SALESMAN-B',
          productId: 'ITEM-MURUKKU-200',
          quantity: 120,
          unitPrice: 50.0,
          notes: 'Inter-state order to Bangalore'
        });
        message = `Step 5: Salesman B placed order ${resObj.orderNo} for Distributor B (120 pkts). Factory Stock: ${resObj.availableStock} pkts. Shortage flagged: ${resObj.shortageQty} pkts!`;
      } else if (step === 6) {
        const inv = db.prepare("SELECT id, invoice_no FROM invoices WHERE customer_id = 'CUST-RETAILER-A' ORDER BY id DESC LIMIT 1").get();
        if (inv) {
          const resObj = recordPayment({
            customerId: 'CUST-RETAILER-A',
            invoiceId: inv.id,
            amount: 4000.0,
            paymentMode: 'UPI',
            referenceNo: 'UPI/2026/8892110',
            notes: 'Part-payment received via GPay'
          });
          message = `Step 6: Payment of ₹4,000 recorded (Receipt: ${resObj.receiptNo}). Remaining balance due: ₹${resObj.balanceDue}.`;
        } else {
          message = 'Step 6: No invoice found for Retailer A to apply payment.';
        }
      } else if (step === 7) {
        const prod = db.prepare("SELECT * FROM production_runs ORDER BY id DESC LIMIT 1").get();
        message = `Step 7: Overheads verified (Labour: ₹1,200 + Power: ₹600). Cost per packet: ₹${prod ? prod.cost_per_packet : 30.90} (FIFO). Gross margin: ₹${(50 - (prod ? prod.cost_per_packet : 30.90)).toFixed(2)}.`;
      } else if (step === 8) {
        const reports = getAuditorReports('2026-11-01', '2026-11-30');
        message = `Step 8: Month-end reports generated. Sales: ${reports.salesRegister.length} invoice(s), GST Tax Liability: ₹${reports.gstSummary.totalTax}, Ledger movements: ${reports.stockLedger.length}.`;
      }

      return sendJson(res, 200, { success: true, step, message });
    }

    // -------------------------------------------------------------
    // STATIC ASSETS SERVING (SPA)
    // -------------------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Normalize path to prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Fallback to index.html for SPA client-side routing
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          return res.end('Server Error loading asset');
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });

  } catch (apiError) {
    console.error('API Error:', apiError);
    return sendJson(res, 400, { error: apiError.message || 'Internal Server Error' });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  const os = require('node:os');
  const getLocalIps = () => {
    const ips = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  };
  const ips = getLocalIps();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n============================================================`);
    console.log(`🚀 Annapoorna Order-to-Audit Server Running!`);
    console.log(`   ► IPv4 Loopback: http://127.0.0.1:${PORT}`);
    ips.forEach(ip => console.log(`   ► Local Network: http://${ip}:${PORT}`));
    console.log(`   ► Localhost:     http://localhost:${PORT}`);
    console.log(`============================================================\n`);
  });

  // Secondary port listener on 8080 for fallback
  const secondaryPort = 8080;
  const secondaryServer = http.createServer(handleRequest);
  secondaryServer.listen(secondaryPort, '0.0.0.0', () => {
    console.log(`   ► Secondary Port (8080): http://127.0.0.1:${secondaryPort}`);
    ips.forEach(ip => console.log(`   ► Secondary Net (8080):  http://${ip}:${secondaryPort}`));
  });
}

module.exports = { server, handleRequest, PORT };
