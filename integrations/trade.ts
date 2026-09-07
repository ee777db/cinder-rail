import {nativeHash} from '../sdk/native-client.ts';
/** Fee allocation only; never submits a broker order or attests that an order filled. */
export function tradeFeeAction(event:{id:string;venue:string;amountAtoms:string;recipients:Array<{address:string,bps:number}>}){
  if(!event.id||!event.venue)throw new Error('An explicit venue/event reference is required.');
  return {type:'split',app:'trade',referenceHash:nativeHash('cinder-trade-fee-v1:'+event.venue+':'+event.id),units:1,amountAtoms:event.amountAtoms,recipients:event.recipients};
}
