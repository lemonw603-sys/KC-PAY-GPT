export async function dispatchOneBarkNotification({ repository, client, maxAttempts = 8 }) {
  await repository.enqueueOpenAlerts();
  const delivery = await repository.claimNext();
  if (!delivery) return { handled: false };
  try {
    await client.send({
      title: delivery.title,
      message: delivery.message,
      severity: delivery.severity
    });
    await repository.markSent(delivery.id);
    return { handled: true, delivered: true, alertId: delivery.alertId };
  } catch (error) {
    const result = await repository.markFailed(delivery.id, {
      error,
      retryable: error?.retryable !== false,
      attemptCount: delivery.attemptCount,
      maxAttempts
    });
    return { handled: true, delivered: false, alertId: delivery.alertId, ...result };
  }
}
