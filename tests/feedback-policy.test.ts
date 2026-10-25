import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { feedbackManifest, validateBridgeClaims, verifyBridgeToken, FEEDBACK_LIMITS as L } from "../functions/src/feedback-policy";
const file = { name: "صورة.png", size: 24, mime: "image/png", sha256: "a".repeat(64) };
const data = { text: "ملاحظة", version: "1.10.1", files: [file] };
test("feedback supports text-only, files-only, Arabic filenames and explicit bounded file chunks",()=>{
  assert.equal(feedbackManifest({ ...data, files: [] }).text,"ملاحظة");
  assert.equal(feedbackManifest({ ...data, text: "" }).files.length,1);
  assert.equal(feedbackManifest(data).files[0].chunks,1);
  assert.equal(feedbackManifest({ ...data, files:[{...file,size:L.fileBytes}] }).files[0].chunks,27);
});
test("invalid and oversized attachments, path characters, empty notes and long text are handled",()=>{
  for(const input of [{...data,text:"",files:[]},{...data,text:"x".repeat(6001)}, {...data,files:Array(6).fill(file)}, {...data,files:[{...file,size:L.fileBytes+1}]}, {...data,files:[{...file,size:0}]}, {...data,files:[{...file,size:1.5}]}, {...data,files:[{...file,name:"attack.html"}]}, {...data,files:[{...file,sha256:"invalid"}]}, {...data,files:Array(3).fill({...file,size:L.fileBytes})}])assert.throws(()=>feedbackManifest(input));
  assert.equal(feedbackManifest({...data,files:[{...file,name:"../فحص.png"}]}).files[0].name,".._فحص.png");
});
const now=Date.parse("2026-10-25T10:00:00Z");
const claims={iss:"https://token.actions.githubusercontent.com",aud:"alatheel-app-feedback",sub:"repo:amjadoh/Alatheel_app:ref:refs/heads/main",repository:"amjadoh/Alatheel_app",repository_id:"1418505579",repository_owner_id:"341951948",repository_visibility:"private",ref:"refs/heads/main",workflow_ref:"amjadoh/Alatheel_app/.github/workflows/feedback-sync.yml@refs/heads/main",event_name:"schedule",run_id:"123456",run_attempt:"1",nbf:now/1000-10,exp:now/1000+300};
test("feedback bridge admits only the exact private repository workflow, audience and live token",()=>{
  assert.equal(validateBridgeClaims(claims,now),"123456:1");
  for(const changed of [{aud:"other"},{iss:"other"},{sub:"repo:other"},{repository:"attacker/fork"},{repository_id:"4"},{repository_owner_id:"4"},{repository_visibility:"public"},{ref:"refs/heads/app-feedback"},{workflow_ref:"amjadoh/Alatheel_app/.github/workflows/other.yml@refs/heads/main"},{event_name:"pull_request"},{exp:now/1000-1},{exp:now/1000+10000},{nbf:now/1000+100},{run_id:"../bad"}])assert.throws(()=>validateBridgeClaims({...claims,...changed},now));
});
test("a real RSA signature is required; changed payload, algorithm and missing signatures are rejected",async()=>{
  const keys=generateKeyPairSync("rsa",{modulusLength:2048});
  const encode=(v:any)=>Buffer.from(JSON.stringify(v)).toString("base64url");
  const first=encode({alg:"RS256",kid:"test"})+"."+encode(claims);
  const token=first+"."+sign("RSA-SHA256",Buffer.from(first),keys.privateKey).toString("base64url");
  assert.equal(await verifyBridgeToken(token,async()=>keys.publicKey,now),"123456:1");
  await assert.rejects(()=>verifyBridgeToken(token.replace(encode(claims),encode({...claims,repository:"other/repo"})),async()=>keys.publicKey,now));
  await assert.rejects(()=>verifyBridgeToken(encode({alg:"none",kid:"test"})+"."+encode(claims)+".",async()=>keys.publicKey,now));
  await assert.rejects(()=>verifyBridgeToken("a.b",async()=>keys.publicKey,now));
});
