// Real HAP characteristic contracts; no bridge advertising or device commands.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const Garage=require('../src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory');
const Lock=require('../src/homekit/accessories/HttpWebHookLockMechanismAccessory');
const Command=require('../src/CommandRequest');
const variants=['hap-nodejs'];if(Number(process.versions.node.split('.')[0])>=22)variants.push('@homebridge/hap-nodejs');
for(const moduleName of variants){
 const hap=require(moduleName);
 for(const Kind of [Garage,Lock])test(moduleName+' '+Kind.name+' preserves identity, errors, events and SET isolation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'webhooks-hap-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const storage=require('node-persist').create({dir:path.join(dir,'storage')});storage.initSync();
  const platform={storage,cacheDirectory:path.join(dir,'storage'),log:Object.assign(()=>{},{error(){},debug(){}})};
  const a=new Kind(hap.Service,hap.Characteristic,platform,{id:'demo',name:'Demo',state_mode:'external',notification_policy:'allow_explicit'});
  assert.equal(a.service.UUID,Kind===Garage?hap.Service.GarageDoorOpener.UUID:hap.Service.LockMechanism.UUID);
  assert.equal(a.service.displayName,'Demo');assert.equal(a.informationService.getCharacteristic(hap.Characteristic.Manufacturer).value,'HttpWebHooksPlatform');
  await assert.rejects(a.characteristics.currentState.handleGetRequest());
  let commands=0;t.mock.method(Command,'send',(_,cb)=>{commands++;cb(null);});
  let events=[];a.characteristics.currentState.on('change',e=>events.push(e));
  a.apply({currentState:0,targetState:0,notify:true});assert.equal(commands,0);assert.equal(events.at(-1).reason,'event');
  assert.equal(await a.characteristics.currentState.handleGetRequest(),0);
  await a.characteristics.targetState.handleSetRequest(1);assert.equal(commands,1);
  assert.equal(await a.characteristics.currentState.handleGetRequest(),0);
  const pending=[];t.mock.method(Command,'send',(_,cb)=>pending.push(cb));
  const write=a.characteristics.targetState.handleSetRequest(0);
  a.apply({currentState:1,targetState:1});pending[0](null);await assert.rejects(write);
  assert.equal(await a.characteristics.targetState.handleGetRequest(),1);assert.equal(a.characteristics.targetState.value,1);
  // Separate atomic snapshots must coexist with node-persist on a real restart.
  const restored=require('node-persist').create({dir:platform.cacheDirectory});restored.initSync();
  const b=new Kind(hap.Service,hap.Characteristic,{...platform,storage:restored},{id:'demo',name:'Demo',state_mode:'external',startup_state_policy:'use_cache'});
  assert.equal(await b.characteristics.currentState.handleGetRequest(),1);
 });
}

for (const moduleName of variants) for (const Kind of [Garage, Lock]) {
 test(moduleName+' '+Kind.name+' expires and recovers actual HAP reads without SET events', async t => {
  const hap=require(moduleName), dir=fs.mkdtempSync(path.join(os.tmpdir(),'webhooks-freshness-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const storage=require('node-persist').create({dir:path.join(dir,'storage')});storage.initSync();
  const a=new Kind(hap.Service,hap.Characteristic,{storage,cacheDirectory:path.join(dir,'storage'),log:{}},
   {id:'freshness',name:'Freshness',state_mode:'external',feedback_timeout_seconds:0.03,
    ...(Kind===Garage?{obstruction_monitoring:true,obstruction_timeout_seconds:0.03}:{})});
  t.after(()=>a.close());let writes=0;a.characteristics.targetState.on('set',()=>{writes++;});
  a.apply({currentState:1,...(Kind===Garage?{obstruction:false}:{})});
  assert.equal(await a.characteristics.currentState.handleGetRequest(),1);
  await new Promise(resolve=>setTimeout(resolve,70));
  await assert.rejects(a.characteristics.currentState.handleGetRequest());
  if(Kind===Garage) await assert.rejects(a.characteristics.obstruction.handleGetRequest());
  a.apply({currentState:0,...(Kind===Garage?{obstruction:false}:{})});
  assert.equal(await a.characteristics.currentState.handleGetRequest(),0);
  if(Kind===Garage) assert.equal(await a.characteristics.obstruction.handleGetRequest(),false);
  assert.equal(writes,0);
 });
}
