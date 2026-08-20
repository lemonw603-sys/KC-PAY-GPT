import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isEnvTrue, loadConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { HnskjCardProvider, mapPurchasedCard } from '../src/providers/index.js';
import { createCardStockService, mapStockCard } from '../src/services/card-stock-service.js';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

function positiveInteger(value, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`--${name} must be an integer between 1 and ${max}`);
  }
  return number;
}

function cardId(record) {
  const value = record?.id ?? record?.cardId ?? record?.card_id;
  return value == null ? null : String(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function allCardIds(provider) {
  const ids = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await provider.cards({ page, pageSize: 50 });
    ids.push(...response.data.cards.map(cardId).filter(Boolean));
    if (ids.length >= response.data.total) return new Set(ids);
  }
  throw new Error('Provider card list exceeded 100 pages');
}

async function resolvePurchasedId(provider, response, knownIds) {
  try {
    return mapPurchasedCard(response);
  } catch (error) {
    if (!error?.uncertain) throw error;
    const currentIds = await allCardIds(provider);
    const candidates = [...currentIds].filter((id) => !knownIds.has(id));
    if (candidates.length !== 1) {
      throw new Error(`Purchase accepted but ${candidates.length} new cards were found; manual reconciliation required`);
    }
    return candidates[0];
  }
}

export async function openStockCards({
  provider,
  stock,
  count,
  amount,
  cardTypeId,
  randomUUID = crypto.randomUUID,
  onCardOpened = async () => {},
  beforeCard = async () => {},
  pollDelayMs = 5_000,
  maxDetailPolls = 24,
  interCardDelayMs = 10_000,
  waitFn = wait
}) {
  const knownIds = await allCardIds(provider);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    await beforeCard({ index: index + 1, remaining: count - index });
    if (index > 0 && interCardDelayMs > 0) await waitFn(interCardDelayMs);
    let providerCardId;
    try {
      const response = await provider.purchaseCard({
        cardTypeId,
        openCardAmount: amount,
        idempotencyKey: `stock-${randomUUID()}`,
        remark: `stock ${index + 1}/${count}`
      });
      providerCardId = await resolvePurchasedId(provider, response, knownIds);
    } catch (error) {
      if (!error?.uncertain) throw error;
      const currentIds = await allCardIds(provider);
      const candidates = [...currentIds].filter((id) => !knownIds.has(id));
      if (candidates.length !== 1) {
        throw new Error(`Purchase result is uncertain and ${candidates.length} new cards were found; manual reconciliation required`);
      }
      [providerCardId] = candidates;
    }
    knownIds.add(providerCardId);
    let registered = await stock.register(mapStockCard({
      data: { id: providerCardId, cardTypeId, status: 'provisioning' }
    }, { providerCardId, cardTypeId, fundedAmount: amount }));
    await onCardOpened({ index: index + 1, providerCardId, registered });
    let ready = false;
    let lastReadError = null;
    for (let poll = 0; poll < maxDetailPolls; poll += 1) {
      try {
        const mapped = mapStockCard(await provider.card(providerCardId), {
          providerCardId, cardTypeId, fundedAmount: amount
        });
        registered = await stock.register(mapped);
        if (mapped.failed) {
          const error = new Error(`Provider card ${providerCardId} entered terminal status ${mapped.status}`);
          error.code = 'CARD_STOCK_CARD_FAILED';
          throw error;
        }
        if (mapped.ready) {
          ready = true;
          break;
        }
        lastReadError = null;
      } catch (error) {
        if (error?.code === 'CARD_STOCK_CARD_FAILED') throw error;
        lastReadError = error;
      }
      if (poll + 1 < maxDetailPolls) await waitFn(pollDelayMs);
    }
    if (!ready) {
      const error = new Error(`Provider card ${providerCardId} did not become ready before timeout`);
      error.code = lastReadError?.code || lastReadError?.kind || 'CARD_STOCK_PROVISIONING_TIMEOUT';
      throw error;
    }
    results.push(registered);
  }
  return {
    requested: count,
    opened: results.length,
    amount: String(amount),
    cardTypeId: String(cardTypeId),
    cards: results
  };
}

export async function syncProvisioningStock({ pool, provider, stock, limit = 50 }) {
  const [rows] = await pool.query(
    `SELECT provider_card_id, card_type_id, funded_amount FROM cards
     WHERE order_id IS NULL AND inventory_status = 'PROVISIONING'
       AND (last_synced_at IS NULL OR last_synced_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 SECOND))
     ORDER BY updated_at ASC LIMIT ?`,
    [Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const details = await provider.card(row.provider_card_id);
      const mapped = mapStockCard(details, {
        providerCardId: row.provider_card_id,
        cardTypeId: row.card_type_id,
        fundedAmount: row.funded_amount
      });
      await stock.register(mapped);
      synced += 1;
      if (mapped.failed) failed += 1;
    } catch {
      // Read-only synchronization is retried on the next timer cycle.
    }
  }
  return { checked: rows.length, synced, failed };
}

export async function runCardStockCli({ env = process.env } = {}) {
  const command = process.argv[2];
  if (!['status', 'threshold', 'register', 'sync', 'open'].includes(command)) {
    throw new Error('Usage: card-stock <status|threshold|register|sync|open> [options]');
  }
  const config = loadConfig(env);
  const pool = createDatabasePool(config.database);
  const stock = createCardStockService({ pool, sessionEncryptionKey: config.sessionEncryptionKey });
  const provider = ['status', 'threshold'].includes(command) ? null : new HnskjCardProvider({
    baseUrl: env.HNSKJ_API_BASE_URL || 'https://card.hnskj.vip/api/open/v1',
    apiKey: String(env.HNSKJ_API_KEY || '')
  });
  try {
    if (command === 'status') return await stock.status();
    if (command === 'threshold') return await stock.setThreshold(option('count'));
    if (command === 'register') {
      const providerCardId = option('card-id');
      if (!providerCardId) throw new Error('--card-id is required');
      const details = await provider.card(providerCardId);
      return stock.register(mapStockCard(details, {
        providerCardId,
        cardTypeId: option('card-type-id')
      }));
    }
    if (command === 'sync') {
      const [rows] = await pool.query(
        `SELECT provider_card_id, card_type_id, funded_amount FROM cards
         WHERE order_id IS NULL AND inventory_status IN ('PROVISIONING','AVAILABLE')`
      );
      const results = [];
      for (const row of rows) {
        const details = await provider.card(row.provider_card_id);
        results.push(await stock.register(mapStockCard(details, {
          providerCardId: row.provider_card_id,
          cardTypeId: row.card_type_id,
          fundedAmount: row.funded_amount
        })));
      }
      return { synced: results.length, cards: results };
    }
    if (option('execute') !== 'OPEN-CARDS') {
      throw new Error('Paid opening requires --execute OPEN-CARDS');
    }
    if (!isEnvTrue(env.PROVIDER_CARD_WRITES_ENABLED) || isEnvTrue(env.PROVIDER_WRITES_ENABLED)) {
      throw new Error('Paid opening requires only PROVIDER_CARD_WRITES_ENABLED=true');
    }
    const count = positiveInteger(option('count'), 'count', { max: 500 });
    const amount = positiveInteger(option('amount'), 'amount', { max: 100000 });
    const cardTypeId = option('card-type-id');
    if (!cardTypeId) throw new Error('--card-type-id is required');
    return await openStockCards({ provider, stock, count, amount, cardTypeId });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCardStockCli()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
