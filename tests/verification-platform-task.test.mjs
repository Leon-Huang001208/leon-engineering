import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {planGitVerification, planVerification, validateVerificationReceipt} from '../lib/verification/index.mjs';

function fixture(t,customizePolicy) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'leon-platform-task-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
  git(['init','-q']);git(['config','user.email','test@example.invalid']);git(['config','user.name','Test']);
  fs.mkdirSync(path.join(root,'.agents'));fs.mkdirSync(path.join(root,'src-tauri'));
  const policy=JSON.parse(fs.readFileSync(new URL('./fixtures/verification/rwb-v3/verification-policy.json',import.meta.url)));
  customizePolicy?.(policy);fs.writeFileSync(path.join(root,'.agents/verification-policy.json'),JSON.stringify(policy));
  fs.writeFileSync(path.join(root,'src-tauri/config.json'),'base');fs.writeFileSync(path.join(root,'evidence.txt'),'fixture evidence');
  git(['add','.']);git(['commit','-qm','base']);const base=git(['rev-parse','HEAD']);
  fs.writeFileSync(path.join(root,'src-tauri/config.json'),'candidate');git(['add','.']);git(['commit','-qm','candidate']);
  const candidate=git(['rev-parse','HEAD']);
  const task={hostPlatform:'macos',taskKind:'feature-development',objective:'Platform evidence contract',acceptanceScope:'Current host checks',candidateCommit:candidate,candidateBaseCommit:base,supplementalGateIds:[]};
  const plan=planGitVerification({projectRoot:root,base,task});
  const records=path.join(root,'.git','leon-engineering','verification');fs.mkdirSync(records,{recursive:true});
  const planPath=path.join(records,'plan.json'),receiptPath=path.join(records,'receipt.json');
  const receipt={schemaVersion:3,binding:plan.binding,task:plan.task,changeSummary:plan.changeSummary,changedFiles:plan.changedFiles,plannedLevel:plan.requiredLevel,actualLevel:plan.requiredLevel,components:plan.components,platforms:plan.platforms,impact:plan.impact,
    executed:plan.receiptTemplate.requiredValidationIds.map(id=>({id,level:[...plan.tests,...plan.documentation].find(x=>x.id===id).level,status:'PASS',durationSeconds:1,source:'runner',runnerPlatform:'macos',evidence:'evidence.txt'})),
    external:plan.receiptTemplate.externalGateIds.map(id=>id==='macos-ci'?{id,status:'PASS',source:'ci',evidence:'evidence.txt',runnerPlatform:'macos',runId:'123',workflow:'.github/workflows/desktop.yml#macos',candidateCommit:candidate,checkoutCommit:candidate,expectedCheckoutCommit:candidate,checkoutKind:'candidate-head'}:{id,status:'NOT_RUN',source:'ci',evidence:'evidence.txt'}),
    realMachine:plan.receiptTemplate.releaseGateIds.map(id=>({id,status:'NOT_RUN',source:'manual',evidence:'evidence.txt'})),result:'PASS',mergeReady:false,releaseReady:false,hostAcceptance:'PASS',aggregateAcceptance:'NOT_READY',platformHandoffs:[{platform:'linux',status:'NOT_RUN',gateIds:[]},{platform:'windows',status:'NOT_RUN',gateIds:['windows-ci','windows-installation']}],uncoveredRisks:['external_gate_not_run:windows-ci','real_machine_not_run:windows-installation'],escalation:{required:false,targetLevel:null,reasons:[]}};
  const validate=(r=receipt,p=plan)=>{fs.writeFileSync(planPath,JSON.stringify(p));fs.writeFileSync(receiptPath,JSON.stringify(r));return validateVerificationReceipt({projectRoot:root,planPath,receiptPath});};
  return {root,base,task,plan,receipt,validate,git};
}

test('platform task preserves total gates while host passes and other platform remains unverified',t=>{
  const f=fixture(t);assert.equal(f.plan.schemaVersion,4);assert.equal(f.validate().hostAcceptance,'PASS');assert.equal(f.validate().aggregateAcceptance,'NOT_READY');
});
test('legacy planning without context remains plan v3',t=>{const f=fixture(t);assert.equal(planGitVerification({projectRoot:f.root,base:f.base}).schemaVersion,3);});
for(const [name,mutate] of [
  ['wrong CI runner',r=>r.external[0].runnerPlatform='linux'],
  ['old candidate',r=>r.external[0].candidateCommit='0'.repeat(40)],
  ['wrong checkout',r=>r.external[0].checkoutCommit='0'.repeat(40)],
  ['missing handoff',r=>r.platformHandoffs=[]],
  ['removed total gate',r=>r.external.pop()],
  ['false aggregate ready',r=>r.aggregateAcceptance='READY'],
  ['wrong native machine',r=>{r.realMachine[0]={...r.realMachine[0],status:'PASS',machinePlatform:'macos'};}],
  ['unrelated preview head',r=>{Object.assign(r.external[0],{checkoutKind:'merge-preview',checkoutCommit:'1'.repeat(40),expectedCheckoutCommit:'1'.repeat(40),headCommit:'0'.repeat(40),baseCommit:r.task.candidateBaseCommit});}],
]) test(name+' is rejected',t=>{const f=fixture(t);const r=structuredClone(f.receipt);mutate(r);assert.throws(()=>f.validate(r));});
test('task context drift invalidates canonical bound plan',t=>{const f=fixture(t);const p=structuredClone(f.plan);p.task.objective='changed objective';assert.throws(()=>f.validate(f.receipt,p));});
test('only registered supplemental gates may be selected',t=>{const f=fixture(t);assert.throws(()=>planGitVerification({projectRoot:f.root,base:f.base,task:{...f.task,supplementalGateIds:['shell arbitrary command']}}));});
test('registered supplemental gates extend the closure without changing source lanes',t=>{
  const f=fixture(t);const plan=planGitVerification({projectRoot:f.root,base:f.base,task:{...f.task,supplementalGateIds:['project-ci']}});
  assert.equal(plan.ci.length,f.plan.ci.length+1);assert.ok(plan.ci.some(gate=>gate.id==='project-ci' && gate.lane==='ci'));assert.deepEqual(plan.changedFiles,f.plan.changedFiles);
});
test('valid merge preview must retain candidate head and base identity',t=>{
  const f=fixture(t);const preview=f.git(['commit-tree',`${f.task.candidateCommit}^{tree}`,'-p',f.task.candidateBaseCommit,'-p',f.task.candidateCommit,'-m','actual fixture merge preview']);const r=structuredClone(f.receipt);Object.assign(r.external[0],{checkoutKind:'merge-preview',checkoutCommit:preview,expectedCheckoutCommit:preview,headCommit:f.task.candidateCommit,baseCommit:f.task.candidateBaseCommit});assert.equal(f.validate(r).hostAcceptance,'PASS');
});
test('another platform failure remains a handoff without falsely failing the host',t=>{
  const f=fixture(t);const r=structuredClone(f.receipt);r.external[1].status='FAIL';r.platformHandoffs.find(item=>item.platform==='windows').status='FAIL';assert.equal(f.validate(r).result,'PASS');assert.equal(f.validate(r).aggregateAcceptance,'NOT_READY');
});
test('unexecuted host checks cannot produce host PASS',t=>{
  const f=fixture(t);const r=structuredClone(f.receipt);r.executed[0].status='NOT_RUN';assert.throws(()=>f.validate(r));r.hostAcceptance='BLOCKED';r.result='BLOCKED';assert.equal(f.validate(r).hostAcceptance,'BLOCKED');
});
test('CI cannot certify changed bytes outside the candidate commit',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'src-tauri/config.json'),'uncommitted');const p=planGitVerification({projectRoot:f.root,base:f.base,task:f.task});const r=structuredClone(f.receipt);r.binding=p.binding;assert.throws(()=>f.validate(r,p),/uncommitted candidate/);
});
test('planner does not modify the project or execute catalog commands',t=>{
  const f=fixture(t);const before=f.git(['status','--porcelain']);const policy=fs.readFileSync(path.join(f.root,'.agents/verification-policy.json'));planGitVerification({projectRoot:f.root,base:f.base,task:f.task});assert.equal(f.git(['status','--porcelain']),before);assert.deepEqual(fs.readFileSync(path.join(f.root,'.agents/verification-policy.json')),policy);assert.equal(fs.existsSync(path.join(f.root,'logs')),false);
});
test('supplemental depth preserves higher-level gates from the original matched rule',t=>{
  const f=fixture(t);const file=path.join(f.root,'.agents/verification-policy.json');const policy=JSON.parse(fs.readFileSync(file));policy.rules[1].minimumLevel='L1';fs.writeFileSync(file,JSON.stringify(policy));
  const p=planVerification({projectRoot:f.root,changedFiles:['src-tauri/config.json'],task:{...f.task,supplementalGateIds:['project-ci']}});
  assert.equal(p.requiredLevel,'L4');assert.ok(p.tests.some(gate=>gate.id==='desktop-test'));assert.ok(p.ci.some(gate=>gate.id==='windows-ci'));
});
test('canonical CLI accepts a safe task JSON and remains read-only',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'.git/task.json'),JSON.stringify(f.task));const before=f.git(['status','--porcelain']);
  const result=spawnSync(process.execPath,[new URL('../scripts/verification-plan.mjs',import.meta.url).pathname,'--project',f.root,'--base',f.base,'--task-context','.git/task.json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),f.plan);assert.equal(f.git(['status','--porcelain']),before);
});
test('new schemas describe native CI and task fields without changing legacy schemas',()=>{
  const plan=JSON.parse(fs.readFileSync(new URL('../schemas/verification-plan-v4.schema.json',import.meta.url)));const receipt=JSON.parse(fs.readFileSync(new URL('../schemas/verification-receipt-v3.schema.json',import.meta.url)));
  assert.equal(plan.properties.schemaVersion.const,4);assert.ok(plan.required.includes('task'));assert.equal(receipt.properties.schemaVersion.const,3);assert.ok(receipt.required.includes('platformHandoffs'));assert.ok(receipt.$defs.external.allOf[0].then.required.includes('expectedCheckoutCommit'));
  assert.equal(plan.required.includes('binding'),false);assert.equal(plan.required.includes('changeSet'),false);
  assert.deepEqual(plan.dependentRequired,{binding:['changeSet'],changeSet:['binding']});assert.ok(receipt.required.includes('binding'));
});
test('unbound platform receipts cannot certify acceptance',t=>{
  const f=fixture(t);const p=structuredClone(f.plan),r=structuredClone(f.receipt);delete p.binding;delete p.changeSet;delete r.binding;assert.throws(()=>f.validate(r,p),/Git-bound plan/);
});
test('legacy receipts cannot be used to certify a platform task',t=>{
  const f=fixture(t);const r=structuredClone(f.receipt);r.schemaVersion=2;assert.throws(()=>f.validate(r),/requires receipt v3/);
});
test('a single native runner cannot certify a multi-platform CI gate',t=>{
  const f=fixture(t);const file=path.join(f.root,'.agents/verification-policy.json');const policy=JSON.parse(fs.readFileSync(file));policy.catalogs.ci['macos-ci'].platforms=['macos','windows'];fs.writeFileSync(file,JSON.stringify(policy));f.git(['add','.']);f.git(['commit','-qm','native scope']);
  const task={...f.task,candidateCommit:f.git(['rev-parse','HEAD'])};const p=planGitVerification({projectRoot:f.root,base:f.base,task});const r=structuredClone(f.receipt);r.binding=p.binding;r.task=p.task;r.changeSummary=p.changeSummary;r.changedFiles=p.changedFiles;r.impact=p.impact;r.external[0].candidateCommit=task.candidateCommit;r.external[0].checkoutCommit=task.candidateCommit;r.external[0].expectedCheckoutCommit=task.candidateCommit;
  r.components=p.components;r.platforms=p.platforms;
  r.executed=p.local.map(gate=>({id:gate.id,level:gate.level,status:'PASS',durationSeconds:1,source:'runner',runnerPlatform:'macos',evidence:'evidence.txt'}));
  r.external=p.ci.map(gate=>r.external.find(item=>item.id===gate.id) ?? {id:gate.id,status:'NOT_RUN',source:'ci',evidence:'evidence.txt'});
  r.uncoveredRisks=r.external.filter(item=>item.status==='NOT_RUN').map(item=>`external_gate_not_run:${item.id}`).concat(r.realMachine.map(item=>`real_machine_not_run:${item.id}`));
  assert.throws(()=>f.validate(r,p),/CI runner or checkout identity/);
});
test('cross-platform impact with only Linux and Mac gates cannot become aggregate READY',t=>{
  const f=fixture(t);const file=path.join(f.root,'.agents/verification-policy.json');const policy=JSON.parse(fs.readFileSync(file));
  policy.catalogs.ci['linux-ci']={...policy.catalogs.ci['windows-ci'],platforms:['linux'],value:'.github/workflows/desktop.yml#linux'};
  policy.rules[1].platforms=['linux','macos','cross-platform'];policy.rules[1].ci=['macos-ci','linux-ci'];policy.rules[1].realMachine=[];
  fs.writeFileSync(file,JSON.stringify(policy));f.git(['add','.']);f.git(['commit','-qm','explicit Linux and Mac gates']);
  const task={...f.task,candidateCommit:f.git(['rev-parse','HEAD'])},p=planGitVerification({projectRoot:f.root,base:f.base,task});
  const r={...f.receipt,binding:p.binding,task:p.task,changeSummary:p.changeSummary,changedFiles:p.changedFiles,components:p.components,platforms:p.platforms,impact:p.impact,uncoveredRisks:[],mergeReady:true,releaseReady:false};
  r.executed=p.local.map(gate=>({id:gate.id,level:gate.level,status:'PASS',durationSeconds:1,source:'runner',runnerPlatform:'macos',evidence:'evidence.txt'}));
  r.external=p.ci.map(gate=>({id:gate.id,status:'PASS',source:'ci',evidence:'evidence.txt',runnerPlatform:gate.platforms.includes('linux')?'linux':'macos',runId:'123',workflow:gate.value,candidateCommit:task.candidateCommit,checkoutCommit:task.candidateCommit,expectedCheckoutCommit:task.candidateCommit,checkoutKind:'candidate-head'}));
  r.realMachine=[];r.platformHandoffs=[{platform:'linux',status:'PASS',gateIds:['linux-ci']},{platform:'windows',status:'NOT_RUN',gateIds:[]}];
  assert.equal(f.validate(r,p).aggregateAcceptance,'NOT_READY');
  assert.deepEqual(f.validate(r,p).platformHandoffs[1],{platform:'windows',status:'NOT_RUN',gateIds:[]});
  assert.throws(()=>f.validate({...r,aggregateAcceptance:'READY',releaseReady:true},p),/inconsistent with evidence/);
});
test('multi-native local PASS certifies only its actual runner and leaves the other native target unverified',t=>{
  const f=fixture(t,policy=>{
    policy.catalogs.tests['desktop-test'].platforms=['macos','windows'];
    policy.rules[1].platforms=['macos','windows'];policy.rules[1].ci=[];policy.rules[1].realMachine=[];
  });
  const r={...f.receipt,external:[],realMachine:[],mergeReady:true,releaseReady:false,aggregateAcceptance:'NOT_READY',platformHandoffs:[{platform:'windows',status:'NOT_RUN',gateIds:['desktop-test']}],uncoveredRisks:[]};
  assert.equal(f.validate(r).hostAcceptance,'PASS');assert.equal(f.validate(r).aggregateAcceptance,'NOT_READY');
  assert.throws(()=>f.validate({...r,releaseReady:true,aggregateAcceptance:'READY',platformHandoffs:[{platform:'windows',status:'PASS',gateIds:['desktop-test']}]}),/inconsistent with evidence/);
});
for(const [name,checkout] of [
  ['unavailable merge object',f=>'1'.repeat(40)],
  ['nonmerge commit with self-reported parents',f=>f.task.candidateCommit],
  ['wrong actual merge parents',f=>f.git(['commit-tree',`${f.task.candidateCommit}^{tree}`,'-p',f.task.candidateCommit,'-p',f.task.candidateBaseCommit,'-m','reversed parents'])],
  ['blob containing forged commit headers',f=>execFileSync('git',['-C',f.root,'hash-object','-w','--stdin'],{encoding:'utf8',input:`tree ${f.git(['rev-parse',`${f.task.candidateCommit}^{tree}`])}\nparent ${f.task.candidateBaseCommit}\nparent ${f.task.candidateCommit}\n\nforged commit text\n`}).trim()],
]) test(name+' cannot certify CI checkout',t=>{
  const f=fixture(t),commit=checkout(f),r=structuredClone(f.receipt);Object.assign(r.external[0],{checkoutKind:'merge-preview',checkoutCommit:commit,expectedCheckoutCommit:commit,headCommit:f.task.candidateCommit,baseCommit:f.task.candidateBaseCommit});
  assert.throws(()=>f.validate(r),/merge preview/);
});
