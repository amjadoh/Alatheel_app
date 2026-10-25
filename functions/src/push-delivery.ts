import type { Row } from './domain';
import { deviceWantsAlert, type StaffAlert } from './alerts';
const invalidCodes=new Set(['messaging/registration-token-not-registered','messaging/invalid-registration-token']);
export function pushDeliveryPlan(devices:Row[],alert:StaffAlert & {pushDeliveredDeviceIds?:string[]},now=Date.now()) {
  const delivered=new Set(alert.pushDeliveredDeviceIds||[]);
  const targets=devices.filter(d=>deviceWantsAlert(d,alert,now)&&!delivered.has(d.id));
  const idleState=delivered.size ? 'sent' : alert.kind==='app_update'&&devices.length>0&&devices.every(d=>Number(d.installedVersionCode||0)>=Number(alert.versionCode)) ? 'not_needed' : 'waiting_device';
  return {targets,idleState};
}
export function pushDeliveryResults(ids:string[],responses:{success:boolean;error?:{code?:string}}[],previous:string[]=[]) {
  if(ids.length!==responses.length||!ids.length)throw new Error('Incomplete push result');
  const delivered=new Set(previous),invalid:string[]=[];let failures=0;
  responses.forEach((r,i)=>{if(r.success)delivered.add(ids[i]);else if(invalidCodes.has(r.error?.code||''))invalid.push(ids[i]);else failures++;});
  return {state:failures?'pending':delivered.size?'sent':'waiting_device',deliveredIds:[...delivered],invalidIds:invalid,successCount:delivered.size,transientCount:failures};
}
