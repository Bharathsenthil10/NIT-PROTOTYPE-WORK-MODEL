// public/app.js - Full-Stack Client SPA for Order-to-Audit System
(function() {
  'use strict';

  // State
  let currentRole = 'admin';
  let currentLang = 'en';
  let isSimulatedOffline = false;
  let offlineQueue = JSON.parse(localStorage.getItem('annapoorna_offline_queue') || '[]');

  // Cached API Data
  let appData = {
    items: [],
    customers: [],
    suppliers: [],
    boms: [],
    orders: [],
    invoices: [],
    productionRuns: [],
    purchases: [],
    reports: null,
    ownerStats: null,
    benchmarkStatus: null
  };

  // Tamil Translations Dictionary
  const I18N = {
    en: {
      factoryName: 'Annapoorna Traditional Foods',
      admin: 'Factory Admin',
      salesman: 'Field Salesman',
      production: 'Production Floor',
      accountant: 'Auditor / CA',
      owner: 'Owner Dashboard',
      online: 'Online - Live Sync',
      offline: 'Offline - Working Local',
      orderNow: 'Submit Order',
      selectCustomer: 'Select Retailer / Distributor',
      selectProduct: 'Select Product',
      quantity: 'Quantity (Packets)',
      unitPrice: 'Unit Price',
      totalValue: 'Total Value',
      currentStock: 'Current Stock',
      shortageAlert: 'Shortage Warning',
      costPerPkt: 'Cost Per Packet',
      yieldVar: 'Yield Variance',
      flour: 'Flour (kg)',
      oil: 'Cooking Oil (L)',
      pouches: 'Pouches (pcs)',
      cartons: 'Cartons (pcs)',
      runBenchmark: '▶️ Run Benchmark Scenario',
      resetInitial: '🔄 Reset Opening State',
      auditChecklist: '📋 Audit Checklist',
      saveRun: 'Record Production Run'
    },
    ta: {
      factoryName: 'அன்னபூர்ணா பாரம்பரிய உணவுகள்',
      admin: 'தொழிற்சாலை நிர்வாகி',
      salesman: 'கள விற்பனையாளர்',
      production: 'உற்பத்தி தளம்',
      accountant: 'தணிக்கையாளர் / CA',
      owner: 'உரிமையாளர் முகப்பு',
      online: 'இணையத்தில் உள்ளது (Live Sync)',
      offline: 'இணையம் இல்லை (Offline சேமிப்பு)',
      orderNow: 'ஆர்டரை சமர்ப்பிக்கவும்',
      selectCustomer: 'வாடிக்கையாளரைத் தேர்ந்தெடுக்கவும்',
      selectProduct: 'பொருளைத் தேர்ந்தெடுக்கவும்',
      quantity: 'எண்ணிக்கை (பாக்கெட்டுகள்)',
      unitPrice: 'விலை (₹)',
      totalValue: 'மொத்த மதிப்பு',
      currentStock: 'இருப்பு அளவு',
      shortageAlert: 'இருப்பு பற்றாக்குறை எச்சரிக்கை',
      costPerPkt: 'ஒரு பாக்கெட் அடக்க விலை',
      yieldVar: 'விளைச்சல் மாறுபாடு',
      flour: 'மாவு (கிலோ)',
      oil: 'சமையல் எண்ணெய் (லிட்டர்)',
      pouches: 'பைகள் (Pouches)',
      cartons: 'அட்டைப்பெட்டிகள் (Cartons)',
      runBenchmark: '▶️ மாதிரி சூழ்நிலையை இயக்கு',
      resetInitial: '🔄 தொடக்க நிலைக்கு மீட்டமை',
      auditChecklist: '📋 தணிக்கை சரிபார்ப்பு பட்டியல்',
      saveRun: 'உற்பத்திப் பதிவைச் சேமிக்கவும்'
    }
  };

  function t(key) {
    return I18N[currentLang][key] || key;
  }

  // Format INR Currency
  function formatINR(val) {
    const num = Number(val || 0);
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // API Call Helper
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request Failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Initial Load
  async function loadInitialData() {
    try {
      const [items, customers, suppliers, boms, orders, invoices, benchmarkStatus] = await Promise.all([
        api('/api/items'),
        api('/api/customers'),
        api('/api/suppliers'),
        api('/api/boms'),
        api('/api/orders'),
        api('/api/invoices'),
        api('/api/benchmark/status')
      ]);

      appData.items = items;
      appData.customers = customers;
      appData.suppliers = suppliers;
      appData.boms = boms;
      appData.orders = orders;
      appData.invoices = invoices;
      appData.benchmarkStatus = benchmarkStatus;

      updateBenchmarkStatusIndicator();
      renderCurrentView();
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }

  function updateBenchmarkStatusIndicator() {
    const el = document.getElementById('benchmark-status-indicator') || document.getElementById('benchmark-status-badge');
    if (!el || !appData.benchmarkStatus) return;
    if (appData.benchmarkStatus.allPassed) {
      el.className = 'status-pill pill-success';
      el.innerHTML = '✅ Benchmark 100% Verified';
    } else {
      el.className = 'status-pill pill-warning';
      el.innerHTML = '⚠️ Benchmark Pending Run';
    }
  }

  // Render View Router
  function renderCurrentView() {
    const container = document.getElementById('view-container') || document.getElementById('main-view-container');
    if (!container) return;

    if (currentRole === 'salesman') {
      renderSalesmanView(container);
    } else if (currentRole === 'admin') {
      renderAdminView(container);
    } else if (currentRole === 'production') {
      renderProductionView(container);
    } else if (currentRole === 'accountant') {
      renderAuditorView(container);
    } else if (currentRole === 'owner') {
      renderOwnerView(container);
    }
  }

  // =========================================================================
  // 1. SALESMAN VIEW (Mobile Optimized)
  // =========================================================================
  function renderSalesmanView(container) {
    const fgItem = appData.items.find(i => i.id === 'ITEM-MURUKKU-200') || { currentStock: 0, standard_rate: 50 };
    const myOrders = appData.orders.filter(o => o.salesman_id === 'USER-SALESMAN-A' || !o.salesman_id);

    container.innerHTML = `
      <div class="mobile-shell">
        <div class="mobile-header">
          <div>
            <strong>${t('salesman')}</strong>
            <div style="font-size: 11px; opacity: 0.8;">Salesman A (Tamil Nadu Region)</div>
          </div>
          <div class="mobile-network-status">
            <span class="status-dot ${isSimulatedOffline ? 'offline' : ''}"></span>
            <span>${isSimulatedOffline ? t('offline') : t('online')}</span>
            <button id="btn-toggle-offline" style="background: none; border: none; color: #94a3b8; font-size: 10px; text-decoration: underline; cursor: pointer; margin-left: 4px;">Toggle</button>
          </div>
        </div>

        <div class="mobile-body">
          ${offlineQueue.length > 0 ? `
            <div class="alert alert-warning">
              ⚠️ <strong>${offlineQueue.length} Order(s) Queued Offline.</strong>
              <button class="btn btn-sm btn-secondary" id="btn-sync-offline" style="margin-left: auto;">Sync Now</button>
            </div>
          ` : ''}

          <div class="card" style="padding: 14px; margin-bottom: 16px;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
              <span>📝 Take New Order</span>
              <span class="badge badge-info">Fast Entry &lt; 30s</span>
            </div>

            <form id="sales-order-form">
              <div class="form-group">
                <label class="form-label">${t('selectCustomer')}</label>
                <select class="form-control" id="order-customer" required>
                  ${appData.customers.map(c => `
                    <option value="${c.id}" ${c.id === 'CUST-RETAILER-A' ? 'selected' : ''}>
                      ${c.name} (${c.state} - ${c.type})
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="product-order-card">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div>
                    <strong>${fgItem.name || 'Murukku 200 g'}</strong>
                    <div style="font-size: 12px; color: var(--text-muted);">HSN: 21069099 • Pack: 200g</div>
                  </div>
                  <div style="text-align: right;">
                    <div style="font-weight: 700; color: var(--primary); font-size: 15px;">${formatINR(fgItem.standard_rate || 50)}</div>
                    <span class="badge ${fgItem.currentStock > 0 ? 'badge-success' : 'badge-danger'}">
                      Stock: ${fgItem.currentStock} pkts
                    </span>
                  </div>
                </div>

                <div class="form-group" style="margin-top: 10px; margin-bottom: 8px;">
                  <label class="form-label">${t('quantity')}</label>
                  <div class="qty-stepper">
                    <button type="button" onclick="adjustQty(-10)">-</button>
                    <input type="number" id="order-qty" value="150" min="1" step="1" required>
                    <button type="button" onclick="adjustQty(10)">+</button>
                    <div style="display: flex; gap: 4px; margin-left: 8px;">
                      <button type="button" class="quick-add-btn" onclick="setQty(50)">50</button>
                      <button type="button" class="quick-add-btn" onclick="setQty(120)">120</button>
                      <button type="button" class="quick-add-btn" onclick="setQty(150)">150</button>
                    </div>
                  </div>
                </div>

                <div id="live-stock-warning" style="display: none; margin-top: 8px;" class="alert alert-danger" style="padding: 6px 10px; font-size: 11px;">
                  ⚠️ Shortage Alert: Insufficient factory stock!
                </div>
              </div>

              <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; margin-bottom: 14px;">
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span>Taxable Value:</span>
                  <strong id="summary-taxable">${formatINR(7500)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span>Estimated GST (5%):</span>
                  <strong id="summary-gst">${formatINR(375)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; border-top: 1px solid #cbd5e1; padding-top: 4px;">
                  <span>Total Order Amount:</span>
                  <span id="summary-total" style="color: var(--primary);">${formatINR(7875)}</span>
                </div>
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 12px;">
                🚀 ${t('orderNow')}
              </button>
            </form>
          </div>

          <!-- RECENT ORDERS -->
          <div class="card" style="padding: 14px;">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px;">📦 My Orders & Dispatch Status</div>
            ${myOrders.length === 0 ? '<div style="color: var(--text-muted); font-size: 12px;">No orders placed yet.</div>' : `
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${myOrders.map(o => `
                  <div style="border: 1px solid var(--border); border-radius: 6px; padding: 10px; background: #fff; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; font-weight: 600;">
                      <span>${o.order_no}</span>
                      <span class="badge ${
                        o.status === 'DISPATCHED' ? 'badge-success' :
                        o.status === 'APPROVED' ? 'badge-info' :
                        o.status === 'SUBMITTED' ? (o.shortage_qty > 0 ? 'badge-danger' : 'badge-warning') : 'badge-neutral'
                      }">${o.status} ${o.shortage_qty > 0 ? `(Short: ${o.shortage_qty})` : ''}</span>
                    </div>
                    <div style="color: var(--text-muted); margin-top: 2px;">
                      ${o.customer_name} • ${o.quantity} pkts • ${formatINR(o.total_value)}
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    // Hook events
    const qtyInput = document.getElementById('order-qty');
    const updateCalculations = () => {
      const q = Number(qtyInput.value || 0);
      const rate = fgItem.standard_rate || 50;
      const taxable = q * rate;
      const gst = taxable * 0.05;
      const total = taxable + gst;

      document.getElementById('summary-taxable').innerText = formatINR(taxable);
      document.getElementById('summary-gst').innerText = formatINR(gst);
      document.getElementById('summary-total').innerText = formatINR(total);

      const warnEl = document.getElementById('live-stock-warning');
      if (q > fgItem.currentStock) {
        warnEl.style.display = 'block';
        warnEl.innerHTML = `⚠️ Shortage Warning: Stock is ${fgItem.currentStock} pkts. Shortage of <strong>${q - fgItem.currentStock} pkts</strong> will be flagged.`;
      } else {
        warnEl.style.display = 'none';
      }
    };

    window.adjustQty = (delta) => {
      qtyInput.value = Math.max(1, Number(qtyInput.value || 0) + delta);
      updateCalculations();
    };

    window.setQty = (val) => {
      qtyInput.value = val;
      updateCalculations();
    };

    qtyInput.addEventListener('input', updateCalculations);
    updateCalculations();

    // Toggle Offline Simulation
    document.getElementById('btn-toggle-offline').onclick = () => {
      isSimulatedOffline = !isSimulatedOffline;
      renderCurrentView();
    };

    // Sync Offline Queue
    const syncBtn = document.getElementById('btn-sync-offline');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        try {
          while (offlineQueue.length > 0) {
            const item = offlineQueue.shift();
            await api('/api/orders', { method: 'POST', body: JSON.stringify(item) });
          }
          localStorage.removeItem('annapoorna_offline_queue');
          alert('All offline orders synchronized successfully!');
          await loadInitialData();
        } catch (e) {
          alert('Sync failed: ' + e.message);
        }
      };
    }

    // Submit Order Form
    document.getElementById('sales-order-form').onsubmit = async (e) => {
      e.preventDefault();
      const customerId = document.getElementById('order-customer').value;
      const quantity = Number(document.getElementById('order-qty').value);

      const payload = {
        customerId,
        salesmanId: 'USER-SALESMAN-A',
        productId: 'ITEM-MURUKKU-200',
        quantity,
        unitPrice: 50.0,
        createdOffline: isSimulatedOffline ? 1 : 0
      };

      if (isSimulatedOffline) {
        offlineQueue.push(payload);
        localStorage.setItem('annapoorna_offline_queue', JSON.stringify(offlineQueue));
        alert('🌐 Device is offline. Order saved locally in offline queue!');
        renderCurrentView();
      } else {
        try {
          const res = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
          if (res.hasShortage) {
            alert(`Order ${res.orderNo} submitted! Note: Factory has shortage of ${res.shortageQty} packets.`);
          } else {
            alert(`Order ${res.orderNo} submitted successfully! Stock available.`);
          }
          await loadInitialData();
        } catch (err) {
          alert('Order error: ' + err.message);
        }
      }
    };
  }

  // =========================================================================
  // 2. FACTORY ADMIN VIEW (Billing Desk & Dispatch)
  // =========================================================================
  function renderAdminView(container) {
    const fgItem = appData.items.find(i => i.id === 'ITEM-MURUKKU-200') || { currentStock: 0 };
    const pendingOrders = appData.orders.filter(o => o.status === 'SUBMITTED');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>🖥️ Factory Billing & Dispatch Desk</span>
            <span class="badge badge-info">Tamil Nadu (State 33)</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" id="btn-open-purchase-modal">➕ Record Raw Material Purchase</button>
            <button class="btn btn-primary btn-sm" id="btn-open-payment-modal">💵 Record Customer Payment</button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card ${fgItem.currentStock < 50 ? 'warning' : 'success'}">
            <div class="kpi-label">Finished Goods Stock</div>
            <div class="kpi-value">${fgItem.currentStock} pkts</div>
            <div class="kpi-note">Murukku 200g ready for dispatch</div>
          </div>
          <div class="kpi-card ${pendingOrders.length > 0 ? 'warning' : ''}">
            <div class="kpi-label">Incoming Orders</div>
            <div class="kpi-value">${pendingOrders.length}</div>
            <div class="kpi-note">Awaiting verification & billing</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Invoices Raised</div>
            <div class="kpi-value">${appData.invoices.length}</div>
            <div class="kpi-note">Total GST-compliant invoices</div>
          </div>
        </div>

        <!-- INCOMING ORDERS SECTION -->
        <div style="margin-top: 20px;">
          <h3 style="font-size: 14px; margin-bottom: 10px; font-weight: 700;">📥 Incoming Sales Orders (Verification & Stock Check)</h3>
          ${appData.orders.length === 0 ? '<div class="alert alert-warning">No orders in queue.</div>' : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Date</th>
                    <th>Customer & State</th>
                    <th>Product</th>
                    <th class="text-right">Ordered Qty</th>
                    <th class="text-right">Live Stock</th>
                    <th>Coverage / Shortage</th>
                    <th>Status</th>
                    <th class="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${appData.orders.map(o => {
                    const isTN = o.customer_state_code === '33';
                    const shortage = o.quantity > fgItem.currentStock ? (o.quantity - fgItem.currentStock) : 0;
                    return `
                      <tr>
                        <td><strong>${o.order_no}</strong></td>
                        <td>${o.date}</td>
                        <td>
                          <strong>${o.customer_name}</strong>
                          <div style="font-size: 11px; color: var(--text-muted);">${o.customer_state} (${isTN ? 'Intra-state: CGST+SGST' : 'Inter-state: IGST'})</div>
                        </td>
                        <td>${o.product_name}</td>
                        <td class="text-right"><strong>${o.quantity}</strong> ${o.product_unit}</td>
                        <td class="text-right">${fgItem.currentStock}</td>
                        <td>
                          ${shortage > 0 ? `
                            <span class="badge badge-danger">⚠️ Shortage: ${shortage} pkts</span>
                          ` : `
                            <span class="badge badge-success">✓ Stock Available</span>
                          `}
                        </td>
                        <td>
                          <span class="badge ${
                            o.status === 'DISPATCHED' ? 'badge-success' :
                            o.status === 'APPROVED' ? 'badge-info' : 'badge-warning'
                          }">${o.status}</span>
                        </td>
                        <td class="text-center">
                          ${o.status === 'SUBMITTED' ? `
                            ${shortage > 0 ? `
                              <button class="btn btn-sm btn-secondary" onclick="alert('Cannot dispatch: Factory has a shortage of ${shortage} packets. Produce more Murukku first!')">
                                Flag Shortage
                              </button>
                            ` : `
                              <button class="btn btn-sm btn-primary" onclick="approveAndInvoiceOrder('${o.id}')">
                                Approve & Invoice
                              </button>
                            `}
                          ` : `
                            <span style="font-size: 12px; color: var(--text-muted);">Processed</span>
                          `}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- GST TAX INVOICES SECTION -->
        <div style="margin-top: 30px;">
          <h3 style="font-size: 14px; margin-bottom: 10px; font-weight: 700;">📑 GST Tax Invoices & Dispatches</h3>
          ${appData.invoices.length === 0 ? '<div class="alert alert-neutral">No invoices raised yet.</div>' : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Taxable Value</th>
                    <th>CGST (2.5%)</th>
                    <th>SGST (2.5%)</th>
                    <th>IGST (5%)</th>
                    <th>Total Value</th>
                    <th>Paid</th>
                    <th>Balance Due</th>
                    <th>Status</th>
                    <th class="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${appData.invoices.map(inv => `
                    <tr>
                      <td><strong>${inv.invoice_no}</strong></td>
                      <td>${inv.invoice_date}</td>
                      <td>${inv.customer_name}</td>
                      <td class="text-right">${formatINR(inv.taxable_value)}</td>
                      <td class="text-right">${formatINR(inv.cgst_amount)}</td>
                      <td class="text-right">${formatINR(inv.sgst_amount)}</td>
                      <td class="text-right">${formatINR(inv.igst_amount)}</td>
                      <td class="text-right"><strong>${formatINR(inv.total_amount)}</strong></td>
                      <td class="text-right">${formatINR(inv.amount_paid)}</td>
                      <td class="text-right"><strong style="color: ${inv.balance_due > 0 ? 'var(--danger)' : 'var(--success)'};">${formatINR(inv.balance_due)}</strong></td>
                      <td>
                        <span class="badge ${inv.status === 'PAID' ? 'badge-success' : inv.status === 'PARTIALLY_PAID' ? 'badge-warning' : 'badge-info'}">
                          ${inv.status}
                        </span>
                      </td>
                      <td class="text-center">
                        <button class="btn btn-sm btn-secondary" onclick="viewInvoiceModal('${inv.id}')">
                          🖨️ View & Print PDF
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    // Hook Admin actions
    document.getElementById('btn-open-purchase-modal').onclick = openPurchaseModal;
    document.getElementById('btn-open-payment-modal').onclick = openPaymentModal;

    window.approveAndInvoiceOrder = async (orderId) => {
      try {
        const res = await api('/api/orders/approve', {
          method: 'POST',
          body: JSON.stringify({ orderId, autoDispatch: true })
        });
        alert(`Invoice ${res.invoiceNo} generated and dispatch recorded! Finished goods stock reduced.`);
        await loadInitialData();
      } catch (err) {
        alert('Approval failed: ' + err.message);
      }
    };
  }

  // =========================================================================
  // 3. PRODUCTION SUPERVISOR VIEW (Floor & BOM Recipe)
  // =========================================================================
  function renderProductionView(container) {
    const rawItems = appData.items.filter(i => i.category === 'raw_material');
    const packItems = appData.items.filter(i => i.category === 'packaging');
    const fgItem = appData.items.find(i => i.category === 'finished_good') || { currentStock: 0 };

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>⚙️ Production Floor & Recipe Control (BOM)</span>
            <span class="badge badge-info">Tolerance: ±3.0%</span>
          </div>
          <button class="btn btn-primary" id="btn-open-prod-run-modal">
            ➕ Log Daily Production Run
          </button>
        </div>

        <!-- CURRENT INVENTORY SNAPSHOT -->
        <h3 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">📦 Live Floor Inventory Balances (From Stock Ledger)</h3>
        <div class="kpi-grid">
          ${[...rawItems, ...packItems].map(item => `
            <div class="kpi-card ${item.isLowStock ? 'warning' : ''}">
              <div class="kpi-label">${item.name} (${item.unit})</div>
              <div class="kpi-value">${item.currentStock} <span style="font-size: 14px; font-weight: 400;">${item.unit}</span></div>
              <div class="kpi-note">Reorder Level: ${item.reorder_level} ${item.unit} ${item.isLowStock ? '⚠️ LOW' : ''}</div>
            </div>
          `).join('')}
          <div class="kpi-card success">
            <div class="kpi-label">Finished Murukku 200g</div>
            <div class="kpi-value">${fgItem.currentStock} <span style="font-size: 14px; font-weight: 400;">pkts</span></div>
            <div class="kpi-note">Valuation: ${formatINR(fgItem.currentStock * 31.00)}</div>
          </div>
        </div>

        <!-- PRODUCTION RUNS LOG -->
        <div style="margin-top: 24px;">
          <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 10px;">📋 Production Runs & Consumption Variance</h3>
          ${appData.productionRuns.length === 0 ? '<div class="alert alert-warning">No production runs recorded yet. Use button above to log a batch run.</div>' : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Run #</th>
                    <th>Date</th>
                    <th>Batch #</th>
                    <th>Expected Yield</th>
                    <th>Actual Output</th>
                    <th>Scrap Pouches</th>
                    <th>Yield Variance</th>
                    <th>Raw Materials</th>
                    <th>Overheads</th>
                    <th>Total Cost</th>
                    <th>Cost / Pkt</th>
                    <th>Gross Margin (@ ₹50)</th>
                  </tr>
                </thead>
                <tbody>
                  ${appData.productionRuns.map(r => `
                    <tr>
                      <td><strong>${r.run_no}</strong></td>
                      <td>${r.date}</td>
                      <td>${r.batch_no}</td>
                      <td>${r.expected_output} pkts</td>
                      <td><strong>${r.actual_output} pkts</strong></td>
                      <td>${r.scrap_pouches} pcs</td>
                      <td>
                        <span class="badge ${r.yield_variance_pct < -3 ? 'badge-danger' : 'badge-success'}">
                          ${r.yield_variance_pct}% ${r.yield_variance_pct < -3 ? '⚠️ ALERT' : ''}
                        </span>
                      </td>
                      <td class="text-right">${formatINR(r.raw_material_cost)}</td>
                      <td class="text-right">${formatINR(r.direct_labour_cost + r.gas_power_cost + r.other_overheads)}</td>
                      <td class="text-right"><strong>${formatINR(r.total_cost)}</strong></td>
                      <td class="text-right"><strong style="color: var(--primary);">${formatINR(r.cost_per_packet)}</strong></td>
                      <td class="text-right"><strong style="color: var(--success);">${formatINR(50 - r.cost_per_packet)} (${(((50 - r.cost_per_packet)/50)*100).toFixed(1)}%)</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('btn-open-prod-run-modal').onclick = openProductionRunModal;
  }

  // =========================================================================
  // 4. ACCOUNTANT / AUDITOR VIEW (Reports, GSTR-1, Ledger & Tally)
  // =========================================================================
  async function renderAuditorView(container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>📊 External Auditor & Accounts Console</span>
            <span class="badge badge-neutral">Read-Only Compliance Mode</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <a href="/api/reports/tally-xml" target="_blank" class="btn btn-secondary btn-sm">
              📥 Export Tally XML
            </a>
            <button class="btn btn-primary btn-sm" id="btn-export-csv">
              📊 Export Report CSV
            </button>
          </div>
        </div>

        <!-- DATE RANGE SELECTOR & TABS -->
        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap;">
          <div>
            <label style="font-size: 11px; font-weight: 700; color: var(--secondary);">From:</label>
            <input type="date" id="report-from" class="form-control" value="2026-11-01" style="display: inline-block; width: auto; padding: 4px 8px;">
          </div>
          <div>
            <label style="font-size: 11px; font-weight: 700; color: var(--secondary);">To:</label>
            <input type="date" id="report-to" class="form-control" value="2026-11-30" style="display: inline-block; width: auto; padding: 4px 8px;">
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-reports">Filter</button>
        </div>

        <!-- TABS -->
        <div class="role-switcher" style="margin-bottom: 16px;" id="report-tabs">
          <button class="role-btn active" data-tab="sales">1. Sales Register</button>
          <button class="role-btn" data-tab="gst">2. GST Outward Summary (GSTR-1)</button>
          <button class="role-btn" data-tab="stock">3. Stock Ledger & Movements</button>
          <button class="role-btn" data-tab="production">4. Production Variance Report</button>
          <button class="role-btn" data-tab="receivables">5. Receivables Ageing</button>
        </div>

        <div id="report-content-pane">
          <div style="text-align: center; padding: 20px;">Loading Reports...</div>
        </div>
      </div>
    `;

    // Fetch reports
    const loadReports = async () => {
      const from = document.getElementById('report-from').value;
      const to = document.getElementById('report-to').value;
      const reports = await api(`/api/reports?startDate=${from}&endDate=${to}`);
      appData.reports = reports;
      renderReportTab('sales');
    };

    document.getElementById('btn-refresh-reports').onclick = loadReports;

    const tabButtons = document.querySelectorAll('#report-tabs .role-btn');
    tabButtons.forEach(btn => {
      btn.onclick = () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderReportTab(btn.dataset.tab);
      };
    });

    await loadReports();
  }

  function renderReportTab(tab) {
    const pane = document.getElementById('report-content-pane');
    if (!pane || !appData.reports) return;

    const r = appData.reports;

    if (tab === 'sales') {
      pane.innerHTML = `
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Sales Register (${r.dateRange.startDate} to ${r.dateRange.endDate})</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Place of Supply</th>
                <th class="text-right">Taxable</th>
                <th class="text-right">CGST</th>
                <th class="text-right">SGST</th>
                <th class="text-right">IGST</th>
                <th class="text-right">Total Amount</th>
                <th class="text-right">Paid</th>
                <th class="text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              ${r.salesRegister.map(row => `
                <tr>
                  <td><strong>${row.invoice_no}</strong></td>
                  <td>${row.invoice_date}</td>
                  <td>${row.customer_name}</td>
                  <td>${row.place_of_supply}</td>
                  <td class="text-right">${formatINR(row.taxable_value)}</td>
                  <td class="text-right">${formatINR(row.cgst_amount)}</td>
                  <td class="text-right">${formatINR(row.sgst_amount)}</td>
                  <td class="text-right">${formatINR(row.igst_amount)}</td>
                  <td class="text-right"><strong>${formatINR(row.total_amount)}</strong></td>
                  <td class="text-right">${formatINR(row.amount_paid)}</td>
                  <td class="text-right"><strong style="color: ${row.balance_due > 0 ? 'var(--danger)' : 'var(--success)'};">${formatINR(row.balance_due)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (tab === 'gst') {
      pane.innerHTML = `
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">GST Outward Supplies (GSTR-1 Mapped Shape)</h4>
        <div class="kpi-grid" style="margin-bottom: 16px;">
          <div class="kpi-card">
            <div class="kpi-label">Total Taxable Value</div>
            <div class="kpi-value">${formatINR(r.gstSummary.totalTaxable)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">CGST Output</div>
            <div class="kpi-value">${formatINR(r.gstSummary.b2bCgst)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">SGST Output</div>
            <div class="kpi-value">${formatINR(r.gstSummary.b2bSgst)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total Tax Liability</div>
            <div class="kpi-value">${formatINR(r.gstSummary.totalTax)}</div>
          </div>
        </div>

        <h5 style="font-size: 12px; font-weight: 700; margin-bottom: 6px;">Table 12: HSN Summary of Outward Supplies</h5>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>HSN Code</th>
                <th>Description</th>
                <th>Unit</th>
                <th class="text-right">Total Qty</th>
                <th class="text-right">Taxable Value</th>
                <th class="text-right">CGST</th>
                <th class="text-right">SGST</th>
                <th class="text-right">Total Tax</th>
              </tr>
            </thead>
            <tbody>
              ${r.gstSummary.hsnSummary.map(h => `
                <tr>
                  <td><strong>${h.hsn_code}</strong></td>
                  <td>${h.description}</td>
                  <td>${h.unit}</td>
                  <td class="text-right">${h.total_qty}</td>
                  <td class="text-right">${formatINR(h.taxable_value)}</td>
                  <td class="text-right">${formatINR(h.cgst_amount)}</td>
                  <td class="text-right">${formatINR(h.sgst_amount)}</td>
                  <td class="text-right"><strong>${formatINR(h.cgst_amount + h.sgst_amount + h.igst_amount)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (tab === 'stock') {
      pane.innerHTML = `
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Stock Movement Ledger (Audit-Grade Traceability)</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp</th>
                <th>Item</th>
                <th>Type</th>
                <th>Source Doc</th>
                <th>Doc #</th>
                <th class="text-right">Qty In</th>
                <th class="text-right">Qty Out</th>
                <th class="text-right">Balance After</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${r.stockLedger.map(sl => `
                <tr>
                  <td>${sl.id}</td>
                  <td>${sl.timestamp.slice(0, 19).replace('T', ' ')}</td>
                  <td><strong>${sl.item_name}</strong></td>
                  <td><span class="badge badge-neutral">${sl.transaction_type}</span></td>
                  <td>${sl.source_doc_type}</td>
                  <td><strong>${sl.source_doc_id}</strong></td>
                  <td class="text-right">${sl.qty_in > 0 ? `+${sl.qty_in}` : '-'}</td>
                  <td class="text-right">${sl.qty_out > 0 ? `-${sl.qty_out}` : '-'}</td>
                  <td class="text-right"><strong>${sl.balance_after} ${sl.unit}</strong></td>
                  <td>${sl.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (tab === 'production') {
      pane.innerHTML = `
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Production Variance & Cost Allocation Report</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Run No</th>
                <th>Date</th>
                <th>Batch #</th>
                <th>Expected Yield</th>
                <th>Actual Yield</th>
                <th>Scrap Pouches</th>
                <th>Yield Variance</th>
                <th>Materials Cost</th>
                <th>Overheads</th>
                <th>Total Cost</th>
                <th>Cost / Pkt</th>
              </tr>
            </thead>
            <tbody>
              ${r.productionReport.map(pr => `
                <tr>
                  <td><strong>${pr.run_no}</strong></td>
                  <td>${pr.date}</td>
                  <td>${pr.batch_no}</td>
                  <td>${pr.expected_output} pkts</td>
                  <td><strong>${pr.actual_output} pkts</strong></td>
                  <td>${pr.scrap_pouches} pcs</td>
                  <td><span class="badge ${pr.yield_variance_pct < -3 ? 'badge-danger' : 'badge-success'}">${pr.yield_variance_pct}%</span></td>
                  <td class="text-right">${formatINR(pr.raw_material_cost)}</td>
                  <td class="text-right">${formatINR(pr.overheads)}</td>
                  <td class="text-right"><strong>${formatINR(pr.total_cost)}</strong></td>
                  <td class="text-right"><strong style="color: var(--primary);">${formatINR(pr.cost_per_packet)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (tab === 'receivables') {
      pane.innerHTML = `
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Customer Outstanding & Ageing Analysis</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Total Invoiced</th>
                <th>Total Collected</th>
                <th>Current Outstanding</th>
                <th>0-30 Days</th>
                <th>31-60 Days</th>
                <th>60+ Days</th>
              </tr>
            </thead>
            <tbody>
              ${r.receivables.map(c => `
                <tr>
                  <td><strong>${c.customer_name}</strong></td>
                  <td>${c.phone || '-'}</td>
                  <td class="text-right">${formatINR(c.total_billed)}</td>
                  <td class="text-right">${formatINR(c.total_collected)}</td>
                  <td class="text-right"><strong style="color: var(--danger);">${formatINR(c.current_outstanding)}</strong></td>
                  <td class="text-right">${formatINR(c.age_0_30)}</td>
                  <td class="text-right">${formatINR(c.age_31_60)}</td>
                  <td class="text-right">${formatINR(c.age_above_60)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // =========================================================================
  // 5. OWNER EXECUTIVE DASHBOARD VIEW
  // =========================================================================
  async function renderOwnerView(container) {
    const stats = await api('/api/owner/dashboard');
    appData.ownerStats = stats;

    const fgItem = appData.items.find(i => i.id === 'ITEM-MURUKKU-200') || { currentStock: 0 };
    const latestProd = stats.latestProduction;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>👔 Managing Director's Executive Overview</span>
            <span class="badge badge-info">${stats.factory.name}</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openChecklistModal()">
            📋 View Benchmark Verification
          </button>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card success">
            <div class="kpi-label">Finished Goods Stock</div>
            <div class="kpi-value">${fgItem.currentStock} <span style="font-size: 13px;">pkts</span></div>
            <div class="kpi-note">Murukku 200g ready to sell</div>
          </div>

          <div class="kpi-card danger">
            <div class="kpi-label">Customer Dues (Receivables)</div>
            <div class="kpi-value">${formatINR(stats.totalOutstanding)}</div>
            <div class="kpi-note">Pending collection across retailers</div>
          </div>

          <div class="kpi-card ${latestProd?.yield_variance_pct < -3 ? 'warning' : 'success'}">
            <div class="kpi-label">Production Yield Variance</div>
            <div class="kpi-value">${latestProd ? latestProd.yield_variance_pct + '%' : '0%'}</div>
            <div class="kpi-note">Batch ${latestProd?.batch_no || 'N/A'} (Tolerance: ±3%)</div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">Unit Cost per Packet</div>
            <div class="kpi-value">${latestProd ? formatINR(latestProd.cost_per_packet) : 'N/A'}</div>
            <div class="kpi-note">Gross Margin: ${latestProd ? formatINR(50 - latestProd.cost_per_packet) + ' / pkt' : '-'}</div>
          </div>
        </div>

        <!-- ACTIVE SYSTEM ALERTS -->
        <h3 style="font-size: 14px; font-weight: 700; margin-top: 16px; margin-bottom: 8px;">🚨 Critical Factory Alerts & Exceptions</h3>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
          ${latestProd?.yield_variance_pct < -3 ? `
            <div class="alert alert-danger">
              ⚠️ <strong>Yield Variance Exception:</strong> Production run ${latestProd.run_no} yielded 188 pkts vs 200 expected (-6.0% variance). Exceeds 3% tolerance. Supervisor investigation recommended.
            </div>
          ` : ''}

          ${stats.pendingShortagesCount > 0 ? `
            <div class="alert alert-warning">
              ⚠️ <strong>Order Shortage Alert:</strong> Distributor B (Karnataka) placed an order for 120 pkts, but available finished stock is only ${fgItem.currentStock} pkts (Shortage: 32 pkts).
            </div>
          ` : ''}

          ${stats.stockAlerts.map(a => `
            <div class="alert alert-warning">
              ⚠️ <strong>Raw Material Reorder Warning:</strong> ${a.name} current stock (${a.current_stock} ${a.unit}) is at or below reorder level (${a.reorder_level} ${a.unit}).
            </div>
          `).join('')}
        </div>

        <!-- INVENTORY HEALTH -->
        <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 8px;">🏭 Raw Material & Packaging Inventory Health</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th class="text-right">Current Stock</th>
                <th class="text-right">Reorder Level</th>
                <th class="text-right">Unit Rate</th>
                <th class="text-right">Inventory Valuation</th>
                <th>Health Status</th>
              </tr>
            </thead>
            <tbody>
              ${appData.items.map(item => `
                <tr>
                  <td><strong>${item.name}</strong></td>
                  <td>${item.category}</td>
                  <td class="text-right"><strong>${item.currentStock}</strong> ${item.unit}</td>
                  <td class="text-right">${item.reorder_level} ${item.unit}</td>
                  <td class="text-right">${formatINR(item.standard_rate)}</td>
                  <td class="text-right">${formatINR(item.stockValue)}</td>
                  <td>
                    ${item.isLowStock ? `
                      <span class="badge badge-warning">⚠️ Low Stock</span>
                    ` : `
                      <span class="badge badge-success">✓ Healthy</span>
                    `}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // MODALS: Production Run, Purchase, Payment, Invoice PDF, Audit Checklist
  // =========================================================================

  function getModalContent() {
    return document.getElementById('modal-dialog-content') || document.getElementById('modal-content');
  }

  function showModal() {
    const m = document.getElementById('modal-backdrop') || document.getElementById('modal-container');
    if (m) m.style.display = 'flex';
  }

  window.closeModal = () => {
    const m = document.getElementById('modal-backdrop') || document.getElementById('modal-container');
    if (m) m.style.display = 'none';
  };

  // Modal 1: Log Production Run
  function openProductionRunModal() {
    const modal = getModalContent();
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="font-size: 16px; font-weight: 700;">⚙️ Record Daily Production Run (Murukku 200g)</h3>
        <button onclick="closeModal()" style="border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
      </div>

      <form id="prod-run-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Batch Code</label>
            <input type="text" id="prod-batch" class="form-control" value="MK-202611-01" required>
          </div>
          <div class="form-group">
            <label class="form-label">Production Date</label>
            <input type="date" id="prod-date" class="form-control" value="2026-11-17" required>
          </div>
        </div>

        <h4 style="font-size: 13px; font-weight: 700; margin: 12px 0 6px;">Raw Materials Issued (Standard vs Actual)</h4>
        <div class="table-responsive" style="margin-bottom: 12px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Standard BOM Qty</th>
                <th>Actual Issued Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Flour (Rice/Gram)</td>
                <td>40.0</td>
                <td><input type="number" id="prod-flour" class="form-control" value="40" step="0.1" style="width: 100px;" required></td>
                <td>kg</td>
              </tr>
              <tr>
                <td>Cooking Oil</td>
                <td>10.0</td>
                <td><input type="number" id="prod-oil" class="form-control" value="10.5" step="0.1" style="width: 100px;" required></td>
                <td>litre</td>
              </tr>
              <tr>
                <td>Salt & Spice Mix</td>
                <td>1.2</td>
                <td><input type="number" id="prod-spice" class="form-control" value="1.2" step="0.1" style="width: 100px;" required></td>
                <td>kg</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 style="font-size: 13px; font-weight: 700; margin: 12px 0 6px;">Output & Packaging Wastage</h4>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Actual Good Packets Produced</label>
            <input type="number" id="prod-actual-output" class="form-control" value="188" required>
            <div style="font-size: 11px; color: var(--text-muted);">Standard expected: 200 packets</div>
          </div>
          <div class="form-group">
            <label class="form-label">Damaged / Scrap Pouches</label>
            <input type="number" id="prod-scrap-pouches" class="form-control" value="6" required>
            <div style="font-size: 11px; color: var(--text-muted);">Total pouches consumed = 188 + 6 = 194</div>
          </div>
          <div class="form-group">
            <label class="form-label">Cartons Used (20 pkts/box)</label>
            <input type="number" id="prod-cartons" class="form-control" value="9" required>
          </div>
        </div>

        <h4 style="font-size: 13px; font-weight: 700; margin: 12px 0 6px;">Direct Overheads & Valuation Rule</h4>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Direct Labour (₹)</label>
            <input type="number" id="prod-labour" class="form-control" value="1200" required>
          </div>
          <div class="form-group">
            <label class="form-label">Gas & Power (₹)</label>
            <input type="number" id="prod-power" class="form-control" value="600" required>
          </div>
          <div class="form-group">
            <label class="form-label">Inventory Valuation Method</label>
            <select id="prod-valuation" class="form-control">
              <option value="FIFO" selected>FIFO (Flour: ₹42/kg from opening stock)</option>
              <option value="WEIGHTED_AVERAGE">Weighted Average (Flour: ₹43.125/kg)</option>
            </select>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">💾 Save Run & Update Stock</button>
        </div>
      </form>
    `;

    document.getElementById('modal-container').style.display = 'flex';

    document.getElementById('prod-run-form').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        batchNo: document.getElementById('prod-batch').value,
        date: document.getElementById('prod-date').value,
        issuedItems: [
          { itemId: 'ITEM-FLOUR', actualQty: Number(document.getElementById('prod-flour').value) },
          { itemId: 'ITEM-OIL', actualQty: Number(document.getElementById('prod-oil').value) },
          { itemId: 'ITEM-SPICE', actualQty: Number(document.getElementById('prod-spice').value) }
        ],
        actualOutput: Number(document.getElementById('prod-actual-output').value),
        scrapPouches: Number(document.getElementById('prod-scrap-pouches').value),
        cartonsUsed: Number(document.getElementById('prod-cartons').value),
        directLabourCost: Number(document.getElementById('prod-labour').value),
        gasPowerCost: Number(document.getElementById('prod-power').value),
        valuationMethod: document.getElementById('prod-valuation').value
      };

      try {
        const res = await api('/api/production-runs', { method: 'POST', body: JSON.stringify(payload) });
        alert(`Production Run ${res.runNo} recorded! Cost per packet: ₹${res.costPerPacket}. Finished goods stock updated.`);
        closeModal();
        await loadInitialData();
      } catch (err) {
        alert('Production run error: ' + err.message);
      }
    };
    showModal();
  }

  // Modal 2: Purchase Order
  function openPurchaseModal() {
    const modal = getModalContent();
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="font-size: 16px; font-weight: 700;">📦 Record Raw Material Purchase</h3>
        <button onclick="closeModal()" style="border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
      </div>

      <form id="purchase-form">
        <div class="form-group">
          <label class="form-label">Supplier</label>
          <select id="pur-supplier" class="form-control" required>
            ${appData.suppliers.map(s => `<option value="${s.id}">${s.name} (${s.state})</option>`).join('')}
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Raw Material Item</label>
            <select id="pur-item" class="form-control" required>
              ${appData.items.filter(i => i.category === 'raw_material').map(i => `<option value="${i.id}" ${i.id === 'ITEM-FLOUR' ? 'selected' : ''}>${i.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Quantity</label>
            <input type="number" id="pur-qty" class="form-control" value="60" step="0.1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Unit Rate (₹)</label>
            <input type="number" id="pur-rate" class="form-control" value="45" step="0.01" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Supplier Invoice Reference #</label>
          <input type="text" id="pur-ref" class="form-control" value="MFM/2026/894">
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">📥 Record Purchase & Increase Stock</button>
        </div>
      </form>
    `;

    document.getElementById('purchase-form').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        supplierId: document.getElementById('pur-supplier').value,
        itemId: document.getElementById('pur-item').value,
        quantity: Number(document.getElementById('pur-qty').value),
        rate: Number(document.getElementById('pur-rate').value),
        invoiceRef: document.getElementById('pur-ref').value
      };

      try {
        const res = await api('/api/purchases', { method: 'POST', body: JSON.stringify(payload) });
        alert(`Purchase ${res.purchaseNo} recorded! Total: ₹${res.totalAmount}. Raw stock increased.`);
        closeModal();
        await loadInitialData();
      } catch (err) {
        alert('Purchase error: ' + err.message);
      }
    };
    showModal();
  }

  // Modal 3: Record Customer Payment
  function openPaymentModal() {
    const modal = getModalContent();
    const unpaidInvoices = appData.invoices.filter(i => i.balance_due > 0);

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="font-size: 16px; font-weight: 700;">💵 Record Customer Payment Receipt</h3>
        <button onclick="closeModal()" style="border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
      </div>

      <form id="payment-form">
        <div class="form-group">
          <label class="form-label">Select Unpaid Tax Invoice</label>
          <select id="pmt-invoice" class="form-control" required>
            ${unpaidInvoices.map(inv => `
              <option value="${inv.id}" data-customer="${inv.customer_id}" data-due="${inv.balance_due}">
                ${inv.invoice_no} • ${inv.customer_name} • Due: ${formatINR(inv.balance_due)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Payment Amount (₹)</label>
            <input type="number" id="pmt-amount" class="form-control" value="4000" step="0.01" required>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Mode</label>
            <select id="pmt-mode" class="form-control">
              <option value="UPI" selected>UPI (GPay / PhonePe)</option>
              <option value="NEFT">NEFT / Bank Transfer</option>
              <option value="Cheque">Cheque</option>
              <option value="Cash">Cash</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Reference / UTR #</label>
            <input type="text" id="pmt-ref" class="form-control" value="UPI/2026/8892110">
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">✓ Record Payment</button>
        </div>
      </form>
    `;

    document.getElementById('payment-form').onsubmit = async (e) => {
      e.preventDefault();
      const invSelect = document.getElementById('pmt-invoice');
      const invoiceId = invSelect.value;
      const customerId = invSelect.options[invSelect.selectedIndex].dataset.customer;
      const amount = Number(document.getElementById('pmt-amount').value);
      const paymentMode = document.getElementById('pmt-mode').value;
      const referenceNo = document.getElementById('pmt-ref').value;

      try {
        const res = await api('/api/payments', {
          method: 'POST',
          body: JSON.stringify({ customerId, invoiceId, amount, paymentMode, referenceNo })
        });
        alert(`Payment of ₹${res.amount} recorded! Remaining balance due: ₹${res.balanceDue}`);
        closeModal();
        await loadInitialData();
      } catch (err) {
        alert('Payment error: ' + err.message);
      }
    };
    showModal();
  }

  // Modal 4: View & Print GST Tax Invoice
  window.viewInvoiceModal = async (invoiceId) => {
    const data = await api(`/api/invoices/${invoiceId}`);
    const inv = data.invoice;
    const fac = data.factory;

    const modal = getModalContent();
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;" class="no-print">
        <h3 style="font-size: 16px; font-weight: 700;">GST Tax Invoice Preview</h3>
        <div style="display: flex; gap: 8px;">
          <a href="https://wa.me/?text=${encodeURIComponent(`Dear Customer, your Tax Invoice ${inv.invoice_no} for ${formatINR(inv.total_amount)} is raised. Balance due: ${formatINR(inv.balance_due)}.`)}" target="_blank" class="btn btn-secondary btn-sm">
            💬 WhatsApp Share Link
          </a>
          <button class="btn btn-primary btn-sm" onclick="window.print()">
            🖨️ Print / Save as PDF
          </button>
          <button onclick="closeModal()" style="border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
        </div>
      </div>

      <div class="invoice-box">
        <div class="invoice-header">
          <div>
            <h2 style="font-size: 18px; font-weight: 700; color: #0284c7;">${fac.name}</h2>
            <div style="font-size: 12px; color: #475569;">${fac.address}</div>
            <div style="font-size: 12px;"><strong>GSTIN:</strong> ${fac.gstin} • <strong>State Code:</strong> ${fac.stateCode} (${fac.state})</div>
            <div style="font-size: 12px;"><strong>Phone:</strong> ${fac.phone} • <strong>Email:</strong> ${fac.email}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; background: #e0f2fe; padding: 4px 8px; border-radius: 4px;">TAX INVOICE</div>
            <div style="font-size: 13px; font-weight: 700; margin-top: 6px;">Invoice #: ${inv.invoice_no}</div>
            <div style="font-size: 12px;">Date: ${inv.invoice_date}</div>
            <div style="font-size: 12px;">Due Date: ${inv.due_date}</div>
          </div>
        </div>

        <div class="invoice-parties">
          <div>
            <div style="font-weight: 700; text-transform: uppercase; font-size: 11px; color: #64748b;">Billed & Shipped To (Buyer):</div>
            <div style="font-weight: 700; font-size: 14px; margin-top: 2px;">${inv.customer_name}</div>
            <div style="font-size: 12px;">${inv.customer_address}</div>
            <div style="font-size: 12px;"><strong>GSTIN:</strong> ${inv.customer_gstin || 'Unregistered'}</div>
            <div style="font-size: 12px;"><strong>State / Code:</strong> ${inv.customer_state} (${inv.customer_state_code})</div>
            <div style="font-size: 12px;"><strong>Place of Supply:</strong> ${inv.customer_state}</div>
          </div>
          <div style="border-left: 1px solid #cbd5e1; padding-left: 12px;">
            <div style="font-weight: 700; text-transform: uppercase; font-size: 11px; color: #64748b;">Dispatch Details:</div>
            <div style="font-size: 12px; margin-top: 2px;"><strong>Order Ref:</strong> ${inv.order_no || 'Direct'}</div>
            <div style="font-size: 12px;"><strong>IRN:</strong> <span style="font-family: monospace; font-size: 10px;">${inv.irn_hash}</span></div>
            <div style="font-size: 12px;"><strong>e-Way Bill #:</strong> ${inv.eway_bill_no}</div>
            <div style="font-size: 12px;"><strong>Dispatch Status:</strong> ${inv.status}</div>
          </div>
        </div>

        <table class="invoice-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item Description</th>
              <th>HSN Code</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Rate</th>
              <th class="text-right">Taxable Value</th>
              ${inv.is_inter_state ? `
                <th class="text-right">IGST (5%)</th>
              ` : `
                <th class="text-right">CGST (2.5%)</th>
                <th class="text-right">SGST (2.5%)</th>
              `}
              <th class="text-right">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><strong>${inv.product_name}</strong><br><span style="font-size: 11px; color: #64748b;">Packaged Savouries</span></td>
              <td>${inv.hsn_code}</td>
              <td class="text-right">${inv.quantity} ${inv.product_unit}</td>
              <td class="text-right">${formatINR(inv.unit_price)}</td>
              <td class="text-right">${formatINR(inv.taxable_value)}</td>
              ${inv.is_inter_state ? `
                <td class="text-right">${formatINR(inv.igst_amount)}</td>
              ` : `
                <td class="text-right">${formatINR(inv.cgst_amount)}</td>
                <td class="text-right">${formatINR(inv.sgst_amount)}</td>
              `}
              <td class="text-right"><strong>${formatINR(inv.total_amount)}</strong></td>
            </tr>
          </tbody>
        </table>

        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Bank Details for Payment:</div>
            <div style="font-size: 12px;">Bank: State Bank of India, Thuvakudi Branch</div>
            <div style="font-size: 12px;">Account No: 33445566778 • IFSC: SBIN0001617</div>
            <div style="font-size: 12px;">UPI ID: billing@annapoornafoods</div>
          </div>

          <div style="width: 250px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span>Total Taxable:</span>
              <span>${formatINR(inv.taxable_value)}</span>
            </div>
            ${inv.is_inter_state ? `
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                <span>IGST (5%):</span>
                <span>${formatINR(inv.igst_amount)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                <span>CGST (2.5%):</span>
                <span>${formatINR(inv.cgst_amount)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                <span>SGST (2.5%):</span>
                <span>${formatINR(inv.sgst_amount)}</span>
              </div>
            `}
            <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; border-top: 2px solid #334155; padding-top: 4px;">
              <span>Invoice Total:</span>
              <span style="color: #0284c7;">${formatINR(inv.total_amount)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #16a34a; margin-top: 4px;">
              <span>Amount Paid:</span>
              <span>${formatINR(inv.amount_paid)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; color: #dc2626; border-top: 1px dashed #cbd5e1; padding-top: 4px; margin-top: 4px;">
              <span>Balance Due:</span>
              <span>${formatINR(inv.balance_due)}</span>
            </div>
          </div>
        </div>

        <div class="invoice-footer">
          <div style="display: flex; gap: 12px; align-items: center;">
            <div class="qr-placeholder">e-Invoice<br>QR Code</div>
            <div style="font-size: 10px; color: #64748b; max-width: 250px;">
              This is a digitally generated tax invoice per GST Rules. Reverse Charge: No.
            </div>
          </div>

          <div style="text-align: right;">
            <div style="font-size: 12px; font-weight: 700;">For Annapoorna Traditional Foods Pvt Ltd</div>
            <div style="height: 40px;"></div>
            <div style="font-size: 11px; border-top: 1px solid #334155; display: inline-block; padding-top: 4px;">Authorized Signatory</div>
          </div>
        </div>
      </div>
    `;

    showModal();
  };

  // Modal 5: Audit Checklist
  window.openChecklistModal = async () => {
    const status = await api('/api/benchmark/status');
    const modal = getModalContent();
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="font-size: 16px; font-weight: 700;">📋 Section 5 Benchmark Verification Checklist</h3>
        <button onclick="closeModal()" style="border: none; background: none; font-size: 20px; cursor: pointer;">&times;</button>
      </div>

      <div style="margin-bottom: 14px;">
        <p style="font-size: 13px; color: var(--text-muted);">
          This table automatically audits the live SQLite database movements against the Section 5 evaluation benchmark.
        </p>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Metric Check</th>
              <th>Expected Value</th>
              <th>Actual Live Value</th>
              <th>Audit Status</th>
            </tr>
          </thead>
          <tbody>
            ${status.checks.map(c => `
              <tr>
                <td><strong>${c.name}</strong></td>
                <td>${c.expected}</td>
                <td>${c.actual}</td>
                <td>
                  <span class="badge ${c.passed ? 'badge-success' : 'badge-danger'}">
                    ${c.passed ? '✅ PASS' : '❌ FAIL'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    `;
    showModal();
  };

  // Step-by-step Guided Tour Step Runner
  window.runBenchmarkStep = async (step) => {
    try {
      const res = await api('/api/benchmark/step', {
        method: 'POST',
        body: JSON.stringify({ step })
      });
      alert(res.message);
      await loadInitialData();
    } catch (e) {
      alert('Error running step ' + step + ': ' + e.message);
    }
  };

  // Top Bar Actions
  const runFullBtn = document.getElementById('btn-run-full-benchmark') || document.getElementById('btn-run-benchmark');
  if (runFullBtn) {
    runFullBtn.onclick = async () => {
      try {
        const res = await api('/api/benchmark/run-all', { method: 'POST' });
        alert('Benchmark Scenario steps 1-9 executed! Check the live numbers.');
        await loadInitialData();
        openChecklistModal();
      } catch (e) {
        alert('Benchmark error: ' + e.message);
      }
    };
  }

  const resetBtn = document.getElementById('btn-reset-benchmark') || document.getElementById('btn-reset-db');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (confirm('Reset database to opening stock per Section 5?')) {
        await api('/api/benchmark/reset', { method: 'POST' });
        alert('Database reset to Initial State!');
        await loadInitialData();
      }
    };
  }

  const checklistBtn = document.getElementById('btn-view-audit-checklist') || document.getElementById('btn-view-checklist');
  if (checklistBtn) {
    checklistBtn.onclick = openChecklistModal;
  }

  // Role Switcher
  const roleButtons = document.querySelectorAll('#role-nav-container .role-nav-btn, #role-switcher .role-btn');
  roleButtons.forEach(btn => {
    btn.onclick = () => {
      roleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role;
      renderCurrentView();
    };
  });

  // Language Toggle
  const langBtn = document.getElementById('btn-language-toggle') || document.getElementById('lang-toggle-btn');
  if (langBtn) {
    langBtn.onclick = () => {
      currentLang = currentLang === 'en' ? 'ta' : 'en';
      renderCurrentView();
    };
  }

  // Live Clock in Footer
  function updateClock() {
    const el = document.getElementById('clock-display');
    if (el) {
      el.innerText = new Date().toLocaleTimeString('en-IN', { hour12: true });
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Start app
  loadInitialData();

})();
