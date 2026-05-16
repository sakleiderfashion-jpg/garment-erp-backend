
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
