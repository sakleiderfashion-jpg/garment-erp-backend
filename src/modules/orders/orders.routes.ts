
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
