import {nativeHash} from '../sdk/native-client.ts';
/**
 * Adapter only. HEARD currently publishes a recruiting page, not live music payouts.
 * A publisher supplies its finalized batch commitment and explicit devnet addresses.
 * This never marks HEARD fiat liabilities as paid, nor treats listens as verified.
 */
export function heardSettlementAction(batch:{status:'closed';id:string;commitment:string;paidEvents:number;amountAtoms:string;recipients:Array<{address:string,bps:number}>}){
  if(batch.status!=='closed'||!batch.id||!batch.commitment||!Number.isSafeInteger(batch.paidEvents)||batch.paidEvents<1)throw new Error('A finalized, identified settlement batch is required.');
  return {type:'split',app:'music',referenceHash:nativeHash('heard-closed-settlement-v1:'+batch.id+':'+batch.commitment),units:batch.paidEvents,amountAtoms:batch.amountAtoms,recipients:batch.recipients};
}
