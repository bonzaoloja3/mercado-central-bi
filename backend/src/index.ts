import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3001);
const DEMO_MODE = (process.env.DEMO_MODE || 'true').toLowerCase() === 'true';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const CACHE_TTL = Math.max(10, Number(process.env.CACHE_TTL_SECONDS || 300));
const JOB_TIMEOUT = Math.max(10, Number(process.env.AGENT_JOB_TIMEOUT_SECONDS || 60));
const JOB_TTL = Math.max(120, JOB_TIMEOUT * 3);

const redis = Redis.fromEnv();

type Filters = {
  from: string;
  to: string;
  store: string;
  group?: string;
  product?: string;
  payment?: string;
};

type Job = {
  id: string;
  type: 'dashboard' | 'sale';
  filters?: Filters;
  storeId?: number;
  documentId?: string;
  date?: string;
  createdAt: number;
};

const QUEUE_KEY = 'mcbi:agent:queue';
const STORES = [
  { id: 1, name: 'Loja 1' },
  { id: 2, name: 'Loja 2' },
  { id: 3, name: 'Loja 3' }
];

const round = (n: number) => Math.round(n * 100) / 100;

function validDate(v: unknown) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function getFilters(q: any): Filters {
  const from = validDate(q.from)
    ? q.from
    : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const to = validDate(q.to)
    ? q.to
    : new Date().toISOString().slice(0, 10);

  return {
    from,
    to,
    store: String(q.store || '0'),
    group: String(q.group || ''),
    product: String(q.product || ''),
    payment: String(q.payment || '')
  };
}

function cacheKey(type: string, data: unknown) {
  return `mcbi:cache:${type}:${JSON.stringify(data)}`;
}

function jobKey(id: string) {
  return `mcbi:job:${id}`;
}

function resultKey(id: string) {
  return `mcbi:result:${id}`;
}

function authorized(req: Request, res: Response) {
  if (!AGENT_TOKEN || req.header('x-agent-token') !== AGENT_TOKEN) {
    res.status(401).json({ error: 'Token do agente inválido.' });
    return false;
  }

  return true;
}

// ======================================================
// CACHE REDIS
// ======================================================

async function getCache(key: string) {
  return redis.get<any>(key);
}

async function setCache(key: string, value: any) {
  await redis.set(key, {
    value,
    updatedAt: new Date().toISOString()
  }, { ex: CACHE_TTL });
}

// ======================================================
// CRIAÇÃO DE TAREFAS
// ======================================================

async function enqueue(job: Omit<Job, 'id' | 'createdAt'>) {
  const id = randomUUID();

  const completeJob: Job = {
    ...job,
    id,
    createdAt: Date.now()
  };

  await redis.set(jobKey(id), {
    status: 'queued',
    createdAt: completeJob.createdAt
  }, { ex: JOB_TTL });

  await redis.lpush(QUEUE_KEY, JSON.stringify(completeJob));

  return id;
}

// ======================================================
// DASHBOARD DEMONSTRATIVO
// ======================================================

function demoDashboard(f: Filters) {
  const start = new Date(`${f.from}T12:00:00`);
  const end = new Date(`${f.to}T12:00:00`);

  const days: { day: string; revenue: number }[] = [];

  const count = Math.max(
    1,
    Math.min(
      31,
      Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
    )
  );

  const storeFactor = f.store === '0' ? 3 : 1;
  const filterFactor = f.product ? 0.18 : f.group ? 0.46 : f.payment ? 0.22 : 1;

  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const seed = d.getDate() * 173 + Number(f.store) * 211;

    days.push({
      day: d.toISOString().slice(0, 10),
      revenue: round((4200 + (seed % 3600) + (i % 3) * 450) * storeFactor * filterFactor)
    });
  }

  const revenue = round(days.reduce((s, d) => s + d.revenue, 0));
  const coupons = Math.round(revenue / 27.5);
  const cost = round(revenue * 0.69);

  const products = [
    { product: 'Banana prata', quantity: 824 * storeFactor, revenue: 4120 * storeFactor, cost: 2760 * storeFactor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Tomate', quantity: 692 * storeFactor, revenue: 3460 * storeFactor, cost: 2320 * storeFactor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Arroz 5kg', quantity: 215 * storeFactor, revenue: 3225 * storeFactor, cost: 2580 * storeFactor, group: 'Mercearia', groupCode: 2 },
    { product: 'Batata', quantity: 510 * storeFactor, revenue: 2550 * storeFactor, cost: 1680 * storeFactor, group: 'Hortifrúti', groupCode: 1 },
    { product: 'Leite integral', quantity: 388 * storeFactor, revenue: 2134 * storeFactor, cost: 1710 * storeFactor, group: 'Mercearia', groupCode: 2 }
  ].filter(p =>
    (!f.group || String(p.groupCode) === f.group) &&
    (!f.product || p.product.toLowerCase().includes(f.product.toLowerCase()))
  );

  const payments = [
    { method: 'DINHEIRO', brand: '', amount: round(revenue * .285) },
    { method: 'PIX', brand: '', amount: round(revenue * .145) },
    { method: 'CARTAO DEBITO TEF', brand: 'MASTER DEBITO', amount: round(revenue * .205) },
    { method: 'CARTAO DEBITO TEF', brand: 'VISA DEBITO', amount: round(revenue * .175) },
    { method: 'CARTAO CREDITO TEF', brand: 'MASTER CREDITO', amount: round(revenue * .115) },
    { method: 'CARTAO CREDITO TEF', brand: 'VISA CREDITO', amount: round(revenue * .075) }
  ].filter(p => !f.payment || p.method === f.payment || p.brand === f.payment);

  const demoShares: Record<number, number> = {
    1: 0.40,
    2: 0.31,
    3: 0.29
  };

  const storeSales = (f.store === '0'
    ? STORES
    : STORES.filter(s => s.id === Number(f.store))
  ).map(s => {
    const share = f.store === '0' ? demoShares[s.id] : 1;
    const r = round(revenue * share);
    const c = Math.round(coupons * share);

    return {
      id: s.id,
      name: s.name,
      revenue: r,
      coupons: c,
      average_ticket: c ? round(r / c) : 0
    };
  });

  const groupSales = [
    { code: '1', name: 'Hortifrúti', revenue: round(revenue * .38), quantity: 1200 },
    { code: '2', name: 'Mercearia', revenue: round(revenue * .34), quantity: 850 },
    { code: '3', name: 'Bebidas', revenue: round(revenue * .18), quantity: 620 },
    { code: '4', name: 'Outros', revenue: round(revenue * .10), quantity: 410 }
  ].filter(g => !f.group || g.code === f.group);

  const year = Number(f.to.slice(0, 4));

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const seed = (i + 3) * 731 + Number(f.store) * 97;

    return {
      month,
      revenue: round(
        (18000 + seed % 9000) *
        (f.store === '0' ? 3 : 1) *
        (f.group ? .38 : 1) *
        (f.product ? .18 : 1) *
        (f.payment ? .22 : 1)
      )
    };
  });

  return {
    filters: f,
    stores: STORES,
    storeSales,
    groupSales,
    monthly,
    kpis: {
      revenue,
      coupons,
      average_ticket: coupons ? round(revenue / coupons) : 0,
      cost,
      gross_profit: round(revenue - cost),
      markup: cost ? round((revenue - cost) / cost * 100) : 0,
      markdown: 18.7
    },
    daily: days,
    payments,
    products,
    groups: [
      { code: '1', name: 'Hortifrúti (exemplo)' },
      { code: '2', name: 'Mercearia (exemplo)' }
    ],
    generatedAt: new Date().toISOString(),
    source: 'demo'
  };
}

// ======================================================
// HEALTH
// ======================================================

app.get('/api/health', async (_req, res) => {
  try {
    const ping = await redis.get<number>('mcbi:agent:lastPing');

    res.json({
      ok: true,
      mode: DEMO_MODE ? 'demo' : 'live',
      agentConnected: Boolean(ping && Date.now() - ping < 10000),
      redis: 'connected'
    });
  } catch {
    res.status(503).json({
      ok: false,
      redis: 'unavailable'
    });
  }
});

// ======================================================
// DASHBOARD
// ======================================================

app.get('/api/dashboard', async (req: Request, res: Response) => {
  const filters = getFilters(req.query);
  const key = cacheKey('dashboard', filters);
  const force = req.query.refresh === '1';

  try {
    if (!force) {
      const cached = await getCache(key);

      if (cached) {
        return res.json({
          ...cached.value,
          cache: {
            hit: true,
            updatedAt: cached.updatedAt
          }
        });
      }
    }

    if (DEMO_MODE) {
      const data = demoDashboard(filters);
      await setCache(key, data);
      return res.json({
        ...data,
        cache: {
          hit: false,
          updatedAt: new Date().toISOString()
        }
      });
    }

    const id = await enqueue({
      type: 'dashboard',
      filters
    });

    res.status(202).json({
      jobId: id,
      status: 'queued'
    });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao solicitar dashboard.'
    });
  }
});

// ======================================================
// CONSULTA DO STATUS DA TAREFA
// ======================================================

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const job = await redis.get<any>(jobKey(id));
    const result = await redis.get<any>(resultKey(id));

    if (result) {
      if (result.status === 'error') {
        return res.json({
          status: 'error',
          error: result.error
        });
      }

      return res.json({
        status: 'completed',
        data: result.data
      });
    }

    if (!job) {
      return res.status(404).json({
        error: 'Tarefa não encontrada ou expirada.'
      });
    }

    res.json({
      status: job.status
    });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao consultar tarefa.'
    });
  }
});

// ======================================================
// VENDA INDIVIDUAL
// ======================================================

app.get('/api/sales/:storeId/:documentId', async (req, res) => {
  const storeId = Number(req.params.storeId);
  const documentId = req.params.documentId;
  const date = String(req.query.date || '');

  if (![1, 2, 3].includes(storeId) || !documentId || !validDate(date)) {
    return res.status(400).json({
      error: 'Informe loja, cupom e data válidos.'
    });
  }

  const key = cacheKey('sale', { storeId, documentId, date });
  const force = req.query.refresh === '1';

  try {
    if (!force) {
      const cached = await getCache(key);
      if (cached) return res.json(cached.value);
    }

    const id = await enqueue({
      type: 'sale',
      storeId,
      documentId,
      date
    });

    res.status(202).json({
      jobId: id,
      status: 'queued'
    });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao solicitar venda.'
    });
  }
});

// ======================================================
// AGENTE: BUSCAR TAREFA
// ======================================================

app.get('/api/agent/next', async (req, res) => {
  if (!authorized(req, res)) return;

  try {
    await redis.set('mcbi:agent:lastPing', Date.now(), { ex: 30 });

    const raw = await redis.rpop<string>(QUEUE_KEY);

    if (!raw) {
      return res.json({ job: null });
    }

    const job = JSON.parse(raw) as Job;

    await redis.set(jobKey(job.id), {
      status: 'processing',
      createdAt: job.createdAt
    }, { ex: JOB_TTL });

    res.json({ job });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao buscar tarefa.'
    });
  }
});

// ======================================================
// AGENTE: DEVOLVER RESULTADO
// ======================================================

app.post('/api/agent/result', async (req, res) => {
  if (!authorized(req, res)) return;

  const { id, data, error } = req.body || {};

  if (!id) {
    return res.status(400).json({
      error: 'ID da tarefa não informado.'
    });
  }

  try {
    const job = await redis.get<any>(jobKey(String(id)));

    if (!job) {
      return res.status(404).json({
        error: 'Solicitação não encontrada ou expirada.'
      });
    }

    await redis.set(resultKey(String(id)), {
      status: error ? 'error' : 'completed',
      data: error ? null : data,
      error: error ? String(error) : null
    }, { ex: JOB_TTL });

    await redis.set(jobKey(String(id)), {
      status: error ? 'error' : 'completed'
    }, { ex: JOB_TTL });

    res.json({ ok: true });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao salvar resultado.'
    });
  }
});

// ======================================================
// STATUS DO AGENTE
// ======================================================

app.get('/api/agent/status', async (req, res) => {
  if (!authorized(req, res)) return;

  try {
    const queuedJobs = await redis.llen(QUEUE_KEY);
    const lastPing = await redis.get<number>('mcbi:agent:lastPing');

    res.json({
      queuedJobs,
      lastPing,
      agentConnected: Boolean(lastPing && Date.now() - lastPing < 10000)
    });

  } catch (e: any) {
    res.status(500).json({
      error: e.message || 'Falha ao consultar status.'
    });
  }
});

// ======================================================
// EXPORTAÇÃO PARA VERCEL E EXECUÇÃO LOCAL
// ======================================================

export default app;

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(
      `Mercado Central BI API em http://localhost:${PORT} | modo=${DEMO_MODE ? 'DEMO' : 'LIVE'}`
    );
  });
}
