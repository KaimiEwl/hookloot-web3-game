import { and, eq } from 'drizzle-orm';
import { paymentMonitorCheckpoints } from '../db/schema.js';

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildIndexerUrl({ baseUrl, receiverWallet, cursor }) {
  if (baseUrl.includes('{address}')) {
    const replaced = baseUrl.replaceAll('{address}', encodeURIComponent(receiverWallet));
    const url = new URL(replaced);
    if (cursor?.beforeLt && !cursor?.lastSeenLt && !url.searchParams.has('before_lt')) {
      url.searchParams.set('before_lt', cursor.beforeLt);
    }
    return url;
  }

  const url = new URL(`${trimSlash(baseUrl)}/blockchain/accounts/${encodeURIComponent(receiverWallet)}/transactions`);
  url.searchParams.set('limit', '50');
  if (cursor?.beforeLt && !cursor?.lastSeenLt) url.searchParams.set('before_lt', cursor.beforeLt);
  return url;
}

function readTransactionLt(tx) {
  const value =
    tx?.lt ??
    tx?.tx_lt ??
    tx?.transaction_id?.lt ??
    tx?.transactionId?.lt ??
    tx?.in_msg?.created_lt ??
    tx?.inMsg?.createdLt ??
    null;
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function buildNextCursor(transactions, cursor) {
  const maxLt = transactions.reduce((max, tx) => {
    const lt = readTransactionLt(tx);
    return lt !== null && (max === null || lt > max) ? lt : max;
  }, null);

  if (maxLt === null) return cursor || null;

  const current = cursor?.lastSeenLt && /^\d+$/.test(String(cursor.lastSeenLt))
    ? BigInt(cursor.lastSeenLt)
    : null;

  if (current !== null && current >= maxLt) return cursor;
  return { ...(cursor || {}), lastSeenLt: maxLt.toString() };
}

export async function fetchIncomingTransactions({ config, receiverWallet, cursor = null, fetchImpl = globalThis.fetch }) {
  if (!config.tonIndexerUrl) return { transactions: [], cursor };
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required for TON indexer');

  const url = buildIndexerUrl({
    baseUrl: config.tonIndexerUrl,
    receiverWallet,
    cursor
  });

  const headers = { Accept: 'application/json' };
  if (config.tonIndexerApiKey) {
    headers.Authorization = `Bearer ${config.tonIndexerApiKey}`;
  }

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`TON indexer request failed: ${response.status}`);
  }
  const payload = await response.json();
  const transactions = payload.transactions || payload.items || payload.result || [];
  const normalizedTransactions = Array.isArray(transactions) ? transactions : [];
  const lastSeenLt = cursor?.lastSeenLt && /^\d+$/.test(String(cursor.lastSeenLt))
    ? BigInt(cursor.lastSeenLt)
    : null;
  const newTransactions = lastSeenLt === null
    ? normalizedTransactions
    : normalizedTransactions.filter((tx) => {
        const lt = readTransactionLt(tx);
        return lt === null || lt > lastSeenLt;
      });
  const providerCursor = payload.cursor && typeof payload.cursor === 'object' ? payload.cursor : null;
  const nextCursor = providerCursor || buildNextCursor(normalizedTransactions, cursor);
  return { transactions: newTransactions, cursor: nextCursor };
}

export async function readPaymentCheckpoint(db, { network, receiverWallet }) {
  const [row] = await db
    .select()
    .from(paymentMonitorCheckpoints)
    .where(and(
      eq(paymentMonitorCheckpoints.network, network),
      eq(paymentMonitorCheckpoints.receiverWallet, receiverWallet)
    ))
    .limit(1);
  return row?.cursor || null;
}

export async function writePaymentCheckpoint(db, { network, receiverWallet, cursor }) {
  await db
    .insert(paymentMonitorCheckpoints)
    .values({
      network,
      receiverWallet,
      cursor,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [paymentMonitorCheckpoints.network, paymentMonitorCheckpoints.receiverWallet],
      set: {
        cursor,
        updatedAt: new Date()
      }
    });
}
