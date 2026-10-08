// Real HAP characteristic contracts; no bridge advertising or device commands.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const Garage=require('../src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory');
const Lock=require('../src/homekit/accessories/HttpWebHookLockMechanismAccessory');
const Command=require('../src/CommandRequest');
const ActionApi=require('../src/ActionApi');
const Actions=require('../homebridge-ui/public/actions');
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
for (const moduleName of variants) test(moduleName+' external actions use every actual HomeKit SET handler and preserve report isolation', async t => {
 const hap=require(moduleName), dir=fs.mkdtempSync(path.join(os.tmpdir(),'webhooks-actions-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const values=new Map(), platform={cacheDirectory:path.join(dir,'storage'),log:Object.assign(()=>{},{debug(){},info(){},warn(){},error(){}}),
  storage:{getItemSync:key=>values.get(key),setItemSync:(key,value)=>values.set(key,value)}};
 const families={switches:'Switch',outlets:'Outlet',lights:'LightBulb',valves:'Valve',pushbuttons:'PushButton',
  garagedooropeners:'GarageDoorOpener',lockmechanisms:'LockMechanism',windowcoverings:'WindowCovering',thermostats:'Thermostat',security:'Security',fanv2s:'Fanv2'};
 const sent=[];t.mock.method(Command,'send',(options,callback)=>{sent.push(options);callback(null);return ()=>{};});
 for (const [family,name] of Object.entries(families)) {
  const config={id:family,name:'Test '+family,allow_external_actions:true,enableLockPhysicalControls:true,enableTargetStateControls:true,enableSwingModeControls:true,
   ...(family==='garagedooropeners'||family==='lockmechanisms'?{state_mode:'external'}:{})};
  const fields=Actions.fields(family,config);
  for (const field of fields) if(field.urlKey) {config[field.urlKey]='http://command.example/'+field.urlKey;config[field.urlKey.replace(/_url$/,'_method')]='POST';config[field.urlKey.replace(/_url$/,'_body')]='synthetic';}
  config.open_40_url='http://command.example/open_40_url';config.open_40_method='POST';config.open_40_body='synthetic';
  const Kind=require('../src/homekit/accessories/HttpWebHook'+name+'Accessory');
  const accessory=new Kind(hap.Service,hap.Characteristic,platform,config);
  if(accessory.close)t.after(()=>accessory.close());
  const runtime=new ActionApi({[family]:[config]},hap.Characteristic);
  for (const field of fields) {
   const before=sent.length, value=field.fixedValue ?? field.sample;
   await runtime.prepare(accessory,{accessoryId:family,action:'on',[Actions.parameter(field)]:Object.hasOwn(field,'fixedValue')?Actions.inputValue(field):String(value)})();
   assert.equal(sent.length,before+1,family+' '+field.key);
   assert.equal(sent.at(-1).url.href,Actions.commandURL(field,value,config));
   assert.equal(sent.at(-1).method,'POST');assert.equal(sent.at(-1).body,'synthetic');
   assert.equal(accessory.service.getCharacteristic(hap.Characteristic[field.characteristic]).value,value);
  }
  const before=sent.length;
  if(['switches','outlets','lights','valves'].includes(family))accessory.changeFromServer({state:'true'});
  if(['garagedooropeners','lockmechanisms'].includes(family)) {
   assert.equal(accessory.status().availability.currentState,'awaiting_feedback');
   accessory.apply({currentState:1});assert.equal(accessory.values.currentState,1);
  }
  assert.equal(sent.length,before,'state reports must not execute');
 }
});
