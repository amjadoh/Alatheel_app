const {spawnSync}=require('node:child_process');
for(const script of ['scripts/rules-check.cjs','scripts/feedback-backend-check.cjs']){
  const run=spawnSync(process.execPath,[script],{stdio:'inherit',env:process.env});
  if(run.status!==0)process.exit(run.status||1);
}
