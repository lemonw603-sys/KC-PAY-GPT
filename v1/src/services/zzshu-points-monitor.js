import { resolveSupplyAlert, upsertSupplyAlert } from './card-supply-scheduler-service.js';

/**
 * 直充平台（ZZSHU）点数监控（D-401，2026-09-27 Lemon 定）。
 *
 * 2026-09-26 起 ZZSHU 按发放的 API Key 计点：开通成功扣点（默认每单 1 点），失败不扣；点数由
 * Lemon 去平台 /query 页用点卡充进同一把 Key（不在本系统开发充点）。本监控只读，不建单、不扣点：
 *   - 读剩余点数，写进 app_settings（后台显示、下单与切路线时判断「点数为 0」）；
 *   - ≤ lowThreshold（5）推一次 ZZSHU_POINTS_LOW，= 0 推一次 ZZSHU_POINTS_EMPTY；回升后自动关，再跌再推；
 *   - = 0 且 Plus 正走 API：用正式切路线服务切到 Browser（四项校验 + Browser 就绪检查 + 审计，
 *     actor `system:zzshu-points`）。切不过去（Browser 不在线 / 没卡）就不切——下单入口看到点数为 0
 *     会拒 API 路线的新单（客户看到暂停接单）。点数充回来**不自动切回**，推 ZZSHU_POINTS_RESTORED 请 Lemon 定；
 *   - Key 被拒（401 / 403 / 40107 / 40306）推 ZZSHU_KEY_REJECTED；网络等临时错误只记日志、不推。
 */
export const ZZSHU_POINTS_SETTING = 'zzshu_points_remaining';
export const ZZSHU_POINTS_OBSERVED_SETTING = 'zzshu_points_observed_at';
export const ZZSHU_AUTO_SWITCHED_SETTING = 'zzshu_points_auto_switched_at';
export const ZZSHU_POINTS_LOW_THRESHOLD = 5;
export const ZZSHU_POINTS_CHECK_INTERVAL_MS = 5 * 60_000;
export const ZZSHU_POINTS_ACTOR = 'system:zzshu-points';

const KEY_REJECTED_CODES = new Set(['40106', '40107', '40306']);

export const ZZSHU_ALERT_KEYS = Object.freeze({
  LOW: 'zzshu-points-low',
  EMPTY: 'zzshu-points-empty',
  RESTORED: 'zzshu-points-restored',
  KEY_REJECTED: 'zzshu-key-rejected'
});

function keyRejected(error) {
  const status = Number(error?.status);
  return status === 401 || status === 403 || KEY_REJECTED_CODES.has(String(error?.businessCode || ''));
}

function switchRejectionText(error) {
  const failed = Array.isArray(error?.checks) ? error.checks.filter((item) => item && item.ok === false) : [];
  if (failed.length) return failed.map((item) => item.detail || item.code).join('；');
  return error?.code || error?.message || '原因未返回';
}

export function createZzshuPointsMonitor({
  pool, provider, routeAdmin, now = () => new Date(), lowThreshold = ZZSHU_POINTS_LOW_THRESHOLD
} = {}) {
  if (!pool?.query) throw new TypeError('pool is required');
  if (typeof provider?.readPoints !== 'function') throw new TypeError('provider.readPoints is required');
  if (typeof routeAdmin?.setDefaultRechargeMethod !== 'function') throw new TypeError('routeAdmin is required');

  async function activePlusExecutor() {
    const [rows] = await pool.query(
      `SELECT fr.executor_kind FROM fulfillment_routes fr
         INNER JOIN products p ON p.id = fr.product_id
        WHERE p.product_code = 'chatgpt_plus' AND fr.accepts_new_orders = 1 AND fr.retired_at IS NULL`
    );
    return rows.length === 1 ? String(rows[0].executor_kind || '').toUpperCase() : null;
  }

  async function writeSettings(pairs) {
    const placeholders = pairs.map(() => '(?, ?)').join(', ');
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
      pairs.flat()
    );
  }

  async function check() {
    let points;
    try {
      ({ points } = await provider.readPoints());
    } catch (error) {
      if (keyRejected(error)) {
        await upsertSupplyAlert(pool, {
          type: 'ZZSHU_KEY_REJECTED', key: ZZSHU_ALERT_KEYS.KEY_REJECTED, severity: 'critical',
          title: '直充平台不认这把 Key',
          message: `直充平台拒绝了当前 API Key（HTTP ${error?.status ?? '?'}${error?.businessCode ? ` / ${error.businessCode}` : ''}）。API 路线下不了单；到平台核对 Key，或换一把后告诉执行者装到服务器。`
        });
        return { ok: false, reason: 'KEY_REJECTED', status: error?.status ?? null, businessCode: error?.businessCode ?? null };
      }
      return { ok: false, reason: 'READ_FAILED', code: error?.code || error?.kind || error?.name || 'UNKNOWN' };
    }
    await resolveSupplyAlert(pool, ZZSHU_ALERT_KEYS.KEY_REJECTED);
    const observedAt = now().toISOString();
    await writeSettings([[ZZSHU_POINTS_SETTING, String(points)], [ZZSHU_POINTS_OBSERVED_SETTING, observedAt]]);

    if (points <= lowThreshold) {
      await upsertSupplyAlert(pool, {
        type: 'ZZSHU_POINTS_LOW', key: ZZSHU_ALERT_KEYS.LOW, severity: 'warning',
        title: '直充平台点数快用完了',
        message: `直充平台（ZZSHU）剩 ${points} 点（提醒线 ${lowThreshold}）。每成功开通一单扣点，失败不扣；去平台 /query 页把点卡充进 API Key。`
      });
    } else {
      await resolveSupplyAlert(pool, ZZSHU_ALERT_KEYS.LOW);
    }

    const executor = await activePlusExecutor();
    const [flagRows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [ZZSHU_AUTO_SWITCHED_SETTING]
    );
    const autoSwitchedAt = String(flagRows[0]?.setting_value || '');
    let switched = null;
    let switchError = null;

    if (points === 0) {
      if (executor === 'API') {
        try {
          switched = await routeAdmin.setDefaultRechargeMethod({
            method: 'BROWSER', actorId: ZZSHU_POINTS_ACTOR,
            confirmation: '切换默认充值方式为 BROWSER', expectedCurrentMethod: 'API'
          });
          if (switched?.changed) await writeSettings([[ZZSHU_AUTO_SWITCHED_SETTING, observedAt]]);
        } catch (error) {
          switchError = error;
        }
      }
      const situation = executor === 'API'
        ? (switched?.changed
          ? 'Plus 新单已自动改走 Browser（审计记为 system:zzshu-points）；充点后要不要切回 API 由你在工作台定。'
          : `没能自动切到 Browser（${switchRejectionText(switchError)}），API 路线的新单已暂停接单。`)
        : executor === 'BROWSER'
          ? 'Plus 目前走 Browser，不受影响；切回 API 前先充点。'
          : 'Plus 当前没有开着的路线。';
      await upsertSupplyAlert(pool, {
        type: 'ZZSHU_POINTS_EMPTY', key: ZZSHU_ALERT_KEYS.EMPTY, severity: 'critical',
        title: '直充平台点数用完了',
        message: `直充平台（ZZSHU）点数为 0。${situation}`
      });
    } else {
      await resolveSupplyAlert(pool, ZZSHU_ALERT_KEYS.EMPTY);
      if (autoSwitchedAt) {
        if (executor === 'BROWSER') {
          await upsertSupplyAlert(pool, {
            type: 'ZZSHU_POINTS_RESTORED', key: ZZSHU_ALERT_KEYS.RESTORED, severity: 'warning',
            title: '直充平台点数已恢复',
            message: `直充平台（ZZSHU）点数已恢复到 ${points}。Plus 目前走 Browser（点数用完时自动切的）；要切回 API 请到工作台切换。`
          });
        }
        await writeSettings([[ZZSHU_AUTO_SWITCHED_SETTING, '']]);
      }
    }
    if (executor === 'API') await resolveSupplyAlert(pool, ZZSHU_ALERT_KEYS.RESTORED);

    return {
      ok: true, points, executor,
      autoSwitched: Boolean(switched?.changed),
      switchRejected: switchError ? (switchError.code || 'REJECTED') : null
    };
  }

  return Object.freeze({ check });
}
