import { normalizeTonAddress } from '../auth/tonProof.js';

export function normalizeAddressForCompare(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return normalizeTonAddress(source).raw;
  } catch {
    return source.toLowerCase();
  }
}

export function sameWalletAddress(left, right) {
  return normalizeAddressForCompare(left) === normalizeAddressForCompare(right);
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return null;
}

export function normalizeIncomingPaymentTransaction(rawTx = {}) {
  const inMsg = rawTx.in_msg || rawTx.inMsg || rawTx.inMessage || rawTx.message || {};
  const decodedBody = inMsg.decoded_body || inMsg.decodedBody || rawTx.decoded_body || rawTx.decodedBody || {};
  const jetton = rawTx.jetton || rawTx.jetton_transfer || rawTx.jettonTransfer || {};
  const rawAmount = firstValue(
    rawTx.amount_units,
    rawTx.amountUnits,
    rawTx.amount,
    rawTx.value,
    inMsg.value,
    inMsg.amount,
    jetton.amount
  );

  const rawPayload = firstValue(
    rawTx.payload,
    rawTx.comment,
    rawTx.memo,
    inMsg.payload,
    inMsg.comment,
    inMsg.message,
    decodedBody.text,
    decodedBody.comment,
    jetton.forward_payload,
    jetton.forwardPayload
  );

  return {
    txHash: String(firstValue(
      rawTx.tx_hash,
      rawTx.txHash,
      rawTx.hash,
      rawTx.transaction_hash,
      rawTx.transactionHash,
      rawTx.transaction_id?.hash,
      rawTx.transactionId?.hash
    ) || ''),
    txLt: String(firstValue(
      rawTx.tx_lt,
      rawTx.txLt,
      rawTx.lt,
      rawTx.transaction_id?.lt,
      rawTx.transactionId?.lt
    ) || ''),
    senderWallet: String(firstValue(
      rawTx.sender_wallet,
      rawTx.senderWallet,
      rawTx.sender,
      rawTx.source,
      rawTx.from,
      inMsg.source,
      inMsg.src,
      jetton.sender
    ) || ''),
    receiverWallet: String(firstValue(
      rawTx.receiver_wallet,
      rawTx.receiverWallet,
      rawTx.receiver,
      rawTx.destination,
      rawTx.to,
      inMsg.destination,
      inMsg.dest,
      jetton.recipient
    ) || ''),
    assetType: String(firstValue(rawTx.asset_type, rawTx.assetType, jetton.asset_type) || (jetton.jetton_contract ? 'JETTON' : 'TON')).toUpperCase(),
    jettonContract: firstValue(
      rawTx.jetton_contract,
      rawTx.jettonContract,
      jetton.jetton_contract,
      jetton.jettonContract,
      jetton.address,
      jetton.master
    ),
    amountUnits: rawAmount === null ? 0n : BigInt(String(rawAmount)),
    payload: String(rawPayload || ''),
    rawTx,
    confirmedAt: rawTx.confirmed_at || rawTx.confirmedAt || rawTx.utime
      ? new Date(Number(rawTx.utime) ? Number(rawTx.utime) * 1000 : (rawTx.confirmed_at || rawTx.confirmedAt))
      : new Date()
  };
}

export function convertAssetAmountToUnits(amount, decimals) {
  const source = String(amount || '0').trim();
  const normalizedDecimals = Math.max(0, Math.floor(Number(decimals || 0)));
  const [whole = '0', fractionRaw = ''] = source.split('.');
  const fraction = fractionRaw.padEnd(normalizedDecimals, '0').slice(0, normalizedDecimals);
  return BigInt(whole || '0') * (10n ** BigInt(normalizedDecimals)) + BigInt(fraction || '0');
}

export function validateIncomingPayment({ order, tx, linkedWalletAddress, allowGifts = false, now = new Date() }) {
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (!tx?.txHash) return { ok: false, reason: 'missing_tx_hash' };
  if (order.status !== 'pending') return { ok: false, reason: `order_${order.status}` };
  if (new Date(order.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: 'order_expired' };
  if (!sameWalletAddress(tx.receiverWallet, order.receiverWallet)) return { ok: false, reason: 'wrong_receiver' };
  if (String(tx.assetType || '').toUpperCase() !== String(order.assetType || '').toUpperCase()) {
    return { ok: false, reason: 'wrong_asset' };
  }
  if (String(order.assetType || '').toUpperCase() === 'JETTON') {
    if (!order.jettonContract || !sameWalletAddress(tx.jettonContract, order.jettonContract)) {
      return { ok: false, reason: 'wrong_jetton_contract' };
    }
  }
  if (BigInt(tx.amountUnits || 0) !== BigInt(order.expectedAmountUnits || 0)) {
    return { ok: false, reason: 'wrong_amount' };
  }
  if (String(tx.payload || '') !== String(order.payload || '')) {
    return { ok: false, reason: 'wrong_payload' };
  }
  if (!allowGifts && linkedWalletAddress && !sameWalletAddress(tx.senderWallet, linkedWalletAddress)) {
    return { ok: false, reason: 'wrong_sender' };
  }
  return { ok: true };
}
