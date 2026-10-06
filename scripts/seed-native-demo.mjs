#!/usr/bin/env node
/**
 * Publish one original synthesized demo track and optionally fund an empty pool.
 * No mutation or network request occurs without --run.
 *
 * CINDER_URL=http://127.0.0.1:8787 node scripts/seed-native-demo.mjs --run
 * CINDER_URL=https://your-native-host node scripts/seed-native-demo.mjs --run --seed-pool
 *
 * Private keys: artifacts/native-demo-wallets.json only (0600, ignored by Git).
 * Resume journal: artifacts/native-demo-state.json (signed public actions, no keys).
 * Public result: public/examples/native-demo.json (metadata/addresses/hashes only).
 * All three wallets are operator demo accounts, not evidence of artist adoption.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CinderNativeClient } from '../public/native-sdk.js';
import { nativeAddress, nativeGenerateKey, nativeSign, nativeVerify, nativeHash, nativeCanonical, nativeBase64url } from '../src/native-crypto.ts';
import { quoteAddLiquidity } from '../src/native-economy.ts';

const args = new Set(process.argv.slice(2));
const allowed = new Set(['--run', '--seed-pool', '--help']);
for (const arg of args) if (!allowed.has(arg)) throw new Error('Unknown option: ' + arg);
if (!args.has('--run') || args.has('--help')) {
  console.log('No changes made. Use --run to publish the original demo track; add --seed-pool to fund a currently empty CINDER/WORK pool from actual test balances. CINDER_URL defaults to http://127.0.0.1:8787.');
} else {
  await main().catch(error => {
    console.error('Demo seed stopped: ' + error.message);
    console.error('Rerun the same command to resume saved actions. Do not delete the ignored wallet file.');
    process.exitCode = 1;
  });
}

function synthesize() {
  const rate = 22050, duration = 12, samples = rate * duration;
  const floats = new Float64Array(samples);
  const note = (midi, start, length, amplitude, bright = true) => {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const first = Math.round(start * rate), count = Math.round(length * rate);
    for (let j = 0; j < count && first + j < samples; j++) {
      const t = j / rate, end = Math.min(1, (length - t) / 0.13);
      const envelope = (1 - Math.exp(-t * 85)) * Math.exp(-t * (bright ? 3.5 : 0.7)) * end;
      const phase = 2 * Math.PI * hz * t;
      const tone = Math.sin(phase) + (bright ? 0.23 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3) : 0);
      floats[first + j] += amplitude * envelope * tone;
    }
  };
  // Original algorithmic phrase: four open voicings, rising/falling bell arpeggios.
  const chords = [[48, 55, 60, 64, 71], [45, 52, 57, 60, 67], [41, 48, 53, 57, 64], [43, 50, 55, 62, 67]];
  const order = [2, 3, 4, 3, 2, 4, 3, 1];
  for (let bar = 0; bar < 4; bar++) {
    const chord = chords[bar], start = bar * 2.5;
    note(chord[0], start, 2.8, 0.10, false);
    note(chord[1], start + 0.04, 2.6, 0.045, false);
    for (let beat = 0; beat < order.length; beat++) note(chord[order[beat]] + 12, start + beat * 0.3125, 0.92, 0.17);
  }
  note(60, 10, 2, 0.11, false); note(67, 10.03, 1.95, 0.075); note(76, 10.08, 1.88, 0.07);
  const wav = new Uint8Array(44 + samples * 2), view = new DataView(wav.buffer);
  const text = (offset, value) => wav.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate, fade = Math.min(1, t / 0.03, (duration - t) / 0.6);
    view.setInt16(44 + i * 2, Math.round(Math.tanh(floats[i]) * fade * 26000), true);
  }
  assert.ok(wav.length < 1024 * 1024);
  return { bytes: wav, mime: 'audio/wav', durationSeconds: duration, sampleRate: rate };
}

async function main() {
  const network = new URL(process.env.CINDER_URL || 'http://127.0.0.1:8787');
  assert.ok(['http:', 'https:'].includes(network.protocol), 'Use an HTTP(S) network URL');
  assert.ok(!network.username && !network.password && !network.search && !network.hash && network.pathname === '/', 'Use a bare network origin without credentials, query or path');
  const baseUrl = network.origin, chainId = 'cinder-devnet-1';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = path.join(root, 'artifacts');
  const walletPath = path.join(directory, 'native-demo-wallets.json');
  const statePath = path.join(directory, 'native-demo-state.json');
  const lockPath = path.join(directory, 'native-demo.lock');
  const outputPath = path.join(root, 'public/examples/native-demo.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  assert.ok(!(await fs.lstat(directory)).isSymbolicLink(), 'Refusing a symlinked private-artifact directory');
  const lock = await acquireLock(lockPath);
  try {
    const client = new CinderNativeClient(baseUrl, process.env.CINDER_OPERATOR_KEY || undefined);
    const info = await client.connect();
    assert.equal(info.chainId, chainId); assert.equal(info.mainnet, false);
    const get = async endpoint => {
      const response = await fetch(baseUrl + '/api/native' + endpoint, { signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.message || 'Native read failed'), { status: response.status, code: body.error });
      return body;
    };
    const genesis = await get('/genesis');
    assert.equal(genesis.genesis.chainId, chainId);
    assert.equal(genesis.genesis.operatorPublicKey, info.signer.publicKey);
    assert.equal(nativeHash(nativeCanonical(genesis.genesis)), genesis.hash);
    assert.ok(nativeVerify(genesis.genesis, genesis.signature, info.signer.publicKey));
    const identity = { baseUrl, chainId, genesisHash: genesis.hash, operatorPublicKey: info.signer.publicKey };

    let privateFile;
    try {
      const handle = await fs.open(walletPath, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        await handle.chmod(0o600);
        try { privateFile = JSON.parse(await handle.readFile('utf8')); }
        catch { throw new Error('The saved private wallet file is unreadable. Preserve it for recovery; no replacement wallets were created.'); }
      }
      finally { await handle.close(); }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      privateFile = { format: 'cinder.demo-wallets.v1', ...identity, createdAt: new Date().toISOString(), wallets: [nativeGenerateKey(), nativeGenerateKey(), nativeGenerateKey()] };
      const handle = await fs.open(walletPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(privateFile, null, 2) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
    }
    assert.equal(privateFile.format, 'cinder.demo-wallets.v1');
    for (const [key, value] of Object.entries(identity)) assert.equal(privateFile[key], value, 'Saved demo wallet belongs to another network identity: ' + key);
    assert.equal(privateFile.wallets.length, 3);
    for (const wallet of privateFile.wallets) {
      assert.equal(wallet.algorithm, 'ML-DSA-65'); assert.equal(nativeAddress(wallet.publicKey), wallet.address);
      const proof = { domain: 'cinder.demo-key-check.v1', chainId, publicKey: wallet.publicKey };
      assert.ok(nativeVerify(proof, nativeSign(proof, wallet.secretKey), wallet.publicKey), 'Saved key pair does not match');
    }
    const [payer, collaborator, studio] = privateFile.wallets;
    assert.equal(new Set(privateFile.wallets.map(wallet => wallet.address)).size, 3);
    let state;
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = { format: 'cinder.demo-state.v1', ...identity, owner: payer.address, operations: {}, upload: null, pool: null }; }
    assert.equal(state.format, 'cinder.demo-state.v1'); assert.equal(state.owner, payer.address);
    for (const [key, value] of Object.entries(identity)) assert.equal(state[key], value, 'Saved demo state belongs to another network identity: ' + key);
    const save = () => atomicJson(statePath, state, 0o600);
    await save();
    for (const wallet of privateFile.wallets) {
      try { const existing = await client.account(wallet.address); assert.equal(existing.publicKey, wallet.publicKey); }
      catch (error) { if (error.status !== 404) throw error; await client.register(wallet); }
    }

    // Persist each signed envelope before submitting. Lost responses resume by hash.
    async function commit(name, proposal) {
      let operation = state.operations[name];
      if (operation?.receipt) { client.verifyReceipt(operation.receipt, operation.envelope.transaction); return operation; }
      if (operation?.envelope) {
        try {
          const existing = await get('/transactions/' + operation.txHash);
          client.verifyReceipt(existing.receipt, operation.envelope.transaction);
          operation.receipt = existing.receipt; await save(); return operation;
        } catch (error) { if (error.status !== 404) throw error; }
        if (Date.parse(operation.envelope.transaction.validUntil) > Date.now()) {
          const result = await client.submit(operation.envelope);
          operation.receipt = result.receipt; await save(); return operation;
        }
        const account = await client.account(payer.address);
        assert.equal(account.nonce + 1, operation.envelope.transaction.nonce, 'An unresolved demo nonce changed; refusing another authorization');
      }
      const { action, maximum } = await proposal();
      const envelope = await client.authorize(payer, [action], maximum);
      operation = { envelope, txHash: nativeHash(nativeCanonical(envelope.transaction)), priorAttempts: operation ? [...(operation.priorAttempts || []), operation.txHash] : [] };
      state.operations[name] = operation; await save();
      const result = await client.submit(envelope); operation.receipt = result.receipt; await save(); return operation;
    }

    if (state.operations.faucet || !(await client.account(payer.address)).claimedFaucet) {
      await commit('faucet', async () => ({ action: { type: 'faucet' }, maximum: '0' }));
    }
    const audio = synthesize();
    const audioHash = Buffer.from(await crypto.subtle.digest('SHA-384', audio.bytes)).toString('hex');
    if (!state.upload) { state.upload = { uploadId: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'), audioHash, next: 0, complete: false }; await save(); }
    assert.equal(state.upload.audioHash, audioHash, 'Original audio changed; refusing to overwrite the saved publication');
    const chunks = Math.ceil(audio.bytes.length / 24576);
    for (let index = state.upload.next; index < chunks; index++) {
      const bytes = audio.bytes.slice(index * 24576, (index + 1) * 24576);
      const authorization = { domain: 'cinder.media-chunk.v1', chainId, owner: payer.address, uploadId: state.upload.uploadId, audioHash,
        mime: audio.mime, bytes: audio.bytes.length, chunks, index,
        chunkHash: Buffer.from(await crypto.subtle.digest('SHA-384', bytes)).toString('hex'), validUntil: new Date(Date.now() + 1800000).toISOString() };
      const response = await fetch(baseUrl + '/api/native/media/upload', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorization, signature: nativeSign(authorization, payer.secretKey), data: nativeBase64url(bytes) }), signal: AbortSignal.timeout(30000) });
      const uploaded = await response.json();
      if (!response.ok) throw new Error(uploaded.message || 'Original audio upload failed');
      assert.equal(uploaded.audioHash, audioHash); assert.equal(uploaded.next, index + 1);
      state.upload.next = uploaded.next; state.upload.complete = uploaded.complete; await save();
    }
    assert.equal(state.upload.complete, true);
    const recipients = [{ address: payer.address, bps: 7000 }, { address: collaborator.address, bps: 2000 }, { address: studio.address, bps: 1000 }];
    const publication = await commit('publication', async () => ({ maximum: '12', action: { type: 'music.publish', audioHash,
      mime: audio.mime, bytes: audio.bytes.length, title: 'First Light · Cinder demo', artist: 'Cinder Studio (original test audio)',
      recipients, priceAtoms: '1000', rightsDeclared: true } }));
    const track = await client.track(publication.receipt.result.trackId);
    assert.equal(track.owner, payer.address); assert.equal(track.audioHash, audioHash); assert.equal(track.priceAtoms, '1000');
    assert.equal(nativeCanonical([...track.recipients].sort((a, b) => a.address.localeCompare(b.address))), nativeCanonical([...recipients].sort((a, b) => a.address.localeCompare(b.address))));
    // Deliberate unpublication must not be reversed by running a demo script again.
    if (!track.active) throw new Error('The saved demo was unpublished; it will not be republished automatically');

    if (args.has('--seed-pool') && !state.pool) {
      const current = await client.economy(payer.address);
      state.pool = current.state.pool.lpSupply === '0' ? { status: 'started', startedEmpty: true } : { status: 'skipped-existing-pool', startedEmpty: false };
      await save();
    }
    if (args.has('--seed-pool') && state.pool?.status === 'started') {
      try {
        for (let tranche = 0; tranche < 2; tranche++) {
          const expected = tranche === 0 ? { cinderAtoms: '0', workUnits: '0', lpSupply: '0' } : state.operations['liquidity-0'].receipt.result.globalState.pool;
          const unchangedPool = async () => {
            const current = await client.economy(payer.address);
            if (nativeCanonical(current.state.pool) !== nativeCanonical(expected)) throw Object.assign(new Error('The pool changed after the empty-pool plan; no new seed action will be signed'), { code: 'seed_pool_changed' });
            return current;
          };
          await commit('work-purchase-' + tranche, async () => { await unchangedPool(); return { action: { type: 'economy.buy', workUnits: '10000', maxCinderAtoms: '1000000' }, maximum: '1000012' }; });
          await commit('liquidity-' + tranche, async () => {
            const current = await unchangedPool(), quote = quoteAddLiquidity(current.state, '1000000', '10000');
            return { action: { type: 'economy.addLiquidity', maxCinderAtoms: '1000000', maxWorkUnits: '10000', minLpUnits: quote.lpUnits, deadline: new Date(Date.now() + 120000).toISOString() }, maximum: '1000012' };
          });
        }
        state.pool.status = 'complete'; await save();
      } catch (error) {
        if (error.code !== 'seed_pool_changed') throw error;
        state.pool.status = 'stopped-pool-changed'; state.pool.reason = error.message; await save();
      }
    }
    const liquidity = Object.entries(state.operations).filter(([name, entry]) => name.startsWith('liquidity-') && entry.receipt);
    const publicManifest = { format: 'cinder.demo-public.v1', network: baseUrl, chainId, genesisHash: genesis.hash,
      trackId: track.trackId, publicationTransaction: publication.txHash, title: track.title, artist: track.artist,
      audioHash, mime: audio.mime, bytes: audio.bytes.length, durationSeconds: audio.durationSeconds, sampleRate: audio.sampleRate,
      priceAtoms: track.priceAtoms, priceCinder: '0.001', recipients, createdAt: track.publishedAt,
      provenance: 'Original synthesized test audio generated by scripts/seed-native-demo.mjs; no copied recording. All recipient wallets are operated by this demonstration, not independent artists or adoption.',
      liquidity: { status: state.pool?.status || 'not-requested', startedFromEmptyPool: state.pool?.startedEmpty || false,
        transactions: liquidity.map(([, entry]) => entry.txHash),
        cinderDepositedAtoms: liquidity.reduce((total, [, entry]) => total + BigInt(entry.receipt.result.events[0].cinderAtoms), 0n).toString(),
        workDepositedUnits: liquidity.reduce((total, [, entry]) => total + BigInt(entry.receipt.result.events[0].workUnits), 0n).toString(),
        funding: 'Purchased WORK and deposited both assets from actual finite-reserve test CINDER balances; no synthetic liquidity.' },
      scope: 'Native testnet demonstration only. No cash value, market-price support, external artist adoption or promised return.' };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await atomicJson(outputPath, publicManifest, 0o644);
    console.log(JSON.stringify(publicManifest, null, 2));
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

async function atomicJson(file, value, mode) {
  const temporary = file + '.tmp-' + process.pid;
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, file);
}

async function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(String(process.pid)); await handle.sync(); return handle;
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt !== 0) throw error;
      const pid = Number(await fs.readFile(file, 'utf8'));
      assert.ok(Number.isSafeInteger(pid) && pid > 0, 'The demo lock is invalid; inspect it before retrying');
      try { process.kill(pid, 0); throw new Error('Another demo seed process is active'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await fs.unlink(file);
    }
  }
  throw new Error('Could not acquire the demo seed lock');
}
