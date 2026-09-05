import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/app.js';
import { migrate } from '../dist/database.js';
import { generate } from '../dist/ai.js';
if(!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
const pg=new PGlite();
const db={query:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn(tx)),close:()=>pg.close()};
await migrate(db);
let calls=0,result,latency;
const origin='http://127.0.0.1:18374';
const server=createApp(db,{origin,ai:async input=>{assert.equal(++calls,1);const start=performance.now();result=await generate(input);latency=Math.round(performance.now()-start);return result;}}).listen(18374,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
let cookie='';
async function request(path,method,body){const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.ok(r.ok,JSON.stringify({status:r.status,error:data.error}));return data;}
try {
 await request('/auth/register','POST',{email:'live-probe@example.com',password:randomUUID()});
 await request('/profile','PUT',{negocio:'Estudio de fotografia ficticio para prueba',oferta:'Fotografia de producto por 150 EUR la sesion',cliente_ideal:'Pequenas tiendas online',tono:'Cercano y preciso',objetivos:'Presentar el servicio sin prometer ventas',instrucciones:'No ofrecemos bonus, descuentos, garantias ni plazos confirmados. No los inventes.'});
 const {generation}=await request('/run','POST',{assistantId:'oferta',inputs:{producto:'Fotografia de producto',cliente_ideal:'Tiendas online',precio:'150 EUR por sesion'},requestKey:randomUUID()});
 const history=await request('/history','GET');assert.equal(history.items[0].id,generation.id);
 console.log(JSON.stringify({success:true,calls,latencyMs:latency,model:result.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd,output:result.output}));
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
