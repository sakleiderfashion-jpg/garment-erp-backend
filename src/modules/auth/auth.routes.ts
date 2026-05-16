import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
const router = Router();
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ success: false, message: 'Email and password required' }); return; }
    const result = await query(`SELECT u.id, u.name, u.email, u.password_hash, u.is_active, r.name as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`, [email]);
    if (result.rows.length === 0) { res.status(401).json({ success: false, message: 'Invalid credentials' }); return; }
    const user = result.rows[0];
    if (!user.is_active) { res.status(401).json({ success: false, message: 'Account deactivated' }); return; }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) { res.status(401).json({ success: false, message: 'Invalid credentials' }); return; }
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' } as any);
    res.json({ success: true, data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  } catch (err) { res.status(500).json({ success: false, message: 'Internal server error' }); }
});
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`SELECT u.id, u.name, u.email, u.last_login, r.name as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [req.user!.id]);
    if (result.rows.length === 0) { res.status(404).json({ success: false, message: 'User not found' }); return; }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Internal server error' }); }
});
export default router;