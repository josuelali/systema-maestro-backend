import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { Database } from './database';
import { Billing, HttpError } from './app';

export function stripeBilling(db:Database, stripe:Stripe, config:{priceId:string;webhookSecret:string;origin:string;livemode?:boolean}):Billing {
  const integration='smia_web_v1_'+Array.from(randomBytes(8),n=>String.fromCharCode(97+n%26)).join('');
  return {
    async checkout(userId,email) {
      return db.transaction(async tx=>{
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
        let local=(await tx.query('SELECT * FROM subscriptions WHERE user_id=$1',[userId])).rows[0];
        if(local?.subscription_id && ['active','past_due','unpaid','incomplete','trialing','paused'].includes(local.status)) throw new HttpError(409,'subscription_exists');
        const price=await stripe.prices.retrieve(config.priceId);
        if(price.livemode !== !!config.livemode || !price.active || price.unit_amount!==1999 || price.currency!=='eur' || price.recurring?.interval!=='month' || price.recurring.interval_count!==1) throw new HttpError(503,'invalid_price');
        if(!local?.customer_id) {
          const customer=await stripe.customers.create({email,metadata:{smia_user_id:userId}},{idempotencyKey:`smia-customer-${userId}`});
          await tx.query('INSERT INTO subscriptions(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET customer_id=$2',[userId,customer.id]);
          local={customer_id:customer.id};
        }
        const subscriptions=await stripe.subscriptions.list({customer:local.customer_id,status:'all',limit:100});
        if(subscriptions.data.some(s=>s.metadata.smia_user_id===userId && !['canceled','incomplete_expired'].includes(s.status))) throw new HttpError(409,'subscription_exists');
        const open=await stripe.checkout.sessions.list({customer:local.customer_id,status:'open',limit:100});
        const existing=open.data.find(s=>s.metadata?.smia_user_id===userId && s.mode==='subscription');
        if(existing?.url) return existing.url;
        const session=await stripe.checkout.sessions.create({
          mode:'subscription',customer:local.customer_id,client_reference_id:userId,
          line_items:[{price:config.priceId,quantity:1}],metadata:{smia_user_id:userId},
          subscription_data:{metadata:{smia_user_id:userId}},integration_identifier:integration,
          success_url:`${config.origin}/panel.html?checkout=success`,cancel_url:`${config.origin}/panel.html?checkout=cancel`,
        },{idempotencyKey:`smia-checkout-${userId}-${Math.floor(Date.now()/1800000)}`});
        if(!session.url) throw new HttpError(503,'checkout_unavailable');
        return session.url;
      });
    },
    async portal(userId) {
      const local=(await db.query('SELECT customer_id FROM subscriptions WHERE user_id=$1',[userId])).rows[0];
      if(!local?.customer_id) throw new HttpError(409,'no_subscription');
      return (await stripe.billingPortal.sessions.create({customer:local.customer_id,return_url:`${config.origin}/panel.html`})).url;
    },
    async webhook(body,signature) {
      let event:Stripe.Event;
      try { event=stripe.webhooks.constructEvent(body,signature,config.webhookSecret); }
      catch { throw new HttpError(400,'invalid_signature'); }
      if(event.livemode !== !!config.livemode) throw new HttpError(400,config.livemode?'test_events_disabled':'live_events_disabled');
      if(!['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed'].includes(event.type)) return;
      const object:any=event.data.object;
      const customerId=typeof object.customer==='string'?object.customer:object.customer?.id;
      const local=(await db.query('SELECT user_id FROM subscriptions WHERE customer_id=$1',[customerId||''])).rows[0];
      if(!local) return;
      await db.transaction(async tx=>{
        // Retrieve current Stripe state under the same user lock used by quota reservation.
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[local.user_id]);
        if((await tx.query('SELECT id FROM stripe_events WHERE id=$1',[event.id])).rows.length) return;
        const list=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100,expand:['data.latest_invoice']});
        const matching=list.data.filter(s=>s.metadata.smia_user_id===local.user_id && s.items.data.length===1 && s.items.data[0].price.id===config.priceId);
        matching.sort((a,b)=>b.created-a.created);
        const sub=matching[0];
        if(sub) {
          const invoice=sub.latest_invoice as Stripe.Invoice|null;
          const item=sub.items.data[0];
          await tx.query('UPDATE subscriptions SET subscription_id=$1,status=$2,paid=$3,period_start=$4,period_end=$5,cancel_at_period_end=$6,updated_at=now() WHERE user_id=$7',[
            sub.id,sub.status,!!(invoice && typeof invoice!=='string' && invoice.status==='paid'),
            new Date(item.current_period_start*1000),new Date(Math.min(item.current_period_end,sub.cancel_at || item.current_period_end)*1000),sub.cancel_at_period_end || !!sub.cancel_at,local.user_id,
          ]);
        } else await tx.query("UPDATE subscriptions SET status='none',paid=false,period_start=NULL,period_end=NULL,updated_at=now() WHERE user_id=$1",[local.user_id]);
        await tx.query('INSERT INTO stripe_events(id) VALUES($1)',[event.id]);
      });
    },
  };
}
export function configuredBilling(db:Database,origin:string):Billing|undefined {
  const key=process.env.STRIPE_SECRET_KEY;
  if(!key) return undefined;
  const livemode=process.env.STRIPE_MODE==='live';
  if(!new RegExp(`^(sk|rk)_${livemode?'live':'test'}_`).test(key)) throw new Error('Stripe key does not match configured mode');
  if(livemode && (!origin.startsWith('https://') || process.env.NODE_ENV!=='production')) throw new Error('Live billing requires production and HTTPS');
  if(!process.env.STRIPE_PRICE_ID || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe test price and signing secret required');
  return stripeBilling(db,new Stripe(key),{priceId:process.env.STRIPE_PRICE_ID,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,origin,livemode});
}
