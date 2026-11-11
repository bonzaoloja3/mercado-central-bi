import 'dotenv/config';
import mysql from 'mysql2/promise';

type StoreConfig = {
  id: number;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type Filters = {
  from: string;
  to: string;
  store: string;
  group?: string;
  product?: string;
  payment?: string;
};

const api = (process.env.BACKEND_URL || 'https://mercado-central-bi.vercel.app').replace(/\/$/, '');
const token = process.env.AGENT_TOKEN || '';
const pollMs = Math.max(500, Number(process.env.AGENT_POLL_MS || 1500));

const stores: StoreConfig[] = [1, 2, 3].map(id => {
  const p = `STORE_${id}_`;

  return {
    id,
    name: process.env[p + 'NAME'] || `Loja ${id}`,
    host: process.env[p + 'HOST'] || '',
    port: Number(process.env[p + 'PORT'] || 3306),
    user: process.env[p + 'USER'] || '',
    password: process.env[p + 'PASSWORD'] || '',
    database: process.env[p + 'DATABASE'] || 'db_iserver'
  };
});

// ======================================================
// MEDIDOR DE DESEMPENHO DAS CONSULTAS SQL
// ======================================================

async function timedQuery<T = any[]>(
  db: any,
  store: string,
  name: string,
  sql: string,
  params: any[]
): Promise<T> {
  const start = performance.now();

  try {
    const [rows] = await db.execute(sql, params);
    return rows as T;
  } finally {
    const elapsed = performance.now() - start;

    console.log(
      `[SQL] ${store} | ${name} | ${elapsed.toFixed(0)} ms`
    );
  }
}

// ======================================================
// FILTROS SQL
// ======================================================

function filtersSql(f: Filters, aliasHead = 'h') {
  const clauses = [
    `${aliasHead}.status_cupom = 'A'`,
    `${aliasHead}.data_emissao_cupom >= ?`,
    `${aliasHead}.data_emissao_cupom < DATE_ADD(?, INTERVAL 1 DAY)`
  ];

  const params: any[] = [f.from, f.to];

  if (f.group) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM tbl_all_item ix
        WHERE ix.id_documento=${aliasHead}.id_documento
        AND ix.cod_loja=${aliasHead}.cod_loja
        AND ix.status_cupom='A'
        AND ix.item_cancelado='N'
        AND ix.cod_grupo=?
      )`
    );

    params.push(Number(f.group));
  }

  if (f.product) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM tbl_all_item ix
        WHERE ix.id_documento=${aliasHead}.id_documento
        AND ix.cod_loja=${aliasHead}.cod_loja
        AND ix.status_cupom='A'
        AND ix.item_cancelado='N'
        AND (
          ix.descricao_produto LIKE ?
          OR CAST(ix.cod_interno_produto AS CHAR)=?
          OR ix.codigo_barra_produto=?
        )
      )`
    );

    params.push(`%${f.product}%`, f.product, f.product);
  }

  if (f.payment) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM tbl_all_finalizadora fx
        WHERE fx.id_documento=${aliasHead}.id_documento
        AND fx.cod_loja=${aliasHead}.cod_loja
        AND (
          fx.descricao_finalizadora=?
          OR fx.bandeira_tef=?
        )
      )`
    );

    params.push(f.payment, f.payment);
  }

  return {
    where: clauses.join(' AND '),
    params
  };
}

// ======================================================
// CONSULTA COMPLETA DE UMA LOJA
// ======================================================

async function queryStore(s: StoreConfig, f: Filters) {
  const totalStart = performance.now();

  if (!s.host || !s.user || !s.password) {
    throw new Error(
      `${s.name}: configure host, usuário e senha no .env do agente.`
    );
  }

  const connectionStart = performance.now();

  const db = await mysql.createConnection({
    host: s.host,
    port: s.port,
    user: s.user,
    password: s.password,
    database: s.database,
    connectTimeout: 15000,
    dateStrings: true
  });

  console.log(
    `[CONEXÃO] ${s.name} | ${(performance.now() - connectionStart).toFixed(0)} ms`
  );

  try {
    const h = filtersSql(f, 'h');

    // 1. FATURAMENTO E CUPONS

    const headRows = await timedQuery<any[]>(
      db,
      s.name,
      'Cabeçalho',
      `
        SELECT
          COUNT(*) coupons,
          COALESCE(SUM(h.valor_liquido_cupom),0) revenue
        FROM tbl_all_head h
        WHERE ${h.where}
      `,
      h.params
    );

    // 2. FATURAMENTO DIÁRIO

    const dailyRows = await timedQuery<any[]>(
      db,
      s.name,
      'Vendas diárias',
      `
        SELECT
          DATE_FORMAT(h.data_emissao_cupom,'%Y-%m-%d') day,
          COALESCE(SUM(h.valor_liquido_cupom),0) revenue
        FROM tbl_all_head h
        WHERE ${h.where}
        GROUP BY DATE(h.data_emissao_cupom)
        ORDER BY day
      `,
      h.params
    );

    // 3. FATURAMENTO MENSAL

    const year = String(f.to).slice(0, 4);

    const yearFilters = {
      ...f,
      from: `${year}-01-01`,
      to: `${year}-12-31`
    };

    const hy = filtersSql(yearFilters, 'h');

    const monthlyTable =
      'tbl_all_head h FORCE INDEX (idx_data_emissao_cupom)';

    console.log(
      `[ÍNDICE MENSAL] ${s.name} | Índice de data forçado`
    );

    const monthlyRows = await timedQuery<any[]>(
      db,
      s.name,
      'Vendas mensais',
      `
        SELECT
          DATE_FORMAT(h.data_emissao_cupom,'%Y-%m') month,
          COALESCE(SUM(h.valor_liquido_cupom),0) revenue
        FROM ${monthlyTable}
        WHERE ${hy.where}
        GROUP BY DATE_FORMAT(h.data_emissao_cupom,'%Y-%m')
        ORDER BY month
      `,
      hy.params
    );

    // 4. CUSTOS E DESCONTOS

    const itemRows = await timedQuery<any[]>(
      db,
      s.name,
      'Custos e descontos',
      `
        SELECT
          COALESCE(SUM(i.custo_total_item),0) cost,
          COALESCE(SUM(i.preco_total_item),0) item_revenue,
          COALESCE(SUM(i.desconto_item),0) discounts
        FROM tbl_all_item i
        INNER JOIN tbl_all_head h
          ON h.id_documento=i.id_documento
          AND h.cod_loja=i.cod_loja
        WHERE ${h.where}
          AND i.status_cupom='A'
          AND i.item_cancelado='N'
      `,
      h.params
    );

    // 5. PRODUTOS

    const productRows = await timedQuery<any[]>(
      db,
      s.name,
      'Produtos',
      `
        SELECT
          i.descricao_produto product,
          COALESCE(SUM(i.quantidade_produto),0) quantity,
          COALESCE(SUM(i.preco_total_item),0) revenue,
          COALESCE(SUM(i.custo_total_item),0) cost,
          MAX(i.cod_grupo) group_code
        FROM tbl_all_item i
        INNER JOIN tbl_all_head h
          ON h.id_documento=i.id_documento
          AND h.cod_loja=i.cod_loja
        WHERE ${h.where}
          AND i.status_cupom='A'
          AND i.item_cancelado='N'
        GROUP BY i.cod_interno_produto,i.descricao_produto
        ORDER BY revenue DESC
        LIMIT 100
      `,
      h.params
    );

    // 6. GRUPOS

    const groupRows = await timedQuery<any[]>(
      db,
      s.name,
      'Grupos',
      `
        SELECT
          i.cod_grupo code,
          COALESCE(g.descr_grupo, CONCAT('Grupo ',i.cod_grupo)) name,
          COALESCE(SUM(i.preco_total_item),0) revenue,
          COALESCE(SUM(i.quantidade_produto),0) quantity
        FROM tbl_all_item i
        INNER JOIN tbl_all_head h
          ON h.id_documento=i.id_documento
          AND h.cod_loja=i.cod_loja
        LEFT JOIN tbl_grupo g
          ON g.cod_grupo=i.cod_grupo
        WHERE ${h.where}
          AND i.status_cupom='A'
          AND i.item_cancelado='N'
        GROUP BY i.cod_grupo,g.descr_grupo
        ORDER BY revenue DESC
      `,
      h.params
    );

    // 7. FORMAS DE PAGAMENTO

    const paymentRows = await timedQuery<any[]>(
      db,
      s.name,
      'Formas de pagamento',
      `
        SELECT
          f.descricao_finalizadora method,
          COALESCE(NULLIF(f.bandeira_tef,''),'') brand,
          COALESCE(SUM(f.valor_finalizadora),0) amount,
          COALESCE(SUM(f.troco_finalizadora),0) change_amount
        FROM tbl_all_finalizadora f
        INNER JOIN tbl_all_head h
          ON h.id_documento=f.id_documento
          AND h.cod_loja=f.cod_loja
        WHERE ${h.where}
        GROUP BY f.descricao_finalizadora, f.bandeira_tef
        ORDER BY amount DESC
      `,
      h.params
    );

    console.log(
      `[LOJA CONCLUÍDA] ${s.name} | ${(performance.now() - totalStart).toFixed(0)} ms`
    );

    return {
      storeId: s.id,
      storeName: s.name,
      head: headRows[0],
      items: itemRows[0],
      daily: dailyRows,
      monthly: monthlyRows,
      products: productRows,
      groups: groupRows,
      payments: paymentRows
    };

  } finally {
    await db.end();

    console.log(`[CONEXÃO ENCERRADA] ${s.name}`);
  }
}

// ======================================================
// DASHBOARD
// ======================================================

async function dashboard(f: Filters) {
  const dashboardStart = performance.now();

  const selected =
    f.store === '0'
      ? stores
      : stores.filter(s => s.id === Number(f.store));

  if (!selected.length) {
    throw new Error('Loja inválida.');
  }

  console.log('\n========================================');
  console.log('INICIANDO CONSULTA DO DASHBOARD');
  console.log(`Período: ${f.from} até ${f.to}`);
  console.log(`Lojas: ${selected.map(s => s.name).join(', ')}`);
  console.log('========================================\n');

  const results = await Promise.all(
    selected.map(s => queryStore(s, f))
  );

  const revenue = results.reduce(
    (a, r) => a + Number(r.head.revenue || 0), 0
  );

  const itemRevenue = results.reduce(
    (a, r) => a + Number(r.items.item_revenue || 0), 0
  );

  const coupons = results.reduce(
    (a, r) => a + Number(r.head.coupons || 0), 0
  );

  const cost = results.reduce(
    (a, r) => a + Number(r.items.cost || 0), 0
  );

  const discounts = results.reduce(
    (a, r) => a + Number(r.items.discounts || 0), 0
  );

  const dailyMap = new Map<string, number>();
  const monthlyMap = new Map<string, number>();
  const groupSalesMap = new Map<string, any>();

  const storeSales = results.map(r => ({
    id: r.storeId,
    name: r.storeName,
    revenue: Number(r.head.revenue || 0),
    coupons: Number(r.head.coupons || 0),
    average_ticket: Number(r.head.coupons || 0)
      ? Number(r.head.revenue || 0) / Number(r.head.coupons || 0)
      : 0
  }));

  const groupMap = new Map<string, { code: string; name: string }>();

  const paymentMap = new Map<
    string,
    {
      method: string;
      brand: string;
      amount: number;
      change_amount: number;
    }
  >();

  const productMap = new Map<string, any>();

  for (const r of results) {
    for (const x of r.daily) {
      dailyMap.set(
        x.day,
        (dailyMap.get(x.day) || 0) + Number(x.revenue)
      );
    }

    for (const x of r.monthly || []) {
      monthlyMap.set(
        x.month,
        (monthlyMap.get(x.month) || 0) + Number(x.revenue)
      );
    }

    for (const g of r.groups || []) {
      const key = String(g.code);

      const old = groupSalesMap.get(key) || {
        code: key,
        name: String(g.name),
        revenue: 0,
        quantity: 0
      };

      old.revenue += Number(g.revenue || 0);
      old.quantity += Number(g.quantity || 0);

      groupSalesMap.set(key, old);
    }

    for (const g of r.groups || []) {
      groupMap.set(String(g.code), {
        code: String(g.code),
        name: String(g.name || `Grupo ${g.code}`)
      });
    }

    for (const x of r.payments) {
      const key = `${x.method}|${x.brand}`;

      const old = paymentMap.get(key) || {
        method: x.method,
        brand: x.brand,
        amount: 0,
        change_amount: 0
      };

      old.amount += Number(x.amount);
      old.change_amount += Number(x.change_amount);

      paymentMap.set(key, old);
    }

    for (const x of r.products) {
      const key = String(x.product);

      const old = productMap.get(key) || {
        product: x.product,
        quantity: 0,
        revenue: 0,
        cost: 0,
        groupCode: x.group_code
      };

      old.quantity += Number(x.quantity);
      old.revenue += Number(x.revenue);
      old.cost += Number(x.cost);

      productMap.set(key, old);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  const result = {
    stores: stores.map(s => ({
      id: s.id,
      name: s.name
    })),

    storeSales,

    groupSales: [...groupSalesMap.values()]
      .sort((a, b) => b.revenue - a.revenue),

    monthly: [...monthlyMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({
        month,
        revenue: round(revenue)
      })),

    filters: f,

    kpis: {
      revenue: round(revenue),
      coupons,
      average_ticket: coupons ? round(revenue / coupons) : 0,
      cost: round(cost),
      gross_profit: round(itemRevenue - cost),
      markup: cost
        ? round((itemRevenue - cost) / cost * 100)
        : 0,
      markdown: (itemRevenue + discounts)
        ? round(discounts / (itemRevenue + discounts) * 100)
        : 0
    },

    daily: [...dailyMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, revenue]) => ({
        day,
        revenue: round(revenue)
      })),

    payments: [...paymentMap.values()]
      .map(x => ({
        ...x,
        amount: round(x.amount),
        change_amount: round(x.change_amount)
      }))
      .sort((a, b) => b.amount - a.amount),

    products: [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 100),

    groups: [...groupMap.values()]
      .sort((a, b) => a.name.localeCompare(b.name)),

    generatedAt: new Date().toISOString(),
    source: 'live'
  };

  console.log('\n========================================');
  console.log(
    `[DASHBOARD CONCLUÍDO] ${(performance.now() - dashboardStart).toFixed(0)} ms`
  );
  console.log('========================================\n');

  return result;
}

// ======================================================
// CONSULTA INDIVIDUAL DE VENDA
// ======================================================

async function sale(
  storeId: number,
  documentId: string,
  date: string
) {
  const totalStart = performance.now();

  const s = stores.find(x => x.id === storeId);

  if (!s) {
    throw new Error('Loja inválida.');
  }

  if (!s.host || !s.user || !s.password) {
    throw new Error(`${s.name}: configure a conexão no .env.`);
  }

  const connectionStart = performance.now();

  const db = await mysql.createConnection({
    host: s.host,
    port: s.port,
    user: s.user,
    password: s.password,
    database: s.database,
    connectTimeout: 15000,
    dateStrings: true
  });

  console.log(
    `[CONEXÃO] ${s.name} | ${(performance.now() - connectionStart).toFixed(0)} ms`
  );

  try {
    const heads = await timedQuery<any[]>(
      db,
      s.name,
      'Localizar cupom',
      `
        SELECT
          id_documento documentId,
          cod_loja sourceStore,
          data_emissao_cupom issuedAt,
          valor_bruto_cupom gross,
          valor_liquido_cupom total,
          status_cupom status
        FROM tbl_all_head
        WHERE id_documento=?
          AND DATE(data_emissao_cupom)=?
          AND status_cupom='A'
        LIMIT 1
      `,
      [documentId, date]
    );

    if (!heads.length) {
      return {
        sale: null,
        message: 'Cupom não encontrado.'
      };
    }

    const items = await timedQuery<any[]>(
      db,
      s.name,
      'Itens do cupom',
      `
        SELECT
          cod_interno_produto productCode,
          codigo_barra_produto barcode,
          descricao_produto description,
          quantidade_produto quantity,
          preco_total_item total,
          custo_total_item cost
        FROM tbl_all_item
        WHERE id_documento=?
          AND cod_loja=?
          AND DATE(data_emissao)=?
          AND status_cupom='A'
          AND item_cancelado='N'
        ORDER BY cod_all_item
      `,
      [documentId, heads[0].sourceStore, date]
    );

    const payments = await timedQuery<any[]>(
      db,
      s.name,
      'Pagamentos do cupom',
      `
        SELECT
          descricao_finalizadora method,
          bandeira_tef brand,
          valor_finalizadora amount,
          troco_finalizadora changeAmount
        FROM tbl_all_finalizadora
        WHERE id_documento=?
          AND cod_loja=?
        ORDER BY descricao_finalizadora
      `,
      [documentId, heads[0].sourceStore]
    );

    console.log(
      `[VENDA CONCLUÍDA] ${s.name} | ${(performance.now() - totalStart).toFixed(0)} ms`
    );

    return {
      sale: {
        ...heads[0],
        storeId,
        storeName: s.name,
        items,
        payments
      },
      source: 'live'
    };

  } finally {
    await db.end();
    console.log(`[CONEXÃO ENCERRADA] ${s.name}`);
  }
}

// ======================================================
// ENVIO DOS RESULTADOS AO BACKEND
// ======================================================

async function postResult(
  id: string,
  data: any,
  error?: string
) {
  const r = await fetch(`${api}/api/agent/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-token': token
    },
    body: JSON.stringify({
      id,
      data,
      error
    })
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Falha ao devolver resultado: ${r.status}: ${detail}`);
  }
}

// ======================================================
// FILA DO AGENTE
// ======================================================

let polling = false;

async function poll() {
  if (polling) return;

  polling = true;

  try {
    const r = await fetch(`${api}/api/agent/next`, {
      headers: {
        'x-agent-token': token
      }
    });

    if (!r.ok) {
      const detail = await r.text();

      throw new Error(
        `Backend respondeu ${r.status}: ${detail}`
      );
    }

    const body = await r.json() as { job: any };

    if (!body.job) return;

    const j = body.job;

    console.log('\n----------------------------------------');
    console.log(`TRABALHO RECEBIDO: ${j.type}`);
    console.log(`ID: ${j.id}`);
    console.log('----------------------------------------');

    const jobStart = performance.now();

    try {
      const data =
        j.type === 'dashboard'
          ? await dashboard(j.filters)
          : await sale(
              Number(j.storeId),
              String(j.documentId),
              String(j.date)
            );

      await postResult(j.id, data);

      console.log(
        `[TRABALHO CONCLUÍDO] ${j.type} | ${(performance.now() - jobStart).toFixed(0)} ms`
      );

    } catch (e: any) {
      await postResult(
        j.id,
        null,
        e.message || 'Erro na consulta MySQL'
      );

      console.error('Falha na consulta:', e.message);
    }

  } catch (e: any) {
    console.error(
      'Falha ao consultar fila do backend:',
      e.message
    );

  } finally {
    polling = false;
  }
}

// ======================================================
// INICIALIZAÇÃO
// ======================================================

if (!token) {
  console.error('Configure AGENT_TOKEN no .env do agente.');
  process.exit(1);
}

console.log('Agente Mercado Central BI iniciado.');
console.log(`Backend: ${api}`);
console.log(`Intervalo de consulta: ${pollMs} ms`);
console.log('Proteção contra consultas simultâneas: ATIVA');

setInterval(poll, pollMs);

void poll();
