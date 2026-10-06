import { nativeGenerateKey, nativeSign, nativeVerify, nativeHash, nativeCanonical, nativeAddress, nativeBase64url, type NativeKey } from '../src/native-crypto.ts';

import { encryptWallet, decryptWallet } from './wallet-vault.ts';
import { quoteWork, quoteSwap, quoteAddLiquidity, quoteRemoveLiquidity } from '../src/native-economy.ts';

type TabName = 'transfer' | 'music' | 'agent' | 'trade';
type Account = { address: string; balanceAtoms: string; nonce: number; [key: string]: unknown };
type Receipt = { transaction: any; signature: string | null; checkpoint: any; checkpointSignature: string; postings: { account: string; deltaAtoms: string }[]; result: any };
type DemoAccount = { label: string; wallet: NativeKey; account: Account; before?: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const brief = (value: string, length = 13) => value ? value.slice(0,length) + '…' + value.slice(-8) : '—';
const state: { info: any; wallet: NativeKey | null; account: Account | null; claimed: boolean; busy: boolean; tab: TabName; receipt: Receipt | null; txHash: string; music: DemoAccount[]; trade: DemoAccount[]; recipient: DemoAccount | null; transferTo: string; transferAmount: string; agentInput: string; agentService: string; output: string; pending: any; stopped: boolean; job: string | null; computeContext: {txHash:string;service:string;input:string} | null; backedUp:boolean; catalog:any[]; catalogNext:string|null; catalogLoaded:boolean; catalogLoading:boolean; catalogError:string; playbacks:Record<string,{url:string;expiresAt:number}>; musicMode:'library'|'publish'; upload:any; economy:any; economyError:string; economyMode:string; economyDraft:Record<string,string>; economyPreview:any } = {
  info:null,wallet:null,account:null,claimed:false,busy:false,tab:'music',receipt:null,txHash:'',music:[],trade:[],recipient:null,transferTo:'',transferAmount:'0.01',agentInput:'用一句话解释：为什么智能体需要明确的支出预算？',agentService:'inference',output:'',pending:null,stopped:false,job:null,computeContext:null,backedUp:false,catalog:[],catalogNext:null,catalogLoaded:false,catalogLoading:false,catalogError:'',playbacks:{},musicMode:'library',upload:null,economy:null,economyError:'',economyMode:'swap',economyDraft:{workUnits:'100',assetIn:'CINDER',amountIn:'0.001',maxCinder:'0.01',maxWork:'100',lpUnits:'1',slippage:'100',redeemInput:'Hello, Cinder.'},economyPreview:null
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
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-native-action]'))button.disabled=!state.wallet||!!state.pending||!!state.job||state.stopped;
    const restore=$<HTMLButtonElement>('restore-form')?.querySelector('button');if(restore)restore.disabled=!!state.pending||!!state.job;
    if(!state.economyPreview&&state.tab==='trade'){const submit=$<HTMLButtonElement>('app-run');if(submit)submit.disabled=true;}
  }
  $('workspace').setAttribute('aria-busy',String(value));
}
function renderWallet(): void {
  $('balance').textContent=state.account ? format(state.account.balanceAtoms) : '—';
  $('nonce').textContent=state.account ? String(state.account.nonce) : '—';
  $('balance-caption').textContent=state.account ? '实际开发币余额 · 无现金价值' : '创建账户后显示真实开发币余额';
  $('create-wallet').hidden=!!state.wallet;
  $('claim').hidden=!state.wallet || state.claimed;
  $('wallet-address').hidden=!state.wallet;$('backup-tools').hidden=!state.wallet;
  if (state.wallet) {
    $('copy-address').textContent=brief(state.wallet.address,22)+'  ↗';
    $('copy-address').title=state.wallet.address;
    $('copy-address').setAttribute('aria-label','复制完整公开地址 '+state.wallet.address);
    $('wallet-note').textContent=state.backedUp?'已下载加密备份。请分别保管备份文件与密码；以后可以恢复同一账户。':'请先下载加密备份。密钥仅在内存中，未备份时刷新或关闭页面会失去账户访问权限。';
  }
}
async function registerWallet(wallet:NativeKey=nativeGenerateKey()): Promise<{wallet:NativeKey;account:Account}> {
  const proof=nativeSign({domain:'cinder.account.v1',chainId:state.info.chainId,publicKey:wallet.publicKey},wallet.secretKey);
  const account=accountFrom(await api('/api/native/accounts',{publicKey:wallet.publicKey,proof}));
  if (account.address!==wallet.address) throw new Error('服务器账户地址与本地公钥不匹配。');
  return {wallet,account};
}
async function refreshAccount(): Promise<void> {
  if (!state.wallet) return;
  const account=accountFrom(await api('/api/native/accounts/'+encodeURIComponent(state.wallet.address)));
  if (account.address!==state.wallet.address) throw new Error('返回的账户与本地钱包不匹配。');
  state.account=account;state.claimed=account.claimedFaucet===true||state.claimed; renderWallet();
}

function renderPanel(): void {
  const fee=format(feeFor());
  $('app-panel').setAttribute('aria-labelledby','tab-'+state.tab);
  if (state.tab==='transfer') {
    $('app-panel').innerHTML=`<p class="panel-intro">在 Cinder 账户之间转移原生开发币。收款地址必须属于此网络；不接受其他链的地址。</p><form id="transfer-form"><label class="field"><span>收款账户 <small>CINDER ADDRESS</small></span><input id="transfer-to" type="text" value="${esc(state.transferTo)}" placeholder="cin1… 输入完整公开地址" autocomplete="off" required spellcheck="false"></label><p class="panel-note">请由收款人提供已注册的完整公开地址。转账不会创建虚构的收款人。</p><label class="field"><span>转账金额 <small>CINDER / DEVNET</small></span><input id="transfer-amount" type="text" inputmode="decimal" value="${esc(state.transferAmount)}" required autocomplete="off"></label><div class="cost-line"><span>另计网络费</span><strong>${fee} CINDER</strong></div><button id="app-run" class="button primary app-action" type="submit">签名并转账 <span>↗</span></button><p class="panel-note">${state.wallet ? '请核对金额和地址。交易提交后，余额按实际账本更新。' : '先在左侧创建钱包并领取开发币。'}</p></form>`;
    $('transfer-form').addEventListener('submit',e=>{e.preventDefault();void performTransfer();});
  } else if (state.tab==='music') {
    renderMusicPanel();
  } else if (state.tab==='agent') {
    const service=state.info?.services?.find((s:any)=>s.id===state.agentService);
    const serviceCost=service ? format(service.amountAtoms) : '—';
    $('app-panel').innerHTML=`<p class="panel-intro">让账户为一次计算付费。请求哈希、费用和结果被绑定到网络收据；推理结果由运营方出具，不是模型执行的零知识证明。</p><label class="field"><span>计算服务 <small>FIXED NATIVE PRICE</small></span><select id="agent-service"><option value="inference" ${state.agentService==='inference'?'selected':''}>Meta Llama · 短文本推理</option><option value="hash" ${state.agentService==='hash'?'selected':''}>SHA-384 · 确定性哈希</option></select></label><label class="field"><span>请求内容 <small>最多 1,200 字符</small></span><textarea id="agent-input" maxlength="1200" rows="3" spellcheck="false">${esc(state.agentInput)}</textarea></label><div class="cost-line"><span>计算费 / 网络费</span><strong>${serviceCost} + ${fee} CINDER</strong></div><button id="app-run" class="button primary" type="button">签名并支付计算 <span>↗</span></button><p class="panel-note">输入会发送至服务端；计算输出公开、永久留存。只使用非敏感测试内容。服务失败显示退款结果。</p>${state.output?`<div class="job-result"><span>VERIFIED RECEIPT / OUTPUT</span><pre>${esc(state.output)}</pre></div>`:''}`;
    $('agent-service').addEventListener('change',()=>{state.agentInput=$<HTMLTextAreaElement>('agent-input').value;state.agentService=$<HTMLSelectElement>('agent-service').value;renderPanel();});
    $('app-run').addEventListener('click',()=>void performAgent());
  } else {
    renderEconomyPanel();
  }
  lock(state.busy);
}

function randomHex(bytes=16):string{return [...crypto.getRandomValues(new Uint8Array(bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function binaryHash(data:Uint8Array):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-384',new Uint8Array(data).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function loadCatalog(append=false):Promise<void>{
  if(state.catalogLoading)return;state.catalogLoading=true;state.catalogError='';
  try{
    const data=await api('/api/native/music/catalog'+(append&&state.catalogNext?'?after='+encodeURIComponent(state.catalogNext):''));
    if(!Array.isArray(data.tracks)||!data.tracks.every((track:any)=>typeof track.title==='string'&&typeof track.artist==='string'&&/^[a-f0-9]{96}$/.test(track.trackId)&&/^[a-f0-9]{96}$/.test(track.audioHash)&&atoms(track.priceAtoms)>=0n))throw new Error('音乐目录格式无效。');
    state.catalog=append?[...state.catalog,...data.tracks.filter((t:any)=>!state.catalog.some(old=>old.trackId===t.trackId))]:data.tracks;
    state.catalogNext=typeof data.next==='string'?data.next:null;state.catalogLoaded=true;
  }catch(error:any){state.catalogError=error.message;}finally{state.catalogLoading=false;if(state.tab==='music'&&state.musicMode==='library')renderPanel();}
}
async function loadEconomy():Promise<void>{
  state.economyError='';
  try{
    const data=await api('/api/native/economy'+(state.wallet?'?address='+encodeURIComponent(state.wallet.address):''));
    if(!data.state?.pool||!data.offer)throw new Error('市场状态格式无效。');
    for(const n of [data.state.pool.cinderAtoms,data.state.pool.workUnits,data.state.pool.lpSupply,data.offer.priceAtoms??data.offer.priceCinderAtoms])atoms(n);
    state.economy={...data,wallet:data.wallet||{workUnits:'0',lpUnits:'0'}};
  }catch(error:any){state.economyError=error.message;}
  if(state.tab==='trade')renderPanel();
}
async function refreshServices():Promise<void>{await Promise.all([loadCatalog(),loadEconomy()]);}
function renderMusicPanel():void{
  const publish=state.musicMode==='publish';
  let body=`<div class="music-toolbar"><p>你的作品，直接在原生网络定价和分配。</p><div><button class="mode-button ${!publish?'selected':''}" id="music-library" type="button">音乐库</button><button class="mode-button ${publish?'selected':''}" id="music-publish" type="button">发布作品 ＋</button></div></div>`;
  if(publish){
    body+=`<form id="music-publish-form"><div class="form-pair"><label class="field"><span>作品名称</span><input id="music-title" maxlength="120" required placeholder="作品标题"></label><label class="field"><span>创作者</span><input id="music-artist" maxlength="80" required placeholder="公开显示的名字"></label></div><label class="field"><span>上传音频 <small>MP3 / WAV / OGG · 最大 4 MiB</small></span><input id="music-file" type="file" accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg" required></label><label class="field"><span>每次访问价格 <small>CINDER / 1 小时访问权</small></span><input id="music-price" type="text" inputmode="decimal" value="0.01" required></label><details class="split-options"><summary>自定义收入分配 <span>默认：当前账户 100%</span></summary><label class="field"><span>每行：完整地址 + 比例基点</span><textarea id="music-splits" rows="3" placeholder="cin1… 7000&#10;cin1… 3000" spellcheck="false"></textarea></label><p class="panel-note">最多 8 个已注册账户，总和 10,000 基点。100 基点 = 1%。发布后该作品的分配不可更改。</p></details><label class="rights-check"><input id="music-rights" type="checkbox" required><span>我拥有或已获授权公开分发这段音频，并确认所列收入分配。权利声明会写入公开收据。</span></label><div class="cost-line"><span>上传完成后签名发布 · 网络费</span><strong>${format(feeFor())} CINDER</strong></div><button id="app-run" data-native-action class="button primary" type="submit">上传并签名发布 <span>↗</span></button><p class="panel-note">音频通过付费访问接口提供；作品元数据与交易公开留存。权利声明来自发布者，不是平台对版权的认证。</p></form>`;
  }else{
    body+=state.catalogError?`<div class="notice error">${esc(state.catalogError)}</div>`:'';
    if(!state.catalogLoaded||state.catalogLoading)body+='<div class="library-empty"><span class="loading-dot"></span>正在读取原生音乐库…</div>';
    else if(!state.catalog.length)body+='<div class="library-empty"><span class="library-glyph">♫</span><h3>第一首作品，等你发布。</h3><p>这里展示实际上传的作品。发布音频、设定价格，收听支付会按你声明的比例分配。</p></div>';
    else body+='<div class="track-list">'+state.catalog.map((track,index)=>{
      const access=state.playbacks[track.trackId],live=access&&access.expiresAt>Date.now();
      return `<article class="track"><div class="track-art" aria-hidden="true">♫</div><div class="track-main"><h3>${esc(track.title)}</h3><p>${esc(track.artist)} <span>· ${esc(track.mime.replace('audio/','').toUpperCase())}</span></p><span class="track-price">${format(track.priceAtoms)} CINDER / 访问</span></div><button class="button secondary compact" data-track="${index}" data-native-action type="button">${live?'已购买访问 ✓':'支付并收听 ↗'}</button>${live?`<div class="track-player"><audio controls preload="none" src="${esc(access.url)}"></audio><span>本次访问权一小时有效；播放器由你手动开始。</span></div>`:''}<details class="track-proof"><summary>作品与分配</summary><p>发布者 ${esc(brief(track.owner))}</p><p>音频 SHA-384：${esc(track.audioHash)}</p><p>${track.recipients.map((r:any)=>esc(brief(r.address))+' · '+(r.bps/100).toFixed(2)+'%').join('<br>')}</p>${track.owner===state.wallet?.address?`<button type="button" class="inline-button" data-unpublish="${index}" data-native-action>停止此作品的新访问购买</button>`:''}</details></article>`;
    }).join('')+'</div>';
    body+=`<div class="library-bottom"><button type="button" class="inline-button" id="music-refresh">刷新音乐库 ↻</button>${state.catalogNext?'<button type="button" class="inline-button" id="music-more">加载更多 ↓</button>':''}<span>访问支付不等于真实收听次数。</span></div>`;
  }
  $('app-panel').innerHTML=body;
  $('music-library').addEventListener('click',()=>{state.musicMode='library';renderPanel();if(!state.catalogLoaded)void loadCatalog();});
  $('music-publish').addEventListener('click',()=>{state.musicMode='publish';renderPanel();});
  if(publish)$('music-publish-form').addEventListener('submit',event=>{event.preventDefault();void publishMusic();});
  else{
    $('music-refresh')?.addEventListener('click',()=>void loadCatalog());$('music-more')?.addEventListener('click',()=>void loadCatalog(true));
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-track]'))button.addEventListener('click',()=>void listenMusic(state.catalog[Number(button.dataset.track)]));
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-unpublish]'))button.addEventListener('click',()=>void action(async()=>{await commit([{type:'music.unpublish',trackId:state.catalog[Number(button.dataset.unpublish)].trackId}],feeFor());await loadCatalog();status('作品已停止新的访问购买。原有公开记录保持不变。');}));
  }
}
async function publishMusic():Promise<void>{await action(async()=>{
  if(!state.wallet)throw new Error('请先创建或恢复钱包。');
  const file=$<HTMLInputElement>('music-file').files?.[0];if(!file||file.size<1||file.size>4*1024*1024)throw new Error('请选择 1 字节至 4 MiB 的 MP3、WAV 或 OGG 文件。');
  const extension=file.name.split('.').pop()?.toLowerCase();const mime:Record<string,string>={mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg'};
  const mediaType=['audio/mpeg','audio/wav','audio/ogg'].includes(file.type)?file.type:mime[extension||''];if(!mediaType)throw new Error('只支持 MP3、WAV 或 OGG 音频。');
  const title=$<HTMLInputElement>('music-title').value.trim(),artist=$<HTMLInputElement>('music-artist').value.trim();
  if(!title||title.length>120||!artist||artist.length>80||/[\u0000-\u001f\u007f-\u009f]/.test(title+artist))throw new Error('请填写有效的作品名称和创作者。');
  if(!$<HTMLInputElement>('music-rights').checked)throw new Error('请明确确认分发权利和收入分配。');
  const priceAtoms=parseAmount($<HTMLInputElement>('music-price').value);const splitText=$<HTMLTextAreaElement>('music-splits').value.trim();
  const recipients=splitText?splitText.split(/\r?\n/).filter(Boolean).map(line=>{const [address,bps,...extra]=line.trim().split(/\s+/);if(extra.length||!/^cin1[a-f0-9]{96}$/.test(address)||!/^\d{1,5}$/.test(bps)||Number(bps)<1||Number(bps)>10000)throw new Error('分配格式应为完整账户地址和整数基点，每行一位接收人。');return {address,bps:Number(bps)};}):[{address:state.wallet.address,bps:10000}];
  if(recipients.length>8||new Set(recipients.map(r=>r.address)).size!==recipients.length||recipients.reduce((total,r)=>total+r.bps,0)!==10000)throw new Error('分配须包含 1–8 个不同的已注册账户，基点总和为 10,000。');
  await refreshAccount();if(atoms(state.account!.balanceAtoms)<feeFor())throw new Error('余额不足以支付发布的网络费。');
  for(const recipient of recipients)await api('/api/native/accounts/'+recipient.address);
  status('正在本地计算完整音频的 SHA-384…',true);const data=new Uint8Array(await file.arrayBuffer());const audioHash=await binaryHash(data);
  const chunks=Math.ceil(data.length/24576);if(!state.upload||state.upload.audioHash!==audioHash||state.upload.owner!==state.wallet.address)state.upload={audioHash,owner:state.wallet.address,uploadId:randomHex(),index:0,complete:false};
  for(let index=state.upload.index;index<chunks;index++){
    const chunk=data.subarray(index*24576,Math.min((index+1)*24576,data.length));
    const authorization={domain:'cinder.media-chunk.v1',chainId:state.info.chainId,owner:state.wallet.address,uploadId:state.upload.uploadId,audioHash,mime:mediaType,bytes:data.length,chunks,index,chunkHash:await binaryHash(chunk),validUntil:new Date(Date.now()+25*60000).toISOString()};
    status('正在上传音频 '+(index+1)+' / '+chunks+'，每一块均由你的钱包签名…',true);
    const response=await api('/api/native/media/upload',{authorization,signature:nativeSign(authorization,state.wallet.secretKey),data:nativeBase64url(chunk)});
    if(response.audioHash!==audioHash||response.uploadId!==state.upload.uploadId)throw new Error('上传确认与原音频不匹配。');state.upload.index=index+1;state.upload.complete=response.complete===true;
  }
  if(!state.upload.complete)throw new Error('服务器尚未确认完整音频。请重试上传核对。');
  await commit([{type:'music.publish',audioHash,title,artist,mime:mediaType,bytes:data.length,recipients,priceAtoms,rightsDeclared:true}],feeFor());
  state.upload=null;state.musicMode='library';await loadCatalog();renderPanel();status('作品已发布。目录、价格和收入分配来自真实网络记录。');
});}
async function listenMusic(track:any):Promise<void>{await action(async()=>{
  const existing=state.playbacks[track.trackId];if(existing&&existing.expiresAt>Date.now()){status('这首作品的访问权仍有效，请使用播放器收听。');return;}
  const response=await commit([{type:'music.listen',trackId:track.trackId,listenId:randomHex()}],atoms(track.priceAtoms)+feeFor());
  await acceptPlayback(response,track);renderPanel();status('访问支付已确认，收入已按作品声明分配。点击播放器开始收听。');
});}
async function acceptPlayback(response:any,track?:any):Promise<void>{
  const trackId=response.receipt?.transaction?.actions?.[0]?.trackId;const record=track||state.catalog.find(item=>item.trackId===trackId);
  if(!record||response.receipt.result?.access?.audioHash!==record.audioHash)throw new Error('播放收据中的音频与所选作品不匹配。');
  if(response.receipt.result.access.paidAtoms!==record.priceAtoms||response.receipt.result.access.sender!==state.wallet?.address)throw new Error('播放收据中的付款账户或价格与授权不一致。');
  const authorization={domain:'cinder.music.playback.v1',chainId:state.info.chainId,owner:state.wallet!.address,transactionHash:response.txHash,nonce:randomHex(),validUntil:new Date(Date.now()+240000).toISOString()};
  state.pending={transaction:response.receipt.transaction,signature:response.receipt.signature};
  status('正在用新的私钥证明获取访问令牌，证明不会写入公开账本…',true);
  const access=await api('/api/native/music/access',{authorization,signature:nativeSign(authorization,state.wallet!.secretKey)});
  if(access.audioHash!==record.audioHash||typeof access.playbackToken!=='string'||!access.playbackToken)throw new Error('访问令牌与已支付作品不一致。请核对原交易。');
  const expiresAt=Number(access.playbackExpiresAt);if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){state.pending=null;throw new Error('原访问权已到期。需要新的访问购买才能继续收听。');}
  state.pending=null;state.playbacks[record.trackId]={url:'/api/native/media/'+record.audioHash+'?token='+encodeURIComponent(access.playbackToken),expiresAt};
}
function marketState():any{return {...state.economy.state,wallets:{}};}
function positiveUnits(value:string):string{if(!/^[1-9]\d*$/.test(value)||value.length>24)throw new Error('WORK 与流动性份额必须为正整数。');return value;}
function minAfterSlippage(value:string):string{const calculated=atoms(value)*(10000n-BigInt(state.economyDraft.slippage))/10000n;return (calculated>0n?calculated:1n).toString();}
function renderEconomyPanel():void{
  if(!state.economy){$('app-panel').innerHTML=`<div class="library-empty"><h3>${state.economyError?'市场暂时不可用':'正在读取原生市场…'}</h3><p>${esc(state.economyError||'只显示网络实际余额与流动性。')}</p><button id="economy-refresh" class="button secondary compact">重新读取 ↻</button></div>`;$('economy-refresh').addEventListener('click',()=>void loadEconomy());return;}
  const market=state.economy,mode=state.economyMode,d=state.economyDraft;
  const field=(id:string,label:string,value:string,unit:string)=>`<label class="field"><span>${label} <small>${unit}</small></span><input id="${id}" type="text" inputmode="decimal" value="${esc(value)}" required></label>`;
  let fields='';
  if(mode==='buy')fields=field('econ-work','购买数量',d.workUnits,'WORK / 整数');
  else if(mode==='swap')fields=`<div class="form-pair"><label class="field"><span>支付资产</span><select id="econ-asset"><option value="CINDER" ${d.assetIn==='CINDER'?'selected':''}>CINDER → WORK</option><option value="WORK" ${d.assetIn==='WORK'?'selected':''}>WORK → CINDER</option></select></label>${field('econ-amount','支付数量',d.amountIn,d.assetIn)}</div>`;
  else if(mode==='add')fields=`<div class="form-pair">${field('econ-cinder','CINDER 上限',d.maxCinder,'CINDER')}${field('econ-work','WORK 上限',d.maxWork,'WORK / 整数')}</div>`;
  else if(mode==='remove')fields=field('econ-lp','取回的流动性份额',d.lpUnits,'LP / 整数');
  else fields=`<label class="field"><span>要计算哈希的文本 <small>1 WORK / 最多 4,000 字符</small></span><textarea id="econ-input" maxlength="4000" rows="3">${esc(d.redeemInput)}</textarea></label>`;
  const descriptions:Record<string,string>={buy:'从网络的有限 WORK 服务库存购买。每枚 WORK 可以兑换一次最多 4,000 字符的 SHA-384 计算；不锚定美元。',swap:'在实际 CINDER / WORK 资金池中兑换。价格由池中储备决定，交易收取 0.3% 池费用，另计原生网络费。',add:'向资金池提供两种资产，获得可取回相应池份额的 LP。初始池可能为空；流动性不会由界面凭空补齐。',remove:'按你的流动性份额取回两种资产。最低接收数量随签名提交；市场变化超过限制时交易会被拒绝。',redeem:'销毁 1 WORK 并执行确定性 SHA-384 计算。该操作消耗一项明确的计算服务，另计 CINDER 网络费。'};
  $('app-panel').innerHTML=`<div class="market-balances"><div><span>你的 WORK</span><strong>${atoms(market.wallet.workUnits).toLocaleString('en-US')}</strong></div><div><span>你的流动性份额</span><strong>${atoms(market.wallet.lpUnits).toLocaleString('en-US')}</strong></div><div><span>可购买 WORK 库存</span><strong>${atoms(market.state.inventoryWork).toLocaleString('en-US')}</strong></div></div><label class="field"><span>原生市场 <small>CINDER / WORK</small></span><select id="economy-mode"><option value="swap" ${mode==='swap'?'selected':''}>兑换现货 · Swap</option><option value="buy" ${mode==='buy'?'selected':''}>购买计算额度 · Buy WORK</option><option value="add" ${mode==='add'?'selected':''}>提供流动性 · Add liquidity</option><option value="remove" ${mode==='remove'?'selected':''}>取回流动性 · Remove liquidity</option><option value="redeem" ${mode==='redeem'?'selected':''}>使用 WORK 计算 · Redeem</option></select></label><p class="panel-intro">${descriptions[mode]}</p><form id="economy-form">${fields}${['swap','add','remove'].includes(mode)?`<label class="field"><span>报价保护 <small>SLIPPAGE LIMIT</small></span><select id="econ-slippage"><option value="50" ${d.slippage==='50'?'selected':''}>0.5%</option><option value="100" ${d.slippage==='100'?'selected':''}>1%</option><option value="300" ${d.slippage==='300'?'selected':''}>3%</option></select></label>`:''}<div id="economy-quote" class="market-quote" role="status"></div><button id="app-run" data-native-action class="button primary" type="submit">核对并签名${({buy:'购买',swap:'兑换',add:'提供流动性',remove:'取回',redeem:'计算'} as Record<string,string>)[mode]} <span>↗</span></button></form><div class="pool-state"><span>实际池储备</span><strong>${format(market.state.pool.cinderAtoms)} CINDER / ${atoms(market.state.pool.workUnits).toLocaleString('en-US')} WORK</strong><button id="economy-refresh" class="inline-button" type="button">刷新 ↻</button></div><p class="panel-note">CINDER 与 WORK 都属于当前单运营方开发网络，没有现金兑付或投资收益承诺。池子可为空，资产价格也可能变化。</p>`;
  $('economy-mode').addEventListener('change',()=>{state.economyMode=$<HTMLSelectElement>('economy-mode').value;if(state.economyMode==='remove'&&atoms(state.economy.wallet.lpUnits)>0n)state.economyDraft.lpUnits=state.economy.wallet.lpUnits;renderPanel();});
  $('economy-refresh').addEventListener('click',()=>void loadEconomy());
  $('economy-form').addEventListener('submit',event=>{event.preventDefault();void performEconomy();});
  for(const input of $('economy-form').querySelectorAll('input,select,textarea'))input.addEventListener('input',()=>updateEconomyQuote());
  $('econ-asset')?.addEventListener('change',()=>{state.economyDraft.assetIn=$<HTMLSelectElement>('econ-asset').value;state.economyDraft.amountIn=state.economyDraft.assetIn==='WORK'?'1':'0.001';renderPanel();});
  updateEconomyQuote();
}
function updateEconomyQuote():void{
  if(!state.economy||!$('economy-quote'))return;const d=state.economyDraft,mode=state.economyMode;
  if($('econ-slippage'))d.slippage=$<HTMLSelectElement>('econ-slippage').value;
  state.economyPreview=null;
  try{
    let quote:any,lines:string[]=[];
    if(mode==='buy'){d.workUnits=$<HTMLInputElement>('econ-work').value.trim();quote=quoteWork(positiveUnits(d.workUnits),marketState());lines=['获得 '+quote.workUnits+' WORK','支付 '+format(quote.cinderAtoms)+' CINDER'];}
    else if(mode==='swap'){d.assetIn=$<HTMLSelectElement>('econ-asset').value;d.amountIn=$<HTMLInputElement>('econ-amount').value.trim();if(state.economy.state.pool.lpSupply==='0')throw new Error('池中尚无流动性。先购买 WORK，再提供两种资产，才能进行兑换。');quote=quoteSwap(marketState(),d.assetIn as 'CINDER'|'WORK',d.assetIn==='CINDER'?parseAmount(d.amountIn):positiveUnits(d.amountIn));quote.minOut=minAfterSlippage(quote.amountOut);lines=['预计获得 '+(quote.assetOut==='CINDER'?format(quote.amountOut):quote.amountOut)+' '+quote.assetOut,'最低接收 '+(quote.assetOut==='CINDER'?format(quote.minOut):quote.minOut)+' '+quote.assetOut];}
    else if(mode==='add'){d.maxCinder=$<HTMLInputElement>('econ-cinder').value.trim();d.maxWork=$<HTMLInputElement>('econ-work').value.trim();quote=quoteAddLiquidity(marketState(),parseAmount(d.maxCinder),positiveUnits(d.maxWork));quote.minLpUnits=minAfterSlippage(quote.lpUnits);lines=['实际投入 '+format(quote.cinderAtoms)+' CINDER + '+quote.workUnits+' WORK','预计 '+quote.lpUnits+' LP / 最低 '+quote.minLpUnits+' LP'];}
    else if(mode==='remove'){d.lpUnits=$<HTMLInputElement>('econ-lp').value.trim();quote=quoteRemoveLiquidity(marketState(),positiveUnits(d.lpUnits));quote.minCinderAtoms=minAfterSlippage(quote.cinderAtoms);quote.minWorkUnits=minAfterSlippage(quote.workUnits);lines=['预计取回 '+format(quote.cinderAtoms)+' CINDER + '+quote.workUnits+' WORK','最低 '+format(quote.minCinderAtoms)+' CINDER + '+quote.minWorkUnits+' WORK'];}
    else{d.redeemInput=$<HTMLTextAreaElement>('econ-input').value;if(!d.redeemInput.trim()||d.redeemInput.length>4000)throw new Error('请输入 1–4,000 个字符。');quote={workUnits:'1'};lines=['使用 1 WORK · 确定性 SHA-384','输入与结果以公开收据核对'];}
    state.economyPreview=quote;$('economy-quote').innerHTML=lines.map(line=>'<div>'+esc(line)+'</div>').join('')+'<small>另计网络费 '+format(feeFor())+' CINDER</small>';
  }catch(error:any){$('economy-quote').textContent=error.message;}
  const run=$<HTMLButtonElement>('app-run');if(run)run.disabled=!state.economyPreview||!state.wallet||state.busy||!!state.pending||!!state.job||state.stopped;
}
async function performEconomy():Promise<void>{await action(async()=>{
  updateEconomyQuote();const quote=state.economyPreview;if(!quote)throw new Error('请先取得有效报价。');
  const d=state.economyDraft,mode=state.economyMode,deadline=new Date(Date.now()+120000).toISOString();let nativeAction:any,spend=feeFor(),computeInput:string|undefined;
  if(mode==='buy'){nativeAction={type:'economy.buy',workUnits:d.workUnits,maxCinderAtoms:quote.cinderAtoms};spend+=atoms(quote.cinderAtoms);}
  else if(mode==='swap'){nativeAction={type:'economy.swap',assetIn:d.assetIn,amountIn:quote.amountIn,minOut:quote.minOut,deadline};if(d.assetIn==='CINDER')spend+=atoms(quote.amountIn);else if(atoms(state.economy.wallet.workUnits)<atoms(quote.amountIn))throw new Error('WORK 余额不足。');}
  else if(mode==='add'){nativeAction={type:'economy.addLiquidity',maxCinderAtoms:parseAmount(d.maxCinder),maxWorkUnits:d.maxWork,minLpUnits:quote.minLpUnits,deadline};spend+=atoms(nativeAction.maxCinderAtoms);if(atoms(state.economy.wallet.workUnits)<atoms(quote.workUnits))throw new Error('WORK 余额不足，请先购买或接收 WORK。');}
  else if(mode==='remove'){nativeAction={type:'economy.removeLiquidity',lpUnits:d.lpUnits,minCinderAtoms:quote.minCinderAtoms,minWorkUnits:quote.minWorkUnits,deadline};if(atoms(state.economy.wallet.lpUnits)<atoms(d.lpUnits))throw new Error('流动性份额不足。');}
  else{if(atoms(state.economy.wallet.workUnits)<1n)throw new Error('需要至少 1 WORK 才能兑换计算。');computeInput=d.redeemInput;nativeAction={type:'economy.redeem',inputHash:nativeHash(computeInput)};}
  const response=await commit([nativeAction],spend,computeInput);
  if(mode==='redeem'){
    const output=response.receipt.result.output??response.receipt.result.economy?.output;
    if(typeof output!=='string'||output!==nativeHash(computeInput!)){state.stopped=true;throw new Error('WORK 计算结果未通过本地重算验证。');}
    status('1 WORK 已兑换计算，输出与本地 SHA-384 重算一致：'+output);
  }else status('交易已入账，ML-DSA-65 签名和 CINDER 账本守恒已验证。市场状态已刷新。');
  await loadEconomy();await refreshAccount();
});}

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
    const debit=receipt.postings.filter(posting=>posting.account===state.wallet!.address&&signedAtoms(posting.deltaAtoms)<0n).reduce((total,posting)=>total-signedAtoms(posting.deltaAtoms),0n);
    if(debit>atoms(expected.transaction.maxDebitAtoms))throw new Error('收据中的总扣款超过了本地签署的支出上限。');
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
async function performTransfer(): Promise<void> { await action(async()=>{
  state.transferTo=$<HTMLInputElement>('transfer-to').value.trim();state.transferAmount=$<HTMLInputElement>('transfer-amount').value.trim();
  if(!/^cin1[0-9a-f]{96}$/.test(state.transferTo))throw new Error('请输入完整 Cinder 地址：cin1 后接 96 个十六进制字符。');
  const amountAtoms=parseAmount(state.transferAmount);
  await commit([{type:'transfer',to:state.transferTo,amountAtoms}],atoms(amountAtoms)+feeFor());
  status('转账已入账，账户签名、检查点和账本守恒均已验证。');
}); }
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
  else {if(pending.transaction.actions[0]?.type==='music.listen')await acceptPlayback(response);await refreshServices();renderPanel();status('原交易已恢复并验证，没有创建重复交易。');}
});}

$('create-wallet').addEventListener('click',()=>void action(async()=>{
  status('正在本地生成 ML-DSA-65 密钥并注册公钥…',true);
  const created=await registerWallet();state.wallet=created.wallet;state.account=created.account;state.claimed=created.account.claimedFaucet===true;renderWallet();renderPanel();await loadEconomy();status('原生账户已注册。请先下载加密备份，再领取开发币体验应用。');
}));
$('backup-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
  if(!state.wallet)throw new Error('请先创建或恢复钱包。');
  const password=$<HTMLInputElement>('backup-password').value;if(password!==$<HTMLInputElement>('backup-confirm').value)throw new Error('两次输入的备份密码不一致。');
  $('vault-status').textContent='正在本机加密钱包…';
  const vault=await encryptWallet(state.wallet,password,state.info.chainId);
  const url=URL.createObjectURL(new Blob([JSON.stringify(vault,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='cinder-encrypted-wallet-'+state.wallet.address.slice(4,16)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $<HTMLFormElement>('backup-form').reset();state.backedUp=true;renderWallet();$('vault-status').textContent='加密备份已下载。请确认文件已保存，并将密码分开保管。';status('钱包已用 AES-256-GCM 加密导出，私钥未发送到服务器。');
});});
$('restore-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
  if(state.pending||state.job)throw new Error('请先核对当前账户尚未完成的交易。');
  const file=$<HTMLInputElement>('restore-file').files?.[0];if(!file||file.size>32768)throw new Error('请选择大小不超过 32 KiB 的加密钱包 JSON 文件。');
  $('vault-status').textContent='正在本机解密并验证密钥…';
  const wallet=await decryptWallet(await file.text(),$<HTMLInputElement>('restore-password').value,state.info.chainId);
  const restored=await registerWallet(wallet);state.wallet=restored.wallet;state.account=restored.account;state.claimed=restored.account.claimedFaucet===true;state.backedUp=true;state.stopped=false;state.output='';state.playbacks={};state.upload=null;
  $<HTMLFormElement>('restore-form').reset();$<HTMLDetailsElement>('restore-tools').open=false;renderWallet();await refreshServices();renderPanel();$('vault-status').textContent='已恢复相同公开地址，余额与 nonce 已从网络读取。';status('钱包恢复完成。密码与私钥始终留在本机。');
});});
$('claim').addEventListener('click',()=>void action(async()=>{await commit([{type:'faucet'}],0n);renderPanel();status('100 CINDER 开发币已入账。来源是有限创世分配，不是有现金价值的资产。');}));
$('copy-address').addEventListener('click',()=>{if(state.wallet)void copy(state.wallet.address);});
for(const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){
  tab.addEventListener('click',()=>{
    if(state.busy)return;
    if(state.tab==='transfer'&&$('transfer-to')){state.transferTo=$<HTMLInputElement>('transfer-to').value;state.transferAmount=$<HTMLInputElement>('transfer-amount').value;}
    if(state.tab==='agent'&&$('agent-input'))state.agentInput=$<HTMLTextAreaElement>('agent-input').value;
    state.tab=tab.dataset.tab as TabName;
    for(const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){other.setAttribute('aria-selected',String(other===tab));other.tabIndex=other===tab?0:-1;}
    renderPanel();clearError();if(!state.pending&&!state.job)status();if(state.tab==='music'&&!state.catalogLoaded)void loadCatalog();if(state.tab==='trade'&&!state.economy)void loadEconomy();
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
    $('connection').className='connection ready';$('connection').textContent='网络已连接';renderPanel();lock(false);await refreshServices();
  }catch(error){$('connection').className='connection failed';$('connection').textContent='连接不可用';showError(error);status('请刷新页面重新连接。所有余额与网络数据只在服务器验证后显示。');}
}
void init();
