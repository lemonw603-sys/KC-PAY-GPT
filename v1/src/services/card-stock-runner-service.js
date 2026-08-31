export async function scheduleAutomaticStockJob({ stockJobs, refreshSnapshot }) {
  try {
    return { automatic: await stockJobs.scheduleAutomaticJob(), providerRulesSynced: false };
  } catch (error) {
    if (error?.code !== 'CARD_STOCK_RULES_STALE') throw error;
    await refreshSnapshot();
    return { automatic: await stockJobs.scheduleAutomaticJob(), providerRulesSynced: true };
  }
}
