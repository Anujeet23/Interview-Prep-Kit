/** An error that carries a stable machine-readable code and an HTTP status. */
export class AppError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, { cause });
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`, { status: 404 });
