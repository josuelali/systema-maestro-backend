import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createApp, entitlement } from '../dist/app.js';
import { migrate } from '../dist/database.js';
import { messagesFor, AiError } from '../dist/ai.js';
import { stripeBilling } from '../dist/billing.js';
import Stripe from 'stripe';

test('V1 accounts, isolation, quotas, persistence and subscription lifecycle',async t=>{
  const pg=new PGlite();
  const db={query:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn(tx)),close:()=>pg.close()};
  await migrate(db);await migrate(db);
  let calls=0,lastInput,fail=false,release;
  const origin='http://127.0.0.1:18373';
  const ai=async input=>{calls++;lastInput=input;if(release)await new Promise(r=>{release.resolve=r;});if(fail)throw new AiError('ai_busy');return {output:'Resultado de prueba, proveedor simulado explicitamente.',model:'test',inputTokens:100,outputTokens:50,costUsd:0};};
  const server=createApp(db,{origin,ai}).listen(18373,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const api=async(path,method='GET',body,cookie='',requestOrigin=origin)=>{
    const res=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:requestOrigin,Cookie:cookie},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const profile={negocio:'Estudio fotografia',oferta:'Fotografia de producto',cliente_ideal:'Pequenas tiendas',tono:'Cercano',objetivos:'Presentar mi servicio',instrucciones:'No inventar condiciones.'};
  const request=()=>({assistantId:'oferta',inputs:{producto:'Fotografia',cliente_ideal:'Tiendas',precio:'150 EUR'},requestKey:randomUUID()});
  try {
    let a,b;
    await t.test('Authentication rejects invalid access, origins and passwords',async()=>{
      assert.equal((await api('/me')).status,401);
      assert.equal((await api('/auth/register','POST',{email:'a@example.com',password:'A-secure-password-123'},'','https://evil.invalid')).status,403);
      a=await api('/auth/register','POST',{email:'a@example.com',password:'A-secure-password-123'});
      b=await api('/auth/register','POST',{email:'b@example.com',password:'B-secure-password-123'});
      assert.equal(a.status,201);assert.equal(b.status,201);assert.ok(a.cookie);
      assert.equal((await api('/auth/login','POST',{email:'a@example.com',password:'wrong-password-long'})).status,401);
      assert.equal((await api('/auth/login','POST',{email:'a@example.com',password:'A-secure-password-123'})).status,200);
      const stored=(await db.query('SELECT password_hash FROM users WHERE id=$1',[a.data.id])).rows[0].password_hash;
      assert.ok(!stored.includes('A-secure-password'));
    });
    let job;
    await t.test('Profile isolation and mandatory context in every generation',async()=>{
      assert.equal((await api('/run','POST',request(),a.cookie)).status,409);
      assert.equal((await api('/profile','PUT',profile,a.cookie)).status,200);
      assert.equal((await api('/me','GET',null,b.cookie)).data.profile,null);
      const body=request();job=await api('/run','POST',body,a.cookie);
      assert.equal(job.status,201);assert.deepEqual(lastInput.profile,profile);
      assert.equal((await api('/run','POST',body,a.cookie)).status,200);assert.equal(calls,1);
      assert.equal((await api('/history/'+job.data.generation.id,'GET',null,b.cookie)).status,404);
      assert.equal((await api('/history','GET',null,b.cookie)).data.items.length,0);
      assert.equal((await api('/history/'+job.data.generation.id,'GET',null,a.cookie)).data.generation.output,job.data.generation.output);
      const messages=messagesFor(lastInput);assert.ok(messages[0].content.includes('Nunca inventes'));assert.ok(messages[1].content.includes(profile.negocio));
      const catalog=(await api('/assistants','GET',null,a.cookie)).data.assistants;
      assert.equal(catalog.length,8);
      for(const assistant of catalog) assert.ok(messagesFor({...lastInput,assistantId:assistant.id})[1].content.includes(profile.negocio));
    });
    await t.test('Failure restores quota; concurrent calls and fourth free generation blocked',async()=>{
      fail=true;assert.equal((await api('/run','POST',request(),a.cookie)).status,503);fail=false;
      assert.equal((await api('/me','GET',null,a.cookie)).data.plan.used,1);
      release={};const pending=api('/run','POST',request(),a.cookie);
      for(let n=0;!release.resolve && n<100;n++) await new Promise(r=>setTimeout(r,10));
      assert.ok(release.resolve);
      assert.equal((await api('/run','POST',request(),a.cookie)).status,409);
      release.resolve();release=null;assert.equal((await pending).status,201);
      assert.equal((await api('/run','POST',request(),a.cookie)).status,201);
      assert.equal((await api('/run','POST',request(),a.cookie)).status,402);
      assert.equal((await api('/assistants/oferta','PUT',{name:'Mi vendedor',instructions:'Breve'},a.cookie)).status,403);
    });
    await t.test('Signed Stripe events, renewal, duplicate/out-of-order, cancellation and expiration',async()=>{
      await db.query('INSERT INTO subscriptions(user_id,customer_id) VALUES($1,$2)',[a.data.id,'cus_test']);
      const now=Math.floor(Date.now()/1000);
      let sub={id:'sub_test',created:now,metadata:{smia_user_id:a.data.id},status:'active',cancel_at_period_end:false,latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_test'},current_period_start:now-5,current_period_end:now+86400}]}};
      const sdk=new Stripe('sk_test_not_a_real_key');
      const fake={webhooks:sdk.webhooks,subscriptions:{list:async()=>({data:[sub]})}};
      const billing=stripeBilling(db,fake,{priceId:'price_test',webhookSecret:'whsec_fixture',origin});
      const send=async(id,type='customer.subscription.updated',live=false)=>{
        const body=JSON.stringify({id,object:'event',type,livemode:live,data:{object:{customer:'cus_test'}}});
        const sig=sdk.webhooks.generateTestHeaderString({payload:body,secret:'whsec_fixture'});
        await billing.webhook(Buffer.from(body),sig);
      };
      await assert.rejects(billing.webhook(Buffer.from('{}'),'invalid'),e=>e.code==='invalid_signature');
      await assert.rejects(send('evt_live','invoice.paid',true),e=>e.code==='live_events_disabled');
      await send('evt_1');assert.equal((await entitlement(db,a.data.id)).pro,true);
      assert.equal((await api('/assistants/oferta','PUT',{name:'Mi vendedor',instructions:'Una respuesta breve'},a.cookie)).status,200);
      assert.equal((await api('/run','POST',request(),a.cookie)).status,201);assert.equal(lastInput.instructions,'Una respuesta breve');
      const used=(await entitlement(db,a.data.id)).used;await send('evt_1');assert.equal((await entitlement(db,a.data.id)).used,used);
      sub={...sub,cancel_at_period_end:true};await send('evt_2');assert.equal((await entitlement(db,a.data.id)).pro,true);
      sub={...sub,cancel_at_period_end:false,cancel_at:now+86400};await send('evt_cancel_date');assert.equal((await entitlement(db,a.data.id)).cancelAtPeriodEnd,true);assert.equal((await entitlement(db,a.data.id)).pro,true);
      sub={...sub,cancel_at:null};await send('evt_cancel_undone');assert.equal((await entitlement(db,a.data.id)).cancelAtPeriodEnd,false);
      sub={...sub,status:'past_due',latest_invoice:{status:'open'}};await send('evt_3','invoice.payment_failed');assert.equal((await entitlement(db,a.data.id)).pro,false);
      await send('evt_old','invoice.paid');assert.equal((await entitlement(db,a.data.id)).pro,false);
      const renewalStart=Math.floor(Date.now()/1000)+1;
      sub={...sub,status:'active',latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_test'},current_period_start:renewalStart,current_period_end:renewalStart+90000}]}};
      await new Promise(r=>setTimeout(r,1100));await send('evt_4','invoice.paid');assert.equal((await entitlement(db,a.data.id)).used,0);
      sub={...sub,status:'canceled'};await send('evt_5','customer.subscription.deleted');assert.equal((await entitlement(db,a.data.id)).pro,false);
      sub={...sub,status:'active',items:{data:[{price:{id:'price_test'},current_period_start:now-90000,current_period_end:now-10}]}};
      await send('evt_6');assert.equal((await entitlement(db,a.data.id)).pro,false);
      assert.ok((await api('/history','GET',null,a.cookie)).data.items.length>0);
    });
    await t.test('Pro is limited to 100 generations and preserves the history at the limit',async()=>{
      await db.query("UPDATE subscriptions SET status='active',paid=true,period_start=now()-interval '1 hour',period_end=now()+interval '1 day' WHERE user_id=$1",[a.data.id]);
      await db.transaction(async tx=>{for(let i=0;i<100;i++) await tx.query("INSERT INTO generations(id,user_id,request_key,assistant_id,assistant_name,inputs,context,instructions,state,output,cost_usd) VALUES($1,$2,$3,'oferta','Test','{}','{}','','completed','Test',0)",[randomUUID(),a.data.id,randomUUID()]);});
      const before=calls;assert.equal((await api('/run','POST',request(),a.cookie)).status,402);assert.equal(calls,before);
      assert.equal((await api('/history','GET',null,a.cookie)).data.hasMore,true);
    });
    await t.test('Logout revokes session and billing fails closed without credentials',async()=>{
      assert.equal((await api('/billing/checkout','POST',{},b.cookie)).status,503);
      assert.equal((await api('/auth/logout','POST',{},a.cookie)).status,200);
      assert.equal((await api('/me','GET',null,a.cookie)).status,401);
    });
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
});
