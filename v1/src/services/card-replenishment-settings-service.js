import { PublicApiError } from '../domain/public-api-error.js';

const DAILY_LIMIT_KEY = 'card_replenishment_daily_limit';
const MIN_LIMIT = 0;
const MAX_LIMIT = 500;

function integerLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw new PublicApiError('Daily replenishment limit must be an integer from 0 to 500', {
      code: 'INVALID_REPLENISHMENT_DAILY_LIMIT', status: 400
    });
  }
  return limit;
}

function shanghaiDayBounds(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid settings clock');
  const shifted = new Date(instant.getTime() + 8 * 60 * 60_000);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return [new Date(start - 8 * 60 * 60_000), new Date(start + 24 * 60 * 60_000 - 8 * 60 * 60_000)];
}

export function createCardReplenishmentSettingsService({ pool }) {
  async function get({ now = new Date() } = {}) {
    const [[setting]] = await pool.query(
      `SELECT setting_value, updated_at FROM app_settings WHERE setting_key = ? LIMIT 1`,
      [DAILY_LIMIT_KEY]
    );
    const [[usage]] = await pool.query(
      `SELECT COALESCE(SUM(requested_count), 0) AS used
       FROM card_stock_jobs
       WHERE job_source = 'AUTOMATIC' AND created_at >= ? AND created_at < ?`,
      shanghaiDayBounds(now)
    );
    const limit = integerLimit(setting?.setting_value ?? 5);
    const used = Number(usage?.used || 0);
    return { dailyLimit: limit, usedToday: used, remainingToday: Math.max(0, limit - used),
      updatedAt: setting?.updated_at instanceof Date ? setting.updated_at.toISOString() : setting?.updated_at || null };
  }

  async function setDailyLimit({ value, actorId = 'admin', reason = null } = {}) {
    const limit = integerLimit(value);
    const actor = String(actorId || '').trim();
    if (!actor || actor.length > 128) throw new PublicApiError('Invalid settings actor', {
      code: 'INVALID_SETTINGS_ACTOR', status: 400
    });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[row]] = await connection.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1 FOR UPDATE`,
        [DAILY_LIMIT_KEY]
      );
      const oldValue = row?.setting_value ?? null;
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [DAILY_LIMIT_KEY, String(limit)]
      );
      if (String(oldValue ?? '') !== String(limit)) {
        await connection.query(
          `INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason)
           VALUES (?, ?, ?, ?, ?)`,
          [DAILY_LIMIT_KEY, oldValue, String(limit), actor, reason ? String(reason).slice(0, 500) : null]
        );
      }
      await connection.commit();
      return get();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { get, setDailyLimit };
}
