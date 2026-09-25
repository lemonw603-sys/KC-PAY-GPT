import { appendFile, rename, stat } from 'node:fs/promises';

/**
 * 点完付款之后各段花了多久（D-389，只记录、不改流程）。
 *
 * 为什么要：09-11～09-16 的 6 张全自动成功单，点击付款到判「付款不明」中位约 43 秒，
 * 而且 6/6 都没能当场确认、全靠补核线 7～23 秒后才确认。当场确认为什么没成、
 * 43 秒花在哪一段，现有记录说不出来（D-386 盘点 P3 ①）。
 *
 * 记什么：点击后三段——人机验证检测、结账页结果观察、账号套餐确认——每段的耗时、
 * 结论和出错码，再加这一单付款环节的最终结果。一段一行 JSON，写本机池状态目录。
 * 不记：卡号、CVV、Cookie、Token、邮箱、完整 URL（只留域名和第一段路径）。
 *
 * 硬规矩：包装层必须原样返回被包的结果、原样抛出被包的错误；写文件失败只吞掉，
 * 绝不影响付款。写文件不在付款路径上等待（排队异步写）。
 */

const MAX_BYTES = 10 * 1024 * 1024;

function pageWhere(page) {
  try {
    const url = new URL(String(page?.url?.() || ''));
    const first = url.pathname.split('/').filter(Boolean)[0] || '';
    return `${url.host}/${first}`;
  } catch {
    return null;
  }
}

function errorSummary(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 60),
    code: error?.code ? String(error.code).slice(0, 80) : null,
    // 页面或接口给的原话可能带数字串，截短并去掉 8 位以上数字，防卡号混进来。
    message: String(error?.message || '').replace(/\d[\d\s-]{6,}\d/g, '[redacted]').slice(0, 160),
  };
}

export function createPostClickTiming({
  file = null,
  clock = () => Date.now(),
  write = (path, line) => appendFile(path, line, { mode: 0o600 }),
  maxBytes = MAX_BYTES,
} = {}) {
  let queue = Promise.resolve();
  let rotated = false;
  const enqueue = (record) => {
    if (!file) return queue;
    queue = queue.then(async () => {
      if (!rotated) {
        rotated = true;
        const size = await stat(file).then((s) => s.size).catch(() => 0);
        if (size > maxBytes) await rename(file, `${file}.1`).catch(() => undefined);
      }
      await write(file, `${JSON.stringify(record)}\n`);
    }).catch(() => undefined);
    return queue;
  };

  return Object.freeze({
    enabled: Boolean(file),
    /** 等排队的写完（只给测试和进程退出用，付款路径不等）。 */
    drain: () => queue,
    start({ runId, plan = null }) {
      const startedAt = clock();
      const base = { runId: String(runId || '').slice(0, 64), plan: plan ? String(plan).slice(0, 20) : null };
      const emit = (event, fields) => enqueue({
        at: new Date(clock()).toISOString(), ...base, event, sinceStartMs: clock() - startedAt, ...fields,
      });
      return Object.freeze({
        /**
         * 包一段异步调用：原样返回、原样抛出，只多记一行。
         * describe 从结果里挑可记的字段；它自己出错也只影响记录。
         */
        async span(event, fn, { page = null, describe = () => ({}), describeError = () => ({}) } = {}) {
          const t0 = clock();
          const where = pageWhere(page);
          try {
            const result = await fn();
            let detail;
            try { detail = describe(result) || {}; } catch { detail = { describeFailed: true }; }
            emit(event, { ms: clock() - t0, ok: true, where, whereAfter: pageWhere(page), ...detail });
            return result;
          } catch (error) {
            let detail;
            try { detail = describeError(error) || {}; } catch { detail = { describeFailed: true }; }
            emit(event, { ms: clock() - t0, ok: false, where, whereAfter: pageWhere(page), error: errorSummary(error), ...detail });
            throw error;
          }
        },
        finish(result) {
          emit('payment-result', {
            status: result?.status ? String(result.status).slice(0, 40) : null,
            reasonCode: result?.reasonCode ? String(result.reasonCode).slice(0, 80) : null,
            paymentSubmitCalls: Number.isInteger(result?.paymentSubmitCalls) ? result.paymentSubmitCalls : null,
          });
        },
        fail(error) {
          emit('payment-result', { status: 'THREW', error: errorSummary(error) });
        },
      });
    },
  });
}
