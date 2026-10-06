import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CinderNativeClient,nativeHash} from '../public/native-sdk.js';
const url=process.env.CINDER_URL||'http://127.0.0.1:8899',count=Number(process.env.CINDER_CALLS||100);assert.ok(Number.isSafeInteger(count)&&count>=1&&count<=10000);
const c=new CinderNativeClient(url);await c.connect();const owner=await c.createWallet();await c.claimFaucet(owner);const started=performance.now(),opened=await c.openChannel(owner,count,3600000),id=opened.channel.channelId,times=[];let previous=opened.channel.journalHead,last;
for(let i=1;i<=count;i++){
 const start=performance.now(),envelope=c.authorizeChannelCall(opened.sessionKey,id,i,'Cinder channel workload '+i);last=await c.submitChannelCall(envelope,opened.sessionKey.publicKey,previous);previous=last.result.journalHash;times.push(performance.now()-start);
 if(i===1){const replay=await c.submitChannelCall(envelope,opened.sessionKey.publicKey,opened.channel.journalHead);assert.equal(replay.replayed,true);const wrong=c.authorizeChannelCall(opened.sessionKey,id,i,'Changed input');await assert.rejects(c.submitChannelCall(wrong,opened.sessionKey.publicKey));}
 if(i%1000===0)console.log('Verified '+i+' collateral-backed calls');
}
const closed=await c.closeChannel(owner,id);assert.equal(closed.receipt.result.callCount,count);assert.equal(closed.receipt.result.journalHead,previous);assert.equal(closed.receipt.result.settledAtoms,String(count*100));assert.equal(closed.receipt.result.refundedAtoms,'0');assert.equal((await c.channel(id)).status,'closed');
const sorted=[...times].sort((a,b)=>a-b),durationMs=performance.now()-started,report={network:url,checkedAt:new Date().toISOString(),channelId:id,calls:count,checkpointsForOpenAndClose:2,networkFeesAtoms:'24',networkFeeAtomsPerCall:24/count,resourceAtomsPerCall:100,totalDurationMs:Math.round(durationMs),callsPerSecond:Number((count*1000/durationMs).toFixed(2)),medianEndToEndMs:Number(sorted[Math.floor(count/2)].toFixed(2)),p95EndToEndMs:Number(sorted[Math.min(count-1,Math.floor(count*.95))].toFixed(2)),clientIncludesSigningAndVerification:true,settlement:closed.txHash,scope:'Measured HTTP session-authorized calls, with durable collateral reservations and later operator-checkpoint settlement. Not decentralized finality or a dollar-price benchmark.'};
if(process.env.CINDER_REPORT)await fs.writeFile(process.env.CINDER_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
