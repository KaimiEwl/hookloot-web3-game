import { randomUUID } from 'node:crypto';

function buildMeta(reply, meta = {}) {
  return {
    ...meta,
    requestId: reply?.requestId || meta.requestId || randomUUID(),
    serverTime: new Date().toISOString()
  };
}

export function ok(reply, data = {}, meta = {}) {
  if (reply) reply.errorCode = null;
  return reply.send({
    ok: true,
    data,
    error: null,
    meta: buildMeta(reply, meta)
  });
}

export function fail(reply, statusCode, code, message, details = null) {
  if (reply) reply.errorCode = code;
  return reply.code(statusCode).send({
    ok: false,
    data: null,
    error: {
      code,
      message,
      details
    },
    meta: buildMeta(reply)
  });
}

export function normalizeFastifyError(error) {
  if (error?.validation) {
    return {
      statusCode: 400,
      code: 'validation_error',
      message: 'Invalid request payload',
      details: error.validation
    };
  }
  return {
    statusCode: error?.statusCode || 500,
    code: error?.code || 'internal_error',
    message: error?.message || 'Internal server error',
    details: null
  };
}
