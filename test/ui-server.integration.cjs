const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('custom UI server starts with the installed helper and replies over authenticated UI IPC', {timeout:10000}, async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'webhooks-ui-'));
  const configPath=path.join(dir,'config.json');
  fs.writeFileSync(configPath,JSON.stringify({platforms:[{platform:'HttpWebHooks',webhook_port:'51828',state_api_token:'synthetic-secret-token-01234567890',garagedooropeners:[{id:'sample'}]}]}));
  const child=fork(path.join(__dirname,'../homebridge-ui/server.js'),[],{env:{...process.env,HOMEBRIDGE_CONFIG_PATH:configPath},stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true});});
  let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
  function waitFor(predicate) {return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(Error('UI IPC timeout'));},5000);
    const message=data=>{if(predicate(data)){cleanup();resolve(data);}};
    const exit=()=>{cleanup();reject(Error('UI server exited before its response'));};
    function cleanup(){clearTimeout(timeout);child.off('message',message);child.off('exit',exit);}
    child.on('message',message);child.on('exit',exit);
  });}
  await waitFor(data=>data.action==='ready');
  let result=waitFor(data=>data.action==='response'&&data.payload.requestId==='1');
  child.send({action:'request',requestId:'1',path:'/api/connection'});
  const connection=(await result).payload.data;
  assert.equal(typeof connection.defaultHost,'string');assert.ok(connection.addresses.length);
  result=waitFor(data=>data.action==='response'&&data.payload.requestId==='2');
  child.send({action:'request',requestId:'2',path:'/api/execute',body:{family:'garagedooropeners',id:'sample',port:'51828',https:false,host:'external.example',format:'webhook',field:'currentdoorstate',value:'0'}});
  assert.match((await result).payload.data.error,/this Homebridge instance/);
  assert.doesNotMatch(log,/synthetic-secret-token/);
});
