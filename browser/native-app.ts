import { nativeGenerateKey, nativeSign, nativeVerify, nativeHash, nativeCanonical, nativeAddress, type NativeKey } from '../src/native-crypto.ts';

type TabName = 'transfer' | 'music' | 'agent' | 'trade';
type Account = { address: string; balanceAtoms: string; nonce: number; [key: string]: unknown };
type Receipt = { transaction: any; signature: string | null; checkpoint: any; checkpointSignature: string; postings: { account: string; deltaAtoms: string }[]; result: any };
type DemoAccount = { label: string; wallet: NativeKey; account: Account; before?: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const brief = (value: string, length = 13) => value ? value.slice(0,length) + '…' + value.slice(-8) : '—';
const state: { info: any; wallet: NativeKey | null; account: Account | null; claimed: boolean; busy: boolean; tab: TabName; receipt: Receipt | null; txHash: string; music: DemoAccount[]; trade: DemoAccount[]; recipient: DemoAccount | null; transferTo: string; transferAmount: string; agentInput: string; agentService: string; output: string; pending: any; stopped: boolean; job: string | null; computeContext: {txHash:string;service:string;input:string} | null } = {
  info:null,wallet:null,account:null,claimed:false,busy:false,tab:'transfer',receipt:null,txHash:'',music:[],trade:[],recipient:null,transferTo:'',transferAmount:'0.01',agentInput:'用一句话解释：为什么智能体需要明确的支出预算？',agentService:'inference',output:'',pending:null,stopped:false,job:null,computeContext:null
};

function atoms(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('账本金额格式无效。');
  return BigInt(value);
}
function signedAtoms(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value) || value === '-0') throw new Error('账本变动金额格式无效。');
  return BigInt(value);
}
function format(value: string | bigint): string {
  const n = typeof value === 'bigint' ? value : atoms(value);
  const whole = n / 1000000n, fraction = (n % 1000000n).toString().padStart(6,'0').replace(/0+$/,'');
  return whole.toLocaleString('en-US') + (fraction ? '.' + fraction : '');
}
function parseAmount(value: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.trim())) throw new Error('请输入正数，最多保留六位小数。');
  const [whole, fractional = ''] = value.trim().split('.');
  const n = BigInt(whole) * 1000000n + BigInt(fractional.padEnd(6,'0'));
  if (n <= 0n) throw new Error('转账金额必须大于零。');
  return n.toString();
}
function feeFor(count = 1): bigint { return state.info ? atoms(state.info.feeBaseAtoms) + atoms(state.info.feePerActionAtoms) * BigInt(count) : 0n; }
function accountFrom(data: any): Account {
  const account = data.account || data;
  if (typeof account.address !== 'string' || !Number.isSafeInteger(account.nonce) || account.nonce < 0) throw new Error('账户响应无效。');
  atoms(account.balanceAtoms); return account;
}
async function api(path: string, body?: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(path,{method:body === undefined ? 'GET':'POST',headers:body === undefined ? {}:{'Content-Type':'application/json'},body:body === undefined ? undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal});
    let data: any; try { data = await response.json(); } catch { throw new Error('网络返回了无法识别的内容，请稍后再试。'); }
    if (!response.ok) { const error: any = new Error(data.message || data.error || '请求未能完成。'); error.status = response.status; throw error; }
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError' || error instanceof TypeError) { const failure: any = new Error('连接中断，操作结果尚未确定。请核对原交易，不要重复创建新交易。'); failure.network = true; throw failure; }
    throw error;
  } finally { clearTimeout(timer); }
}
function status(message = '', loading = false): void { $('action-status').innerHTML = (loading ? '<span class="loading-dot" aria-hidden="true"></span>' : '') + esc(message); }
function showError(error: unknown): void { $('action-error').textContent = error instanceof Error ? error.message : String(error); $('action-error').hidden = false; }
function clearError(): void { $('action-error').hidden = true; $('action-error').textContent = ''; }
function toast(message: string): void { document.querySelector('.toast')?.remove(); const item = document.createElement('div'); item.className='toast'; item.setAttribute('role','status'); item.textContent=message; document.body.append(item); setTimeout(()=>item.remove(),3000); }
async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); toast('已复制公开地址'); }
  catch { showError('剪贴板不可用。可从账户地址栏选择并复制公开地址。'); }
}
function lock(value: boolean): void {
  state.busy=value;
  for (const el of document.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('.workspace button,.workspace input,.workspace textarea,.workspace select')) el.disabled=value;
  if (!value) {
    ($('create-wallet') as HTMLButtonElement).disabled=!state.info || !!state.wallet;
    ($('claim') as HTMLButtonElement).disabled=!state.wallet || state.claimed || !!state.pending || !!state.job || state.stopped;
    const run=$<HTMLButtonElement>('app-run'); if (run) run.disabled=!state.wallet || !state.info || !!state.pending || !!state.job || state.stopped;
    const demo=$<HTMLButtonElement>('create-recipient'); if (demo) demo.disabled=!state.wallet || !!state.pending || state.stopped;
  }
  $('workspace').setAttribute('aria-busy',String(value));
}
function renderWallet(): void {
  $('balance').textContent=state.account ? format(state.account.balanceAtoms) : '—';
  $('nonce').textContent=state.account ? String(state.account.nonce) : '—';
  $('balance-caption').textContent=state.account ? '实际开发币余额 · 无现金价值' : '创建账户后显示真实开发币余额';
  $('create-wallet').hidden=!!state.wallet;
  $('claim').hidden=!state.wallet || state.claimed;
  $('wallet-address').hidden=!state.wallet;
  if (state.wallet) {
    $('copy-address').textContent=brief(state.wallet.address,22)+'  ↗';
    $('copy-address').title=state.wallet.address;
    $('copy-address').setAttribute('aria-label','复制完整公开地址 '+state.wallet.address);
    $('wallet-note').innerHTML=state.claimed ? '已领取开发币。现在可以签署应用操作。<br>密钥仅在内存中；刷新或关闭本页会失去访问权限。' : '账户已创建。点击领取按钮，才会转入开发币。<br>密钥仅在内存中；刷新或关闭本页会失去访问权限。';
  }
}
async function registerWallet(): Promise<{wallet:NativeKey;account:Account}> {
  const wallet=nativeGenerateKey();
  const proof=nativeSign({domain:'cinder.account.v1',chainId:state.info.chainId,publicKey:wallet.publicKey},wallet.secretKey);
  const account=accountFrom(await api('/api/native/accounts',{publicKey:wallet.publicKey,proof}));
  if (account.address!==wallet.address) throw new Error('服务器账户地址与本地公钥不匹配。');
  return {wallet,account};
}
async function refreshAccount(): Promise<void> {
  if (!state.wallet) return;
  const account=accountFrom(await api('/api/native/accounts/'+encodeURIComponent(state.wallet.address)));
  if (account.address!==state.wallet.address) throw new Error('返回的账户与本地钱包不匹配。');
  state.account=account; renderWallet();
}

function renderPanel(): void {
  const fee=format(feeFor());
  $('app-panel').setAttribute('aria-labelledby','tab-'+state.tab);
  if (state.tab==='transfer') {
    $('app-panel').innerHTML=`<p class="panel-intro">在 Cinder 账户之间转移原生开发币。收款地址必须属于此网络；不接受其他链的地址。</p><form id="transfer-form"><label class="field"><span>收款账户 <small>CINDER ADDRESS</small></span><input id="transfer-to" type="text" value="${esc(state.transferTo)}" placeholder="cin1… 输入完整公开地址" autocomplete="off" required spellcheck="false"></label><div class="cost-line"><span>${state.recipient ? '测试账户已在网络注册 · ' + esc(brief(state.recipient.wallet.address)) : '还没有测试收款账户？'}</span><button class="inline-button" type="button" id="create-recipient">${state.recipient ? '填入测试账户' : '创建一个'}</button></div><label class="field"><span>转账金额 <small>CINDER / DEVNET</small></span><input id="transfer-amount" type="text" inputmode="decimal" value="${esc(state.transferAmount)}" required autocomplete="off"></label><div class="cost-line"><span>另计网络费</span><strong>${fee} CINDER</strong></div><button id="app-run" class="button primary app-action" type="submit">签名并转账 <span>↗</span></button><p class="panel-note">${state.wallet ? '请核对金额和地址。交易提交后，余额按实际账本更新。' : '先在左侧创建钱包并领取开发币。'}</p></form>`;
    $('transfer-form').addEventListener('submit',e=>{e.preventDefault();void performTransfer();});
    $('create-recipient').addEventListener('click',()=>void createRecipient());
  } else if (state.tab==='music') {
    const names=['录音权益','词曲权益','服务份额'];
    $('app-panel').innerHTML=`<p class="panel-intro">把 0.01 CINDER 分配给三个真实创建的<strong>演示账户</strong>。70 / 20 / 10 是本次实验设定，不代表任何实际作品的权利比例。</p><div class="split-roles">${names.map((name,i)=>`<article class="role-card"><span class="role-index">DEMO / 0${i+1}</span><h3>${name}</h3><strong>${[70,20,10][i]}<small>%</small></strong><p>${state.music[i] ? esc(brief(state.music[i].wallet.address,7)) : '操作时创建账户'}</p>${state.music[i]?.before!==undefined ? `<div class="split-change"><span>前 ${format(state.music[i].before!)}</span><span>后 ${format(state.music[i].account.balanceAtoms)}</span></div>`:''}</article>`).join('')}</div><div class="cost-line"><span>总分配 / 网络费</span><strong>0.01 + ${fee} CINDER</strong></div><button id="app-run" class="button primary" type="button">签名并执行音乐分配 <span>↗</span></button><p class="panel-note">分配额精确守恒：0.007 + 0.002 + 0.001 = 0.01 CINDER。网络费另计。此操作不触发 HEARD 艺术家支付。</p>`;
    $('app-run').addEventListener('click',()=>void performMusic());
  } else if (state.tab==='agent') {
    const service=state.info?.services?.find((s:any)=>s.id===state.agentService);
    const serviceCost=service ? format(service.amountAtoms) : '—';
    $('app-panel').innerHTML=`<p class="panel-intro">让账户为一次计算付费。请求哈希、费用和结果被绑定到网络收据；推理结果由运营方出具，不是模型执行的零知识证明。</p><label class="field"><span>计算服务 <small>FIXED NATIVE PRICE</small></span><select id="agent-service"><option value="inference" ${state.agentService==='inference'?'selected':''}>Meta Llama · 短文本推理</option><option value="hash" ${state.agentService==='hash'?'selected':''}>SHA-384 · 确定性哈希</option></select></label><label class="field"><span>请求内容 <small>最多 1,200 字符</small></span><textarea id="agent-input" maxlength="1200" rows="3" spellcheck="false">${esc(state.agentInput)}</textarea></label><div class="cost-line"><span>计算费 / 网络费</span><strong>${serviceCost} + ${fee} CINDER</strong></div><button id="app-run" class="button primary" type="button">签名并支付计算 <span>↗</span></button><p class="panel-note">输入会发送至服务端；计算输出公开、永久留存。只使用非敏感测试内容。服务失败显示退款结果。</p>${state.output?`<div class="job-result"><span>VERIFIED RECEIPT / OUTPUT</span><pre>${esc(state.output)}</pre></div>`:''}`;
    $('agent-service').addEventListener('change',()=>{state.agentInput=$<HTMLTextAreaElement>('agent-input').value;state.agentService=$<HTMLSelectElement>('agent-service').value;renderPanel();});
    $('app-run').addEventListener('click',()=>void performAgent());
  } else {
    $('app-panel').innerHTML=`<p class="panel-intro">测试交易应用的批量结算能力：三笔小额转账与一笔使用费分配，作为同一笔签名交易提交。<strong>没有交易对、订单撮合或真实成交。</strong></p><div class="batch-list"><div><span>三笔演示转账 → 应用账户</span><strong>3 × 0.001 CINDER</strong></div><div><span>使用费 → 三个演示服务账户</span><strong>0.001 CINDER</strong></div><div><span>4 个动作的网络费</span><strong>${format(feeFor(4))} CINDER</strong></div>${state.trade.map(item=>`<div><span>${esc(item.label)}</span><strong>${item.before!==undefined ? format(item.before)+' → ' : ''}${format(item.account.balanceAtoms)}</strong></div>`).join('')}</div><button id="app-run" class="button primary" type="button">签名并执行批次 <span>↗</span></button><p class="panel-note">批次引用包含使用记录哈希。此处只验证开发币转移与费用分配，不连接券商，不代表交易所已上线。</p>`;
    $('app-run').addEventListener('click',()=>void performTrade());
  }
  lock(state.busy);
}

function verifyReceipt(receipt: Receipt, expected?: any): string {
  if (!receipt || !Array.isArray(receipt.postings) || !receipt.checkpoint || !receipt.transaction) throw new Error('网络收据不完整，已暂停操作。');
  const checkpoint=receipt.checkpoint;
  if (checkpoint.domain!=='cinder.checkpoint.v1'||checkpoint.chainId!==state.info.chainId||!Number.isSafeInteger(checkpoint.height)||checkpoint.height<1||!Number.isFinite(Date.parse(checkpoint.timestamp))) throw new Error('检查点字段无效。');
  if (!nativeVerify(checkpoint,receipt.checkpointSignature,state.info.signer.publicKey)) throw new Error('检查点 ML-DSA-65 签名验证失败。');
  const hash=nativeHash(nativeCanonical(receipt.transaction));
  if (checkpoint.transactionHash!==hash||checkpoint.postingsHash!==nativeHash(nativeCanonical(receipt.postings))||checkpoint.resultHash!==nativeHash(nativeCanonical(receipt.result))) throw new Error('交易、账本变动或结果与已签名检查点不一致。');
  const sum=receipt.postings.reduce((total,posting)=>total+signedAtoms(posting.deltaAtoms),0n);
  if (sum!==0n) throw new Error('账本变动不守恒，已暂停操作。');
  if (expected) {
    if (nativeCanonical(receipt.transaction)!==nativeCanonical(expected.transaction)||receipt.signature!==expected.signature||!nativeVerify(receipt.transaction,receipt.signature!,state.wallet!.publicKey)) throw new Error('网络收据与本地授权的交易不一致。');
  }
  if (checkpoint.height>=state.info.head.height) { state.info.head={height:checkpoint.height,hash:nativeHash(nativeCanonical(checkpoint))};$('height').textContent='# '+checkpoint.height.toLocaleString('en-US'); }
  return hash;
}
function displayReceipt(receipt: Receipt, hash: string): void {
  state.receipt=receipt;state.txHash=hash;
  const isSystem=receipt.transaction.domain==='cinder.compute-settlement.v1';
  const own=receipt.postings.filter(p=>p.account===state.wallet!.address).reduce((total,p)=>total+signedAtoms(p.deltaAtoms),0n);
  const signedDisplay=(own<0n?'−':'+')+format(own<0n?-own:own);
  $('receipt-content').className='receipt-card';
  $('receipt-content').innerHTML=`<div class="receipt-top"><span class="verified-status">${isSystem?'运营方计算结算签名已验证':'账户与网络签名已验证'}</span><span>CHECKPOINT #${receipt.checkpoint.height}</span></div><div class="receipt-grid"><dl><dt>交易哈希 / SHA-384</dt><dd>${esc(hash)}</dd></dl><dl><dt>${isSystem?'本次结算账户变动':'本次交易账户变动'}</dt><dd>${signedDisplay} CINDER<br>${receipt.postings.length} 条账本变动 · 总和为 0</dd></dl><dl><dt>检查点时间</dt><dd>${esc(new Date(receipt.checkpoint.timestamp).toLocaleString('zh-CN'))}<br>${esc(brief(state.info.signer.address))}</dd></dl></div><div class="receipt-bottom">已在浏览器验证 ML-DSA-65 检查点签名，以及交易、变动和结果的哈希。${isSystem?'此收据由单一运营方出具；它不证明 Llama 运行正确。':'检查点来自单一运营方，不代表独立验证者共识。'} 公开收据不含私钥。</div>`;
  $<HTMLButtonElement>('export-receipt').disabled=false;
}
function appendReconcile(): void {
  const button=document.createElement('button');button.className='button secondary compact';button.style.marginTop='12px';button.textContent=state.job?'核对计算结果':'核对原交易';button.addEventListener('click',()=>void reconcile());$('action-status').append(button);
}
async function commit(actions: any[], spend: bigint, computeInput?: string): Promise<any> {
  if (!state.wallet||!state.account) throw new Error('请先创建本地钱包并领取开发币。');
  if (state.pending||state.job) throw new Error('请先核对尚未确定的原交易。');
  if (state.stopped) throw new Error('此钱包因收据验证异常已暂停。');
  await refreshAccount();
  if (atoms(state.account!.balanceAtoms)<spend) throw new Error('余额不足：此次操作需要 '+format(spend)+' CINDER（含网络费）。');
  const transaction={domain:'cinder.transaction.v1',chainId:state.info.chainId,sender:state.wallet.address,nonce:state.account!.nonce+1,validUntil:new Date(Date.now()+120000).toISOString(),maxDebitAtoms:spend.toString(),actions};
  const signature=nativeSign(transaction,state.wallet.secretKey);
  const payload={transaction,signature,...(computeInput===undefined?{}:{computeInput})};
  state.pending=payload;if(actions[0]?.type==='compute')state.computeContext={txHash:nativeHash(nativeCanonical(transaction)),service:actions[0].service,input:computeInput!};status('账户已签名，正在提交到原生网络…',true);
  const response=await api('/api/native/submit',payload);
  let txHash:string;
  try { txHash=verifyReceipt(response.receipt,payload); if(response.txHash!==txHash) throw new Error('返回的交易哈希与本地授权不一致。'); }
  catch(error){state.stopped=true;throw error;}
  const account=accountFrom(response);if(account.address!==state.wallet.address)throw new Error('交易响应中的账户不匹配。');
  state.account=account;state.pending=null;renderWallet();displayReceipt(response.receipt,txHash);
  if(actions[0]?.type==='faucet'){state.claimed=true;renderWallet();}
  if(actions[0]?.type==='compute'){state.job=txHash;}
  return response;
}
async function action(work:()=>Promise<void>): Promise<void> {
  if(state.busy)return;clearError();status();lock(true);
  try { await work(); }
  catch(error:any){
    if(error.status && ![409,429].includes(error.status))state.pending=null;
    showError(error);status(state.stopped?'验证异常：此钱包已暂停签署。':state.pending||state.job?'操作结果尚未确定，请核对原交易。':'本次操作没有获得已验证的成功结果。');
    if((state.pending||state.job)&&!state.stopped)appendReconcile();
  }finally{lock(false);}
}
async function createRecipient(): Promise<void> { await action(async()=>{
  if(!state.recipient){status('正在创建独立测试收款账户…',true);const created=await registerWallet();state.recipient={label:'测试收款账户',...created};}
  state.transferTo=state.recipient.wallet.address;renderPanel();status('已填入真实注册的开发网络地址。此账户未领取开发币。');
}); }
async function performTransfer(): Promise<void> { await action(async()=>{
  state.transferTo=$<HTMLInputElement>('transfer-to').value.trim();state.transferAmount=$<HTMLInputElement>('transfer-amount').value.trim();
  if(!/^cin1[0-9a-f]{96}$/.test(state.transferTo))throw new Error('请输入完整 Cinder 地址：cin1 后接 96 个十六进制字符。');
  const amountAtoms=parseAmount(state.transferAmount);
  await commit([{type:'transfer',to:state.transferTo,amountAtoms}],atoms(amountAtoms)+feeFor());
  status('转账已入账，账户签名、检查点和账本守恒均已验证。');
}); }
async function ensureDemoAccounts(type:'music'|'trade'):Promise<DemoAccount[]> {
  const names=type==='music'?['录音权益演示','词曲权益演示','服务份额演示']:['应用服务演示','数据服务演示','记录服务演示'];
  const group=state[type];
  for(let i=group.length;i<3;i++){status('正在注册第 '+(i+1)+' 个演示账户…',true);const created=await registerWallet();group.push({label:names[i],...created});}
  for(const item of group){item.account=accountFrom(await api('/api/native/accounts/'+item.wallet.address));item.before=item.account.balanceAtoms;}
  return group;
}
async function refreshDemoAccounts(group:DemoAccount[]):Promise<void>{for(const item of group)item.account=accountFrom(await api('/api/native/accounts/'+item.wallet.address));}
async function performMusic():Promise<void>{await action(async()=>{
  const group=await ensureDemoAccounts('music');
  const referenceHash=nativeHash('Cinder portal music allocation demo; recording/composition/service; one verified usage simulation.');
  await commit([{type:'split',recipients:group.map((item,i)=>({address:item.wallet.address,bps:[7000,2000,1000][i]})),amountAtoms:'10000',app:'music',referenceHash,units:1}],10000n+feeFor());
  await refreshDemoAccounts(group);renderPanel();status('0.01 CINDER 已按 70 / 20 / 10 分配。卡片显示三个演示账户的实际前后余额。');
});}
async function performTrade():Promise<void>{await action(async()=>{
  const group=await ensureDemoAccounts('trade');
  const referenceHash=nativeHash('Cinder trading application devnet example: three transfers and service fee allocation; no matching or executed orders.');
  const actions=[...Array.from({length:3},()=>({type:'transfer',to:group[0].wallet.address,amountAtoms:'1000'})),{type:'split',recipients:group.map((item,i)=>({address:item.wallet.address,bps:[7000,2000,1000][i]})),amountAtoms:'1000',app:'trade',referenceHash,units:3}];
  await commit(actions,4000n+feeFor(4));await refreshDemoAccounts(group);renderPanel();status('四个动作已提交并核对。显示的是开发币转移与费用分配，没有订单成交。');
});}
async function pollJob(txHash:string):Promise<void>{
  const started=Date.now();
  while(Date.now()-started<85000){
    status('计算请求已入账，正在等待运营方完成计算…',true);
    const job=await api('/api/native/jobs/'+encodeURIComponent(txHash));
    if(job.status==='pending'){await new Promise(resolve=>setTimeout(resolve,1800));continue;}
    if(!['complete','failed'].includes(job.status)||!job.receipt)throw new Error('计算结算响应无效，请核对原交易。');
    const final=job.receipt;
    let hash:string;
    try{
      hash=verifyReceipt(final);
      if(final.transaction.domain!=='cinder.compute-settlement.v1'||final.transaction.chainId!==state.info.chainId||final.transaction.requestTxHash!==txHash||final.result.requestTxHash!==txHash||final.transaction.status!==job.status||final.result.status!==job.status||final.signature!==null)throw new Error('计算结算未绑定原始请求。');
      if(job.status==='complete'){
        const output=job.output??final.result.output;
        if(!state.computeContext||state.computeContext.txHash!==txHash||final.result.service!==state.computeContext.service)throw new Error('计算结果服务与原请求不匹配。');
        if(typeof output!=='string'||final.transaction.outputHash!==nativeHash(output)||final.result.output!==output)throw new Error('计算输出与已签名的结果哈希不一致。');
        if(state.computeContext.service==='hash'&&output!==nativeHash(state.computeContext.input))throw new Error('独立 SHA-384 重算验证失败。');
        state.output=output;
      }
    }catch(error){state.stopped=true;throw error;}
    state.job=null;displayReceipt(final,hash);await refreshAccount();renderPanel();
    status(job.status==='complete'?'计算完成。运营方检查点及输出哈希已验证；这不是模型执行证明。':'计算服务未能完成。退款 '+format(String(final.result.refundAtoms??job.refundAtoms??'0'))+' CINDER，已核对账户余额。');
    return;
  }
  status('计算仍在处理中。请稍后核对这个请求；不会创建第二笔计算费用。');appendReconcile();
}
async function performAgent():Promise<void>{await action(async()=>{
  state.agentInput=$<HTMLTextAreaElement>('agent-input').value;state.agentService=$<HTMLSelectElement>('agent-service').value;state.output='';
  if(!state.agentInput.trim()||state.agentInput.length>1200)throw new Error('请输入 1 到 1,200 个字符的非敏感测试内容。');
  const service=state.info.services.find((s:any)=>s.id===state.agentService);if(!service)throw new Error('这个计算服务当前不可用。');
  const response=await commit([{type:'compute',service:state.agentService,inputHash:nativeHash(state.agentInput)}],atoms(service.amountAtoms)+feeFor(),state.agentInput);
  await pollJob(response.txHash);
});}
async function reconcile():Promise<void>{await action(async()=>{
  if(state.job){await pollJob(state.job);return;}
  if(!state.pending){status('没有需要核对的交易。');return;}
  const pending=state.pending;const response=await api('/api/native/submit',pending);
  const hash=verifyReceipt(response.receipt,pending);if(response.txHash!==hash)throw new Error('原交易哈希不匹配。');
  state.account=accountFrom(response);state.pending=null;
  if(pending.transaction.actions[0]?.type==='faucet')state.claimed=true;
  displayReceipt(response.receipt,hash);renderWallet();
  if(pending.transaction.actions[0]?.type==='compute'){state.job=hash;await pollJob(hash);}
  else {await refreshDemoAccounts(state.music);await refreshDemoAccounts(state.trade);renderPanel();status('原交易已恢复并验证，没有创建重复交易。');}
});}

$('create-wallet').addEventListener('click',()=>void action(async()=>{
  status('正在本地生成 ML-DSA-65 密钥并注册公钥…',true);
  const created=await registerWallet();state.wallet=created.wallet;state.account=created.account;renderWallet();renderPanel();status('原生账户已注册。密钥未发送至服务器；领取开发币后即可体验应用。');
}));
$('claim').addEventListener('click',()=>void action(async()=>{await commit([{type:'faucet'}],0n);renderPanel();status('100 CINDER 开发币已入账。来源是有限创世分配，不是有现金价值的资产。');}));
$('copy-address').addEventListener('click',()=>{if(state.wallet)void copy(state.wallet.address);});
for(const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){
  tab.addEventListener('click',()=>{
    if(state.busy)return;
    if(state.tab==='transfer'&&$('transfer-to')){state.transferTo=$<HTMLInputElement>('transfer-to').value;state.transferAmount=$<HTMLInputElement>('transfer-amount').value;}
    if(state.tab==='agent'&&$('agent-input'))state.agentInput=$<HTMLTextAreaElement>('agent-input').value;
    state.tab=tab.dataset.tab as TabName;
    for(const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){other.setAttribute('aria-selected',String(other===tab));other.tabIndex=other===tab?0:-1;}
    renderPanel();clearError();if(!state.pending&&!state.job)status();
  });
  tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];const index=tabs.indexOf(tab);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();});
}
$('export-receipt').addEventListener('click',()=>{
  if(!state.receipt)return;
  const bundle={format:'cinder-native-receipt-v1',network:state.info.chainId,notice:'Native devnet; no monetary value; single operator checkpoint. No private keys included.',signer:state.info.signer,accountPublicKey:state.wallet?.publicKey,txHash:state.txHash,receipt:state.receipt};
  const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='cinder-native-'+state.txHash.slice(0,16)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('公开收据已导出，不含私钥');
});

async function init():Promise<void>{
  renderPanel();
  try{
    if(!window.isSecureContext||!crypto.getRandomValues)throw new Error('请通过 HTTPS 或本机开发地址打开，以使用安全随机数和浏览器签名。');
    const info=await api('/api/native/info');
    if(info.chainId!=='cinder-devnet-1'||info.symbol!=='CINDER'||info.decimals!==6||info.consensus!=='single-operator-devnet'||!info.signer?.publicKey||nativeAddress(info.signer.publicKey)!==info.signer.address||!Number.isSafeInteger(info.head?.height))throw new Error('原生网络信息未通过校验。');
    atoms(info.supplyAtoms);atoms(info.feeBaseAtoms);atoms(info.feePerActionAtoms);
    if(!Array.isArray(info.services)||!info.services.every((s:any)=>typeof s.id==='string'&&atoms(s.amountAtoms)>=0n))throw new Error('计算服务目录无效。');
    state.info=info;$('supply').textContent=format(info.supplyAtoms)+' CINDER';$('height').textContent='# '+info.head.height.toLocaleString('en-US');$('fee').textContent=format(feeFor())+' CINDER';$('chain').textContent=info.chainId;
    $('connection').className='connection ready';$('connection').textContent='网络已连接';renderPanel();lock(false);
  }catch(error){$('connection').className='connection failed';$('connection').textContent='连接不可用';showError(error);status('请刷新页面重新连接。所有余额与网络数据只在服务器验证后显示。');}
}
void init();
