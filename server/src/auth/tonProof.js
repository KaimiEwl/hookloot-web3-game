import { randomBytes } from 'node:crypto';
import { Address, Cell, contractAddress, loadStateInit } from '@ton/ton';
import { sha256, signVerify } from '@ton/crypto';

const TON_PROOF_PREFIX = 'ton-proof-item-v2/';
const TON_CONNECT_PREFIX = 'ton-connect';

export function createTonProofPayload() {
  return randomBytes(32).toString('base64url');
}

export function normalizeTonAddress(value) {
  const address = Address.parse(String(value || '').trim());
  return {
    address,
    raw: address.toRawString(),
    friendly: address.toString({ urlSafe: true, bounceable: false })
  };
}

function toHex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

function uniqueBuffers(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || item.length !== 32) return false;
    const hex = toHex(item);
    if (seen.has(hex)) return false;
    seen.add(hex);
    return true;
  });
}

export function parseStateInit(stateInitBase64) {
  if (!stateInitBase64) return null;
  return loadStateInit(Cell.fromBase64(stateInitBase64).beginParse());
}

export function assertStateInitMatchesAddress(stateInit, address) {
  const derivedAddress = contractAddress(address.workChain, stateInit);
  return derivedAddress.equals(address);
}

export function extractPublicKeyCandidates(stateInit) {
  const data = stateInit?.data;
  if (!data) return [];

  const offsets = [0, 32, 64, 96];
  const candidates = [];
  for (const offset of offsets) {
    const slice = data.beginParse();
    if (slice.remainingBits < offset + 256) continue;
    if (offset > 0) slice.skip(offset);
    candidates.push(slice.loadBuffer(32));
  }
  return uniqueBuffers(candidates);
}

export function buildTonProofMessage({ address, domain, timestamp, payload }) {
  const domainValue = String(domain?.value || '');
  const domainBuffer = Buffer.from(domainValue, 'utf8');
  const declaredLength = Number(domain?.lengthBytes);
  if (!Number.isInteger(declaredLength) || declaredLength !== domainBuffer.length) {
    throw new Error('Domain length mismatch');
  }

  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain, 0);

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigUInt64LE(BigInt(timestamp), 0);

  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domainBuffer.length, 0);

  return Buffer.concat([
    Buffer.from(TON_PROOF_PREFIX, 'utf8'),
    workchain,
    Buffer.from(address.hash),
    domainLength,
    domainBuffer,
    timestampBuffer,
    Buffer.from(String(payload || ''), 'utf8')
  ]);
}

export async function buildTonProofSigningMessage(input) {
  const message = buildTonProofMessage(input);
  const messageHash = Buffer.from(await sha256(message));
  return Buffer.from(await sha256(Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from(TON_CONNECT_PREFIX, 'utf8'),
    messageHash
  ])));
}

export function isFreshTimestamp(timestamp, { nowSeconds, maxAgeSeconds }) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) return false;
  const now = Number(nowSeconds || Math.floor(Date.now() / 1000));
  const maxAge = Number(maxAgeSeconds || 900);
  if (ts > now + 60) return false;
  return now - ts <= maxAge;
}

export async function verifyTonProof(input, options) {
  const {
    allowedDomain,
    maxAgeSeconds = 900,
    nowSeconds = Math.floor(Date.now() / 1000)
  } = options || {};

  const { address, raw, friendly } = normalizeTonAddress(input.address);
  const proof = input.proof || {};
  const publicKeyHex = String(input.publicKey || input.public_key || '').toLowerCase();
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  if (publicKey.length !== 32) {
    return { ok: false, reason: 'invalid_public_key' };
  }

  if (String(proof.domain?.value || '') !== String(allowedDomain || '')) {
    return { ok: false, reason: 'invalid_domain' };
  }
  if (!isFreshTimestamp(proof.timestamp, { nowSeconds, maxAgeSeconds })) {
    return { ok: false, reason: 'stale_proof' };
  }

  let stateInit;
  try {
    stateInit = parseStateInit(proof.state_init || proof.stateInit);
  } catch {
    return { ok: false, reason: 'invalid_state_init' };
  }
  if (!stateInit || !assertStateInitMatchesAddress(stateInit, address)) {
    return { ok: false, reason: 'address_mismatch' };
  }

  const statePublicKeys = extractPublicKeyCandidates(stateInit);
  if (!statePublicKeys.some((candidate) => candidate.equals(publicKey))) {
    return { ok: false, reason: 'public_key_mismatch' };
  }

  let signingMessage;
  try {
    signingMessage = await buildTonProofSigningMessage({
      address,
      domain: proof.domain,
      timestamp: proof.timestamp,
      payload: proof.payload
    });
  } catch {
    return { ok: false, reason: 'invalid_message' };
  }

  const signature = Buffer.from(String(proof.signature || ''), 'base64');
  const signatureOk = signature.length === 64 && signVerify(signingMessage, signature, publicKey);
  if (!signatureOk) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return {
    ok: true,
    wallet: {
      address: friendly,
      rawAddress: raw,
      network: String(input.network || 'mainnet'),
      publicKey: publicKeyHex
    }
  };
}
