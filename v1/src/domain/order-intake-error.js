import { PublicApiError } from './public-api-error.js';

export class OrderIntakeError extends PublicApiError {
  constructor(message, { code, status = 400, cause } = {}) {
    super(message, { code: code || 'ORDER_INTAKE_FAILED', status, cause });
    this.name = 'OrderIntakeError';
  }
}
