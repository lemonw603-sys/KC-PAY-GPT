import { PublicApiError } from '../domain/public-api-error.js';

/**
 * 第④步（面二⑩，D-228 / D-232 / D-248 打架 4）：待销清单。
 *
 * 口径（任一成立即「不再服务新单」）：
 *   USED_UP                  用量（RESERVED/CONSUMED/RECONCILIATION）≥ 每卡上限（全局 card_max_successful_payments，
 *                            现 3 = Plus；5X/20X 按产品上限落地前，用「服务过 Pro 单」兜住，见 PRO_USED）
 *   PRO_USED                 账本里有一笔 Pro 产品的消费（Pro 一单一卡，D-221）
 *   DEPLETED                 inventory_status = DEPLETED（付款成功后余额置空）
 *   FAILED                   inventory_status = FAILED（卡台说卡无效；2026-09-18 生产实跑口径时发现 hnskj 12 张作废卡里
 *                            7 张没 override、不在清单，补上这一条）
 *   RETIRED_OVERRIDE         运营已标 RETIRED（card_operational_overrides）
 *   CANCELLATION_UNCONFIRMED 这张卡付过的单交付了但取消续费没确认（cancellation_review_required=1，D-248）
 * 再加「开卡时间 + 最短存活期（card_min_retire_age_hours，默认 6，可调）已到」才进 due 组；没到的放 notYetDue，
 * 不提醒（D-228 补充二：时间没到去点也销不了）。有活动分配的卡不进清单（等单结束）。
 *
 * 不新建表（缝 c）：清单是派生查询。销卡本身 V2 手动（D-232）：Lemon 在卡台删完，调 confirmRetired
 * 登记——卡进终态 inventory_status=RETIRED、加 RETIRED override、写 card_state_events
 * CARD_RETIRED_CONFIRMED（带 ageHours，积累卡台真实的可销规则）。事后同步确认：highvcc 靠快照
 * source_present=0，hnskj 靠目录/详情同步；清单里 sourcePresent 一列直接给出。
 */
const REASON_LABELS = Object.freeze({
  USED_UP: '用满',
  PRO_USED: '服务过 Pro 单（一单一卡）',
  DEPLETED: '余额已用尽（DEPLETED）',
  FAILED: '卡台标记失效（FAILED）',
  RETIRED_OVERRIDE: '运营已标 RETIRED',
  CANCELLATION_UNCONFIRMED: '取消续费未确认'
});

export const RETIRED_INVENTORY_STATUS = 'RETIRED';
export const RETIRED_CONFIRMED_EVENT = 'CARD_RETIRED_CONFIRMED';
export const MIN_RETIRE_AGE_SETTING = 'card_min_retire_age_hours';

function text(value, name, max = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) {
    throw new PublicApiError(`Invalid ${name}`, { code: 'INVALID_CARD_RETIREMENT', status: 400 });
  }
  return result;
}

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function retirementCandidateSql() {
  return `SELECT c.id, c.provider_account_id, pa.provider_code, c.provider_card_id, c.external_card_id,
          c.last4, c.inventory_status, c.status, c.sync_tier, c.source_present,
          c.funded_amount, c.current_balance, c.currency, c.created_at,
          (SELECT COUNT(*) FROM card_consumption_ledger u
            WHERE u.card_id = c.id AND u.status IN ('RESERVED','CONSUMED','RECONCILIATION')) AS used_count,
          (SELECT COUNT(*) FROM card_consumption_ledger u
            INNER JOIN products p ON p.id = u.product_id
            WHERE u.card_id = c.id AND u.status IN ('CONSUMED','RECONCILIATION')
              AND p.product_code LIKE 'chatgpt_pro%') AS pro_used_count,
          EXISTS (SELECT 1 FROM card_assignment_history h
            WHERE h.card_id = c.id AND h.status = 'ACTIVE') AS active_assignment,
          EXISTS (SELECT 1 FROM card_operational_overrides o
            WHERE o.provider_account_id = c.provider_account_id
              AND BINARY o.external_card_id = BINARY c.external_card_id
              AND o.allocation_policy = 'RETIRED') AS retired_override,
          EXISTS (SELECT 1 FROM orders o
            WHERE o.assigned_card_id = c.id AND o.status = 'RECHARGE_SUCCESS'
              AND o.cancellation_review_required = 1
              AND COALESCE(o.subscription_cancelled, 0) = 0) AS cancellation_unconfirmed,
          COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM app_settings
            WHERE setting_key = 'card_max_successful_payments' LIMIT 1), 3) AS max_payments,
          COALESCE((SELECT CAST(setting_value AS DECIMAL(10,2)) FROM app_settings
            WHERE setting_key = '${MIN_RETIRE_AGE_SETTING}' LIMIT 1), 6) AS min_age_hours
     FROM cards c
     INNER JOIN provider_accounts pa ON pa.id = c.provider_account_id AND pa.purpose = 'CARD'
     WHERE c.intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')
       AND c.inventory_status <> '${RETIRED_INVENTORY_STATUS}'`;
}

export function classifyRetirementRow(row, { now = new Date() } = {}) {
  const reasons = [];
  const used = Number(row.used_count || 0);
  const maxPayments = Number(row.max_payments || 3);
  if (used >= maxPayments) reasons.push('USED_UP');
  if (Number(row.pro_used_count || 0) >= 1) reasons.push('PRO_USED');
  if (String(row.inventory_status) === 'DEPLETED') reasons.push('DEPLETED');
  if (String(row.inventory_status) === 'FAILED') reasons.push('FAILED');
  if (Number(row.retired_override) === 1) reasons.push('RETIRED_OVERRIDE');
  if (Number(row.cancellation_unconfirmed) === 1) reasons.push('CANCELLATION_UNCONFIRMED');
  const minAgeHours = Number(row.min_age_hours ?? 6);
  const createdAt = row.created_at ? new Date(row.created_at) : null;
  const dueAt = createdAt && Number.isFinite(createdAt.getTime())
    ? new Date(createdAt.getTime() + minAgeHours * 60 * 60_000) : null;
  const activeAssignment = Number(row.active_assignment) === 1;
  const candidate = reasons.length > 0 && !activeAssignment;
  const due = candidate && dueAt != null && dueAt.getTime() <= now.getTime();
  return {
    cardId: row.id,
    providerAccountId: row.provider_account_id,
    providerCode: row.provider_code,
    providerCardId: row.provider_card_id,
    externalCardId: row.external_card_id,
    last4: row.last4,
    inventoryStatus: row.inventory_status,
    sourcePresent: row.source_present == null ? null : Number(row.source_present) === 1,
    fundedAmount: row.funded_amount == null ? null : String(row.funded_amount),
    currentBalance: row.current_balance == null ? null : String(row.current_balance),
    currency: row.currency || null,
    usedCount: used,
    maxPayments,
    reasons,
    reasonLabels: reasons.map((code) => REASON_LABELS[code] || code),
    activeAssignment,
    createdAt: iso(createdAt),
    minAgeHours,
    dueAt: iso(dueAt),
    candidate,
    due
  };
}

export function createCardRetirementService({ pool, clock = () => new Date() }) {
  if (!pool) throw new TypeError('pool is required');

  async function list({ providerAccountId = null } = {}) {
    const now = clock();
    const params = [];
    let sql = retirementCandidateSql();
    if (providerAccountId) { sql += ' AND c.provider_account_id = ?'; params.push(String(providerAccountId)); }
    sql += ' ORDER BY c.created_at ASC';
    const [rows] = await pool.query(sql, params);
    const items = rows.map((row) => classifyRetirementRow(row, { now })).filter((item) => item.candidate);
    const [confirmed] = await pool.query(
      `SELECT c.last4, c.provider_card_id, c.provider_account_id, c.source_present, e.current_json, e.created_at
         FROM card_state_events e INNER JOIN cards c ON c.id = e.card_id
        WHERE e.event_type = ? ORDER BY e.created_at DESC LIMIT 50`, [RETIRED_CONFIRMED_EVENT]
    );
    return {
      now: now.toISOString(),
      minAgeHours: rows[0] ? Number(rows[0].min_age_hours ?? 6) : 6,
      due: items.filter((item) => item.due),
      notYetDue: items.filter((item) => !item.due),
      recentlyConfirmed: confirmed.map((row) => ({
        last4: row.last4, providerCardId: row.provider_card_id, providerAccountId: row.provider_account_id,
        sourcePresent: row.source_present == null ? null : Number(row.source_present) === 1,
        confirmedAt: iso(row.created_at),
        detail: typeof row.current_json === 'string' ? JSON.parse(row.current_json) : row.current_json
      }))
    };
  }

  /**
   * Lemon 在卡台手动删完后登记。要么传 (providerAccountId, externalCardId)，要么传 cardId。
   * 幂等：已 RETIRED 直接返回 replayed。有活动分配的卡拒绝（先把单收口）。
   */
  async function confirmRetired({ cardId = null, providerAccountId = null, externalCardId = null,
    actorId = 'admin', note = null, source = 'admin', now = clock(), connection: external = null } = {}) {
    const actor = text(actorId || 'admin', 'actorId', 128);
    const safeNote = note == null ? null : String(note).trim().slice(0, 300) || null;
    const connection = external || await pool.getConnection();
    const own = !external;
    try {
      if (own) await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT c.id, c.provider_account_id, c.external_card_id, c.last4, c.provider_card_id,
                c.inventory_status, c.sync_tier, c.source_present, c.created_at, c.current_balance,
                EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id = c.id AND h.status = 'ACTIVE') AS active_assignment
           FROM cards c
          WHERE ${cardId ? 'c.id = ?' : 'c.provider_account_id = ? AND BINARY c.external_card_id = BINARY ?'}
          LIMIT 1 FOR UPDATE`,
        cardId ? [text(cardId, 'cardId', 64)] : [text(providerAccountId, 'providerAccountId', 64), text(externalCardId, 'externalCardId', 191)]
      );
      if (rows.length !== 1) throw new PublicApiError('Card not found', { code: 'ADMIN_CARD_NOT_FOUND', status: 404 });
      const card = rows[0];
      if (card.inventory_status === RETIRED_INVENTORY_STATUS) {
        if (own) await connection.commit();
        return { cardId: card.id, last4: card.last4, replayed: true, inventoryStatus: RETIRED_INVENTORY_STATUS };
      }
      if (Number(card.active_assignment) === 1) {
        throw new PublicApiError('Card still has an active order assignment', { code: 'CARD_RETIREMENT_CARD_BUSY', status: 409 });
      }
      const ageHours = card.created_at
        ? Math.round(((now.getTime() - new Date(card.created_at).getTime()) / 3_600_000) * 100) / 100 : null;
      // MANUAL_IMPORT（备用卡台 A）卡的 sync_tier 是快照比对的键，不动；hnskj 卡转 ARCHIVED
      // 让定时同步彻底不再碰它（scheduler 另外也按 inventory_status<>'RETIRED' 排除）。
      await connection.query(
        `UPDATE cards SET inventory_status = ?,
           sync_tier = IF(sync_tier = 'MANUAL_IMPORT', sync_tier, 'ARCHIVED'),
           next_sync_at = DATE_ADD(?, INTERVAL 3650 DAY),
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND inventory_status <> ?`,
        [RETIRED_INVENTORY_STATUS, now, card.id, RETIRED_INVENTORY_STATUS]
      );
      await connection.query(
        `INSERT INTO card_operational_overrides
          (id, provider_account_id, external_card_id, allocation_policy, product_code, reason, set_by)
         VALUES (UUID(), ?, ?, 'RETIRED', NULL, ?, ?)
         ON DUPLICATE KEY UPDATE allocation_policy = 'RETIRED', product_code = NULL,
           reason = VALUES(reason), set_by = VALUES(set_by)`,
        [card.provider_account_id, card.external_card_id,
          `retired confirmed (${source})${safeNote ? `: ${safeNote}` : ''}`.slice(0, 500), actor]
      );
      const detail = {
        inventoryStatus: RETIRED_INVENTORY_STATUS, retiredConfirmedAt: now.toISOString(),
        ageHours, confirmedBy: actor, source, note: safeNote,
        sourcePresentAtConfirm: card.source_present == null ? null : Number(card.source_present) === 1,
        balanceAtConfirm: card.current_balance == null ? null : String(card.current_balance)
      };
      await connection.query(
        `INSERT INTO card_state_events (card_id, event_type, source, previous_json, current_json)
         VALUES (?, ?, ?, ?, ?)`,
        [card.id, RETIRED_CONFIRMED_EVENT, actor.slice(0, 64),
          JSON.stringify({ inventoryStatus: card.inventory_status, syncTier: card.sync_tier }),
          JSON.stringify(detail)]
      );
      if (own) await connection.commit();
      return { cardId: card.id, last4: card.last4, providerCardId: card.provider_card_id, replayed: false,
        inventoryStatus: RETIRED_INVENTORY_STATUS, ...detail };
    } catch (error) {
      if (own) await connection.rollback().catch(() => {});
      throw error;
    } finally {
      if (own) connection.release();
    }
  }

  return { list, confirmRetired };
}
