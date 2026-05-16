
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
