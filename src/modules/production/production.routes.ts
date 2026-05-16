
import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';
const router = Router();
router.use(authenticate);
async function validateQty(orderOperationId: string, producedQty: number, excludeId?: string) {
  const ooRes = await query(
    `SELECT oo.*, op.qty_limit_type, op.name as op_name, o.order_qty, o.cutting_qty,
     COALESCE(SUM(pe.produced_qty),0) as already_produced
     FROM order_operations oo
     JOIN operations op ON op.id = oo.operation_id
     JOIN orders o ON o.id = oo.order_id
     LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id ${excludeId ? 'AND pe.id != $2' : ''}
     WHERE oo.id = $1
     GROUP BY oo.id, op.qty_limit_type, op.name, o.order_qty, o.cutting_qty`,
    excludeId ? [orderOperationId, excludeId] : [orderOperationId]
  );
  if (ooRes.rows.length === 0) return { valid: false, message: 'Order operation not found' };
  const oo = ooRes.rows[0];
  const limit = oo.qty_limit_type === 'order' ? oo.order_qty : oo.cutting_qty;
  const already = parseInt(oo.already_produced);
  const balance = limit - already;
  if (producedQty > balance) return { valid: false, message: `Exceeds ${oo.qty_limit_type} quantity limit. Balance: ${balance} pcs`, balance };
  return { valid: true, balance };
}
router.get('/', async (req: Request, res: Response) => {
  try {
    const { date, orderId } = req.query;
    let sql = `SELECT pe.*, o.order_number, o.buyer_name, op.name as operation_name, oo.rate, oo.multiplier_count
               FROM production_entries pe
               JOIN order_operations oo ON oo.id = pe.order_operation_id
               JOIN orders o ON o.id = oo.order_id
               JOIN operations op ON op.id = oo.operation_id WHERE 1=1`;
    const params: any[] = [];
    if (date) { params.push(date); sql += ` AND pe.entry_date = $${params.length}`; }
    if (orderId) { params.push(orderId); sql += ` AND o.id = $${params.length}`; }
    sql += ' ORDER BY pe.entry_date DESC, pe.created_at DESC';
    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch entries' }); }
});
router.get('/balance/:orderOperationId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT oo.*, op.name as op_name, op.qty_limit_type, o.order_number, o.order_qty, o.cutting_qty,
       COALESCE(SUM(pe.produced_qty),0) as total_produced,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty ELSE o.cutting_qty END as allowed_qty,
       CASE WHEN op.qty_limit_type='order' THEN o.order_qty - COALESCE(SUM(pe.produced_qty),0) ELSE o.cutting_qty - COALESCE(SUM(pe.produced_qty),0) END as balance_qty
       FROM order_operations oo
       JOIN operations op ON op.id = oo.operation_id
       JOIN orders o ON o.id = oo.order_id
       LEFT JOIN production_entries pe ON pe.order_operation_id = oo.id
       WHERE oo.id = $1
       GROUP BY oo.id, op.name, op.qty_limit_type, o.order_number, o.order_qty, o.cutting_qty`,
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
