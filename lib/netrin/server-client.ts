// lib/netrin/server-client.ts
import { NetrinClient } from './client.ts';

const REQUIRED_ENV = ['NETRIN_BASE_URL', 'NETRIN_TOKEN'] as const;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`missing env: ${name}`);
  return v;
}

export function createServerNetrinClient(): NetrinClient {
  for (const k of REQUIRED_ENV) readEnv(k);
  const acuraciaRaw = process.env.NETRIN_PEP_ACURACIA;
  const pepAcuracia = acuraciaRaw ? Number.parseInt(acuraciaRaw, 10) : undefined;
  return new NetrinClient({
    baseUrl: readEnv('NETRIN_BASE_URL'),
    token: readEnv('NETRIN_TOKEN'),
    pepAcuracia: Number.isFinite(pepAcuracia) ? pepAcuracia : undefined,
  });
}
