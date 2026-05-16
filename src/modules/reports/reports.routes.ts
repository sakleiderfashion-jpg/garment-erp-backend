
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
      query(`SELECT op.name, COALESCE(SUM(pe.produced_qty),0) as produced
             FROM operations op
             LEFT JOIN order_operations oo ON oo.operation_id = op.id
             LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id AND pe.entry_date = $1
             GROUP BY op.name ORDER BY op.sort_order`, [today]),
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
      `SELECT pe.entry_date, o.order_number, o.buyer_name, op.name as operation,
       pe.contractor_name, pe.produced_qty, oo.rate, pe.produced_qty * oo.rate * oo.multiplier_count as amount
       FROM production_entries pe
       JOIN order_operations oo ON oo.id = pe.order_operation_id
       JOIN orders o ON o.id = oo.order_id
       JOIN operations op ON op.id = oo.operation_id
       WHERE pe.entry_date = $1 ORDER BY o.order_number, op.sort_order`,
      [d]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
router.get('/pending-qty', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT o.order_number, o.buyer_name, op.name as operation_name, oo.contractor_name,
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
       ORDER BY o.order_number, op.sort_order`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
router.get('/order-status', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT o.order_number, o.buyer_name, o.item_name, o.order_qty, o.cutting_qty, o.delivery_date, o.status,
       COUNT(DISTINCT oo.id) FILTER (WHERE oo.is_enabled) as total_ops,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       o.delivery_date < CURRENT_DATE AND o.status NOT IN ('Completed','Cancelled') as is_delayed
       FROM orders o
       LEFT JOIN order_operations oo ON oo.order_id = o.id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       GROUP BY o.id, o.order_number, o.buyer_name, o.item_name, o.order_qty, o.cutting_qty, o.delivery_date, o.status
       ORDER BY o.delivery_date ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate report' }); }
});
export default router;
