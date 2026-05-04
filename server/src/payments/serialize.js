function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function serializeBigInt(value) {
  return BigInt(value || 0).toString();
}

export function serializePaymentOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.orderId,
    itemId: row.itemId,
    expectedAmountUnits: serializeBigInt(row.expectedAmountUnits),
    assetType: row.assetType,
    jettonContract: row.jettonContract || null,
    receiverWallet: row.receiverWallet,
    payload: row.payload,
    status: row.status,
    expiresAt: iso(row.expiresAt),
    metadata: row.metadata || null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

export function serializePayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.orderId,
    txHash: row.txHash,
    txLt: row.txLt || null,
    senderWallet: row.senderWallet || null,
    receiverWallet: row.receiverWallet,
    assetType: row.assetType,
    jettonContract: row.jettonContract || null,
    amountUnits: serializeBigInt(row.amountUnits),
    payload: row.payload,
    status: row.status,
    confirmedAt: iso(row.confirmedAt),
    createdAt: iso(row.createdAt)
  };
}

export function serializeWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    amountUnits: serializeBigInt(row.amountUnits),
    assetType: row.assetType,
    destinationWallet: row.destinationWallet,
    status: row.status,
    reason: row.reason || null,
    metadata: row.metadata || null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}
