
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
      `SELECT oo.*, op.name as operation_name, op.code, op.qty_limit_type, op.has_multiplier, op.multiplier_label, op.sort_order,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END as allowed_qty,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty - COALESCE(SUM(pe.produced_qty),0) ELSE o.cutting_qty - COALESCE(SUM(pe.produced_qty),0) END as balance_qty
       FROM order_operations oo
       JOIN operations op ON op.id = oo.operation_id
       JOIN orders o ON o.id = oo.order_id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       WHERE oo.order_id = $1
       GROUP BY oo.id, op.name, op.code, op.qty_limit_type, op.has_multiplier, op.multiplier_label, op.sort_order, o.order_qty, o.cutting_qty
       ORDER BY op.sort_order`,
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
      `INSERT INTO order_operations (id,order_id,operation_id,is_enabled,rate,contractor_name,multiplier_count,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (order_id, operation_id)
       DO UPDATE SET is_enabled=$4,rate=$5,contractor_name=$6,multiplier_count=$7,remarks=$8,updated_at=NOW()
       RETURNING *`,
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
        `INSERT INTO order_operations (id,order_id,operation_id,is_enabled,rate,contractor_name,multiplier_count,remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (order_id, operation_id)
         DO UPDATE SET is_enabled=$4,rate=$5,contractor_name=$6,multiplier_count=$7,remarks=$8,updated_at=NOW()
         RETURNING *`,
        [id, req.params.orderId, op.operation_id, op.is_enabled, op.rate, op.contractor_name, op.multiplier_count || 1, op.remarks]
      );
      results.push(r.rows[0]);
    }
    res.json({ success: true, data: results });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to bulk save operations' }); }
});
export default router;
