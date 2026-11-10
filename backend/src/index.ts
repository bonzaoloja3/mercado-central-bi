import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = Number(process.env.PORT || 3001);
const DEMO_MODE = (process.env.DEMO_MODE || 'true').toLowerCase() === 'true';
const AGENT_TOKEN = process.env.AGENT_TOKEN || 'troque-por-um-token-forte';
const CACHE_TTL = Math.max(10, Number(process.env.CACHE_TTL_SECONDS || 300)) * 1000;
const JOB_TIMEOUT = Math.max(10, Number(process.env.AGENT_JOB_TIMEOUT_SECONDS || 60)) * 1000;

type Filters = { from: string; to: string; store: string; group?: string; product?: string; payment?: string };
type Job = { id: string; type: 'dashboard' | 'sale'; filters?: Filters; storeId?: number; documentId?: string; date?: string; createdAt: number };
type CacheEntry = { expiresAt: number; value: any; updatedAt: string };
const cache = new Map<string, CacheEntry>();
const queue: Job[] = [];
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let lastAgentPing = 0;

const stores = [{ id: 1, name: 'Loja 1' }, { id: 2, name: 'Loja 2' }, { id: 3, name: 'Loja 3' }];
const round = (n: number) => Math.round(n * 100) / 100;
function validDate(v: unknown) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function getFilters(q: any): Filters {
  const from = validDate(q.from) ? q.from : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const to = validDate(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  return { from, to, store: String(q.store || '0'), group: String(q.group || ''), product: String(q.product || ''), payment: String(q.payment || '') };
}
function cacheKey(type: string, data: unknown) { return `${type}:${JSON.stringify(data)}`; }
function getCache(key: string) { const v = cache.get(key); if (!v) return null; if (v.expiresAt <= Date.now()) { cache.delete(key); return null; } return v; }
function setCache(key: string, value: any) { cache.set(key, { value, updatedAt: new Date().toISOString(), expiresAt: Date.now() + CACHE_TTL }); }
function cleanCache() { for (const [k, v] of cache) if (v.expiresAt <= Date.now()) cache.delete(k); }
setInterval(cleanCache, 30_000).unref();

function demoDashboard(f: Filters) {
  const start = new Date(`${f.from}T12:00:00`); const end = new Date(`${f.to}T12:00:00`);
  const days: { day: string; revenue: number }[] = [];
  const count = Math.max(1, Math.min(31, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1));
  const storeFactor = f.store === '0' ? 3 : 1;
  const filterFactor = f.product ? 0.18 : f.group ? 0.46 : f.payment ? 0.22 : 1;
  for (let i = 0; i < count; i++) { const d = new Date(start.getTime() + i * 86400000); const seed = d.getDate() * 173 + Number(f.store) * 211; days.push({ day: d.toISOString().slice(0, 10), revenue: round((4200 + (seed % 3600) + (i % 3) * 450) * storeFactor * filterFactor) }); }
  const factor = storeFactor; const revenue = round(days.reduce((s, d) => s + d.revenue, 0));
  const coupons = Math.round(revenue / 27.5); const cost = round(revenue * 0.69);
  const products = [
    { product: 'Banana prata', quantity: 824 * factor, revenue: 4120 * factor, cost: 2760 * factor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Tomate', quantity: 692 * factor, revenue: 3460 * factor, cost: 2320 * factor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Arroz 5kg', quantity: 215 * factor, revenue: 3225 * factor, cost: 2580 * factor, group: 'Mercearia', groupCode: 2 },
    { product: 'Batata', quantity: 510 * factor, revenue: 2550 * factor, cost: 1680 * factor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Leite integral', quantity: 388 * factor, revenue: 2134 * factor, cost: 1710 * factor, group: 'Mercearia', groupCode: 2 }
  ].filter(p => (!f.group || String(p.groupCode) === f.group) && (!f.product || p.product.toLowerCase().includes(f.product.toLowerCase())));
  const payments = [
    { method: 'DINHEIRO', brand: '', amount: round(revenue * .285) }, { method: 'PIX', brand: '', amount: round(revenue * .145) },
    { method: 'CARTAO DEBITO TEF', brand: 'MASTER DEBITO', amount: round(revenue * .205) },
    { method: 'CARTAO DEBITO TEF', brand: 'VISA DEBITO', amount: round(revenue * .175) },
    { method: 'CARTAO CREDITO TEF', brand: 'MASTER CREDITO', amount: round(revenue * .115) },
    { method: 'CARTAO CREDITO TEF', brand: 'VISA CREDITO', amount: round(revenue * .075) }
  ].filter(p => !f.payment || p.method === f.payment || p.brand === f.payment);
  const demoShares: Record<number, number> = { 1: 0.40, 2: 0.31, 3: 0.29 }; const storeSales = (f.store === '0' ? stores : stores.filter(s => s.id === Number(f.store))).map(s => { const share = f.store === '0' ? demoShares[s.id] : 1; const r = round(revenue * share); const c = Math.round(coupons * share); return { id: s.id, name: s.name, revenue: r, coupons: c, average_ticket: c ? round(r / c) : 0 }; });
  const groupSales = [{ code: '1', name: 'Hortifrúti', revenue: round(revenue * .38), quantity: 1200 }, { code: '2', name: 'Mercearia', revenue: round(revenue * .34), quantity: 850 }, { code: '3', name: 'Bebidas', revenue: round(revenue * .18), quantity: 620 }, { code: '4', name: 'Outros', revenue: round(revenue * .10), quantity: 410 }].filter(g => !f.group || g.code === f.group);
  const year = Number(f.to.slice(0,4)); const monthly = Array.from({ length: 12 }, (_, i) => { const month = `${year}-${String(i+1).padStart(2,'0')}`; const seed = (i+3)*731 + Number(f.store)*97; return { month, revenue: round((18000 + seed % 9000) * (f.store === '0' ? 3 : 1) * (f.group ? .38 : 1) * (f.product ? .18 : 1) * (f.payment ? .22 : 1)) }; });
  return { filters: f, stores, storeSales, groupSales, monthly, kpis: { revenue, coupons, average_ticket: coupons ? round(revenue / coupons) : 0, cost, gross_profit: round(revenue - cost), markup: cost ? round((revenue - cost) / cost * 100) : 0, markdown: 18.7 }, daily: days, payments, products, groups: [{ code: '1', name: 'Hortifrúti (exemplo)' }, { code: '2', name: 'Mercearia (exemplo)' }], generatedAt: new Date().toISOString(), source: 'demo' };
}

function enqueue(job: Omit<Job, 'id' | 'createdAt'>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Tempo esgotado aguardando o agente das lojas. Verifique a VPN e o agente.')); }, JOB_TIMEOUT);
    pending.set(id, { resolve, reject, timer }); queue.push({ ...job, id, createdAt: Date.now() });
  });
}
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: DEMO_MODE ? 'demo' : 'live', agentConnected: Date.now() - lastAgentPing < 10000, cacheEntries: cache.size, cacheTtlSeconds: CACHE_TTL / 1000 }));

app.get('/api/dashboard', async (req: Request, res: Response) => {
  const filters = getFilters(req.query); const key = cacheKey('dashboard', filters); const force = req.query.refresh === '1';
  if (!force) { const cached = getCache(key); if (cached) return res.json({ ...cached.value, cache: { hit: true, updatedAt: cached.updatedAt, expiresAt: new Date(cached.expiresAt).toISOString() } }); }
  try {
    const data = DEMO_MODE ? demoDashboard(filters) : await enqueue({ type: 'dashboard', filters });
    setCache(key, data); const saved = getCache(key)!;
    res.json({ ...data, cache: { hit: false, updatedAt: saved.updatedAt, expiresAt: new Date(saved.expiresAt).toISOString() } });
  } catch (e: any) { res.status(504).json({ error: e.message || 'Falha ao consultar lojas.' }); }
});

app.get('/api/sales/:storeId/:documentId', async (req, res) => {
  const storeId = Number(req.params.storeId); const documentId = req.params.documentId; const date = String(req.query.date || '');
  if (![1, 2, 3].includes(storeId) || !documentId || !validDate(date)) return res.status(400).json({ error: 'Informe loja, cupom e data válidos.' });
  const request = { storeId, documentId, date }; const key = cacheKey('sale', request); const force = req.query.refresh === '1';
  if (!force) { const cached = getCache(key); if (cached) return res.json({ ...cached.value, cache: { hit: true, updatedAt: cached.updatedAt, expiresAt: new Date(cached.expiresAt).toISOString() } }); }
  try { const data = DEMO_MODE ? { sale: { storeId, storeName: stores.find(s => s.id === storeId)?.name || `Loja ${storeId}`, documentId, date, issuedAt: `${date} 12:00:00`, gross: 13.02, total: 13.02, items: [{ description: 'Produto demonstrativo A', quantity: 2, total: 8 }, { description: 'Produto demonstrativo B', quantity: 1, total: 5.02 }], payments: [{ method: 'DINHEIRO', amount: 13.02 }] }, source: 'demo' } : await enqueue({ type: 'sale', ...request }); setCache(key, data); const saved = getCache(key)!; res.json({ ...data, cache: { hit: false, updatedAt: saved.updatedAt, expiresAt: new Date(saved.expiresAt).toISOString() } }); }
  catch (e: any) { res.status(504).json({ error: e.message || 'Falha ao consultar venda.' }); }
});

function authorized(req: Request, res: Response) { if (req.header('x-agent-token') !== AGENT_TOKEN) { res.status(401).json({ error: 'Token do agente inválido.' }); return false; } return true; }
app.get('/api/agent/next', (req, res) => { if (!authorized(req, res)) return; lastAgentPing = Date.now(); const job = queue.shift(); res.json({ job: job || null }); });
app.post('/api/agent/result', (req, res) => {
  if (!authorized(req, res)) return; const { id, data, error } = req.body || {}; const p = pending.get(String(id));
  if (!p) return res.status(404).json({ error: 'Solicitação não encontrada ou expirada.' });
  clearTimeout(p.timer); pending.delete(String(id)); if (error) p.reject(new Error(String(error))); else p.resolve(data); res.json({ ok: true });
});
app.get('/api/agent/status', (req, res) => { if (!authorized(req, res)) return; res.json({ queuedJobs: queue.length, waitingJobs: pending.size }); });

app.listen(PORT, () => console.log(`Mercado Central BI API em http://localhost:${PORT} | modo=${DEMO_MODE ? 'DEMO' : 'LIVE'} | cache=${CACHE_TTL / 1000}s`));
