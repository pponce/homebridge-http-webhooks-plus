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
for (const moduleName of variants) test(moduleName+' legacy families preserve services and command callback isolation', async t => {
 const hap=require(moduleName), storage=new Map();
 const platform={log:Object.assign(()=>{},{debug(){},info(){},warn(){},error(){}}),storage:{getItemSync:k=>storage.get(k),setItemSync:(k,v)=>storage.set(k,v)}};
 const families=[['Sensor',{type:'contact'},'ContactSensor'],['Switch',{},'Switch'],['PushButton',{},'Switch'],
  ['Doorbell',{},'Doorbell'],['LightBulb',{},'Lightbulb'],['Thermostat',{},'Thermostat'],['Outlet',{},'Outlet'],
  ['Security',{},'SecuritySystem'],['StatelessSwitch',{buttons:[{name:'Button',id:'button'}]},'StatelessProgrammableSwitch'],
  ['WindowCovering',{},'WindowCovering'],['Fanv2',{},'Fanv2'],['CarbonDioxideSensor',{},'CarbonDioxideSensor'],['Valve',{type:0},'Valve']];
 for (const [name,config,service] of families) {
  const Kind=require('../src/homekit/accessories/HttpWebHook'+name+'Accessory');
  const a=new Kind(hap.Service,hap.Characteristic,platform,{id:'sample-'+name,name:'Sample '+name,...config});
  const services=a.getServices();assert.ok(services.some(s=>s.UUID===hap.Service[service].UUID),name);
  assert.equal(services.find(s=>s.UUID===hap.Service.AccessoryInformation.UUID).getCharacteristic(hap.Characteristic.Manufacturer).value,'HttpWebHooksPlatform');
 }
 for (const [name,method,char] of [['Switch','setState','On'],['LightBulb','setState','On'],['Outlet','setState','On']]) {
  const Kind=require('../src/homekit/accessories/HttpWebHook'+name+'Accessory');
  const a=new Kind(hap.Service,hap.Characteristic,platform,{id:name,name,on_url:'http://127.0.0.1:1'});
  let calls=0;t.mock.method(Command,'send',(_o,cb)=>{calls++;cb(null);return ()=>{};});
  await new Promise((resolve,reject)=>a[method](true,e=>e?reject(e):resolve()));assert.equal(calls,1);
  await new Promise((resolve,reject)=>a[method](false,e=>e?reject(e):resolve(),require('../src/Constants').CONTEXT_FROM_WEBHOOK));assert.equal(calls,1);
 }
});
