const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const Server=require('../src/Server');
const {fixture}=require('./fixture.cjs');
async function server(t,config={}){
 const a=fixture(t),s=new Server(null,null,a.platform,{state_api_token:'a'.repeat(32),...config});s.setAccessories([a]);
 const listener=http.createServer(s.createServerCallback());await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 t.after(()=>{listener.closeAllConnections();listener.close();});return {a,s,port:listener.address().port};
}
function request(port,path,method='GET',body='',headers={'X-Webhooks-Token':'a'.repeat(32)}){return new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port,path,method,headers:{'Content-Type':'application/json',...headers}},res=>{let raw='';res.on('data',d=>raw+=d);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(body);
});}
test('v1 auth, status and POST state use the same typed snapshot',async t=>{
 const {a,port}=await server(t);const endpoint='/v1/accessories/sample';
 assert.equal((await request(port,endpoint,'GET','',{})).status,401);
 let result=await request(port,endpoint+'/state','POST','{"currentState":0,"targetState":1}');
 assert.equal(result.status,200);assert.equal(result.body.state.currentState,0);
 const timestamp=a.observedAt.currentState;result=await request(port,endpoint);assert.equal(result.body.observedAt.currentState,timestamp);
 assert.equal((await request(port,endpoint+'/state','GET')).status,405);
});
test('duplicate, malformed and oversized bodies never partly change state',async t=>{
 const {a,port}=await server(t),before=a.status();
 for(const body of ['{"currentState":0,"targetState":99}','{"currentState":0,"currentState":1}','{"currentState":0,"obstruction":[]}']){
  assert.equal((await request(port,'/v1/accessories/sample/state','POST',body)).status,400);assert.deepEqual(a.status(),before);
 }
 assert.equal((await request(port,'/v1/accessories/sample/state','POST',' '.repeat(9000))).status,413);assert.deepEqual(a.status(),before);
 assert.equal((await request(port,'/?accessoryId=sample&currentdoorstate=0&currentdoorstate=1')).status,400);
});
test('legacy response and Basic auth remain available; partial credentials rejected',async t=>{
 assert.throws(()=>new Server(null,null,{},{http_auth_user:'secret'}),/incomplete/);
 const {port}=await server(t,{http_auth_user:'user',http_auth_pass:'pass'});
 const headers={Authorization:'Basic '+Buffer.from('user:pass').toString('base64')};
 assert.equal((await request(port,'/?accessoryId=sample&currentdoorstate=0','GET','',headers)).body.currentState,1);
 assert.equal((await request(port,'/v1/accessories/sample','GET','',headers)).status,401);
 headers['X-Webhooks-Token']='a'.repeat(32);assert.equal((await request(port,'/v1/accessories/sample','GET','',headers)).status,200);
});
test('routing rejects duplicate IDs across families, including numeric/string aliases',async t=>{
 const {s}=await server(t);assert.throws(()=>s.setAccessories([{id:0},{id:'0'}]),/duplicate_accessory_id/);
});
test('configurable body limit, CORS and sanitized errors preserve legacy state',async t=>{
 const {port,a}=await server(t,{webhook_body_max_bytes:1024,webhook_enable_cors:true});
 const before=a.status();const result=await request(port,'/?accessoryId=sample&currentdoorstate=0','POST','X'.repeat(1025));
 assert.equal(result.status,413);assert.deepEqual(a.status(),before);
 assert.equal((await request(port,'/','OPTIONS')).status,200);
 for(const config of [{webhook_port:'bad'},{webhook_timeout_ms:0},{https_keyfile:'/secret'},{http_auth_user:false},{https:'true'}]){
  assert.throws(()=>new Server(null,null,a.platform,config),e=>!e.message.includes('/secret'));
 }
});
