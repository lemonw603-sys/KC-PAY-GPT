export class OrderIntakeError extends Error {
  constructor(message, { code, status = 400, cause } = {}) {
    super(message, { cause });
    this.name = 'OrderIntakeError';
    this.code = code || 'ORDER_INTAKE_FAILED';
    this.status = status;
  }
}
