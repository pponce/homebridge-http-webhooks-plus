const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Server = require('../src/Server');
const {fixture} = require('./fixture.cjs');
const {connectionInfo, prepare, execute} = require('../homebridge-ui/requests');
const Api = require('../homebridge-ui/public/api');
const network = {addresses:['127.0.0.1','192.0.2.10'],hostname:'bridge',defaultHost:'192.0.2.10'};
const config = {platforms:[{platform:'HttpWebHooks',webhook_port:'51828',state_api_token:'a'.repeat(32),
  garagedooropeners:[{id:'sample',name:'Sample'}]}]};
const payload = {family:'garagedooropeners',id:'sample',port:'51828',https:false,host:'192.0.2.10',
  format:'json',field:'currentdoorstate',value:'0'};
test('default address comes from server interfaces or the saved listener; browser address helps choose between interfaces', () => {
  const info = connectionInfo({lo:[{internal:true,family:'IPv4',address:'127.0.0.1'}],eth0:[{internal:false,family:'IPv4',address:'192.0.2.10'}]},'bridge');
  assert.equal(info.defaultHost,'192.0.2.10');
  assert.equal(Api.defaultHost({},info),'192.0.2.10');
  assert.equal(Api.defaultHost({},info,'127.0.0.1'),'192.0.2.10');
  assert.equal(Api.defaultHost({webhook_listen_host:'127.0.0.1'},info),'127.0.0.1');
  assert.equal(Api.defaultHost({webhook_listen_host:'::1'},info),'[::1]');
  assert.equal(Api.defaultHost({}, {...info,addresses:[...info.addresses,'192.0.2.11']},'192.0.2.11'),'192.0.2.11');
});
test('execution is limited to saved local devices and validated reports; client credentials and URLs are never used', () => {
  const request = prepare(config,{...payload,url:'http://external.example',state_api_token:'client-token'},network);
  assert.equal(request.endpoint.hostname,'127.0.0.1');
  assert.equal(request.headers['X-Webhooks-Token'],'a'.repeat(32));
  assert.deepEqual(JSON.parse(request.body),{currentState:0});
  for (const override of [{host:'external.example'},{id:'other'},{port:'80'},{field:'unknown'},
    {value:'99'},{format:'command'},{https:true}]) assert.throws(()=>prepare(config,{...payload,...override},network));
});
test('UI executor sends legacy and JSON reports to the actual listener and shows HTTP errors/status without issuing commands', async t => {
  const accessory = fixture(t,undefined,{state_mode:'external'});
  let commands=0; accessory.command=()=>{commands++;};
  const options = {state_api_token:'a'.repeat(32),http_auth_user:'fixture-user',http_auth_pass:'fixture-password'};
  const server = new Server(null,null,accessory.platform,options); server.setAccessories([accessory]);
  const listener = http.createServer(server.createServerCallback());
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>{listener.closeAllConnections();listener.close();});
  const port = String(listener.address().port);
  const saved = {platforms:[{...config.platforms[0],...options,webhook_port:port}]};
  let result = await execute(saved,{...payload,port},network);
  assert.equal(result.status,200); assert.equal(JSON.parse(result.body).state.currentState,0);
  result = await execute(saved,{...payload,port,format:'webhook',value:'1'},network);
  assert.equal(result.status,200); assert.equal(accessory.values.currentState,1);
  const timestamp = accessory.observedAt.currentState;
  result = await execute(saved,{...payload,port,format:'status'},network);
  assert.equal(JSON.parse(result.body).state.currentState,1);
  assert.equal(accessory.observedAt.currentState,timestamp);
  const wrong = structuredClone(saved); wrong.platforms[0].http_auth_pass='incorrect';
  result = await execute(wrong,{...payload,port},network);
  assert.equal(result.status,401); assert.match(result.body,/authentication_required/);
  assert.equal(accessory.values.currentState,1);
  assert.equal(commands,0);
});
test('response output is bounded and redacts saved credentials without following redirects', async t => {
  const listener = http.createServer((req,res)=>{
    if (req.url.includes('currentdoorstate=1')) {res.writeHead(302,{Location:'http://external.example'});res.end('redirect');}
    else if(req.url.includes('currentdoorstate=2')) res.end('fixture-user fixture-password');
    else res.end('fixture-password '+ 'x'.repeat(66000));
  });
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>{listener.closeAllConnections();listener.close();});
  const port=String(listener.address().port);
  const saved={platforms:[{...config.platforms[0],webhook_port:port,http_auth_user:'fixture-user',http_auth_pass:'fixture-password'}]};
  let result=await execute(saved,{...payload,port,format:'webhook'},network);
  assert.match(result.error,/64 KiB/);
  result=await execute(saved,{...payload,port,format:'webhook',value:'1'},network);
  assert.equal(result.status,302);assert.equal(result.body,'redirect');
  result=await execute(saved,{...payload,port,format:'webhook',value:'2'},network);
  assert.equal(result.status,200);assert.equal(result.body,'[redacted] [redacted]');
});
