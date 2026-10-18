import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
export const androidPush = Capacitor.getPlatform() === "android";
export type PushOpen = { alertId: string; userId: string };
export interface StaffPushAPI {
  status(): Promise<{enabled:boolean}>;
  enable(): Promise<{enabled:boolean;token?:string}>;
  token(): Promise<{enabled:boolean;token:string}>;
  session(value:{userId:string;deviceId:string}):Promise<void>;
  disable():Promise<void>;
  pending():Promise<PushOpen>;
  addListener(event:"open",handler:(value:PushOpen)=>void):Promise<PluginListenerHandle>;
}
export const StaffPush=registerPlugin<StaffPushAPI>("StaffPush");
export function pushDeviceId(){const key="alatheel.push.device";let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}return id;}
