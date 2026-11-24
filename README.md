# Order-to-Audit ERP for Small Food Manufacturer (Packaged Snacks)
### Centre for Digital Infrastructure — NIT Tiruchirappalli Internship Prototype
**Hypothetical Client:** Annapoorna Traditional Foods Pvt Ltd (Packaged South Indian Snacks Manufacturer, Tiruchirappalli, Tamil Nadu)  
**Author:** Candidate Submission

---

## 1. Quick Start & Execution

This application has **zero external runtime npm dependencies**, eliminating install failures, C++ build tool errors, and version mismatch issues. It runs on any machine with Node.js 22+.

### Option A: Direct Local Run (Recommended - Instant)
```bash
# 1. Reset and load Section 5 initial master data
node seed.js

# 2. Run the automated benchmark verification test
node benchmark.js

# 3. Start the ERP Web Application
node server.js
```
Open **`http://localhost:3000`** in any web browser.

### Option B: Run via NPM Scripts
```bash
npm test         # Runs full 10-suite unit & integration test
npm run seed     # Resets database to Section 5 benchmark state
npm run benchmark # Executes full benchmark scenario steps 1-9 & audits checks
npm start        # Starts web server on http://localhost:3000
```

### Option C: Single-Command Docker Deployment
```bash
docker compose up --build
```
Access at `http://localhost:3000`.

---

## 2. Technology Stack & Justification

| Layer | Technology | Engineering Rationale |
| :--- | :--- | :--- |
| **Runtime & Backend** | **Node.js 24 Native** (`node:http`, `node:crypto`) | Zero-dependency architecture. Lightning-fast boot time (<100ms), no vulnerability exposure in `node_modules`, and guaranteed portability on Windows, macOS, and Linux without build steps. |
| **Database** | **SQLite Native** (`node:sqlite` `DatabaseSync`) | Embedded ACID-compliant relational SQL database with foreign key enforcement and file persistence (`database.sqlite`). Evaluators do not need to install Postgres or configure Docker databases. |
| **Inventory Engine** | **Immutable Stock Ledger** | Strict double-entry inventory. Stock is never an arbitrary counter that gets overwritten; closing stock is derived directly from chronological ledger movement rows (`qty_in - qty_out`). |
| **Frontend** | **Vanilla ES6 Single Page App + PWA** | Highly responsive, native look-and-feel for mobile salesmen, desktop billing desk, tablet floor supervisors, and external auditors. Includes Service Worker (`sw.js`) and `localStorage` queue for offline order capture. |
| **Math Precision** | **Paisa Arithmetic (`roundMoney`)** | Eliminates JavaScript floating-point rounding drift. Taxes, invoices, payments, and cost per packet are rounded cleanly to 2 decimal places with zero paise discrepancies. |

---

## 3. Section 5 Mandatory Benchmark Scenario Verification

Running `node benchmark.js` executes the exact sequence from Section 5 and produces this verification report:

| Metric Check | Expected Benchmark | Actual System Output | Audit Status |
| :--- | :--- | :--- | :--- |
| **Flour closing balance** | 120 kg (100 + 60 − 40) | **120 kg** | ✅ **PASS** |
| **Oil closing balance** | 19.5 L (30 − 10.5) | **19.5 L** | ✅ **PASS** |
| **Pouches closing balance** | 306 pcs (500 − 188 − 6) | **306 pcs** | ✅ **PASS** |
| **Finished goods after run** | 238 packets (50 + 188) | **238 packets** | ✅ **PASS** |
| **Finished goods after Retailer A dispatch** | 88 packets (238 − 150) | **88 packets** | ✅ **PASS** |
| **Yield variance** | 188 vs 200 expected (−6%, flagged) | **-6.0% (Flagged Alert)** | ✅ **PASS** |
| **Oil consumption variance** | +5%, flagged (10.5 vs 10.0 L) | **+5.0% (Flagged Alert)** | ✅ **PASS** |
| **Retailer A invoice** | ₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875 | **₹7,500 + ₹187.50 + ₹187.50 = ₹7,875** | ✅ **PASS** |
| **Retailer A outstanding** | ₹3,875 (₹7,875 − ₹4,000) | **₹3,875.00** | ✅ **PASS** |
| **Distributor B order shortage** | Shortage of 32 packets flagged; IGST applies | **Shortage: 32 pkts flagged; IGST 5%** | ✅ **PASS** |
| **Cost per packet (FIFO)** | ₹30.90 / pkt (Material ₹4,010 + Overheads ₹1,800) | **₹30.90 / pkt (Gross Margin: ₹19.10)** | ✅ **PASS** |

### Benchmark Numbers Derivation & Costing Walkthrough
- **Raw Material Consumption:**
  - **Flour:** 40 kg consumed from opening stock (100 kg @ ₹42/kg) under FIFO = **₹1,680.00**. *(Under Weighted Average: (100×42 + 60×45)/160 = ₹43.125/kg → 40×43.125 = ₹1,725.00)*.
  - **Cooking Oil:** 10.5 L @ ₹140/L = **₹1,470.00**.
  - **Salt & Spice Mix:** 1.2 kg @ ₹200/kg = **₹240.00**.
  - **Pouches:** 188 good packets + 6 damaged pouches = 194 pouches @ ₹2.50/pc = **₹485.00**.
  - **Cartons:** 9 cartons @ ₹15/pc = **₹135.00**.
  - **Total Direct Materials Cost (FIFO):** $1680 + 1470 + 240 + 485 + 135 =$ **₹4,010.00**.
- **Overheads Allocation:**
  - Direct Labour: **₹1,200.00**
  - Gas & Power: **₹600.00**
  - Total Overheads: **₹1,800.00**.
- **Unit Cost & Gross Margin:**
  $$\text{Total Production Cost} = ₹4,010.00 + ₹1,800.00 = \mathbf{₹5,810.00}$$
  $$\text{Cost Per Packet} = \frac{₹5,810.00}{188 \text{ packets}} = \mathbf{₹30.904} \approx \mathbf{₹30.90}$$
  $$\text{Gross Margin against ₹50 Selling Price} = ₹50.00 - ₹30.90 = \mathbf{₹19.10 \text{ per packet (38.20\% Margin)}}$$

---

## 4. Scope & Feature Delivery (Against Section 6)

### Must Have (100% Implemented)
- [x] **Role-Based Access Control:** Dedicated views for Salesman (Mobile), Factory Admin, Production Supervisor, External Auditor, and Factory Owner with live one-click role switcher.
- [x] **Masters:** Items (Raw, Packaging, Finished Goods), Customers, Suppliers, and BOM recipes.
- [x] **Field Order Taking:** Mobile view optimized for fast 3-tap order entry in <30 seconds.
- [x] **GST Tax Invoices:** Generates GST-compliant invoice with CGST+SGST (Intra-state, TN) and IGST (Inter-state, KA), downloadable/printable PDF format with QR code and WhatsApp sharing link.
- [x] **Automated Production Stock Conversion:** Logging a run atomically deducts raw materials and credits finished goods in the stock ledger.
- [x] **Variance Analysis:** Flags consumption variance (e.g. Oil +5%) and yield variance (e.g. Murukku −6%) beyond ±3% tolerance.
- [x] **Audit-Grade Stock Ledger:** Traceable stock ledger linking every movement to a PO, Production Run, or Invoice.
- [x] **Auditor Exports:** CSV/Excel export for Sales, Purchase, Stock, Production, and Receivables reports.

### Should Have (100% Implemented)
- [x] **Purchases & Supplier Records:** Raw material inward purchase orders with GST.
- [x] **Payments & Receivables Aging:** Record collections against invoices; aging buckets (0–30, 31–60, 60+ days).
- [x] **Costing & Overheads:** Labour and utility overheads allocated per run; transparent unit costing.
- [x] **GSTR-1 Outward Summary:** Outward tax liability broken down into B2B supplies and Table 12 HSN Summary (`21069099`).
- [x] **Owner Executive Dashboard:** Real-time KPI cards for orders, stock levels, production yield alerts, and outstanding receivables.

### Stretch Goals (Bonus Features Implemented)
- [x] **Offline Order Capture with Sync:** Field salesmen can place orders with zero connectivity (simulated offline mode); orders queue in `localStorage` and sync automatically when connection restores.
- [x] **Batch & Expiry Tracking:** Production runs generate batch codes (`MK-202611-01`) and compute 6-month shelf life expiry dates.
- [x] **Reorder Levels & Low-Stock Alerts:** Threshold alerts on flour, oil, spices, and packaging.
- [x] **Production Planning Calculator:** Tool to compute how many batches and raw materials are needed to fulfill pending sales orders.
- [x] **Tally-Compatible XML Export:** 1-click download of Tally XML (`/api/reports/tally-xml`) mapping Sales Vouchers and Ledger Accounts.
- [x] **Mock e-Invoice & e-Way Bill:** Invoices feature mock IRN hash (`IRN...`) and e-Way Bill numbers.
- [x] **Tamil Language Interface (தமிழ்):** Instant language toggle on top navigation for floor staff and supervisors.

---

## 5. Test Logins & Role Perspectives

The top navigation bar contains instant role-switching buttons so reviewers can test each view without logging out:

| Role | Interface Device | Focus Area |
| :--- | :--- | :--- |
| **Salesman (Mobile)** | Mobile phone viewport | Quick customer picker, quantity stepper, stock check, offline queue toggle. |
| **Factory Admin** | Desktop billing desk | Incoming orders, shortage flagging, GST invoicing, dispatch, customer payments. |
| **Production Supervisor** | Tablet on floor | Inventory balances, BOM batch run logger, scrap pouches, overheads allocation. |
| **Auditor / Accountant** | Desktop read-only | Monthly Sales Register, GSTR-1 outward summary, Stock ledger, Ageing, CSV & Tally export. |
| **Owner** | Desktop / Mobile | Executive KPIs, production yield variances, live factory alerts, inventory valuation. |

---

## 6. Documented Assumptions

1. **Factory Location:** Situated in Tiruchirappalli, Tamil Nadu (State Code `33`). Customer orders within Tamil Nadu are billed under Intra-state GST (CGST 2.5% + SGST 2.5%); customers outside Tamil Nadu (Karnataka, State Code `29`) are billed under Inter-state GST (IGST 5.0%).
2. **Murukku GST Classification:** HSN Code `21069099` (Food preparations, namkeens, savouries) taxed at 5% GST.
3. **Packaging Wastage:** Damaged pouches (6 pcs) are recorded as scrap issues in the stock ledger with full financial accounting in material cost.
4. **Direct Overheads:** Direct labour (₹1,200) and power/gas (₹600) are recognized directly in the production run cost calculation.
5. **Credit Terms:** Standard 15-day credit period before receivables fall into aging buckets.
