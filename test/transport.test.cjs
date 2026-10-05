const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const {configure,send}=require('../src/CommandRequest');
async function fixture(t,fn){const server=http.createServer(fn);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});return 'http://127.0.0.1:'+server.address().port;}
const command=o=>new Promise(resolve=>send(o,resolve));
test('transport sends body/form and headers once and discards response content',async t=>{
 let calls=0;const url=await fixture(t,(req,res)=>{let data='';req.on('data',d=>data+=d);req.on('end',()=>{calls++;assert.equal(req.method,'POST');assert.equal(data,'key=a+b');assert.equal(req.headers.authorization,'SECRET');res.end('PRIVATE RESPONSE');});});
 const result=await command(configure({open_url:url,open_method:'POST',open_headers:'{"Authorization":"SECRET"}',open_form:'{"key":"a b"}'},'open'));assert.equal(result,null);assert.equal(calls,1);
});
test('no redirects or retries; total deadline and response limit return sanitized errors',async t=>{
 let calls=0;const url=await fixture(t,(req,res)=>{calls++;if(req.url==='/redirect'){res.writeHead(302,{Location:'/other'});res.end('SECRET');}else if(req.url==='/large')res.end('x'.repeat(2048));else if(req.url==='/stall')res.write('x');});
 for(const [route,code] of [['redirect','command_http_status'],['large','command_response_too_large'],['stall','command_timeout']]){
  const error=await command(configure({open_url:url+'/'+route,request_timeout_ms:100,response_max_bytes:1024},'open'));assert.equal(error.message,code);
 }assert.equal(calls,3);
});
test('command configuration rejects malformed objects, headers, methods and URLs without secrets',()=>{
 for(const config of [{open_headers:'["SECRET"]'},{open_headers:'{"Authorization":9}'},{open_form:'null'},{open_url:'file:///SECRET'},{open_method:'GET\r\nSECRET'},{open_body:{secret:'PRIVATE'}},{request_timeout_ms:Infinity}]){
  assert.throws(()=>configure(config,'open'),e=>!e.message.includes('SECRET')&&!e.message.includes('PRIVATE'));
 }
});
