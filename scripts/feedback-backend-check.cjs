// Isolated Firestore emulator only. Actual callable handler, files and transactions.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {initializeApp,deleteApp}=require('../functions/node_modules/firebase-admin/app');
const {getFirestore}=require('../functions/node_modules/firebase-admin/firestore');
const {feedbackFunctions}=require('../functions/lib/feedback-server');
const {businessDay}=require('../functions/lib/dates');
async function main(){
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Emulator required');
 const app=initializeApp({projectId:'demo-alatheel'},'feedback-qa'),db=getFirestore(app);
 const {appFeedback}=feedbackFunctions(db,async request=>{if(!request.auth)throw new Error('Authentication required');});
 const call=(data,uid='feedback-admin')=>appFeedback.run({data,auth:{uid,token:{}}});
 const base={role:'admin',membershipApproved:true,disabled:false,displayName:'مدير تجريبي'};
 try{
  await db.doc('users/feedback-admin').set(base);
  await db.doc('users/feedback-employee').set({...base,role:'employee'});
  await db.doc('users/feedback-owner').set({...base,role:'owner'});
  await db.doc('users/feedback-disabled').set({...base,disabled:true});
  const bytes=Buffer.alloc(384*1024+17,65),file={name:'فحص.txt',size:bytes.length,mime:'text/plain',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const create={action:'create',id:'feedback_sample',text:'اختبار محلي فقط',version:'1.10.1',files:[file]};
  for(const uid of ['feedback-employee','feedback-owner','feedback-disabled'])await assert.rejects(()=>call(create,uid));
  await assert.rejects(()=>appFeedback.run({data:create}));
  const first=await call(create);assert.equal(first.syncState,'draft');
  await call(create);assert.equal((await db.doc('feedbackUsage/feedback-admin_'+businessDay(new Date().toISOString())).get()).data().count,1);
  await assert.rejects(()=>call({...create,text:'different payload'}));
  await assert.rejects(()=>call({action:'submit',id:create.id}));
  const upload={action:'upload',id:create.id,file:0,chunk:0,base64:bytes.subarray(0,384*1024).toString('base64')};
  // Upload the tail first: reconstruction must follow chunk numbers, not document order.
  await call({...upload,chunk:1,base64:bytes.subarray(384*1024).toString('base64')});
  await call(upload);await call(upload);
  await assert.rejects(()=>call({...upload,chunk:2}));
  await assert.rejects(()=>call({...upload,base64:Buffer.alloc(384*1024,5).toString('base64')}));
  await call({action:'submit',id:create.id});await call({action:'submit',id:create.id});
  assert.equal((await call(create)).syncState,'queued');
  await assert.rejects(()=>call(upload));
  const download=await call({action:'download',id:create.id,file:0});assert.equal(download.base64,bytes.toString('base64'));
  await assert.rejects(()=>call({action:'download',id:create.id,file:0},'feedback-employee'));
  await call({action:'status',id:create.id,status:'discussion'});
  assert.equal((await db.doc('appFeedback/'+create.id).get()).data().status,'discussion');
  await assert.rejects(()=>call({action:'status',id:create.id,status:'bad'}));
  await assert.rejects(()=>call({action:'retry',id:create.id}));
  await db.doc('appFeedback/'+create.id).update({syncState:'failed'});await call({action:'retry',id:create.id});
  assert.equal((await db.doc('appFeedback/'+create.id).get()).data().syncState,'queued');
  console.log('PASS feedback callable authorization, exact file integrity, missing chunks, immutable uploads, retries, limits and idempotent submission');
 }finally{await deleteApp(app);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
