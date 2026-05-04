import { z } from 'zod';
import { authenticateAdminRequest } from './auth.js';
import { fail, ok } from '../lib/responses.js';
import { parseIdempotency } from '../lib/idempotency.js';

const pageQuerySchema = z.object({
  query: z.string().max(160).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().max(256).optional().default('')
}).strict();

const listQuerySchema = pageQuerySchema.omit({ query: true });

const userParamsSchema = z.object({
  userId: z.string().uuid()
}).strict();

const paymentParamsSchema = z.object({
  orderId: z.string().min(1).max(160)
}).strict();

const withdrawalParamsSchema = z.object({
  id: z.string().uuid()
}).strict();

const optionalNoteSchema = z.object({
  note: z.string().trim().max(1000).optional().default('')
}).strict();

const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().min(3).max(1000)
}).strict();

const paidExternalWithdrawalSchema = z.object({
  note: z.string().trim().min(3).max(1000),
  externalReference: z.string().trim().max(240).optional().default('')
}).strict();

async function requireAdmin(fastify, request, reply) {
  const auth = await authenticateAdminRequest(request, fastify.config, fastify.authService);
  if (!auth.ok) {
    fail(reply, auth.statusCode || 401, auth.code, auth.message);
    return null;
  }
  return auth;
}

function parseOrFail(schema, source, reply) {
  const parsed = schema.safeParse(source || {});
  if (!parsed.success) {
    fail(reply, 400, 'validation_error', 'Invalid request payload', parsed.error.issues);
    return null;
  }
  return parsed.data;
}

function parseIdempotencyOrFail(request, reply) {
  const idempotency = parseIdempotency(request);
  if (!idempotency.ok) {
    fail(reply, 400, idempotency.reason, 'Idempotency-Key header is required for this action');
    return null;
  }
  return idempotency;
}

async function audit(fastify, request, auth, route, metadata = {}) {
  await fastify.adminService.recordAccess({
    admin: auth,
    request,
    route,
    metadata
  });
}

export async function registerAdminRoutes(fastify) {
  fastify.get('/api/admin/users', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const query = parseOrFail(pageQuerySchema, request.query, reply);
    if (!query) return reply;
    await audit(fastify, request, auth, 'admin.users.list', {
      limit: query.limit,
      cursor: query.cursor || null,
      hasQuery: Boolean(query.query)
    });
    return ok(reply, await fastify.adminService.listUsers(query));
  });

  fastify.get('/api/admin/users/:userId', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(userParamsSchema, request.params, reply);
    if (!params) return reply;
    await audit(fastify, request, auth, 'admin.users.detail', { targetUserId: params.userId });
    const user = await fastify.adminService.getUser(params);
    if (!user) return fail(reply, 404, 'user_not_found', 'User not found');
    return ok(reply, user);
  });

  fastify.get('/api/admin/users/:userId/ledger', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(userParamsSchema, request.params, reply);
    const query = parseOrFail(listQuerySchema, request.query, reply);
    if (!params || !query) return reply;
    await audit(fastify, request, auth, 'admin.users.ledger', { targetUserId: params.userId, limit: query.limit });
    return ok(reply, await fastify.adminService.getUserLedger({ ...params, ...query }));
  });

  fastify.get('/api/admin/users/:userId/tasks', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(userParamsSchema, request.params, reply);
    const query = parseOrFail(listQuerySchema, request.query, reply);
    if (!params || !query) return reply;
    await audit(fastify, request, auth, 'admin.users.tasks', { targetUserId: params.userId, limit: query.limit });
    return ok(reply, await fastify.adminService.getUserTasks({ ...params, ...query }));
  });

  fastify.get('/api/admin/users/:userId/referrals', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(userParamsSchema, request.params, reply);
    const query = parseOrFail(listQuerySchema, request.query, reply);
    if (!params || !query) return reply;
    await audit(fastify, request, auth, 'admin.users.referrals', { targetUserId: params.userId, limit: query.limit });
    return ok(reply, await fastify.adminService.getUserReferrals({ ...params, ...query }));
  });

  fastify.get('/api/admin/payments/orders', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const query = parseOrFail(pageQuerySchema, request.query, reply);
    if (!query) return reply;
    await audit(fastify, request, auth, 'admin.payments.orders', {
      limit: query.limit,
      cursor: query.cursor || null,
      hasQuery: Boolean(query.query)
    });
    return ok(reply, await fastify.adminService.listPaymentOrders(query));
  });

  fastify.get('/api/admin/payments/:orderId', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(paymentParamsSchema, request.params, reply);
    if (!params) return reply;
    await audit(fastify, request, auth, 'admin.payments.detail', { orderId: params.orderId });
    const payment = await fastify.adminService.getPayment(params);
    if (!payment) return fail(reply, 404, 'payment_order_not_found', 'Payment order not found');
    return ok(reply, payment);
  });

  fastify.get('/api/admin/withdrawals', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const query = parseOrFail(listQuerySchema, request.query, reply);
    if (!query) return reply;
    await audit(fastify, request, auth, 'admin.withdrawals.list', { limit: query.limit, cursor: query.cursor || null });
    return ok(reply, await fastify.adminService.listWithdrawals(query));
  });

  fastify.get('/api/admin/withdrawals/:id', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(withdrawalParamsSchema, request.params, reply);
    if (!params) return reply;
    await audit(fastify, request, auth, 'admin.withdrawals.detail', { withdrawalId: params.id });
    const withdrawal = await fastify.adminService.getWithdrawal(params);
    if (!withdrawal) return fail(reply, 404, 'withdrawal_not_found', 'Withdrawal request not found');
    return ok(reply, withdrawal);
  });

  fastify.post('/api/admin/withdrawals/:id/mark-under-review', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(withdrawalParamsSchema, request.params, reply);
    const body = parseOrFail(optionalNoteSchema, request.body, reply);
    const idempotency = parseIdempotencyOrFail(request, reply);
    if (!params || !body || !idempotency) return reply;
    await audit(fastify, request, auth, 'admin.withdrawals.mark_under_review', { withdrawalId: params.id });
    return ok(reply, await fastify.adminService.markWithdrawalUnderReview({
      ...params,
      ...body,
      admin: auth,
      request,
      idempotency
    }));
  });

  fastify.post('/api/admin/withdrawals/:id/reject', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(withdrawalParamsSchema, request.params, reply);
    const body = parseOrFail(rejectWithdrawalSchema, request.body, reply);
    const idempotency = parseIdempotencyOrFail(request, reply);
    if (!params || !body || !idempotency) return reply;
    await audit(fastify, request, auth, 'admin.withdrawals.reject', { withdrawalId: params.id });
    return ok(reply, await fastify.adminService.rejectWithdrawal({
      ...params,
      ...body,
      admin: auth,
      request,
      idempotency
    }));
  });

  fastify.post('/api/admin/withdrawals/:id/mark-paid-external', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const params = parseOrFail(withdrawalParamsSchema, request.params, reply);
    const body = parseOrFail(paidExternalWithdrawalSchema, request.body, reply);
    const idempotency = parseIdempotencyOrFail(request, reply);
    if (!params || !body || !idempotency) return reply;
    await audit(fastify, request, auth, 'admin.withdrawals.mark_paid_external', { withdrawalId: params.id });
    return ok(reply, await fastify.adminService.markWithdrawalPaidExternal({
      ...params,
      ...body,
      admin: auth,
      request,
      idempotency
    }));
  });

  fastify.get('/api/admin/audit-logs', async (request, reply) => {
    const auth = await requireAdmin(fastify, request, reply);
    if (!auth) return reply;
    const query = parseOrFail(listQuerySchema, request.query, reply);
    if (!query) return reply;
    await audit(fastify, request, auth, 'admin.audit_logs.list', { limit: query.limit, cursor: query.cursor || null });
    return ok(reply, await fastify.adminService.listAuditLogs(query));
  });
}
