import cron from 'node-cron';
import { query, transaction } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';

function getWeekRange(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  return {
    weekStart: mon.toISOString().split('T')[0],
    weekEnd: sat.toISOString().split('T')[0],
  };
}

export async function generateWeeklyBills(targetDate: Date = new Date(), generatedBy?: string) {
  const { weekStart, weekEnd } = getWeekRange(targetDate);
  const entriesRes = await query(
    `SELECT oo.id as order_operation_id, o.order_number, op.name as operation_name,
     oo.contractor_name, oo.rate, oo.multiplier_count, SUM(pe.produced_qty) as produced_qty
     FROM production_entries pe
     JOIN order_operations oo ON oo.id = pe.order_operation_id
     JOIN orders o ON o.id = oo.order_id
     JOIN operations op ON op.id = oo.operation_id
     WHERE pe.entry_date BETWEEN $1 AND $2 AND oo.is_enabled = TRUE
     GROUP BY oo.id, o.order_number, op.name, oo.contractor_name, oo.rate, oo.multiplier_count
     HAVING SUM(pe.produced_qty) > 0`,
    [weekStart, weekEnd]
  );
  if (entriesRes.rows.length === 0) return { created: 0, skipped: 0 };
  const groups = new Map<string, any[]>();
  for (const row of entriesRes.rows) {
    if (!groups.has(row.contractor_name)) groups.set(row.contractor_name, []);
    groups.get(row.contractor_name)!.push(row);
  }
  let created = 0, skipped = 0;
  await transaction(async (client: PoolClient) => {
    for (const [contractor, items] of groups) {
      const existing = await client.query(
        `SELECT id FROM weekly_bills WHERE contractor_name=$1 AND week_start=$2 AND week_end=$3`,
        [contractor, weekStart, weekEnd]
      );
      if (existing.rows.length > 0) { skipped++; continue; }
      const totalAmount = items.reduce((s, i) => s + parseFloat(i.produced_qty) * parseFloat(i.rate) * parseInt(i.multiplier_count), 0);
      const billId = uuidv4();
      const billNumber = `BILL-${weekEnd.substring(0,4)}-W${weekEnd.substring(5,7)}-${contractor.replace(/[^a-zA-Z0-9]/g,'').substring(0,5).toUpperCase()}`;
      await client.query(
        `INSERT INTO weekly_bills (id, bill_number, week_start, week_end, contractor_name, total_amount, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [billId, billNumber, weekStart, weekEnd, contractor, totalAmount.toFixed(2), generatedBy || null]
      );
      for (const item of items) {
        const total = parseFloat(item.produced_qty) * parseFloat(item.rate) * parseInt(item.multiplier_count);
        await client.query(
          `INSERT INTO bill_details (id, bill_id, order_operation_id, order_number, operation_name, produced_qty, rate, multiplier_count, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuidv4(), billId, item.order_operation_id, item.order_number, item.operation_name, item.produced_qty, item.rate, item.multiplier_count, total.toFixed(2)]
        );
      }
      created++;
    }
  });
  return { created, skipped };
}

export function startBillingCron() {
  const schedule = process.env.BILL_CRON_SCHEDULE || '0 0 * * 6';
  cron.schedule(schedule, async () => {
    console.log('⏰ Saturday billing cron triggered');
    try {
      const result = await generateWeeklyBills(new Date());
      console.log(`✅ Bills generated: ${result.created} | Skipped: ${result.skipped}`);
    } catch (err) {
      console.error('❌ Billing cron failed:', err);
    }
  }, { timezone: 'Asia/Kolkata' });
  console.log(`✅ Billing cron scheduled: "${schedule}"`);
}
