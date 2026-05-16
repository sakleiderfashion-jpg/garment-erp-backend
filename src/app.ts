import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
dotenv.config();
import pool from './config/database';
import authRoutes from './modules/auth/auth.routes';
import orderRoutes from './modules/orders/orders.routes';
import operationRoutes from './modules/operations/operations.routes';
import productionRoutes from './modules/production/production.routes';
import billingRoutes from './modules/billing/billing.routes';
import reportsRoutes from './modules/reports/reports.routes';
import { startBillingCron } from './jobs/billing.cron';
const app = express();
const PORT = parseInt(process.env.PORT || '5000');
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(morgan('dev'));
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ success: false, status: 'unhealthy' });
  }
});
app.get('/', (_req, res) => {
  res.json({ success: true, name: 'GarmentERP API', version: '1.0.0' });
});
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reports', reportsRoutes);
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});
async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
    startBillingCron();
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}
startServer();
export default app;
