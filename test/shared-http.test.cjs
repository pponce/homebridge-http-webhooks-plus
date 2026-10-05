const test=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const T=require('../src/CommandRequest'), U=require('../src/Util'), L=require('../src/SafeLog');
const C=require('../src/Constants');
async function server(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});return 'http://127.0.0.1:'+s.address().port;}
const send=o=>new Promise(r=>T.send(o,r));
test('opt-in redirects bounded, retain 307 method/body, and reject cross origin',async t=>{
 const seen=[];const url=await server(t,(q,r)=>{let body='';q.on('data',x=>body+=x);q.on('end',()=>{seen.push([q.url,q.method,body]);if(q.url==='/start'){r.writeHead(307,{Location:'/end'});r.end();}else if(q.url==='/cross'){r.writeHead(302,{Location:'http://localhost:1/private'});r.end();}else if(q.url==='/loop'){r.writeHead(302,{Location:'/loop'});r.end();}else r.end('ok');});});
 assert.equal(await send(T.configure({open_url:url+'/start',open_method:'POST',open_body:'payload',max_redirects:1},'open')),null);
 assert.deepEqual(seen.slice(0,2),[['/start','POST','payload'],['/end','POST','payload']]);
 assert.equal((await send(T.configure({open_url:url+'/cross',max_redirects:2},'open'))).code,'command_unsafe_redirect');
 assert.equal((await send(T.configure({open_url:url+'/loop',max_redirects:2},'open'))).code,'command_http_status');
 assert.equal(seen.filter(x=>x[0]==='/loop').length,3);
});
test('shared legacy adapter preserves methods, auth, form zero/false and one callback',async t=>{
 let calls=0;const url=await server(t,(q,r)=>{let body='';q.on('data',x=>body+=x);q.on('end',()=>{calls++;assert.equal(q.method,'PATCH');assert.equal(q.headers.authorization,'Bearer PRIVATE');assert.equal(body,'zero=0&enabled=false');r.end('PRIVATE_RESPONSE');});});
 const messages=[];const raw=Object.assign(x=>messages.push(x),{debug:x=>messages.push(x),error:x=>messages.push(x)});
 const log=U.accessoryLog({log:raw},{name:'Sample'});let callbacks=0,success=0;
 const error=await new Promise(resolve=>U.callHttpApi(log,url,'PATCH','',JSON.stringify({zero:0,enabled:false}),JSON.stringify({Authorization:'Bearer PRIVATE'}),true,e=>{callbacks++;resolve(e);},null,()=>success++));
 assert.equal(error,null);assert.equal(callbacks,1);assert.equal(success,1);assert.equal(calls,1);assert.doesNotMatch(messages.join('\n'),/PRIVATE|zero|enabled/);
});
test('incoming webhook context never invokes outbound command transport',()=>{
 const log=U.accessoryLog({log:()=>{}},{});let success=0,done=0;
 U.callHttpApi(log,'http://127.0.0.1:1','POST','','','{}',true,e=>{assert.equal(e,null);done++;},C.CONTEXT_FROM_WEBHOOK,()=>success++);
 assert.equal(success,1);assert.equal(done,1);
});
test('shutdown cancellation completes a stalled command once',async t=>{
 const url=await server(t,(_q,r)=>r.write('partial'));let calls=0;
 const result=await new Promise(resolve=>{const cancel=T.send(T.configure({open_url:url},'open'),e=>{calls++;resolve(e);});setTimeout(cancel,20);});
 assert.equal(result.code,'command_cancelled');assert.equal(calls,1);
});
test('logging inherits levels and retains original debug gate; mandatory and custom redaction',()=>{
 const messages=[];let enabled=false;const raw={info:x=>messages.push(x),warn:x=>messages.push(x),error:x=>messages.push(x),debug:x=>{if(enabled)messages.push(x);}};
 const log=L.create(raw,{log_level:'debug',extra_redaction_keys:['tenant_secret']});
 log.debug('hidden');assert.equal(messages.length,0);enabled=true;
 log.debug('Authorization: Bearer VERYPRIVATE; tenant_secret=OTHERSECRET https://user:password@example.test/path?x=SECRET');
 assert.doesNotMatch(messages.join(''),/VERYPRIVATE|OTHERSECRET|user:password|x=SECRET/);
 const quiet=L.create(raw,{log_level:'inherit'},{log_level:'error'});quiet.info('quiet');assert.equal(messages.length,1);quiet.error('visible');assert.equal(messages.length,2);
 assert.throws(()=>L.create(raw,{extra_redaction_keys:['bad.*']}));
});
test('total redirect deadline and aggregate response limit are not renewed per hop',async t=>{
 let calls=0;const url=await server(t,(q,r)=>{calls++;if(q.url==='/size'){r.writeHead(302,{Location:'/done'});r.end('x'.repeat(700));}else if(q.url==='/done')r.end('x'.repeat(700));else setTimeout(()=>{r.writeHead(302,{Location:'/slow'});r.end();},70);});
 assert.equal((await send(T.configure({open_url:url+'/size',max_redirects:2,response_max_bytes:1024},'open'))).code,'command_response_too_large');
 assert.equal((await send(T.configure({open_url:url+'/slow',max_redirects:5,request_timeout_ms:100},'open'))).code,'command_timeout');
 assert.equal(calls,4);
});
test('GET URL basic credentials and 303 form-to-GET behavior remain intentional',async t=>{
 let calls=0;const url=await server(t,(q,r)=>{calls++;assert.equal(q.headers.authorization,'Basic '+Buffer.from('user:password').toString('base64'));if(calls===1){assert.equal(q.method,'POST');r.writeHead(303,{Location:'/done'});r.end();}else{assert.equal(q.method,'GET');assert.equal(q.headers['content-type'],undefined);r.end();}});
 const u=new URL(url);u.username='user';u.password='password';
 assert.equal(await send(T.configure({open_url:u.toString(),open_method:'POST',open_form:'{"a":1}',max_redirects:1},'open')),null);assert.equal(calls,2);
});
test('TLS verification defaults on; explicit self-signed opt-out works',async t=>{
 const https=require('node:https'),fs=require('node:fs'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webhooks-tls-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 require('node:child_process').execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem')],{stdio:'ignore'});
 const s=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:fs.readFileSync(path.join(dir,'cert.pem'))},(_q,r)=>r.end());
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});
 const url='https://127.0.0.1:'+s.address().port;
 assert.equal((await send(T.configure({open_url:url},'open'))).code,'command_transport_failed');
 assert.equal(await send(T.configure({open_url:url,rejectUnauthorized:false},'open')),null);
});
