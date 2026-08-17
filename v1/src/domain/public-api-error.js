export class PublicApiError extends Error {
  constructor(message, { code, status = 400, cause } = {}) {
    super(message, { cause });
    this.name = 'PublicApiError';
    this.code = code || 'PUBLIC_API_ERROR';
    this.status = status;
  }
}
