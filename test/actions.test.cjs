const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Actions = require('../homebridge-ui/public/actions');
const Api = require('../homebridge-ui/public/api');
const ActionApi = require('../src/ActionApi');
const Server = require('../src/Server');
const Requests = require('../homebridge-ui/requests');

const devices = {
  switches: {}, outlets: {}, lights: {}, valves: {}, pushbuttons: {}, garagedooropeners: {}, lockmechanisms: {},
  windowcoverings: {}, thermostats: {}, security: {},
  fanv2s: {enableLockPhysicalControls:true, enableTargetStateControls:true, enableSwingModeControls:true},
  sensors: {type:'contact'}, co2sensors: {}, doorbells: {}, statelessswitches: {}
};
test('every control maps to an existing SET characteristic and generates the execution flag with one control', () => {
  let count = 0;
  for (const [family, config] of Object.entries(devices)) {
    const device = {id:'sample', ...config};
    const fields = Actions.fields(family, device);
    if (['sensors','co2sensors','doorbells','statelessswitches'].includes(family)) {assert.equal(fields.length, 0); continue;}
    assert.ok(fields.length, family);
    const chars = {}, calls = [];
    const accessory = {id:'sample',service:{characteristics:fields.map(field => {
      chars[field.characteristic] = {UUID:field.characteristic};
      if (field.urlKey) device[field.urlKey] = 'http://command.example';
      return {UUID:field.characteristic, setValue:(value, cb, context) => {calls.push([field.characteristic,value,context]);cb();}};
    })}};
    device.open_40_url = 'http://command.example'; device.allow_external_actions = true;
    const runtime = new ActionApi({[family]:[device]}, chars);
    for (const field of fields) {
      count++;
      const request = Api.buildAction({}, device, field, String(field.sample ?? ''), 'bridge');
      const params = Object.fromEntries(new URL(request.endpoint).searchParams);
      assert.equal(params.action, 'on'); assert.equal(Object.keys(params).length, 3);
      runtime.prepare(accessory, params)();
      assert.equal(calls.at(-1)[0], field.characteristic);
      assert.equal(calls.at(-1)[1], field.fixedValue ?? field.sample);
      assert.equal(calls.at(-1)[2], 'external_action');
    }
  }
  assert.ok(count >= 30);
});

async function fixture(t, settings = {}, listenerSettings = {}) {
  const device = {id:'lamp', allow_external_actions:true, on_url:'http://command.example/on',off_url:'http://command.example/off',...settings};
  const records = [], reports = [];
  const accessory = {id:'lamp',platform:{log(){}},service:{characteristics:[{UUID:'on',setValue:(v,cb,c)=>{records.push([v,c]);if(settings.delay)setTimeout(()=>cb(settings.failure),settings.delay);else cb(settings.failure);}}]},
    changeFromServer:params=>{reports.push(params);return {success:true};}};
  const config = {webhook_port:'51828',lights:[device],...listenerSettings};
  const s = new Server(null,{On:{UUID:'on'}},accessory.platform,config);s.setAccessories([accessory]);
  const listener = http.createServer(s.createServerCallback()); await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>{listener.closeAllConnections();listener.close();});
  const url = 'http://127.0.0.1:' + listener.address().port + '/?accessoryId=lamp';
  async function send(query, options) {const result = await fetch(url + query, options);return {status:result.status, body:await result.json()};}
  return {send, records, reports};
}
test('omitted action and explicit off preserve reports; on executes once, including repeated requests and UniFi POST metadata', async t => {
  const {send,records,reports} = await fixture(t);
  assert.equal((await send('&state=true')).status,200);
  assert.equal((await send('&state=false&action=off')).status,200);
  assert.equal(records.length,0); assert.equal(reports.length,2); assert.equal(reports[1].state,'false');
  assert.equal(Object.hasOwn(reports[1],'action'),false);
  for (const state of ['true','true','false']) {
    const r = await send('&state='+state+'&action=on'); assert.equal(r.status,200);
    assert.equal(r.body.commandCompleted,true); assert.equal(r.body.physicalCompletionConfirmed,false);
  }
  assert.deepEqual(records.map(x=>x[0]),[true,true,false]); assert.equal(reports.length,2);
  await send('&state=true&action=on',{method:'POST',body:JSON.stringify({alarm:{name:'test'},state:false})});
  assert.equal(records.length,4); assert.equal(records.at(-1)[0],true);
});
test('late outgoing failure after listener timeout does not crash or retry', async t => {
  const {send,records}=await fixture(t,{delay:1100,failure:Error('late private error')},{webhook_timeout_ms:1000});
  const response=await send('&state=true&action=on');assert.equal(response.status,408);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(records.length,1);
});
test('global Bearer authentication protects reports and commands, with explicit saved per-device exemption', async t => {
  const token='synthetic_bearer_token_0123456789abcdefgh';
  const protectedDevice=await fixture(t,{}, {webhook_bearer_token:token});
  for (const query of ['&state=true','&state=true&action=off','&state=true&action=on','&state=true&disable_bearer_auth=true']) {
    assert.equal((await protectedDevice.send(query)).status,401);
  }
  for (const auth of [token,'Bearer wrong','Basic '+Buffer.from('user:pass').toString('base64')]) {
    assert.equal((await protectedDevice.send('&state=true&action=on',{headers:{Authorization:auth}})).status,401);
  }
  assert.equal(protectedDevice.records.length,0);assert.equal(protectedDevice.reports.length,0);
  const options={headers:{Authorization:'Bearer '+token}};
  assert.equal((await protectedDevice.send('&state=true',options)).status,200);
  assert.equal((await protectedDevice.send('&state=false&action=on',options)).status,200);
  assert.equal(protectedDevice.reports.length,1);assert.deepEqual(protectedDevice.records.map(r=>r[0]),[false]);
  const exempt=await fixture(t,{disable_bearer_auth:true},{webhook_bearer_token:token});
  assert.equal((await exempt.send('&state=true')).status,200);
  assert.equal((await exempt.send('&state=true&action=on')).status,200);
  assert.equal(exempt.records.length,1);
  const disabled=await fixture(t,{disable_bearer_auth:true,allow_external_actions:false},{webhook_bearer_token:token});
  assert.equal((await disabled.send('&state=true&action=on')).status,403);
  assert.equal(disabled.records.length,0);
});
test('Bearer settings reject weak/invalid tokens and conflicting schemes; examples and UI use saved device authentication', () => {
  const token='synthetic_bearer_token_0123456789abcdefgh';
  for (const invalid of ['short',true,12,'a'.repeat(257),' '.repeat(32)]) {
    assert.throws(()=>new Server(null,null,{},{webhook_bearer_token:invalid}),/invalid_config_webhook_bearer_token/);
  }
  assert.throws(()=>new Server(null,null,{},{webhook_bearer_token:token,http_auth_user:'user',http_auth_pass:'pass'}),/choose_basic_or_bearer/);
  assert.doesNotThrow(()=>new Server(null,null,{},{webhook_bearer_token:''}));
  assert.throws(()=>new ActionApi({sensors:[{id:'sensor',disable_bearer_auth:'true'}]},{}),/invalid_config_disable_bearer_auth/);
  const platform={platform:'HttpWebHooks',webhook_port:'51828',webhook_bearer_token:token,
    lights:[{id:'lamp',allow_external_actions:true,on_url:'http://command.example'}]};
  const field=Actions.fields('lights',{})[0];
  let generated=Api.buildAction(platform,platform.lights[0],field,'','bridge');
  assert.match(generated.curl,/Authorization: Bearer YOUR_WEBHOOK_TOKEN/);assert.ok(!generated.curl.includes(token));
  const payload={family:'lights',id:'lamp',port:'51828',https:false,host:'127.0.0.1',format:'action',field:'on',value:''};
  const network={addresses:[],hostname:'bridge'};
  assert.equal(Requests.prepare({platforms:[platform]},payload,network).headers.Authorization,'Bearer '+token);
  platform.lights[0].disable_bearer_auth=true;
  assert.equal(Requests.prepare({platforms:[platform]},payload,network).headers.Authorization,undefined);
  generated=Api.buildAction(platform,platform.lights[0],field,'','bridge');assert.doesNotMatch(generated.curl,/Authorization/);
});
test('invalid, mixed, unsupported and duplicate action fields cannot execute or report', async t => {
  const {send,records,reports} = await fixture(t);
  for (const query of ['&action=toggle&state=true','&action=on','&action=on&state=1','&action=on&state=true&value=50',
    '&action=on&currentstate=0','&action=on&action=off&state=true','&action=on&state=true&state=false','&action=on&state=true&url=http://other']) {
    assert.equal((await send(query)).status,400,query);
  }
  assert.equal(records.length,0);assert.equal(reports.length,0);
});
test('disabled commands and missing URLs reject before mutation; outgoing failures are sanitized', async t => {
  const disabled = await fixture(t,{allow_external_actions:false});
  assert.equal((await disabled.send('&action=on&state=true')).status,403); assert.equal(disabled.records.length,0);
  assert.equal((await disabled.send('&state=true')).status,200);
  const missing = await fixture(t,{on_url:''});
  assert.equal((await missing.send('&action=on&state=true')).status,409);assert.equal(missing.records.length,0);
  const failed = await fixture(t,{failure:Error('private credentials')});
  const response = await failed.send('&action=on&state=true'); assert.equal(response.status,502);
  assert.equal(response.body.error,'action_failed'); assert.equal(failed.records.length,1);
});
test('numeric commands reject invalid ranges and steps; fan options are conditional', () => {
  const temperature = Actions.fields('thermostats',{minTemp:15,maxTemp:30,minStep:0.5})[0];
  assert.equal(Actions.value(temperature,'21.5'),21.5);
  for (const raw of ['21.3','31','NaN','1e1','',undefined]) assert.throws(()=>Actions.value(temperature,raw));
  assert.equal(Actions.fields('fanv2s',{}).some(f=>f.key==='swing'),false);
  const brightness = Actions.fields('lights',{})[2]; assert.throws(()=>Actions.value(brightness,'50.5'));
  const power = Actions.fields('lights',{})[0]; assert.throws(()=>Actions.value(power,'true'));
});
test('UI action execution uses saved enablement and command fields, never a caller-supplied URL or credentials', () => {
  const config = {platforms:[{platform:'HttpWebHooks',webhook_port:'51828',http_auth_user:'user',http_auth_pass:'pass',
    lights:[{id:'lamp',allow_external_actions:true,on_url:'http://configured.example'}]}]};
  const payload = {family:'lights',id:'lamp',port:'51828',https:false,host:'127.0.0.1',format:'action',field:'on',value:'',url:'http://bad.example'};
  const request = Requests.prepare(config,payload,{addresses:[],hostname:'bridge'});
  assert.equal(request.method,'GET');assert.equal(request.endpoint.searchParams.get('action'),'on');
  assert.equal(request.endpoint.searchParams.get('state'),'true');assert.equal(request.body,null);
  assert.equal(request.headers.Authorization,'Basic '+Buffer.from('user:pass').toString('base64'));
  config.platforms[0].lights[0].allow_external_actions = false;
  assert.throws(()=>Requests.prepare(config,payload,{addresses:[],hostname:'bridge'}),/Allow external actions/);
});
