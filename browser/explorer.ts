import { nativeAddress, nativeVerify, nativeHash, nativeCanonical } from '../src/native-crypto.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const chain = 'cinder-devnet-1', digest = /^[a-f0-9]{96}$/, pinKey = 'cinder.explorer.genesis-pin.v1';
let info: any, genesis: any, after = 0, busy = false, receipt: any = null, selected = '';
let retry: () => Promise<void> = initialize;
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const signed = (value: unknown) => { check(typeof value === 'string' && /^(0|-?[1-9]\d*)$/.test(value), '账本金额格式无效。'); return BigInt(value as string); };
const amount = (value: string | bigint) => { const n = typeof value === 'bigint' ? value : signed(value), abs = n < 0n ? -n : n; return (n < 0n ? '−' : '') + (abs / 1000000n).toLocaleString('en-US') + ((abs % 1000000n) ? '.' + (abs % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') : ''); };
const text = (id: string, value: unknown) => { $(id).textContent = String(value); };
async function api(route: string): Promise<any> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/native' + route, { cache: 'no-store', signal: controller.signal });
    let body: any; try { body = await response.json(); } catch { throw new Error('服务器返回内容无法读取。请重试。'); }
    if (!response.ok) throw new Error(body.message || '账本读取失败（HTTP ' + response.status + '）。');
    return body;
  } catch (error: any) { if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('网络连接中断或超时。可点击重试；本页不会发起支付。'); throw error; }
  finally { clearTimeout(timer); }
}
function controls() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy;
  $<HTMLButtonElement>('older').disabled = busy || !info || after === 0;
  $<HTMLButtonElement>('newer').disabled = busy || !info || after + 20 >= info.head.height;
  $<HTMLButtonElement>('download').disabled = busy || !receipt;
  $<HTMLInputElement>('tx-query').disabled = busy;
}
async function run(task: () => Promise<void>) {
  if (busy) return; busy = true; retry = task; $('error').hidden = true; controls();
  try { await task(); }
  catch (error) { text('error-message', error instanceof Error ? error.message : '读取失败。'); $('error').hidden = false; text('status', '读取或验证未完成。请查看错误后重试；未经核对的收据不会显示。'); if (!receipt) text('detail-empty', '本次收据尚未完成验证。请重试，或选择其他记录。'); }
  finally { busy = false; controls(); }
}
function checkpoint(cp: any, signature: string): string {
  check(cp?.domain === 'cinder.checkpoint.v1' && cp.chainId === chain && cp.mode === 'single-operator-devnet', '检查点所属网络或签名域不符。');
  check(Number.isSafeInteger(cp.height) && cp.height > 0 && Number.isFinite(Date.parse(cp.timestamp)) && new Date(cp.timestamp).toISOString() === cp.timestamp, '检查点高度或时间无效。');
  for (const field of ['transactionHash', 'postingsHash', 'resultHash', 'previousHash']) check(typeof cp[field] === 'string' && digest.test(cp[field]), '检查点哈希格式无效。');
  check(nativeVerify(cp, signature, genesis.genesis.operatorPublicKey), '运营方检查点签名未通过验证。');
  return nativeHash(nativeCanonical(cp));
}
async function initialize() {
  text('status', '正在读取网络与创世签名…');
  const [nextInfo, record] = await Promise.all([api('/info'), api('/genesis')]);
  check(nextInfo.chainId === chain && nextInfo.signatureAlgorithm === 'ML-DSA-65' && record.genesis?.domain === 'cinder.genesis.v1' && record.genesis.chainId === chain, '这不是支持的 CINDER 原生网络。');
  check(record.genesis.operatorPublicKey === nextInfo.signer.publicKey && nativeHash(nativeCanonical(record.genesis)) === record.hash && nativeVerify(record.genesis, record.signature, record.genesis.operatorPublicKey), '创世记录签名或网络公钥不匹配。');
  check(record.genesis.symbol === 'CINDER' && record.genesis.decimals === 6 && record.genesis.supplyAtoms === '1000000000000', '创世资产或计量单位与此版本不同。');
  check(Number.isSafeInteger(nextInfo.head?.height) && nextInfo.head.height >= 0 && digest.test(nextInfo.head.hash), '网络头部格式无效。');
  if (nextInfo.head.height === 0) check(nextInfo.head.hash === record.hash, '空账本的网络头部与创世记录不符。');
  const pin = { chainId: chain, genesisHash: record.hash, operatorPublicKey: record.genesis.operatorPublicKey };
  let remembered = false, old: string | null = null;
  try { old = localStorage.getItem(pinKey); } catch { /* Storage restrictions leave a page-lifetime pin. */ }
  if (old) { check(nativeCanonical(JSON.parse(old)) === nativeCanonical(pin), '与此浏览器已保存的创世身份不同。已停止加载；请先核对网络迁移或公钥变化。'); remembered = true; }
  if (genesis) check(genesis.hash === record.hash && genesis.genesis.operatorPublicKey === record.genesis.operatorPublicKey, '本次访问中的运营方身份发生变化。');
  try { if (!old) localStorage.setItem(pinKey, JSON.stringify(pin)); if (localStorage.getItem(pinKey)) remembered = true; } catch { /* Explain the reduced persistence below. */ }
  info = nextInfo; genesis = record;
  text('network-name', chain); text('network-height', info.head.height); text('network-supply', amount(record.genesis.supplyAtoms));
  text('operator-fingerprint', nativeAddress(record.genesis.operatorPublicKey).slice(4)); text('genesis-hash', record.hash);
  text('pin-note', remembered ? '已核对此浏览器记录的创世身份。首次记录来自当前网站；请把下面的指纹与独立可信渠道核对。之后身份变化会停止加载。' : '已核对创世签名，但浏览器无法保存身份。当前页面保留此公钥；首次信任仍需与独立可信渠道核对。');
  await loadPage(Math.floor(Math.max(0, info.head.height - 1) / 20) * 20);
  const query = new URL(location.href).searchParams.get('tx');
  if (query) { check(digest.test(query.toLowerCase()), '网址中的交易哈希无效。'); $<HTMLInputElement>('tx-query').value = query.toLowerCase(); await openReceipt(query.toLowerCase()); }
}
async function loadPage(cursor: number) {
  text('status', '正在核对检查点签名…'); const page = await api('/blocks?after=' + cursor);
  check(Array.isArray(page.blocks) && page.blocks.length <= 20, '检查点分页格式无效。');
  const rows = page.blocks.filter((row: any) => row.height <= info.head.height); let previous = cursor === 0 ? genesis.hash : null, time = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], hash = checkpoint(row.checkpoint, row.checkpointSignature);
    check(row.height === cursor + i + 1 && row.checkpoint.height === row.height && row.hash === hash && row.txHash === row.checkpoint.transactionHash, '检查点序号或内容不匹配。');
    check(!previous || row.checkpoint.previousHash === previous, '这一页的检查点哈希链不连续。');
    check(Date.parse(row.checkpoint.timestamp) >= time, '检查点时间逆序。');
    if (row.height === info.head.height) check(row.hash === info.head.hash, '检查点与已读取网络头部不匹配。');
    previous = hash; time = Date.parse(row.checkpoint.timestamp);
  }
  check(rows.length > 0 || info.head.height === 0, '当前页没有应有的检查点。'); after = cursor;
  const list = $('block-list'); list.replaceChildren();
  for (const row of [...rows].reverse()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'block' + (selected === row.txHash ? ' selected' : ''); button.dataset.hash = row.txHash;
    const height = document.createElement('strong'); height.textContent = '#' + row.height;
    const date = document.createElement('time'); date.dateTime = row.checkpoint.timestamp; date.textContent = new Date(row.checkpoint.timestamp).toLocaleString('zh-CN', { hour12: false });
    const hash = document.createElement('code'); hash.textContent = row.txHash;
    button.append(height, date, hash); button.addEventListener('click', () => void run(() => openReceipt(row.txHash))); list.append(button);
  }
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '已验证创世记录，目前还没有交易。'; list.append(empty); }
  text('page-label', rows.length ? (cursor + 1) + '–' + rows.at(-1).height : '0 条'); text('status', '已核对 ' + rows.length + ' 个检查点的签名与页内衔接。选择一笔查看授权和记账。');
}
async function openReceipt(hash: string) {
  check(info && genesis, '请先连接网络。'); check(digest.test(hash), '请输入完整的 96 位十六进制交易哈希。');
  receipt = null; $('receipt').hidden = true; $('detail-empty').hidden = false; text('detail-empty', '正在取得并核对这笔交易…'); text('status', '正在核对收据哈希和签名…');
  const payload = await api('/transactions/' + hash), item = payload.receipt, cp = item?.checkpoint, tx = item?.transaction;
  check(payload.txHash === hash, '返回了另一笔交易。'); checkpoint(cp, item.checkpointSignature);
  check(tx?.chainId === chain && cp.transactionHash === hash && nativeHash(nativeCanonical(tx)) === hash && nativeHash(nativeCanonical(item.postings)) === cp.postingsHash && nativeHash(nativeCanonical(item.result)) === cp.resultHash, '收据内容与签署的哈希不一致。');
  check(Array.isArray(item.postings) && item.postings.every((p: any) => typeof p.account === 'string' && /^(cin1[a-f0-9]{96}|system:[a-z0-9:-]+)$/.test(p.account)), '记账分录格式无效。');
  check(item.postings.reduce((sum: bigint, p: any) => sum + signed(p.deltaAtoms), 0n) === 0n, '记账分录不守恒。');
  let authorization = '系统结算：没有账户授权签名。运营方签名与内容哈希已核对。';
  if (tx.domain === 'cinder.transaction.v1') {
    check(/^cin1[a-f0-9]{96}$/.test(tx.sender), '发送账户格式无效。');
    const account = await api('/accounts/' + tx.sender);
    check(account.address === tx.sender && nativeAddress(account.publicKey) === tx.sender && nativeVerify(tx, item.signature, account.publicKey), '账户公钥绑定或交易授权签名不符。');
    check(Array.isArray(tx.actions), '交易操作格式无效。'); authorization = '运营方检查点、发送账户授权、收据内容哈希与记账守恒均已核对。';
  } else check(['cinder.compute-settlement.v1', 'cinder.channel-expiry.v1'].includes(tx.domain) && item.signature === null, '不支持的系统交易类型。');
  receipt = item; selected = hash; $('detail-empty').hidden = true; $('receipt').hidden = false; text('verification', '✓ ' + authorization);
  text('receipt-hash', hash); text('receipt-time', '#' + cp.height + ' / ' + new Date(cp.timestamp).toLocaleString('zh-CN', { hour12: false }));
  text('receipt-action', tx.actions ? tx.actions.map((action: any) => String(action.type)).join(' · ') : tx.domain);
  text('receipt-budget', tx.maxDebitAtoms !== undefined ? amount(tx.maxDebitAtoms) + ' CINDER' : '—（系统结算）');
  const body = $('postings'); body.replaceChildren();
  for (const posting of item.postings) { const row = document.createElement('tr'), address = document.createElement('td'), value = document.createElement('td'), code = document.createElement('code'); code.textContent = posting.account; address.append(code); const n = signed(posting.deltaAtoms); value.textContent = (n > 0n ? '+' : '') + amount(n); value.className = n < 0n ? 'debit' : 'credit'; row.append(address, value); body.append(row); }
  text('receipt-json', JSON.stringify(item, null, 2)); $<HTMLInputElement>('tx-query').value = hash;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.block')) button.classList.toggle('selected', button.dataset.hash === hash);
  const url = new URL(location.href); url.searchParams.set('tx', hash); history.replaceState(null, '', url);
  text('status', '这笔收据已完成本地签名与内容核对。完整状态重放仍需使用独立审计工具。');
  if (matchMedia('(max-width:690px)').matches) $('detail-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
$('refresh').addEventListener('click', () => void run(initialize)); $('retry').addEventListener('click', () => void run(retry));
$('older').addEventListener('click', () => void run(() => loadPage(Math.max(0, after - 20)))); $('newer').addEventListener('click', () => void run(() => loadPage(after + 20)));
$('search').addEventListener('submit', event => { event.preventDefault(); const hash = $<HTMLInputElement>('tx-query').value.trim().toLowerCase(); void run(() => openReceipt(hash)); });
$('download').addEventListener('click', () => { if (!receipt) return; const blob = new Blob([JSON.stringify({ network: location.origin, genesisHash: genesis.hash, operatorPublicKey: genesis.genesis.operatorPublicKey, receipt }, null, 2) + '\n'], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'cinder-receipt-' + selected.slice(0, 16) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
void run(initialize);
