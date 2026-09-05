import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, Wallet, ContractFactory, TypedDataEncoder, id, ZeroAddress } from 'ethers';

const voucherTypes = { Voucher: [
  { name: 'channelId', type: 'bytes32' }, { name: 'provider', type: 'address' },
  { name: 'cumulativeAmount', type: 'uint256' }, { name: 'receiptRoot', type: 'bytes32' },
  { name: 'validUntil', type: 'uint64' },
] };
const receiptTypes = { Receipt: [
  { name: 'agent', type: 'address' }, { name: 'provider', type: 'address' },
  { name: 'requestHash', type: 'bytes32' }, { name: 'outputHash', type: 'bytes32' },
  { name: 'modelHash', type: 'bytes32' }, { name: 'channelId', type: 'bytes32' },
  { name: 'cumulativeAmount', type: 'uint256' }, { name: 'completedAt', type: 'uint64' },
  { name: 'sequence', type: 'uint64' },
] };
let compiled, rpc, chain, actors, signingWallets;
function sourcesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sourcesIn(path) : path.endsWith('.sol') ? [path] : [];
  });
}
async function deploy(name, ...args) {
  const artifact = Object.values(compiled).flatMap(file => Object.entries(file)).find(([key]) => key === name)?.[1];
  assert.ok(artifact, `Missing contract ${name}`);
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, actors[0]).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function tx(promise) { return (await promise).wait(); }
async function now() { return Number(BigInt((await rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })).timestamp)); }
async function advanceTo(timestamp) {
  const delta = timestamp - await now();
  if (delta > 0) await rpc.request({ method: 'evm_increaseTime', params: [delta] });
  await rpc.request({ method: 'evm_mine', params: [] });
}
async function rejected(action) {
  await assert.rejects(async () => { const response = await action(); if (response?.wait) await response.wait(); });
}
async function fixture({ tokenName = 'MockToken', providerAddress } = {}) {
  const token = await deploy(tokenName);
  const channel = await deploy('MicropaymentChannel', await token.getAddress());
  const payerAddress = await actors[0].getAddress();
  const recipient = providerAddress ?? await actors[1].getAddress();
  await tx(token.mint(payerAddress, 2_000_000n));
  await tx(token.approve(await channel.getAddress(), 2_000_000n));
  const expiry = await now() + 3600;
  const event = (await tx(channel.open(recipient, 1_000_000n, expiry))).logs
    .map(log => { try { return channel.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'ChannelOpened');
  const channelId = event.args.channelId;
  const domain = { name: 'CinderRailChannel', version: '1', chainId: 31337, verifyingContract: await channel.getAddress() };
  const voucher = { channelId, provider: recipient, cumulativeAmount: 1000n, receiptRoot: id('receipt-batch-one'), validUntil: expiry };
  const sign = (v = voucher, d = domain, wallet = signingWallets[0]) => wallet.signTypedData(d, voucherTypes, v);
  return { token, channel, expiry, channelId, domain, voucher, sign, payerAddress, recipient };
}

before(async () => {
  const sources = Object.fromEntries(sourcesIn(resolve('contracts')).map(path => [relative(process.cwd(), path), { content: readFileSync(path, 'utf8') }]));
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: path => {
    try { return { contents: readFileSync(resolve('node_modules', path), 'utf8') }; }
    catch { return { error: `Import unavailable: ${path}` }; }
  } }));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  compiled = output.contracts;
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { totalAccounts: 6 } });
  chain = new BrowserProvider(rpc);
  chain.pollingInterval = 10;
  actors = await Promise.all(Array.from({ length: 6 }, (_, i) => chain.getSigner(i)));
  signingWallets = Object.values(rpc.getInitialAccounts()).map(account => new Wallet(account.secretKey));
});
after(async () => { if (rpc) await rpc.disconnect(); });

test('cumulative voucher pays only the delta and duplicate settlement is idempotent', async () => {
  const f = await fixture();
  assert.equal(await f.channel.voucherDigest(f.voucher), TypedDataEncoder.hash(f.domain, voucherTypes, f.voucher));
  const signature = await f.sign();
  await tx(f.channel.connect(actors[1]).settle(f.voucher, signature));
  assert.equal(await f.token.balanceOf(f.recipient), 1000n);
  assert.equal(await f.channel.connect(actors[1]).settle.staticCall(f.voucher, signature), 0n);
  await tx(f.channel.connect(actors[1]).settle(f.voucher, signature));
  assert.equal(await f.token.balanceOf(f.recipient), 1000n);
  const next = { ...f.voucher, cumulativeAmount: 1700n, receiptRoot: id('receipt-batch-two') };
  await tx(f.channel.connect(actors[1]).settle(next, await f.sign(next)));
  assert.equal(await f.token.balanceOf(f.recipient), 1700n);
  assert.equal((await f.channel.channels(f.channelId)).settled, 1700n);
  await rejected(() => f.channel.connect(actors[1]).settle(f.voucher, signature));
});

test('payer signature cannot be replayed across chains, deployments, or channels', async () => {
  const f = await fixture();
  const badChainSignature = await f.sign(f.voucher, { ...f.domain, chainId: 31338 });
  await rejected(() => f.channel.connect(actors[1]).settle(f.voucher, badChainSignature));
  const other = await deploy('MicropaymentChannel', await f.token.getAddress());
  const badDeploymentSignature = await f.sign(f.voucher, { ...f.domain, verifyingContract: await other.getAddress() });
  await rejected(() => f.channel.connect(actors[1]).settle(f.voucher, badDeploymentSignature));
  const signature = await f.sign();
  const event = (await tx(f.channel.open(f.recipient, 1000n, f.expiry))).logs
    .map(log => { try { return f.channel.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'ChannelOpened');
  assert.notEqual(event.args.channelId, f.channelId);
  await rejected(() => f.channel.connect(actors[1]).settle({ ...f.voucher, channelId: event.args.channelId }, signature));
  assert.equal(await f.token.balanceOf(f.recipient), 0n);
});

test('signature, recipient, receipt-root, amount and deadline tampering are rejected', async () => {
  const f = await fixture();
  const signature = await f.sign();
  await rejected(() => f.channel.connect(actors[1]).settle(f.voucher, '0x1234'));
  await rejected(async () => f.channel.connect(actors[1]).settle(f.voucher, await f.sign(f.voucher, f.domain, signingWallets[2])));
  await rejected(() => f.channel.connect(actors[2]).settle(f.voucher, signature));
  await rejected(() => f.channel.connect(actors[1]).settle({ ...f.voucher, provider: f.payerAddress }, signature));
  await rejected(() => f.channel.connect(actors[1]).settle({ ...f.voucher, receiptRoot: id('tamper') }, signature));
  await rejected(() => f.channel.connect(actors[1]).settle({ ...f.voucher, cumulativeAmount: 1001n }, signature));
  await rejected(() => f.channel.connect(actors[1]).settle({ ...f.voucher, validUntil: f.expiry - 1 }, signature));
  const overBudget = { ...f.voucher, cumulativeAmount: 1_000_001n };
  await rejected(async () => f.channel.connect(actors[1]).settle(overBudget, await f.sign(overBudget)));
  assert.equal(await f.token.balanceOf(await f.channel.getAddress()), 1_000_000n);
});

test('expiry separates provider settlement from a bounded single payer refund', async () => {
  const f = await fixture();
  const settled = { ...f.voucher, cumulativeAmount: 12000n };
  await tx(f.channel.connect(actors[1]).settle(settled, await f.sign(settled)));
  await rejected(() => f.channel.reclaim(f.channelId));
  await rejected(() => f.channel.connect(actors[2]).reclaim(f.channelId));
  const expired = { ...f.voucher, cumulativeAmount: 13000n, validUntil: await now() - 1 };
  await rejected(async () => f.channel.connect(actors[1]).settle(expired, await f.sign(expired)));
  const overDeadline = { ...f.voucher, cumulativeAmount: 13000n, validUntil: f.expiry + 1 };
  await rejected(async () => f.channel.connect(actors[1]).settle(overDeadline, await f.sign(overDeadline)));
  await advanceTo(f.expiry);
  assert.equal(await now(), f.expiry);
  await rejected(async () => f.channel.connect(actors[1]).settle(f.voucher, await f.sign()));
  assert.equal(await f.channel.reclaim.staticCall(f.channelId), 988000n);
  await tx(f.channel.reclaim(f.channelId, { gasLimit: 300000 }));
  assert.equal(await f.token.balanceOf(f.payerAddress), 1_988_000n);
  assert.equal(await f.token.balanceOf(f.recipient), 12000n);
  assert.equal(await f.token.balanceOf(await f.channel.getAddress()), 0n);
  await rejected(() => f.channel.reclaim(f.channelId));
});

test('channels reject empty, self-directed, overly long and nonstandard deposits', async () => {
  const f = await fixture();
  await rejected(() => f.channel.open(ZeroAddress, 1n, f.expiry));
  await rejected(() => f.channel.open(f.payerAddress, 1n, f.expiry));
  await rejected(() => f.channel.open(f.recipient, 0n, f.expiry));
  await rejected(async () => f.channel.open(f.recipient, 1n, await now()));
  await rejected(async () => f.channel.open(f.recipient, 1n, await now() + 31 * 86400));
  const fee = await deploy('FeeToken');
  const channel = await deploy('MicropaymentChannel', await fee.getAddress());
  await tx(fee.mint(f.payerAddress, 10000n));
  await tx(fee.approve(await channel.getAddress(), 10000n));
  await rejected(() => channel.open(f.recipient, 10000n, f.expiry));
  assert.equal(await fee.balanceOf(f.payerAddress), 10000n);
  assert.equal(await fee.balanceOf(await channel.getAddress()), 0n);
});

test('malicious token callback cannot re-enter provider settlement', async () => {
  const token = await deploy('ReentrantToken');
  const channel = await deploy('MicropaymentChannel', await token.getAddress());
  const payerAddress = await actors[0].getAddress();
  const recipient = await token.getAddress();
  await tx(token.mint(payerAddress, 10000n));
  await tx(token.approve(await channel.getAddress(), 10000n));
  const expiry = await now() + 3600;
  const event = (await tx(channel.open(recipient, 10000n, expiry))).logs
    .map(log => { try { return channel.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'ChannelOpened');
  const voucher = { channelId: event.args.channelId, provider: recipient, cumulativeAmount: 1000n, receiptRoot: id('callback'), validUntil: expiry };
  const domain = { name: 'CinderRailChannel', version: '1', chainId: 31337, verifyingContract: await channel.getAddress() };
  const signature = await signingWallets[0].signTypedData(domain, voucherTypes, voucher);
  const payload = channel.interface.encodeFunctionData('settle', [voucher, signature]);
  await tx(token.arm(await channel.getAddress(), payload));
  await tx(token.callChannel(await channel.getAddress(), payload));
  assert.equal(await token.attempted(), true);
  assert.equal(await token.succeeded(), false);
  assert.equal(await token.balanceOf(recipient), 1000n);
  assert.equal((await channel.channels(voucher.channelId)).settled, 1000n);
});

test('agent directory limits mutation to owner and expires/revokes session authorization', async () => {
  const registry = await deploy('AgentRegistry');
  const owner = await actors[0].getAddress();
  const session = await actors[1].getAddress();
  const outsider = await actors[2].getAddress();
  await rejected(() => registry.register('', id('capabilities')));
  await tx(registry.register('https://compute.example/api', id('capabilities')));
  await rejected(() => registry.register('https://other.example', id('other')));
  await rejected(() => registry.connect(actors[2]).update('https://tamper.example', id('tamper')));
  assert.equal((await registry.agents(owner)).endpoint, 'https://compute.example/api');
  assert.equal(await registry.isAuthorized(owner, owner), true);
  assert.equal(await registry.isAuthorized(owner, outsider), false);
  await rejected(async () => registry.setSessionKey(ZeroAddress, await now() + 60));
  await rejected(async () => registry.setSessionKey(session, await now() + 31 * 86400));
  const expiry = await now() + 60;
  await tx(registry.setSessionKey(session, expiry));
  assert.equal(await registry.isAuthorized(owner, session), true);
  await tx(registry.revokeSessionKey(session));
  assert.equal(await registry.isAuthorized(owner, session), false);
  await tx(registry.setSessionKey(session, expiry));
  await advanceTo(expiry);
  assert.equal(await registry.isAuthorized(owner, session), false);
  await tx(registry.setSessionKey(session, await now() + 120));
  await tx(registry.revokeAgent());
  assert.equal(await registry.isAuthorized(owner, owner), false);
  assert.equal(await registry.isAuthorized(owner, session), false);
  await rejected(() => registry.update('https://revived.example', id('revived')));
});

test('receipt registry verifies provenance, rejects forgery/replay, and restricts declared dispute resolution', async () => {
  const registry = await deploy('ComputeReceiptRegistry', await actors[3].getAddress());
  const receipt = {
    agent: await actors[0].getAddress(), provider: await actors[1].getAddress(),
    requestHash: id('input'), outputHash: id('output'), modelHash: id('claimed-model'), channelId: id('claimed-channel'),
    cumulativeAmount: 1000n, completedAt: await now(), sequence: 1,
  };
  const domain = { name: 'CinderRailReceipts', version: '1', chainId: 31337, verifyingContract: await registry.getAddress() };
  const signature = await signingWallets[1].signTypedData(domain, receiptTypes, receipt);
  const digest = await registry.receiptDigest(receipt);
  assert.equal(digest, TypedDataEncoder.hash(domain, receiptTypes, receipt));
  await rejected(() => registry.submitReceipt({ ...receipt, outputHash: id('forged') }, signature));
  const wrongSigner = await signingWallets[2].signTypedData(domain, receiptTypes, receipt);
  await rejected(() => registry.submitReceipt(receipt, wrongSigner));
  const wrongChain = await signingWallets[1].signTypedData({ ...domain, chainId: 31338 }, receiptTypes, receipt);
  await rejected(() => registry.submitReceipt(receipt, wrongChain));
  await tx(registry.connect(actors[2]).submitReceipt(receipt, signature));
  assert.equal((await registry.records(digest)).provider, receipt.provider);
  await rejected(() => registry.submitReceipt(receipt, signature));
  await rejected(() => registry.connect(actors[2]).openDispute(digest, id('evidence')));
  await rejected(() => registry.connect(actors[3]).resolveDispute(digest, id('resolution')));
  await tx(registry.openDispute(digest, id('evidence')));
  assert.equal((await registry.records(digest)).disputeState, 1n);
  await rejected(() => registry.openDispute(digest, id('second-evidence')));
  await rejected(() => registry.resolveDispute(digest, id('resolution')));
  await tx(registry.connect(actors[3]).resolveDispute(digest, id('trusted-resolution')));
  assert.equal((await registry.records(digest)).disputeState, 2n);
  await rejected(() => registry.connect(actors[3]).resolveDispute(digest, id('second-resolution')));
});
