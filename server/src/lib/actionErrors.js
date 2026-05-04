export class ActionError extends Error {
  constructor(code, message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isActionError(error) {
  return error instanceof ActionError || error?.name === 'ActionError';
}
