import test from 'node:test';
import assert from 'node:assert/strict';
import { beginCell, contractAddress, storeStateInit } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';

import {
  buildTonProofSigningMessage,
  extractPublicKeyCandidates,
  verifyTonProof
} from '../src/auth/tonProof.js';

function createWalletStateInit(publicKey) {
  const code = beginCell().storeUint(0, 1).endCell();
  const data = beginCell()
    .storeUint(0, 32)
    .storeUint(698983191, 32)
    .storeBuffer(publicKey)
    .endCell();
  return { code, data };
}

function stateInitToBase64(stateInit) {
  return beginCell().store(storeStateInit(stateInit)).endCell().toBoc().toString('base64');
}

test('ton proof helper verifies a valid proof and rejects replay-domain mismatch', async () => {
  const keyPair = keyPairFromSeed(Buffer.alloc(32, 7));
  const stateInit = createWalletStateInit(keyPair.publicKey);
  const address = contractAddress(0, stateInit);
  const stateInitBase64 = stateInitToBase64(stateInit);
  const proof = {
    timestamp: 1_700_000_000,
    domain: { lengthBytes: Buffer.byteLength('demo.example.com'), value: 'demo.example.com' },
    payload: 'test-payload',
    state_init: stateInitBase64
  };
  const signingMessage = await buildTonProofSigningMessage({ address, ...proof });
  proof.signature = Buffer.from(sign(signingMessage, keyPair.secretKey)).toString('base64');

  const result = await verifyTonProof({
    address: address.toString({ bounceable: false, urlSafe: true }),
    network: 'mainnet',
    public_key: Buffer.from(keyPair.publicKey).toString('hex'),
    proof
  }, {
    allowedDomain: 'demo.example.com',
    nowSeconds: 1_700_000_030,
    maxAgeSeconds: 900
  });

  assert.equal(result.ok, true);
  assert.equal(result.wallet.rawAddress, address.toRawString());

  const wrongDomain = await verifyTonProof({
    address: address.toString({ bounceable: false, urlSafe: true }),
    public_key: Buffer.from(keyPair.publicKey).toString('hex'),
    proof
  }, {
    allowedDomain: 'example.com',
    nowSeconds: 1_700_000_030,
    maxAgeSeconds: 900
  });

  assert.equal(wrongDomain.ok, false);
  assert.equal(wrongDomain.reason, 'invalid_domain');
});

test('state init helper extracts standard wallet public key candidates', () => {
  const keyPair = keyPairFromSeed(Buffer.alloc(32, 3));
  const stateInit = createWalletStateInit(keyPair.publicKey);
  const candidates = extractPublicKeyCandidates(stateInit);
  assert.equal(candidates.some((item) => item.equals(Buffer.from(keyPair.publicKey))), true);
});
