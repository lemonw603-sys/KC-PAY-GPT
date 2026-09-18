// 第④步（面二⑩ / D-247 ⑪）：两批旧卡标终态——不再 HELD_FOR_REVIEW / FAILED 挂着。
//
//   --batch hnskj-voided                       hnskj 12 张 $0 旧卡（卡台已作废，Lemon 2026-09-17）
//   --batch highvcc-cancelled --last4 a,b,c    highvcc 从快照消失的卡里、Lemon 勾出的「我注销的」那几张
//   --batch highvcc-manual-used --last4 3336   highvcc 在台的卡、Lemon 手动（不经系统）用它付过款（D-269：3336 手动付 20X）
//   默认 dry-run 只列清单；--apply 才写。Needs DATABASE_URL（生产主机 source /etc/pojia/runtime.env）。
//
// 写什么：与后台「已销卡」端点同一段代码（card-retirement-service.confirmRetired）——
// cards.inventory_status=RETIRED（hnskj 卡另 sync_tier=ARCHIVED，定时同步不再碰）、
// card_operational_overrides RETIRED、card_state_events CARD_RETIRED_CONFIRMED（审计，带 ageHours）。
// 不删行、不动余额、不碰卡台。有活动分配的卡拒绝。
import mysql from 'mysql2/promise';
import { createCardRetirementService } from '../src/services/card-retirement-service.js';

const HNSKJ = '00000000-0000-4000-8000-000000000101';
const HIGHVCC = '00000000-0000-4000-8000-000000000103';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const batch = args[args.indexOf('--batch') + 1];
const last4Arg = args.includes('--last4') ? String(args[args.indexOf('--last4') + 1] || '') : '';
const last4s = last4Arg.split(',').map((s) => s.trim()).filter(Boolean);
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!['hnskj-voided', 'highvcc-cancelled', 'highvcc-manual-used'].includes(batch)) { console.error('--batch hnskj-voided | highvcc-cancelled | highvcc-manual-used'); process.exit(2); }
if (batch !== 'hnskj-voided' && (last4s.length === 0 || last4s.some((v) => !/^\d{4}$/.test(v)))) {
  console.error(`--last4 a,b,c (four digits each) is required for ${batch}`); process.exit(2);
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const service = createCardRetirementService({ pool });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [rows] = batch === 'hnskj-voided'
    ? await connection.query(
      `SELECT c.id, c.last4, c.provider_card_id, c.inventory_status, c.current_balance, c.created_at,
              EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id=c.id AND h.status='ACTIVE') AS active_assignment
         FROM cards c WHERE c.provider_account_id = ? AND c.inventory_status = 'FAILED'
          AND COALESCE(c.current_balance, 0) = 0 ORDER BY c.created_at FOR UPDATE`, [HNSKJ])
    : batch === 'highvcc-cancelled'
      ? await connection.query(
        `SELECT c.id, c.last4, c.provider_card_id, c.inventory_status, c.current_balance, c.created_at, c.source_present,
                EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id=c.id AND h.status='ACTIVE') AS active_assignment
           FROM cards c WHERE c.provider_account_id = ? AND c.inventory_status = 'HELD_FOR_REVIEW'
            AND c.source_present = 0 AND c.last4 IN (${last4s.map(() => '?').join(',')}) ORDER BY c.created_at FOR UPDATE`,
        [HIGHVCC, ...last4s])
      : await connection.query(
        `SELECT c.id, c.last4, c.provider_card_id, c.inventory_status, c.current_balance, c.created_at, c.source_present,
                EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id=c.id AND h.status='ACTIVE') AS active_assignment
           FROM cards c WHERE c.provider_account_id = ? AND c.inventory_status <> 'RETIRED'
            AND c.last4 IN (${last4s.map(() => '?').join(',')}) ORDER BY c.created_at FOR UPDATE`,
        [HIGHVCC, ...last4s]);
  const summary = {
    mode: apply ? 'apply' : 'dry-run', batch,
    candidates: rows.map((r) => ({ last4: r.last4, providerCardId: r.provider_card_id, inventoryStatus: r.inventory_status,
      balance: r.current_balance == null ? null : String(r.current_balance), createdAt: r.created_at,
      activeAssignment: Number(r.active_assignment) === 1 })),
    count: rows.length,
    ...(batch !== 'hnskj-voided' ? { requested: last4s, notFound: last4s.filter((v) => !rows.some((r) => r.last4 === v)) } : {})
  };
  if (summary.candidates.some((c) => c.activeAssignment)) throw new Error('a candidate still has an active assignment; stop');
  if (!apply) {
    await connection.rollback();
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const reason = batch === 'hnskj-voided'
      ? 'hnskj voided the card on the platform (Lemon 2026-09-17); $0 balance; legacy FAILED batch'
      : batch === 'highvcc-cancelled'
        ? 'Lemon cancelled the card on highvcc; balance returned to wallet (D-247/D-269: missing from snapshot = cancelled)'
        : 'Lemon paid a customer 20X manually with this card outside Browser/API (D-269); balance 145 -> 2.46; retire';
    const results = [];
    for (const row of rows) {
      results.push(await service.confirmRetired({ cardId: row.id, actorId: 'lemon-via-fable', note: reason,
        source: `retire-legacy-cards:${batch}`, connection }));
    }
    await connection.commit();
    const [[after]] = await pool.query(
      `SELECT COUNT(*) AS n FROM cards WHERE inventory_status='RETIRED' AND provider_account_id = ?`,
      [batch === 'hnskj-voided' ? HNSKJ : HIGHVCC]);
    console.log(JSON.stringify({ ...summary, retired: results.map((r) => ({ last4: r.last4, replayed: r.replayed, ageHours: r.ageHours })),
      retiredTotalOnAccount: Number(after.n) }, null, 2));
  }
} catch (error) {
  try { await connection.rollback(); } catch { /* already */ }
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
