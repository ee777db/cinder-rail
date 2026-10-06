import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CinderNativeClient,nativeGenerateKey,nativeHash,nativeCanonical} from '../public/native-sdk.js';

// Build the browser SDK first. This command creates ephemeral test-only keys;
// none are printed or written. Keep this process alive until cleanup completes.
// An interruption that prevents cleanup leaves collateral to the channel expiry
// path; it does not make the ephemeral wallet recoverable after process exit.
const integer=(name,fallback,max)=>{
 const raw=process.env[name]??String(fallback);
 if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw new Error(`${name} must be an integer from 1 to ${max}`);
 return Number(raw);
};
const requestedCalls=integer('CINDER_CALLS',1000,10000);
const configuredConcurrency=integer('CINDER_CONCURRENCY',4,8);
const concurrency=Math.min(requestedCalls,configuredConcurrency);
const base=(process.env.CINDER_URL||'http://127.0.0.1:8899').replace(/\/$/,'');
if(!['http:','https:'].includes(new URL(base).protocol))throw new Error('CINDER_URL must use HTTP or HTTPS');
const client=new CinderNativeClient(base,process.env.CINDER_OPERATOR_KEY||undefined);
const startedAt=new Date().toISOString(),started=performance.now(),runId=crypto.randomUUID();
const channels=[],latencies=[],failures=[],cleanupFailures=[];
const abortCalls=new AbortController();let interrupted=false,stopNewCalls=false,phase='setup';
let info,owner,steadyStarted=null,steadyFinished=null,cleanupStarted=null,fundedBalance=null;
let callAttempts=0,recoveredCalls=0;
const previousFetch=globalThis.fetch;
globalThis.fetch=(input,options={})=>previousFetch(input,{...options,signal:AbortSignal.any([
 AbortSignal.timeout(30000),...(options.signal?[options.signal]:[]),...(phase==='calls'?[abortCalls.signal]:[]),
])});
const interrupt=()=>{interrupted=true;stopNewCalls=true;abortCalls.abort();};
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
const errorInfo=(error,context)=>({...context,name:String(error?.name||'Error'),message:String(error?.message||'Unknown failure'),
 ...(Number.isInteger(error?.status)?{status:error.status}:{}),...(typeof error?.code==='string'?{code:error.code}:{}),
 ...(typeof error?.pendingTransactionHash==='string'&&/^[a-f0-9]{96}$/.test(error.pendingTransactionHash)?{pendingTransactionHash:error.pendingTransactionHash}:{}),
});
const retryable=error=>!interrupted&&(error?.status===408||error?.status===429||error?.status>=500||['TypeError','TimeoutError','AbortError'].includes(error?.name));
async function retrySame(operation){
 for(let attempt=1;attempt<=3;attempt++){
  try{return await operation();}catch(error){if(attempt===3||!retryable(error))throw error;await new Promise(resolve=>setTimeout(resolve,100*attempt));}
 }
}
const same=(actual,expected,message)=>assert.equal(nativeCanonical(actual),nativeCanonical(expected),message);
const stopped=()=>{if(stopNewCalls)throw new Error(interrupted?'Benchmark interrupted; reconciling existing channels':'Another channel failed; no new calls will be issued');};
const publicTransaction=async hash=>{
 const response=await fetch(base+'/api/native/transactions/'+hash);
 const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.message||'Transaction lookup failed'),{status:response.status,code:value.error});
 assert.equal(value.txHash,hash);client.verifyReceipt(value.receipt);return value;
};

async function runChannel(record){
 try{
  for(let sequence=1;sequence<=record.capacity;sequence++){
   stopped();const start=performance.now();
   const input=`Cinder bounded throughput ${runId}; channel ${record.index}; call ${sequence}`;
   const envelope=client.authorizeChannelCall(record.sessionKey,record.channelId,sequence,input);
   record.issued.set(sequence,nativeHash(nativeCanonical(envelope.message)));
   const response=await retrySame(async()=>{callAttempts++;return client.submitChannelCall(envelope,record.sessionKey.publicKey,record.journalHead);});
   const elapsed=performance.now()-start;
   assert.equal(response.result.sequence,sequence);assert.equal(response.result.output,nativeHash(input));
   assert.equal(response.result.settledAtoms,'0');assert.equal(response.result.feeAtoms,'0');
   record.acknowledged=sequence;record.journalHead=response.result.journalHash;latencies.push(elapsed);
  }
 }catch(error){stopNewCalls=true;throw Object.assign(new Error(String(error?.message||'Channel call failed')),{name:error?.name||'Error',status:error?.status,code:error?.code,channelId:record.channelId,sequence:record.acknowledged+1});}
}

async function verifySettlement(record,response,reason){
 const receipt=response.receipt;client.verifyReceipt(receipt);
 const result=receipt.result,terms=record.opening;
 assert.equal(result.channelId,record.channelId);assert.equal(result.kind,'native-channel-close');assert.equal(result.reason,reason);
 assert.ok(Number.isSafeInteger(result.callCount)&&result.callCount>=record.acknowledged&&result.callCount<=terms.capacity,'Settlement call count must include every verified acknowledgment');
 // A timed-out last request might have committed. Recover only authorizations
 // actually issued by this run; do not count them as steady-window latency samples.
 let cursor=record.acknowledged;
 while(cursor<result.callCount){
  const page=await retrySame(()=>client.channelJournal(record.channelId,cursor));assert.ok(page.journal.length>0,'Missing committed journal');
  for(const entry of page.journal){
   const journal=entry.journal;assert.equal(journal.sequence,cursor+1);assert.ok(journal.sequence<=result.callCount);
   assert.equal(journal.previousHash,record.journalHead);assert.equal(journal.messageHash,record.issued.get(journal.sequence),'Settlement includes a call not authorized by this benchmark');
   record.journalHead=nativeHash(nativeCanonical(journal));cursor++;record.recovered++;recoveredCalls++;
  }
 }
 assert.equal(result.journalHead,record.journalHead,'Closing checkpoint must bind the verified journal head');
 const settled=BigInt(result.callCount)*100n,refunded=BigInt(terms.depositAtoms)-settled,fee=reason==='owner'?12n:0n;
 assert.equal(result.settledAtoms,settled.toString());assert.equal(result.refundedAtoms,refunded.toString());
 assert.equal(result.depositAtoms,terms.depositAtoms);assert.equal(result.feeAtoms,fee.toString());
 const postings=[];
 if(fee)postings.push({account:owner.address,deltaAtoms:'-12'},{account:'system:fees',deltaAtoms:'12'});
 if(settled)postings.push({account:terms.escrow,deltaAtoms:(-settled).toString()},{account:'system:provider',deltaAtoms:settled.toString()});
 if(refunded)postings.push({account:terms.escrow,deltaAtoms:(-refunded).toString()},{account:owner.address,deltaAtoms:refunded.toString()});
 same(receipt.postings,postings,'Settlement postings must exactly pay the provider, refund unused collateral and charge the closing fee');
 if(reason==='expired'){
  assert.equal(receipt.signature,null);
  same(receipt.transaction,{domain:'cinder.channel-expiry.v1',chainId:info.chainId,channelId:record.channelId,sequence:result.callCount,journalHead:record.journalHead,expiredAt:terms.expiresAt},'Expiry settlement transaction mismatch');
 }
 record.settlement={transactionHash:response.txHash,checkpointHeight:receipt.checkpoint.height,checkpointHash:nativeHash(nativeCanonical(receipt.checkpoint)),
  reason,servedCalls:result.callCount,journalHead:result.journalHead,settledAtoms:result.settledAtoms,refundedAtoms:result.refundedAtoms,feeAtoms:result.feeAtoms};
}

async function closeRecord(record){
 let state;
 try{state=await retrySame(()=>client.channel(record.channelId));}
 catch(error){
  if(!record.confirmedOpen&&error?.status===404){record.notFoundAtCleanup=true;throw new Error('Uncertain opening is not yet visible. A lookup miss does not prove that its in-flight submission can never commit.');}
  throw error;
 }
 record.opening??={...state,status:'open'};record.journalHead??=state.sequence===0?state.journalHead:null;
 if(!record.journalHead)throw new Error('An uncertain opening unexpectedly contains calls; retain its public ID for investigation');
 record.confirmedOpen=true;
 if(state.status==='closed'){
  if(state.closeReason!=='expired')throw new Error('Channel was already closed by an unexpected owner transaction');
  const expiry={domain:'cinder.channel-expiry.v1',chainId:info.chainId,channelId:record.channelId,sequence:state.sequence,journalHead:state.journalHead,expiredAt:state.expiresAt};
  const hash=nativeHash(nativeCanonical(expiry));await verifySettlement(record,await retrySame(()=>publicTransaction(hash)),'expired');return;
 }
 // One owner signs all closes, so cleanup is deliberately sequential. Retain
 // this exact envelope through transport failures instead of changing its nonce.
 record.closeEnvelope??=await client.authorize(owner,[{type:'channel.close',channelId:record.channelId}],'12');
 const response=await retrySame(()=>client.submit(record.closeEnvelope));
 await verifySettlement(record,response,'owner');
}

try{
 info=await retrySame(()=>client.connect());stopped();
 const available=info.limits?.channelAvailableCalls;if(Number.isSafeInteger(available)&&available<requestedCalls)throw new Error(`The test network has ${available} unreserved call slots; ${requestedCalls} requested`);
 owner=nativeGenerateKey();await retrySame(()=>client.register(owner));
 const faucet=await client.authorize(owner,[{type:'faucet'}],'0');
 const funded=await retrySame(()=>client.submit(faucet));fundedBalance=BigInt(funded.account.balanceAtoms);
 assert.ok(fundedBalance>=BigInt(requestedCalls)*100n+BigInt(concurrency)*24n,'Faucet balance must fund all calls and opening/closing fees');
 for(let index=0;index<concurrency;index++){
  stopped();const capacity=Math.floor(requestedCalls/concurrency)+(index<requestedCalls%concurrency?1:0);
  try{
   // Retry through the same SDK instance: it retains an uncertain opening's
   // original owner envelope and newly generated session key in memory.
   const opened=await retrySame(()=>client.openChannel(owner,capacity,86400000));
   assert.equal(opened.channel.capacity,capacity);assert.equal(opened.channel.owner,owner.address);
   channels.push({index,capacity,channelId:opened.channel.channelId,sessionKey:opened.sessionKey,opening:opened.channel,
    journalHead:opened.channel.journalHead,confirmedOpen:true,acknowledged:0,recovered:0,issued:new Map(),openingTransactionHash:opened.txHash});
  }catch(error){
   const id=error?.pendingTransactionHash;
   if(typeof id==='string'&&/^[a-f0-9]{96}$/.test(id)&&!channels.some(c=>c.channelId===id))channels.push({index,capacity,channelId:id,confirmedOpen:false,acknowledged:0,recovered:0,issued:new Map(),openingTransactionHash:id});
   throw error;
  }
 }
 stopped();phase='calls';steadyStarted=performance.now();
 const results=await Promise.allSettled(channels.map(runChannel));steadyFinished=performance.now();
 for(let index=0;index<results.length;index++)if(results[index].status==='rejected')failures.push(errorInfo(results[index].reason,{phase:'calls',channelId:channels[index].channelId,nextSequence:channels[index].acknowledged+1}));
}catch(error){failures.push(errorInfo(error,{phase}));}
finally{
 steadyFinished??=steadyStarted===null?null:performance.now();phase='cleanup';cleanupStarted=performance.now();
 // allSettled above ensures no worker still signs calls during settlement.
 for(const record of channels){
  try{await closeRecord(record);}catch(error){cleanupFailures.push(errorInfo(error,{phase:'cleanup',channelId:record.channelId,
   ...(record.closeEnvelope?{pendingCloseTransactionHash:nativeHash(nativeCanonical(record.closeEnvelope.transaction))}:{})}));}
 }
 process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);globalThis.fetch=previousFetch;
}

const finished=performance.now(),sorted=[...latencies].sort((a,b)=>a-b),round=value=>Math.round(value*1000)/1000;
const percentile=fraction=>sorted.length?round(sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]):null;
const steadyMs=steadyStarted===null?0:steadyFinished-steadyStarted;
const verifiedSettlements=channels.filter(c=>c.settlement),servedCalls=verifiedSettlements.reduce((sum,c)=>sum+c.settlement.servedCalls,0);
const sumAtoms=field=>verifiedSettlements.reduce((sum,c)=>sum+BigInt(c.settlement[field]),0n);
const openingFees=BigInt(channels.filter(c=>c.confirmedOpen).length)*12n,closingFees=sumAtoms('feeAtoms');
const success=!interrupted&&!failures.length&&!cleanupFailures.length&&latencies.length===requestedCalls&&servedCalls===requestedCalls&&verifiedSettlements.length===concurrency;
const report={kind:'cinder-native-channel-throughput-v1',success,network:base,chainId:info?.chainId??null,startedAt,finishedAt:new Date().toISOString(),runId,
 configuration:{requestedCalls,configuredConcurrency,activeChannels:concurrency,requestTimeoutMs:30000,maxAttemptsPerRequest:3,channelLifetimeMs:86400000},
 calls:{requested:requestedCalls,verifiedAcknowledgmentsInSteadyWindow:latencies.length,recoveredFromJournalDuringCleanup:recoveredCalls,verifiedSettled:servedCalls,networkAttempts:callAttempts},
 timing:{totalMs:round(finished-started),setupMs:round((steadyStarted??cleanupStarted)-started),steadyWindowMs:round(steadyMs),cleanupMs:round(finished-cleanupStarted),
  verifiedCallsPerSecond:steadyMs>0?Math.round(latencies.length*1000/steadyMs*1e6)/1e6:null,
  latencyMs:{sampleCount:latencies.length,min:sorted.length?round(sorted[0]):null,p50:percentile(.5),p95:percentile(.95),max:sorted.length?round(sorted.at(-1)):null,mean:sorted.length?round(sorted.reduce((a,b)=>a+b,0)/sorted.length):null}},
 accounting:{unit:'CINDER atom',openingFeesAtoms:openingFees.toString(),verifiedClosingFeesAtoms:closingFees.toString(),verifiedNetworkFeesAtoms:(openingFees+closingFees).toString(),
  verifiedResourceSettledAtoms:sumAtoms('settledAtoms').toString(),verifiedUnusedCollateralRefundedAtoms:sumAtoms('refundedAtoms').toString(),
  verifiedTotalCostAtoms:(openingFees+closingFees+sumAtoms('settledAtoms')).toString(),allKnownOpeningsSettled:channels.every(c=>Boolean(c.settlement))},
 channels:channels.map(c=>({index:c.index,channelId:c.channelId,capacity:c.capacity,confirmedOpen:c.confirmedOpen,notFoundAtCleanup:c.notFoundAtCleanup===true,
  acknowledgedCalls:c.acknowledged,recoveredCalls:c.recovered,openingTransactionHash:c.openingTransactionHash,settlement:c.settlement??null})),
 failures,cleanupFailures,interrupted,
 scope:'Measured short-window deterministic SHA-384 channel calls. Each channel is sequential; channels share one operator ledger. Latency includes local signing, transport, exact retries and SDK verification. Call acknowledgments are provisional; verified closing checkpoints settle collateral. No dollar-price, independent-consensus finality or sustained-one-hour throughput claim.',
 recovery:'Keys remain only in this process. Unknown opening IDs and close transaction IDs are public recovery context, not private credentials. Exact retries preserve authorizations; unresolved channels retain their configured automatic-expiry settlement path. No secret keys are exported.',
};
if(process.env.CINDER_REPORT)await fs.writeFile(process.env.CINDER_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!success)process.exitCode=1;
