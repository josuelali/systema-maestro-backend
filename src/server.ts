import 'dotenv/config';
import path from 'node:path';
import { openDatabase, migrate } from './database';
import { createApp } from './app';
import { configuredBilling } from './billing';
async function main() {
  const port=Number(process.env.PORT || 18370);
  const origin=process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  const production=process.env.NODE_ENV==='production';
  if(process.env.NODE_ENV==='production' && !origin.startsWith('https://')) throw new Error('HTTPS APP_ORIGIN required');
  const db=await openDatabase();
  await migrate(db);
  const app=createApp(db,{origin,secure:origin.startsWith('https://'),billing:configuredBilling(db,origin),frontend:production?undefined:path.resolve(process.env.FRONTEND_DIR || '../frontend'),previewBudgetUsd:production?undefined:0.09});
  const server=app.listen(port,process.env.HOST || (production?'0.0.0.0':'127.0.0.1'),()=>console.log(`SMIA server: ${origin}`));
  const stop=()=>server.close(()=>{void db.close();});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
main().catch(error=>{console.error('Startup failed:',error.name);process.exitCode=1;});
