const fs = require('fs');
const path = require('path');

function write(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log('✅ Created: ' + filePath);
}

// ── ORDERS ROUTES ─────────────────────────────────────────────────────────────
write('src/modules/orders/orders.routes.ts', `
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';
const router = Router();
router.use(authenticate);
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch orders' }); }
});
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch order' }); }
});
router.post('/', authorize('admin', 'production_manager'), async (req: Request, res: Response) => {
  try {
    const { order_number, buyer_name, style_number, item_name, color, size, order_qty, cutting_qty, delivery_date, remarks, status } = req.body;
    if (!order_number || !buyer_name || !item_name || !order_qty || !cutting_qty || !delivery_date) {
      res.status(400).json({ success: false, message: 'Missing required fields' }); return;
    }
    if (cutting_qty < order_qty) { res.status(400).json({ success: false, message: 'Cutting qty must be >= order qty' }); return; }
    const dup = await query('SELECT id FROM orders WHERE order_number = $1', [order_number]);
    if (dup.rows.length > 0) { res.status(409).json({ success: false, message: 'Order number already exists' }); return; }
    const id = uuidv4();
    const result = await query(
      'INSERT INTO orders (id,order_number,buyer_name,style_number,item_name,color,size,order_qty,cutting_qty,delivery_date,remarks,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [id, order_number, buyer_name, style_number, item_name, color, size, order_qty, cutting_qty, delivery_date, remarks, status || 'In Progress', req.user?.id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to create order' }); }
});
router.put('/:id', authorize('admin', 'production_manager'), async (req: Request, res: Response) => {
  try {
    const { order_number, buyer_name, style_number, item_name, color, size, order_qty, cutting_qty, delivery_date, remarks, status } = req.body;
    const result = await query(
      'UPDATE orders SET order_number=$1,buyer_name=$2,style_number=$3,item_name=$4,color=$5,size=$6,order_qty=$7,cutting_qty=$8,delivery_date=$9,remarks=$10,status=$11,updated_at=NOW() WHERE id=$12 RETURNING *',
      [order_number, buyer_name, style_number, item_name, color, size, order_qty, cutting_qty, delivery_date, remarks, status, req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to update order' }); }
});
router.delete('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const result = await query('DELETE FROM orders WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
    res.json({ success: true, message: 'Order deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to delete order' }); }
});
export default router;
`);

// ── OPERATIONS ROUTES ──────────────────────────────────────────────────────────
write('src/modules/operations/operations.routes.ts', `
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';
const router = Router();
router.use(authenticate);
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM operations WHERE is_active=TRUE ORDER BY sort_order');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch operations' }); }
});
router.get('/order/:orderId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      \`SELECT oo.*, op.name as operation_name, op.code, op.qty_limit_type, op.has_multiplier, op.multiplier_label, op.sort_order,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END as allowed_qty,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty - COALESCE(SUM(pe.produced_qty),0) ELSE o.cutting_qty - COALESCE(SUM(pe.produced_qty),0) END as balance_qty
       FROM order_operations oo
       JOIN operations op ON op.id = oo.operation_id
       JOIN orders o ON o.id = oo.order_id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       WHERE oo.order_id = $1
       GROUP BY oo.id, op.name, op.code, op.qty_limit_type, op.has_multiplier, op.multiplier_label, op.sort_order, o.order_qty, o.cutting_qty
       ORDER BY op.sort_order\`,
      [req.params.orderId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch order operations' }); }
});
router.post('/order/:orderId', authorize('admin', 'production_manager'), async (req: Request, res: Response) => {
  try {
    const { operation_id, is_enabled, rate, contractor_name, multiplier_count, remarks } = req.body;
    const id = uuidv4();
    const result = await query(
      \`INSERT INTO order_operations (id,order_id,operation_id,is_enabled,rate,contractor_name,multiplier_count,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (order_id, operation_id)
       DO UPDATE SET is_enabled=$4,rate=$5,contractor_name=$6,multiplier_count=$7,remarks=$8,updated_at=NOW()
       RETURNING *\`,
      [id, req.params.orderId, operation_id, is_enabled ?? true, rate, contractor_name, multiplier_count || 1, remarks]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to save operation' }); }
});
router.post('/order/:orderId/bulk', authorize('admin', 'production_manager'), async (req: Request, res: Response) => {
  try {
    const { operations } = req.body;
    const results = [];
    for (const op of operations) {
      const id = uuidv4();
      const r = await query(
        \`INSERT INTO order_operations (id,order_id,operation_id,is_enabled,rate,contractor_name,multiplier_count,remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (order_id, operation_id)
         DO UPDATE SET is_enabled=$4,rate=$5,contractor_name=$6,multiplier_count=$7,remarks=$8,updated_at=NOW()
         RETURNING *\`,
        [id, req.params.orderId, op.operation_id, op.is_enabled, op.rate, op.contractor_name, op.multiplier_count || 1, op.remarks]
      );
      results.push(r.rows[0]);
    }
    res.json({ success: true, data: results });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to bulk save operations' }); }
});
export default router;
`);

// ── PRODUCTION ROUTES ──────────────────────────────────────────────────────────
write('src/modules/production/production.routes.ts', `
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';
const router = Router();
router.use(authenticate);
async function validateQty(orderOperationId: string, producedQty: number, excludeId?: string) {
  const ooRes = await query(
    \`SELECT oo.*, op.qty_limit_type, op.name as op_name, o.order_qty, o.cutting_qty,
     COALESCE(SUM(pe.produced_qty),0) as already_produced
     FROM order_operations oo
     JOIN operations op ON op.id = oo.operation_id
     JOIN orders o ON o.id = oo.order_id
     LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id \${excludeId ? 'AND pe.id != $2' : ''}
     WHERE oo.id = $1
     GROUP BY oo.id, op.qty_limit_type, op.name, o.order_qty, o.cutting_qty\`,
    excludeId ? [orderOperationId, excludeId] : [orderOperationId]
  );
  if (ooRes.rows.length === 0) return { valid: false, message: 'Order operation not found' };
  const oo = ooRes.rows[0];
  const limit = oo.qty_limit_type === 'order' ? oo.order_qty : oo.cutting_qty;
  const already = parseInt(oo.already_produced);
  const balance = limit - already;
  if (producedQty > balance) return { valid: false, message: \`Exceeds \${oo.qty_limit_type} quantity limit. Balance: \${balance} pcs\`, balance };
  return { valid: true, balance };
}
router.get('/', async (req: Request, res: Response) => {
  try {
    const { date, orderId } = req.query;
    let sql = \`SELECT pe.*, o.order_number, o.buyer_name, op.name as operation_name, oo.rate, oo.multiplier_count
               FROM production_entries pe
               JOIN order_operations oo ON oo.id = pe.order_operation_id
               JOIN orders o ON o.id = oo.order_id
               JOIN operations op ON op.id = oo.operation_id WHERE 1=1\`;
    const params: any[] = [];
    if (date) { params.push(date); sql += \` AND pe.entry_date = $\${params.length}\`; }
    if (orderId) { params.push(orderId); sql += \` AND o.id = $\${params.length}\`; }
    sql += ' ORDER BY pe.entry_date DESC, pe.created_at DESC';
    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch entries' }); }
});
router.get('/balance/:orderOperationId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      \`SELECT oo.*, op.name as op_name, op.qty_limit_type, o.order_number, o.order_qty, o.cutting_qty,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END as allowed_qty,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty - COALESCE(SUM(pe.produced_qty),0) ELSE o.cutting_qty - COALESCE(SUM(pe.produced_qty),0) END as balance_qty
       FROM order_operations oo
       JOIN operations op ON op.id = oo.operation_id
       JOIN orders o ON o.id = oo.order_id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       WHERE oo.id = $1
       GROUP BY oo.id, op.name, op.qty_limit_type, o.order_number, o.order_qty, o.cutting_qty\`,
      [req.params.orderOperationId]
    );
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'Not found' }); return; }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch balance' }); }
});
router.post('/', authorize('admin', 'production_manager', 'data_entry'), async (req: Request, res: Response) => {
  try {
    const { order_operation_id, entry_date, produced_qty, contractor_name, remarks } = req.body;
    if (!order_operation_id || !produced_qty || !entry_date || !contractor_name) {
      res.status(400).json({ success: false, message: 'Missing required fields' }); return;
    }
    const validation = await validateQty(order_operation_id, produced_qty);
    if (!validation.valid) { res.status(422).json({ success: false, message: validation.message, balance: validation.balance }); return; }
    const id = uuidv4();
    const result = await query(
      'INSERT INTO production_entries (id,order_operation_id,entry_date,produced_qty,contractor_name,remarks,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [id, order_operation_id, entry_date, produced_qty, contractor_name, remarks, req.user?.id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to save entry' }); }
});
router.delete('/:id', authorize('admin', 'production_manager'), async (req: Request, res: Response) => {
  try {
    const result = await query('DELETE FROM production_entries WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'Entry not found' }); return; }
    res.json({ success: true, message: 'Entry deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to delete entry' }); }
});
export default router;
`);

// ── BILLING ROUTES ─────────────────────────────────────────────────────────────
write('src/modules/billing/billing.routes.ts', `
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { generateWeeklyBills } from '../../jobs/billing.cron';
const router = Router();
router.use(authenticate);
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM weekly_bills ORDER BY generated_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch bills' }); }
});
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const billRes = await query('SELECT * FROM weekly_bills WHERE id=$1', [req.params.id]);
    if (billRes.rows.length === 0) { res.status(404).json({ success: false, message: 'Bill not found' }); return; }
    const detailRes = await query('SELECT * FROM bill_details WHERE bill_id=$1 ORDER BY order_number, operation_name', [req.params.id]);
    res.json({ success: true, data: { ...billRes.rows[0], line_items: detailRes.rows } });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch bill' }); }
});
router.post('/generate', authorize('admin', 'billing_staff'), async (req: Request, res: Response) => {
  try {
    const { target_date } = req.body;
    const date = target_date ? new Date(target_date) : new Date();
    const result = await generateWeeklyBills(date, req.user?.id);
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate bills' }); }
});
router.patch('/:id/status', authorize('admin', 'billing_staff'), async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const valid = ['Generated', 'Approved', 'Paid', 'Disputed'];
    if (!valid.includes(status)) { res.status(400).json({ success: false, message: 'Invalid status' }); return; }
    const result = await query('UPDATE weekly_bills SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to update bill' }); }
});
export default router;
`);

// ── REPORTS ROUTES ─────────────────────────────────────────────────────────────
write('src/modules/reports/reports.routes.ts', `
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
const router = Router();
router.use(authenticate);
router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [todayProd, pendingOrders, delayedOrders, opSummary] = await Promise.all([
      query('SELECT COALESCE(SUM(produced_qty),0) as total FROM production_entries WHERE entry_date=$1', [today]),
      query("SELECT COUNT(*) as total FROM orders WHERE status NOT IN ('Completed','Cancelled')"),
      query("SELECT COUNT(*) as total FROM orders WHERE delivery_date < CURRENT_DATE AND status NOT IN ('Completed','Cancelled')"),
      query(\`SELECT op.name, COALESCE(SUM(pe.produced_qty),0) as produced
             FROM operations op
             LEFT JOIN order_operations oo ON oo.operation_id = op.id
             LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id AND pe.entry_date = $1
             GROUP BY op.name ORDER BY op.sort_order\`, [today]),
    ]);
    res.json({ success: true, data: {
      today_production: parseInt(todayProd.rows[0].total),
      pending_orders: parseInt(pendingOrders.rows[0].total),
      delayed_orders: parseInt(delayedOrders.rows[0].total),
      operation_summary: opSummary.rows,
    }});
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to load dashboard' }); }
});
router.get('/daily-production', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const d = date || new Date().toISOString().split('T')[0];
    const result = await query(
      \`SELECT pe.entry_date, o.order_number, o.buyer_name, op.name as operation,
       pe.contractor_name, pe.produced_qty, oo.rate, pe.produced_qty * oo.rate * oo.multiplier_count as amount
       FROM production_entries pe
       JOIN order_operations oo ON oo.id = pe.order_operation_id
       JOIN orders o ON o.id = oo.order_id
       JOIN operations op ON op.id = oo.operation_id
       WHERE pe.entry_date = $1 ORDER BY o.order_number, op.sort_order\`,
      [d]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
router.get('/pending-qty', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      \`SELECT o.order_number, o.buyer_name, op.name as operation_name, oo.contractor_name,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END as allowed_qty,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END - COALESCE(SUM(pe.produced_qty),0) as balance_qty
       FROM order_operations oo
       JOIN orders o ON o.id = oo.order_id
       JOIN operations op ON op.id = oo.operation_id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       WHERE oo.is_enabled = TRUE
       GROUP BY o.order_number, o.buyer_name, op.name, oo.contractor_name, op.qty_limit_type, o.order_qty, o.cutting_qty, op.sort_order
       HAVING CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END - COALESCE(SUM(pe.produced_qty),0) > 0
       ORDER BY o.order_number, op.sort_order\`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
router.get('/order-status', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      \`SELECT o.order_number, o.buyer_name, o.item_name, o.order_qty, o.cutting_qty, o.delivery_date, o.status,
       COUNT(DISTINCT oo.id) FILTER (WHERE oo.is_enabled) as total_ops,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       o.delivery_date < CURRENT_DATE AND o.status NOT IN ('Completed','Cancelled') as is_delayed
       FROM orders o
       LEFT JOIN order_operations oo ON oo.order_id = o.id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       GROUP BY o.id, o.order_number, o.buyer_name, o.item_name, o.order_qty, o.cutting_qty, o.delivery_date, o.status
       ORDER BY o.delivery_date ASC\`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
export default router;
`);

// ── DATABASE MIGRATION ─────────────────────────────────────────────────────────
write('src/db/migrations/001_initial_schema.sql', `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  code VARCHAR(30) UNIQUE NOT NULL,
  qty_limit_type VARCHAR(10) NOT NULL CHECK (qty_limit_type IN ('order','cutting')),
  has_multiplier BOOLEAN DEFAULT FALSE,
  multiplier_label VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);
INSERT INTO operations (name,code,qty_limit_type,has_multiplier,multiplier_label,sort_order) VALUES
('Cutting','CUTTING','cutting',FALSE,NULL,1),('Fusing','FUSING','cutting',FALSE,NULL,2),
('Power Table','POWER_TABLE','cutting',FALSE,NULL,3),('SNLS','SNLS','cutting',FALSE,NULL,4),
('Kaja','KAJA','cutting',TRUE,'No of Kaja',5),('Button','BUTTON','cutting',TRUE,'No of Button',6),
('Bartag','BARTAG','cutting',TRUE,'No of Bartag',7),('Rope','ROPE','cutting',FALSE,NULL,8),
('Buckles','BUCKLES','cutting',FALSE,NULL,9),('Piccoding','PICCODING','cutting',FALSE,NULL,10),
('Net Folding','NET_FOLDING','cutting',FALSE,NULL,11),('Outer Elastic','OUTER_ELASTIC','cutting',FALSE,NULL,12),
('Trimmer','TRIMMER','cutting',FALSE,NULL,13),('Checking','CHECKING','cutting',FALSE,NULL,14),
('Ironing','IRONING','order',FALSE,NULL,15),('Panel Ironing','PANEL_IRONING','cutting',FALSE,NULL,16),
('Packing','PACKING','order',FALSE,NULL,17)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  style_number VARCHAR(80),
  item_name VARCHAR(150) NOT NULL,
  color VARCHAR(80),
  size VARCHAR(80),
  order_qty INTEGER NOT NULL CHECK (order_qty > 0),
  cutting_qty INTEGER NOT NULL CHECK (cutting_qty > 0),
  delivery_date DATE NOT NULL,
  remarks TEXT,
  status VARCHAR(30) DEFAULT 'In Progress',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL REFERENCES operations(id),
  is_enabled BOOLEAN DEFAULT TRUE,
  rate NUMERIC(10,4) NOT NULL DEFAULT 0,
  contractor_name VARCHAR(100),
  multiplier_count INTEGER DEFAULT 1,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, operation_id)
);
CREATE TABLE IF NOT EXISTS production_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_operation_id UUID NOT NULL REFERENCES order_operations(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  produced_qty INTEGER NOT NULL CHECK (produced_qty > 0),
  contractor_name VARCHAR(100),
  remarks TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS weekly_bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_number VARCHAR(50) UNIQUE NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  contractor_name VARCHAR(100) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'Generated',
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bill_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES weekly_bills(id) ON DELETE CASCADE,
  order_operation_id UUID NOT NULL REFERENCES order_operations(id),
  order_number VARCHAR(50),
  operation_name VARCHAR(100),
  produced_qty INTEGER NOT NULL,
  rate NUMERIC(10,4) NOT NULL,
  multiplier_count INTEGER DEFAULT 1,
  total_amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(150),
  table_name VARCHAR(80) NOT NULL,
  action VARCHAR(10) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO roles (name,description,permissions) VALUES
('admin','Full system access','{"orders":"*","operations":"*","production":"*","billing":"*","reports":"*","users":"*"}'),
('production_manager','Manage orders and production','{"orders":"*","operations":"*","production":"*","reports":"read","billing":"read"}'),
('data_entry','Daily production entry only','{"production":"*","orders":"read","operations":"read"}'),
('billing_staff','Billing and reports access','{"billing":"*","reports":"*","orders":"read","production":"read"}')
ON CONFLICT (name) DO NOTHING;
`);

// ── SEED FILE ──────────────────────────────────────────────────────────────────
write('src/db/seeds/seed.ts', `
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import pool, { query } from '../../config/database';
async function seed() {
  console.log('Seeding database...');
  const rolesRes = await query('SELECT id, name FROM roles');
  const roles: Record<string, string> = {};
  rolesRes.rows.forEach((r: any) => { roles[r.name] = r.id; });
  const password = await bcrypt.hash('Admin@1234', 12);
  const users = [
    { name: 'Admin User', email: 'admin@garment.com', role: 'admin' },
    { name: 'Prod Manager', email: 'manager@garment.com', role: 'production_manager' },
    { name: 'Entry Staff', email: 'entry@garment.com', role: 'data_entry' },
    { name: 'Billing Staff', email: 'billing@garment.com', role: 'billing_staff' },
  ];
  for (const u of users) {
    await query(
      'INSERT INTO users (id,name,email,password_hash,role_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id',
      [uuidv4(), u.name, u.email, password, roles[u.role]]
    );
  }
  console.log('Seed complete!');
  console.log('Login: admin@garment.com / Admin@1234');
  console.log('Login: manager@garment.com / Admin@1234');
  console.log('Login: entry@garment.com / Admin@1234');
  console.log('Login: billing@garment.com / Admin@1234');
  await pool.end();
}
seed().catch(console.error);
`);

// ── MIGRATE FILE ───────────────────────────────────────────────────────────────
write('src/db/migrate.ts', `
import fs from 'fs';
import path from 'path';
import pool from '../config/database';
async function migrate() {
  console.log('Running migrations...');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())');
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await pool.query('SELECT id FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length > 0) { console.log('Skipped: ' + file); continue; }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log('Applied: ' + file);
  }
  console.log('All migrations complete!');
  await pool.end();
}
migrate().catch(console.error);
`);

// ── PACKAGE.JSON ───────────────────────────────────────────────────────────────
write('package.json', JSON.stringify({
  name: "garment-erp-backend",
  version: "1.0.0",
  main: "dist/app.js",
  scripts: {
    dev: "nodemon --exec ts-node src/app.ts",
    build: "tsc",
    start: "node dist/app.js",
    migrate: "ts-node src/db/migrate.ts",
    seed: "ts-node src/db/seeds/seed.ts"
  },
  dependencies: {
    bcryptjs: "^2.4.3",
    cors: "^2.8.5",
    dotenv: "^16.3.1",
    express: "^4.18.2",
    helmet: "^7.1.0",
    jsonwebtoken: "^9.0.2",
    morgan: "^1.10.0",
    "node-cron": "^3.0.3",
    pg: "^8.11.3",
    uuid: "^9.0.0",
    zod: "^3.22.4",
    exceljs: "^4.4.0",
    pdfkit: "^0.14.0",
    "express-rate-limit": "^7.1.5"
  },
  devDependencies: {
    "@types/bcryptjs": "^2.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.11.0",
    "@types/node-cron": "^3.0.11",
    "@types/pg": "^8.10.9",
    "@types/uuid": "^9.0.7",
    "@types/pdfkit": "^0.13.3",
    nodemon: "^3.0.2",
    "ts-node": "^10.9.2",
    typescript: "^5.3.3"
  }
}, null, 2));

// ── TSCONFIG ───────────────────────────────────────────────────────────────────
write('tsconfig.json', JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    lib: ["ES2020"],
    outDir: "./dist",
    rootDir: "./src",
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"]
}, null, 2));

console.log('');
console.log('All files created successfully!');
console.log('Now run: npm run migrate');
console.log('Then run: npm run seed');