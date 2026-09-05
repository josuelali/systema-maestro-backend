import express, { Request, Response, NextFunction } from 'express';
import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Database, Sql } from './database';
import { assistants } from './assistants';
import { generate, GenerationInput, GenerationResult, AiError } from './ai';

const scrypt = promisify(scryptCallback);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
export interface Billing {
  webhook(body: Buffer, signature: string): Promise<void>;
  checkout(userId: string, email: string): Promise<string>;
  portal(userId: string): Promise<string>;
}
const profileSchema = z.object({
  negocio: z.string().trim().min(3).max(500), oferta: z.string().trim().min(3).max(1000),
  cliente_ideal: z.string().trim().min(3).max(700), tono: z.string().trim().min(2).max(200),
  objetivos: z.string().trim().min(3).max(700), instrucciones: z.string().trim().max(1500),
}).strict();
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(128) }).strict();
const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req,res)).catch(next); };
export async function entitlement(sql: Sql, id: string) {
  const sub = (await sql.query('SELECT * FROM subscriptions WHERE user_id=$1', [id])).rows[0];
  const pro = !!(sub?.status === 'active' && sub.paid && sub.period_start && sub.period_end && new Date(sub.period_start) <= new Date() && new Date(sub.period_end) > new Date());
  const args: any[] = [id];
  let period = '';
  if (pro) { args.push(sub.period_start,sub.period_end); period = ' AND created_at >= $2 AND created_at < $3'; }
  const used = Number((await sql.query(`SELECT count(*) AS n FROM generations WHERE user_id=$1 AND state IN ('completed','pending')${period}`,args)).rows[0].n);
  return { pro, limit: pro ? 100 : 3, used, remaining: Math.max(0,(pro ? 100 : 3)-used), periodEnd: pro ? sub.period_end : null, cancelAtPeriodEnd: !!sub?.cancel_at_period_end };
}
export function createApp(db: Database, options: { origin: string; secure?: boolean; ai?: (input: GenerationInput) => Promise<GenerationResult>; billing?: Billing; frontend?: string; previewBudgetUsd?: number }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control','no-store');
    next();
  });
  app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'100kb'}),wrap(async(req,res)=>{
    if (!options.billing) throw new HttpError(503,'billing_not_configured');
    await options.billing.webhook(req.body, String(req.headers['stripe-signature'] || ''));
    res.json({received:true});
  }));
  app.use(express.json({limit:'32kb'}));
  app.use('/api',(req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== options.origin) return next(new HttpError(403,'origin_rejected'));
    next();
  });
  // A bounded local limiter is defense in depth; quotas are transactional in PostgreSQL.
  const attempts = new Map<string,{n:number;end:number}>();
  app.use('/api/auth',(req,res,next)=>{
    if (req.method !== 'POST') return next();
    const now = Date.now();
    for(const [key,value] of attempts) if(value.end < now) attempts.delete(key);
    const key = req.ip || 'unknown';
    const value = attempts.get(key) || {n:0,end:now+15*60*1000};
    value.n++; attempts.set(key,value);
    if(value.n>20) return next(new HttpError(429,'auth_rate_limited'));
    next();
  });
  const cookieOptions = { httpOnly:true, secure:!!options.secure, sameSite:'lax' as const, path:'/' };
  async function session(res:Response,id:string) {
    const token = randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[hash(token),id,new Date(Date.now()+7*86400000)]);
    res.cookie('smia_session',token,{...cookieOptions,maxAge:7*86400000});
  }
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.post('/api/auth/register',wrap(async(req,res)=>{
    const {email,password}=credentials.parse(req.body);
    const salt=randomBytes(16).toString('hex');
    const passwordHash=`${salt}:${(await scrypt(password,salt,64) as Buffer).toString('hex')}`;
    const id=randomUUID();
    try { await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,email,passwordHash]); }
    catch(error:any) { if(error.code==='23505') throw new HttpError(409,'registration_unavailable'); throw error; }
    await session(res,id); res.status(201).json({id,email});
  }));
  app.post('/api/auth/login',wrap(async(req,res)=>{
    const {email,password}=credentials.parse(req.body);
    const user=(await db.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
    const [salt,expected]=(user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual=await scrypt(password,salt,64) as Buffer;
    if(!user || !timingSafeEqual(Buffer.from(expected,'hex'),actual)) throw new HttpError(401,'invalid_credentials');
    await session(res,user.id); res.json({id:user.id,email:user.email});
  }));
  app.use('/api',(req,res,next)=>{
    Promise.resolve((async()=>{
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('smia_session='))?.slice(13);
      if(!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401,'login_required');
      const user=(await db.query('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)])).rows[0];
      if(!user) throw new HttpError(401,'login_required');
      res.locals.user=user; res.locals.tokenHash=hash(token);
    })()).then(()=>next(),next);
  });
  app.post('/api/auth/logout',wrap(async(_req,res)=>{
    await db.query('DELETE FROM sessions WHERE token_hash=$1',[res.locals.tokenHash]);
    res.clearCookie('smia_session',cookieOptions); res.json({ok:true});
  }));
  app.get('/api/me',wrap(async(_req,res)=>{
    const id=res.locals.user.id;
    const profile=(await db.query('SELECT data FROM business_profiles WHERE user_id=$1',[id])).rows[0]?.data || null;
    res.json({user:res.locals.user,profile,plan:await entitlement(db,id),billingAvailable:!!options.billing});
  }));
  app.put('/api/profile',wrap(async(req,res)=>{
    const data=profileSchema.parse(req.body);
    await db.query('INSERT INTO business_profiles(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=$2,updated_at=now()',[res.locals.user.id,JSON.stringify(data)]);
    res.json({profile:data});
  }));
  app.get('/api/assistants',wrap(async(_req,res)=>{
    const settings=(await db.query('SELECT assistant_id,name,instructions FROM assistant_settings WHERE user_id=$1',[res.locals.user.id])).rows;
    res.json({assistants:assistants.map(({id,name,fields})=>({id,name,fields,custom:settings.find(x=>x.assistant_id===id)||null}))});
  }));
  app.put('/api/assistants/:id',wrap(async(req,res)=>{
    if(!(await entitlement(db,res.locals.user.id)).pro) throw new HttpError(403,'pro_required');
    if(!assistants.some(x=>x.id===req.params.id)) throw new HttpError(404,'not_found');
    const data=z.object({name:z.string().trim().min(2).max(100),instructions:z.string().trim().max(1500)}).strict().parse(req.body);
    await db.query('INSERT INTO assistant_settings(user_id,assistant_id,name,instructions) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,assistant_id) DO UPDATE SET name=$3,instructions=$4',[res.locals.user.id,req.params.id,data.name,data.instructions]);
    res.json({ok:true});
  }));
  app.get('/api/history',wrap(async(req,res)=>{
    const offset=z.coerce.number().int().min(0).max(100000).parse(req.query.offset||0);
    const rows=(await db.query("SELECT id,assistant_id,assistant_name,state,created_at FROM generations WHERE user_id=$1 AND state='completed' ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2",[res.locals.user.id,offset])).rows;
    res.json({items:rows.slice(0,20),hasMore:rows.length>20});
  }));
  app.get('/api/history/:id',wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id);
    const row=(await db.query("SELECT * FROM generations WHERE id=$1 AND user_id=$2 AND state='completed'",[id,res.locals.user.id])).rows[0];
    if(!row) throw new HttpError(404,'not_found'); res.json({generation:row});
  }));
  app.post('/api/run',wrap(async(req,res)=>{
    const body=z.object({assistantId:z.enum(['oferta','landing','anuncios','emails','dm','seo','automatizacion','validacion']),inputs:z.record(z.string(),z.string().trim().max(1200)),requestKey:z.string().uuid()}).strict().parse(req.body);
    const assistant=assistants.find(x=>x.id===body.assistantId)!;
    if(Object.keys(body.inputs).some(key=>!assistant.fields.some(f=>f.name===key)) || assistant.fields.some(f=>!body.inputs[f.name])) throw new HttpError(400,'invalid_inputs');
    const userId=res.locals.user.id;
    const reservation=await db.transaction(async tx=>{
      if(options.previewBudgetUsd !== undefined) {
        await tx.query('SELECT id FROM preview_budget_lock WHERE id=1 FOR UPDATE');
      }
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      await tx.query("UPDATE generations SET state='failed',error_code='interrupted' WHERE user_id=$1 AND state='pending' AND created_at<now()-interval '5 minutes'",[userId]);
      const old=(await tx.query('SELECT * FROM generations WHERE user_id=$1 AND request_key=$2',[userId,body.requestKey])).rows[0];
      if(old) return {old};
      if(options.previewBudgetUsd !== undefined) {
        // Reserve $0.01 per attempt, including failed attempts with unknown usage.
        const attempts=Number((await tx.query('SELECT count(*) AS n FROM generations')).rows[0].n);
        if((attempts+1)*0.01>options.previewBudgetUsd) throw new HttpError(402,'preview_budget_exhausted');
      }
      const plan=await entitlement(tx,userId);
      if(plan.remaining<=0) throw new HttpError(402,'quota_exhausted');
      const attempts=Number((await tx.query("SELECT count(*) AS n FROM generations WHERE user_id=$1 AND created_at>now()-interval '1 hour'",[userId])).rows[0].n);
      if(attempts>=30) throw new HttpError(429,'generation_rate_limited');
      if((await tx.query("SELECT id FROM generations WHERE user_id=$1 AND state='pending' LIMIT 1",[userId])).rows.length) throw new HttpError(409,'generation_in_progress');
      const profile=(await tx.query('SELECT data FROM business_profiles WHERE user_id=$1',[userId])).rows[0]?.data;
      if(!profile) throw new HttpError(409,'profile_required');
      const custom=plan.pro ? (await tx.query('SELECT * FROM assistant_settings WHERE user_id=$1 AND assistant_id=$2',[userId,assistant.id])).rows[0] : null;
      const id=randomUUID();
      await tx.query("INSERT INTO generations(id,user_id,request_key,assistant_id,assistant_name,inputs,context,instructions,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')",[id,userId,body.requestKey,assistant.id,custom?.name||assistant.name,JSON.stringify(body.inputs),JSON.stringify(profile),custom?.instructions||'']);
      return {id,profile,instructions:custom?.instructions||''};
    });
    if(reservation.old) {
      if(reservation.old.state==='completed') return res.json({generation:reservation.old});
      throw new HttpError(409,reservation.old.state==='pending'?'generation_in_progress':'generation_failed_retry_new');
    }
    try {
      const result=await (options.ai||generate)({assistantId:body.assistantId,inputs:body.inputs,profile:reservation.profile,instructions:reservation.instructions});
      const row=(await db.query("UPDATE generations SET state='completed',output=$1,model=$2,input_tokens=$3,output_tokens=$4,cost_usd=$5 WHERE id=$6 AND user_id=$7 AND state='pending' RETURNING *",[result.output,result.model,result.inputTokens,result.outputTokens,result.costUsd,reservation.id,userId])).rows[0];
      if(!row) throw new Error('reservation_expired');
      res.status(201).json({generation:row});
    } catch(error) {
      await db.query("UPDATE generations SET state='failed',error_code=$1 WHERE id=$2 AND state='pending'",[error instanceof AiError?error.code:'generation_error',reservation.id]);
      throw new HttpError(503,error instanceof AiError?error.code:'generation_error');
    }
  }));
  app.post('/api/billing/checkout',wrap(async(_req,res)=>{
    if(!options.billing) throw new HttpError(503,'billing_not_configured');
    res.json({url:await options.billing.checkout(res.locals.user.id,res.locals.user.email)});
  }));
  app.post('/api/billing/portal',wrap(async(_req,res)=>{
    if(!options.billing) throw new HttpError(503,'billing_not_configured');
    res.json({url:await options.billing.portal(res.locals.user.id)});
  }));
  app.use('/api',(_req,res)=>res.status(404).json({error:'not_found'}));
  if(options.frontend) {
    app.get(['/','/index.html','/demo.html','/asistentes','/asistentes.html','/asistentes/:id','/subscription.html','/gracias.html'],(_req,res)=>res.redirect('/panel.html'));
    // Only the V1 panel is served in the isolated application. Old pages cannot
    // expose production checkout links or the former browser-only trial.
    app.get(['/panel.html','/panel.js','/panel.css','/favicon.ico'],express.static(options.frontend));
  }
  app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{
    if(error instanceof z.ZodError) return res.status(400).json({error:'invalid_data'});
    if(error instanceof HttpError) return res.status(error.status).json({error:error.code});
    if(error.type==='entity.parse.failed' || error.type==='entity.too.large') return res.status(400).json({error:'invalid_data'});
    console.error('Request failed',error?.name || 'Error');
    res.status(500).json({error:'server_error'});
  });
  return app;
}

