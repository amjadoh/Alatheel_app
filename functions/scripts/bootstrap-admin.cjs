// Run only with Application Default Credentials controlled by the project owner.
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
initializeApp();
(async()=>{const email=process.argv[2];if(!email)throw Error('Usage: node scripts/bootstrap-admin.cjs admin@example.com');
 const user=await getAuth().getUserByEmail(email);if(!user.emailVerified)throw Error('Sign in with Google first to verify this email.');
 await getFirestore(process.env.FIRESTORE_DATABASE_ID||'(default)').doc('users/'+user.uid).set({uid:user.uid,email:user.email,displayName:user.displayName||'مدير الإسطبل',role:'admin',disabled:false},{merge:true});console.log('Administrator provisioned:',user.uid);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
