import {nativeCanonical,nativeHash} from './native-crypto.ts';
export const NATIVE_CHAIN='cinder-devnet-1';
export const NATIVE_SUPPLY='1000000000000';
export const NATIVE_FAUCET='100000000';
export const NATIVE_ADDRESS=/^cin1[a-f0-9]{96}$/;
export const NATIVE_DIGEST=/^[a-f0-9]{96}$/;
export const NATIVE_SERVICES=[{id:'hash',name:'SHA-384 digest',amountAtoms:'100',maxInputChars:4000,model:'sha384-v1'},{id:'inference',name:'Meta Llama inference',amountAtoms:'500',maxInputChars:1200,model:'@cf/meta/llama-3.1-8b-instruct-fp8-fast'}];
export interface NativeAccount {address:string;publicKey?:string;balanceAtoms:string;nonce:number;claimedFaucet:boolean;createdAt:string;}
export interface Posting {account:string;deltaAtoms:string;}
export class NativeError extends Error {status:number;code:string;constructor(code:string,message:string,status=400){super(message);this.code=code;this.status=status;}}
export function exact(value:any,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))throw new NativeError('invalid_fields','The signed action contains missing or unknown fields.');}
export function atoms(value:any,allowZero=false):bigint {if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,12})$/.test(value))throw new NativeError('invalid_amount','Amounts must be canonical integer atom strings.');const n=BigInt(value);if(n< (allowZero?0n:1n)||n>BigInt(NATIVE_SUPPLY))throw new NativeError('invalid_amount','Amount is outside the native supply bounds.');return n;}
export function txHash(transaction:any){return nativeHash(nativeCanonical(transaction));}
export function validateTransaction(transaction:any,now:number){
  exact(transaction,['domain','chainId','sender','nonce','validUntil','maxDebitAtoms','actions']);
  if(transaction.domain!=='cinder.transaction.v1'||transaction.chainId!==NATIVE_CHAIN)throw new NativeError('wrong_network','The transaction domain or native network is wrong.');
  if(typeof transaction.sender!=='string'||!NATIVE_ADDRESS.test(transaction.sender)||!Number.isSafeInteger(transaction.nonce)||transaction.nonce<1)throw new NativeError('invalid_sender','Invalid native sender or nonce.');
  const until=typeof transaction.validUntil==='string'?Date.parse(transaction.validUntil):NaN;
  if(!Number.isFinite(until)||new Date(until).toISOString()!==transaction.validUntil||until>now+300000)throw new NativeError('invalid_deadline','Use an ISO deadline within five minutes.');
  if(until<=now)throw new NativeError('expired','This signed authorization expired.',410);
  if(!Array.isArray(transaction.actions)||transaction.actions.length<1||transaction.actions.length>16)throw new NativeError('batch_limit','A batch must contain between 1 and 16 actions.');
  nativeCanonical(transaction);
}
export function touchedAccounts(tx:any):string[]{
  const result=new Set<string>([tx.sender,'system:reserve','system:fees','system:provider']);
  for(const a of tx.actions){if(a.type==='transfer'){exact(a,['type','to','amountAtoms']);if(typeof a.to!=='string'||!NATIVE_ADDRESS.test(a.to))throw new NativeError('invalid_recipient','Recipient must be a native address.');result.add(a.to);}else if(a.type==='split'){exact(a,['type','recipients','amountAtoms','app','referenceHash','units']);if(!Array.isArray(a.recipients)||a.recipients.length<1||a.recipients.length>8)throw new NativeError('split_limit','Use between one and eight recipients.');for(const r of a.recipients){if(typeof r?.address!=='string'||!NATIVE_ADDRESS.test(r.address))throw new NativeError('invalid_recipient','Split recipient must be a native address.');result.add(r.address);}}}
  if(tx.actions.some((a:any)=>a.type==='compute'))result.add('system:escrow:'+txHash(tx));
  if(result.size>64)throw new NativeError('recipient_limit','A batch may touch at most 64 accounts including system accounts.');
  return [...result];
}
/** Largest-remainder split: every atom is allocated, ties use address ordering. */
export function allocateSplit(total:bigint,recipients:any[]):Array<{address:string,bps:number,amountAtoms:string}>{
  if(!Array.isArray(recipients)||recipients.length<1||recipients.length>8)throw new NativeError('split_limit','Use one to eight split recipients.');
  let bps=0;const seen=new Set<string>();
  const parts=recipients.map(r=>{exact(r,['address','bps']);if(typeof r.address!=='string'||!NATIVE_ADDRESS.test(r.address)||!Number.isSafeInteger(r.bps)||r.bps<=0||r.bps>10000||seen.has(r.address))throw new NativeError('invalid_split','Unique recipients and positive integer basis points are required.');bps+=r.bps;seen.add(r.address);return {...r,value:total*BigInt(r.bps)/10000n,remainder:total*BigInt(r.bps)%10000n};});
  if(bps!==10000)throw new NativeError('invalid_split','Split percentages must add to exactly 10000 basis points.');
  let left=total-parts.reduce((sum,p)=>sum+p.value,0n);
  const ranked=[...parts].sort((a,b)=>a.remainder===b.remainder?(a.address<b.address?-1:1):(a.remainder>b.remainder?-1:1));
  for(const p of ranked){if(left===0n)break;p.value++;left--;}
  return parts.map(p=>({address:p.address,bps:p.bps,amountAtoms:p.value.toString()}));
}
/** Pure atomic ledger transition. Signature verification and persistence live outside. */
export function applyNativeTransaction(snapshot:Record<string,NativeAccount>,tx:any,now:number){
  validateTransaction(tx,now);
  touchedAccounts(tx);
  const accounts:Record<string,NativeAccount>=structuredClone(snapshot);const sender=accounts[tx.sender];
  if(!sender?.publicKey)throw new NativeError('unknown_sender','Register this native account first.',404);
  if(tx.nonce!==sender.nonce+1)throw new NativeError('wrong_nonce','The signed nonce is not the next account nonce.',409);
  const postings:Posting[]=[];
  const move=(from:string,to:string,n:bigint)=>{if(n===0n)return;const a=accounts[from],b=accounts[to];if(!a||!b)throw new NativeError('unknown_recipient','All recipients must be registered first.',404);if(BigInt(a.balanceAtoms)<n)throw new NativeError('insufficient_balance','Insufficient CINDER devnet balance.',402);a.balanceAtoms=(BigInt(a.balanceAtoms)-n).toString();b.balanceAtoms=(BigInt(b.balanceAtoms)+n).toString();postings.push({account:from,deltaAtoms:(-n).toString()},{account:to,deltaAtoms:n.toString()});};
  const faucet=tx.actions.length===1&&tx.actions[0].type==='faucet';
  const fee=faucet?0n:10n+2n*BigInt(tx.actions.length);
  let gross=fee;for(const action of tx.actions){if(action.type==='transfer'||action.type==='split')gross+=atoms(action.amountAtoms);else if(action.type==='compute'){const service=NATIVE_SERVICES.find(s=>s.id===action.service);if(!service)throw new NativeError('invalid_service','Unknown compute service.');gross+=BigInt(service.amountAtoms);}}
  if(gross>atoms(tx.maxDebitAtoms,true))throw new NativeError('spending_cap','The transaction exceeds its signed maximum debit.',402);
  move(tx.sender,'system:fees',fee);
  const events:any[]=[];let compute:any;
  for(const a of tx.actions){
    if(a.type==='faucet'){
      exact(a,['type']);if(!faucet||sender.claimedFaucet)throw new NativeError('faucet_claimed','The faucet is available once per account, as its own transaction.',409);
      move('system:reserve',tx.sender,BigInt(NATIVE_FAUCET));sender.claimedFaucet=true;events.push({type:'faucet',amountAtoms:NATIVE_FAUCET});
    }else if(a.type==='transfer'){
      exact(a,['type','to','amountAtoms']);move(tx.sender,a.to,atoms(a.amountAtoms));events.push({...a});
    }else if(a.type==='split'){
      exact(a,['type','recipients','amountAtoms','app','referenceHash','units']);
      if(!['music','agent','trade'].includes(a.app)||typeof a.referenceHash!=='string'||!NATIVE_DIGEST.test(a.referenceHash)||!Number.isSafeInteger(a.units)||a.units<1||a.units>1000000)throw new NativeError('invalid_usage','Use an allowed app, SHA-384 reference and positive bounded unit count.');
      const total=atoms(a.amountAtoms);const parts=allocateSplit(total,a.recipients);
      // Check total up front so self-recipient rounding cannot bypass the debit bound.
      if(BigInt(sender.balanceAtoms)<total)throw new NativeError('insufficient_balance','Insufficient balance for the full split.',402);
      for(const part of parts)move(tx.sender,part.address,BigInt(part.amountAtoms));
      events.push({type:'split',app:a.app,referenceHash:a.referenceHash,units:a.units,amountAtoms:a.amountAtoms,recipients:parts,evidence:'payer-authorized-paid-event; not proof of listening, identity or trade execution'});
    }else if(a.type==='compute'){
      exact(a,['type','service','inputHash']);if(tx.actions.length!==1||typeof a.inputHash!=='string'||!NATIVE_DIGEST.test(a.inputHash))throw new NativeError('invalid_compute','Compute reservations must be a separate transaction with an input hash.');
      const service=NATIVE_SERVICES.find(s=>s.id===a.service);if(!service)throw new NativeError('invalid_service','Unknown compute service.');
      const escrow='system:escrow:'+txHash(tx);accounts[escrow]??={address:escrow,balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:new Date(now).toISOString()};
      move(tx.sender,escrow,BigInt(service.amountAtoms));compute={service:service.id,inputHash:a.inputHash,amountAtoms:service.amountAtoms,escrow};events.push({type:'compute-reservation',...compute});
    }else throw new NativeError('invalid_action','Unknown native action.');
  }
  sender.nonce=tx.nonce;
  if(postings.reduce((sum,p)=>sum+BigInt(p.deltaAtoms),0n)!==0n)throw new Error('Native conservation invariant failed');
  return {accounts,postings,result:{kind:'native-payment',feeAtoms:fee.toString(),actionCount:tx.actions.length,events},compute};
}
