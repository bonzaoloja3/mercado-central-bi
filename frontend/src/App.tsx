import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type Filters = { from: string; to: string; store: string; group: string; product: string; payment: string; weekday: string; hour: string };
type StoreSale = { id: number; name: string; revenue: number; coupons: number; average_ticket: number };
type GroupSale = { code: string; name: string; revenue: number; quantity?: number };
type MonthSale = { month: string; revenue: number; average_daily?: number; markup?: number };
type Dashboard = {
  stores: { id: number; name: string }[];
  storeSales?: StoreSale[];
  groupSales?: GroupSale[];
  monthly?: MonthSale[];
  kpis: { revenue: number | string; coupons: number | string; average_ticket: number | string; cost: number | string; gross_profit: number; gross_margin?: number; cost_percentage?: number };
  daily: { day: string; revenue: number }[];
  payments: { method: string; brand: string; amount: number; change_amount?: number }[];
  products: { product: string; quantity: number; revenue: number; cost: number; groupCode?: number; group?: string }[];
  groups?: { code: string; name: string }[];
  cancellations?: { coupons: number; item_records: number; quantity: number; amount: number; stores?: any[] };
  cancelled?: { coupons: number; records?: number; quantity: number; value: number; byStore?: any[] };
  heatmap?: { weekday: number; hour: number; coupons: number; revenue: number }[];
  generatedAt: string; source: 'demo' | 'live';
  cache?: { hit: boolean; updatedAt: string; expiresAt: string };
};
type SaleResult = { sale: null | { storeId: number; storeName: string; documentId: string; issuedAt: string; total: number; gross: number; items: any[]; payments: any[] }; message?: string; source?: string };
const API = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const money = (v: number | string) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const dateLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = dateLocal(new Date());
const week = dateLocal(new Date(Date.now() - 6 * 86400000));
const initialFilters: Filters = { from: week, to: today, store: '0', group: '', product: '', payment: '', weekday: '', hour: '' };
const pct = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

export default function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const requestId = useRef(0);
  const [saleStore, setSaleStore] = useState('3');
  const [saleDate, setSaleDate] = useState(today);
  const [saleDocument, setSaleDocument] = useState('');
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleError, setSaleError] = useState('');
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  const load = useCallback(async (manual = false, override?: Filters) => {
    const current = override || filters;
    const id = ++requestId.current;
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams({ from: current.from, to: current.to, store: current.store });
      if (current.group) q.set('group', current.group);
      if (current.product) q.set('product', current.product);
      if (current.payment) q.set('payment', current.payment);
      if (current.weekday !== '') q.set('weekday', current.weekday);
      if (current.hour !== '') q.set('hour', current.hour);
      if (manual) q.set('refresh', '1');
      const response = await fetch(`${API}/api/dashboard?${q.toString()}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar as lojas.');
      if (id !== requestId.current) return;
      setData(result); setLastUpdated(result.cache?.updatedAt || result.generatedAt || new Date().toISOString());
    } catch (e: any) { if (id === requestId.current) setError(e.message || 'Falha de conexão com o backend.'); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [filters]);

  useEffect(() => { void load(false); }, [load]);
  const update = (patch: Partial<Filters>) => setFilters(old => ({ ...old, ...patch }));
  const resetFilters = () => setFilters(initialFilters);

  const dailyOption = useMemo(() => ({
    animationDuration: 500,
    tooltip: { trigger: 'axis', backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, valueFormatter: (v: any) => money(v) },
    grid: { left: 12, right: 18, top: 24, bottom: 34, containLabel: true },
    xAxis: { type: 'category', data: data?.daily.map(x => x.day) || [], axisLine: { lineStyle: { color: '#34443b' } }, axisLabel: { color: '#aab8ae' } },
    yAxis: { type: 'value', axisLabel: { color: '#aab8ae', formatter: (v: number) => `R$${v}` }, splitLine: { lineStyle: { color: '#26352d' } } },
    series: [{ data: data?.daily.map(x => x.revenue) || [], type: 'line', smooth: true, symbolSize: 8, lineStyle: { width: 3, color: '#79c99a' }, itemStyle: { color: '#79c99a' }, areaStyle: { color: 'rgba(121,201,154,.12)' }, emphasis: { focus: 'series', scale: 1.5 } }]
  }), [data]);
  const paymentOptions = useMemo(() => { const opts = new Map<string, string>(); for (const p of data?.payments || []) { opts.set(p.method, p.method); if (p.brand) opts.set(p.brand, `${p.brand} · ${p.method}`); } return [...opts]; }, [data]);
  const paymentTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of data?.payments || []) totals.set(p.method, (totals.get(p.method) || 0) + Number(p.amount));
    return [...totals].map(([name, value]) => ({ name, value }));
  }, [data]);
  const paymentOption = useMemo(() => ({
    animationDuration: 500,
    tooltip: { trigger: 'item', backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, formatter: (p: any) => `${p.name}<br/>${money(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#aab8ae' } },
    series: [{ type: 'pie', radius: ['45%', '70%'], center: ['50%', '44%'], itemStyle: { borderColor: '#17231c', borderWidth: 3 }, label: { color: '#dce7df' }, emphasis: { scale: true, scaleSize: 9, itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,.35)' } }, data: paymentTotals }]
  }), [paymentTotals]);
  const productOption = useMemo(() => ({
    animationDuration: 500,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, valueFormatter: (v: any) => money(v) },
    grid: { left: 12, right: 18, top: 16, bottom: 55, containLabel: true },
    xAxis: { type: 'category', data: (data?.products || []).slice(0, 8).map(p => p.product), axisLabel: { color: '#aab8ae', rotate: 20, interval: 0 } },
    yAxis: { type: 'value', axisLabel: { color: '#aab8ae' }, splitLine: { lineStyle: { color: '#26352d' } } },
    series: [{ type: 'bar', data: (data?.products || []).slice(0, 8).map(p => p.revenue), itemStyle: { color: '#79c99a', borderRadius: [5, 5, 0, 0] }, emphasis: { itemStyle: { color: '#a8dcb6', shadowBlur: 12, shadowColor: 'rgba(121,201,154,.25)' } } }]
  }), [data]);
  const groupOption = useMemo(() => ({
    animationDuration: 600,
    tooltip: { trigger: 'item', backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, formatter: (p: any) => `${p.name}<br/>${money(p.value)} (${p.percent}%)` },
    legend: { orient: 'vertical', left: 8, top: 'middle', textStyle: { color: '#aab8ae', fontSize: 11 } },
    series: [{ type: 'pie', radius: ['42%', '70%'], center: ['68%', '50%'], itemStyle: { borderColor: '#17231c', borderWidth: 3 }, label: { show: false }, emphasis: { scale: true, scaleSize: 10, label: { show: true, color: '#edf4ef', fontWeight: 700, formatter: '{b}\n{d}%' }, itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,.35)' } }, data: (data?.groupSales || []).map(g => ({ name: g.name, value: g.revenue })) }]
  }), [data]);
  const monthlyOption = useMemo(() => ({
    animationDuration: 600,
    tooltip: { trigger: 'axis', backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, valueFormatter: (v: any) => money(v) },
    legend: { top: 0, textStyle: { color: '#aab8ae' } },
    grid: { left: 12, right: 18, top: 38, bottom: 28, containLabel: true },
    xAxis: { type: 'category', data: (data?.monthly || []).map(m => m.month), axisLabel: { color: '#aab8ae' }, axisLine: { lineStyle: { color: '#34443b' } } },
    yAxis: { type: 'value', axisLabel: { color: '#aab8ae', formatter: (v: number) => `R$${v}` }, splitLine: { lineStyle: { color: '#26352d' } } },
    series: [{ name: 'Venda total', type: 'bar', barMaxWidth: 30, data: (data?.monthly || []).map(m => m.revenue), itemStyle: { color: '#79c99a', borderRadius: [5, 5, 0, 0] }, emphasis: { itemStyle: { color: '#a8dcb6' } } }]
  }), [data]);
  const onDailyClick = (p: any) => { if (p?.name) update({ from: p.name, to: p.name }); };
  const onPaymentClick = (p: any) => { if (p?.name) update({ payment: filters.payment === p.name ? '' : p.name }); };
  const onProductClick = (p: any) => { if (p?.name) update({ product: filters.product === p.name ? '' : p.name }); };
  const onHeatmapClick = (p: any) => { const v = p?.data; if (Array.isArray(v) && v.length >= 2) update({ hour: String(v[0]), weekday: String(v[1]) }); };
  const heatmapData = data?.heatmap || [];
  const weekdayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const heatmapOption = useMemo(() => ({ tooltip: { position: 'top', backgroundColor: '#203229', borderColor: '#45634f', textStyle: { color: '#edf4ef' }, formatter: (p: any) => `${weekdayNames[p.data[1]]} · ${String(p.data[0]).padStart(2,'0')}h<br/>${number(p.data[2])} cupons<br/>${money(p.data[3])}` }, grid: { left: 42, right: 18, top: 18, bottom: 35 }, xAxis: { type: 'category', data: Array.from({length:24},(_,h)=>String(h).padStart(2,'0')), splitArea: { show: true }, axisLabel: { color: '#aab8ae', interval: 2 } }, yAxis: { type: 'category', data: weekdayNames, axisLabel: { color: '#aab8ae' } }, visualMap: { min: 0, max: Math.max(1,...heatmapData.map(x=>Number(x.coupons))), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, show: false, inRange: { color: ['#203229','#39734d','#79c99a'] } }, series: [{ type: 'heatmap', data: heatmapData.map(x=>[x.hour,x.weekday,x.coupons,x.revenue]), label: { show: false }, emphasis: { itemStyle: { borderColor: '#edf4ef', borderWidth: 1 } } }] }), [heatmapData]);
  const onGroupClick = (p: any) => { const found = (data?.groupSales || []).find(g => g.name === p?.name); if (found) update({ group: filters.group === found.code ? '' : found.code }); };

  const searchSale = async () => {
    if (!saleDocument.trim()) { setSaleError('Informe o número do cupom.'); return; }
    setSaleLoading(true); setSaleError(''); setSaleResult(null);
    try {
      const url = `${API}/api/sales/${saleStore}/${encodeURIComponent(saleDocument.trim())}?date=${saleDate}&refresh=1`;
      const r = await fetch(url); const json = await r.json(); if (!r.ok) throw new Error(json.error || 'Erro ao consultar cupom.');
      setSaleResult(json); if (!json.sale) setSaleError(json.message || 'Cupom não encontrado.');
    } catch (e: any) { setSaleError(e.message || 'Falha na consulta.'); }
    finally { setSaleLoading(false); }
  };
  const k = data?.kpis;
  const updatedLabel = lastUpdated ? new Date(lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const markupValue = Number((k as any)?.markup ?? ((Number(k?.gross_profit || 0) / Math.max(1, Number(k?.cost || 0))) * 100));
  const markdownValue = Number((k as any)?.markdown ?? 0);
  const marginValue = Number((k as any)?.gross_margin ?? (Number(k?.revenue || 0) ? Number(k?.gross_profit || 0) / Number(k?.revenue || 1) * 100 : 0));
  const costPercent = Number((k as any)?.cost_percentage ?? (Number(k?.revenue || 0) ? Number(k?.cost || 0) / Number(k?.revenue || 1) * 100 : 0));
  const cancelled = data?.cancellations || (data?.cancelled ? { coupons: data.cancelled.coupons, item_records: data.cancelled.records || 0, quantity: data.cancelled.quantity, amount: data.cancelled.value } : null);
  const storeSales = data?.storeSales || [];
  const groupSales = data?.groupSales || [];

  return <main className="shell">
    <header><div className="brand"><div className="mark">MC</div><div><strong>MERCADO CENTRAL</strong><span>INTELLIGENCE · BUSINESS</span></div></div><div className="status"><i/> {data?.source === 'demo' ? 'Modo demonstração' : 'Consulta às lojas'}</div></header>
    <section className="intro"><div><p className="eyebrow">VISÃO GERAL</p><h1>Inteligência de vendas</h1><p className="sub">Acompanhe o desempenho das três lojas em um só lugar.</p></div><button className="refresh" onClick={() => void load(true)} disabled={loading}>↻ {loading ? 'Consultando...' : 'Atualizar agora'}</button></section>
    <section className="filters">
      <label>Data inicial<input type="date" value={filters.from} max={filters.to} onChange={e => update({ from: e.target.value })}/></label>
      <label>Data final<input type="date" value={filters.to} min={filters.from} onChange={e => update({ to: e.target.value })}/></label>
      <label>Unidade<select value={filters.store} onChange={e => update({ store: e.target.value })}><option value="0">Todas as lojas</option><option value="1">Loja 1</option><option value="2">Loja 2</option><option value="3">Loja 3</option></select></label>
      <label>Grupo<select value={filters.group} onChange={e => update({ group: e.target.value })}><option value="">Todos os grupos</option>{(data?.groups || []).map(g => <option key={g.code} value={g.code}>{g.name}</option>)}</select></label>
      <label>Produto<input value={filters.product} onChange={e => update({ product: e.target.value })} placeholder="Nome, código ou barras"/></label>
      <label>Pagamento<select value={filters.payment} onChange={e => update({ payment: e.target.value })}><option value="">Todas as formas</option>{paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {(filters.weekday !== '' || filters.hour !== '') && <button className="clear" onClick={() => update({ weekday: '', hour: '' })}>Remover filtro de horário</button>}<button onClick={() => void load(false)} disabled={loading}>{loading ? 'Carregando...' : 'Consultar'}</button><button className="clear" onClick={resetFilters}>Limpar filtros</button>
    </section>
    <div className="meta-line"><span>{data?.cache?.hit ? 'Resultado em cache' : 'Consulta atualizada'} · Última atualização: {updatedLabel}</span><span>Cache de até 5 minutos · {data?.source === 'demo' ? 'Dados fictícios' : 'Dados do iServer'}</span></div>
    {error && <div className="error">{error}<br/>Confira se o backend está ligado e, no modo real, se o agente está conectado à VPN.</div>}
    <section className="kpis"><Kpi label="Faturamento" value={money(k?.revenue || 0)} detail="Cupons válidos"/><Kpi label="Quantidade de cupons" value={number(Number(k?.coupons || 0))} detail="Vendas registradas"/><Kpi label="Ticket médio" value={money(k?.average_ticket || 0)} detail="Faturamento ÷ cupons"/><Kpi label="Custo dos produtos" value={money(k?.cost || 0)} detail="Itens não cancelados"/><Kpi label="Lucro bruto estimado" value={money(k?.gross_profit || 0)} detail="Venda dos itens − custo"/><Kpi label="Margem bruta" value={`${marginValue.toFixed(2).replace('.', ',')}%`} detail="Lucro bruto ÷ faturamento"/><Kpi label="Custo percentual" value={`${costPercent.toFixed(2).replace('.', ',')}%`} detail="Custo ÷ faturamento"/><Kpi label="Itens cancelados" value={money(cancelled?.amount || 0)} detail={`${number(cancelled?.coupons || 0)} cupons · ${number(cancelled?.item_records || 0)} itens`}/></section>
    <section className="gauges">
      <Gauge title="Markdown" value={markdownValue} max={85} yellowStart={21.25} greenStart={42.5} subtitle="Desconto médio sobre o preço original"/>
      <Gauge title="Markup" value={markupValue} max={100} yellowStart={33} greenStart={66} subtitle="Margem de acréscimo sobre o custo"/>
      <article className="panel store-panel"><div className="panel-head"><div><h2>Vendas totais por loja</h2><p>Ticket médio, faturamento e quantidade de vendas.</p></div><span className="tag">LOJAS</span></div><div className="table-wrap"><table><thead><tr><th>Loja</th><th>Ticket médio</th><th>Venda total</th><th>Quantidade de vendas</th></tr></thead><tbody>{storeSales.map(s => <tr key={s.id} className="interactive-row" onClick={() => update({ store: String(s.id) })}><td>{s.name}</td><td>{money(s.average_ticket)}</td><td>{money(s.revenue)}</td><td>{number(s.coupons)}</td></tr>)}{!storeSales.length && <tr><td colSpan={4} className="empty">Resumo por loja indisponível nesta consulta.</td></tr>}</tbody></table></div></article>
    </section>
    <section className="charts monthly-row"><article className="panel wide"><div className="panel-head"><div><h2>Vendas nos últimos meses ({filters.to.slice(0,4)})</h2><p>Evolução mensal do faturamento no ano selecionado.</p></div><span className="tag">ANO</span></div><ReactECharts option={monthlyOption} notMerge={true} style={{ height: 285 }}/></article><article className="panel"><div className="panel-head"><div><h2>Vendas por grupos de produtos</h2><p>Clique em uma fatia para filtrar o grupo.</p></div></div><ReactECharts option={groupOption} onEvents={{ click: onGroupClick }} style={{ height: 285 }}/></article></section>
    <section className="panel products"><div className="panel-head"><div><h2>Movimento por dia e horário</h2><p>Selecione uma célula para filtrar todo o dashboard. O maior movimento considera a quantidade de cupons.</p></div><span className="tag">HORÁRIOS</span></div><ReactECharts option={heatmapOption} onEvents={{ click: onHeatmapClick }} style={{ height: 300 }}/>{filters.weekday !== '' && filters.hour !== '' && <button className="clear" onClick={() => update({ weekday: '', hour: '' })}>Limpar seleção: {weekdayNames[Number(filters.weekday)]} às {String(filters.hour).padStart(2,'0')}h</button>}</section>
    <section className="charts"><article className="panel wide"><div className="panel-head"><div><h2>Faturamento por dia</h2><p>Clique em um dia para filtrar o painel inteiro.</p></div><span className="tag">VENDAS</span></div><ReactECharts option={dailyOption} onEvents={{ click: onDailyClick }} style={{ height: 300 }}/></article><article className="panel"><div className="panel-head"><div><h2>Formas de pagamento</h2><p>Clique em uma fatia para filtrar.</p></div></div><ReactECharts option={paymentOption} onEvents={{ click: onPaymentClick }} style={{ height: 300 }}/></article></section>
    <section className="panel products"><div className="panel-head"><div><h2>Detalhamento dos pagamentos</h2><p>Uma linha por forma. Clique para abrir as bandeiras; o troco fica separado e não é subtraído do faturamento.</p></div></div><div className="table-wrap"><table><thead><tr><th>Forma de pagamento</th><th>Valor registrado</th><th>Troco</th></tr></thead><tbody>{[...new Set((data?.payments || []).map(p => p.method))].map(method => { const rows=(data?.payments || []).filter(p=>p.method===method); const total=rows.reduce((a,p)=>a+Number(p.amount),0); const change=rows.reduce((a,p)=>a+Number(p.change_amount||0),0); const open=expandedPayment===method; return <Fragment key={method}><tr className="interactive-row" onClick={()=>setExpandedPayment(open?null:method)}><td>{open?'▾':'▸'} {method}</td><td>{money(total)}</td><td>{money(change)}</td></tr>{open && rows.filter(p=>p.brand).map((p,i)=><tr key={`${method}-${p.brand}-${i}`}><td style={{paddingLeft:32,color:'#9aaca0'}}>↳ {p.brand}</td><td>{money(p.amount)}</td><td>{money(p.change_amount||0)}</td></tr>)}</Fragment>; })}{!(data?.payments || []).length && <tr><td colSpan={3} className="empty">Nenhum pagamento encontrado.</td></tr>}</tbody></table></div></section>
    <section className="panel products"><div className="panel-head"><div><h2>Produtos em destaque</h2><p>Clique em uma barra ou linha para filtrar o produto.</p></div></div><ReactECharts option={productOption} onEvents={{ click: onProductClick }} style={{ height: 280 }}/><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Faturamento</th><th>Custo</th><th>Lucro</th><th>Markup</th><th>Markdown</th></tr></thead><tbody>{data?.products.map((p, i) => { const profit = Number(p.revenue) - Number(p.cost); const markup = Number(p.cost) ? profit / Number(p.cost) * 100 : 0; return <tr key={`${p.product}-${i}`} className="interactive-row" onClick={() => update({ product: filters.product === p.product ? '' : p.product })}><td>{p.product}</td><td>{number(p.quantity)}</td><td>{money(p.revenue)}</td><td>{money(p.cost)}</td><td>{money(profit)}</td><td>{markup.toFixed(2).replace('.', ',')}%</td><td>—</td></tr>; })}{!data?.products.length && <tr><td colSpan={7} className="empty">Nenhum produto encontrado para os filtros selecionados.</td></tr>}</tbody></table></div></section>
    <section className="panel sale-panel"><div className="panel-head"><div><h2>Consultar venda individual</h2><p>Pesquise diretamente no iServer, sem gravar a venda no BI.</p></div><span className="tag">CUPOM</span></div><div className="sale-search"><label>Loja<select value={saleStore} onChange={e => setSaleStore(e.target.value)}><option value="1">Loja 1</option><option value="2">Loja 2</option><option value="3">Loja 3</option></select></label><label>Data<input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}/></label><label className="document-field">Número do cupom<input value={saleDocument} onChange={e => setSaleDocument(e.target.value)} placeholder="Ex.: 001-052902/101126" onKeyDown={e => { if (e.key === 'Enter') void searchSale(); }}/></label><button onClick={() => void searchSale()} disabled={saleLoading}>{saleLoading ? 'Consultando...' : 'Consultar venda'}</button></div>
      {saleError && <div className="error sale-error">{saleError}</div>}
      {saleResult?.sale && <div className="sale-result"><div className="sale-summary"><div><small>Loja</small><strong>{saleResult.sale.storeName}</strong></div><div><small>Cupom</small><strong>{saleResult.sale.documentId}</strong></div><div><small>Data</small><strong>{String(saleResult.sale.issuedAt).slice(0, 19).replace('T', ' ')}</strong></div><div><small>Total</small><strong>{money(saleResult.sale.total)}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Venda</th><th>Custo</th></tr></thead><tbody>{saleResult.sale.items.map((x, i) => <tr key={i}><td>{x.description}</td><td>{number(Number(x.quantity))}</td><td>{money(x.total)}</td><td>{money(x.cost)}</td></tr>)}</tbody></table></div><p className="payment-line">Pagamentos: {saleResult.sale.payments.map((p: any) => `${p.method}${p.brand ? ` (${p.brand})` : ''}: ${money(p.amount)}`).join(' · ')}</p></div>}
    </section>
    <footer>Mercado Central BI <span>· Consultas sem armazenamento permanente · Cache temporário de 5 minutos</span></footer>
  </main>;
}
function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="kpi"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Gauge({ title, value, max, yellowStart, greenStart, subtitle }: { title: string; value: number; max: number; yellowStart: number; greenStart: number; subtitle: string }) {
  const safe = pct(value, max);
  const angle = -90 + (safe / max) * 180;
  const zone = safe < yellowStart ? 'Vermelho' : safe < greenStart ? 'Amarelo' : 'Verde';
  const option = {
    animationDuration: 700,
    tooltip: { formatter: `${title}: ${safe.toFixed(2).replace('.', ',')}%` },
    series: [{ type: 'gauge', min: 0, max, startAngle: 180, endAngle: 0, center: ['50%', '76%'], radius: '100%', pointer: { show: true, length: '62%', width: 5, itemStyle: { color: '#dce7df' } }, anchor: { show: true, showAbove: true, size: 9, itemStyle: { color: '#a8dcb6', borderColor: '#17231c', borderWidth: 2 } }, progress: { show: false }, axisLine: { lineStyle: { width: 18, color: [[yellowStart / max, '#e35d5b'], [greenStart / max, '#e6b94f'], [1, '#65b77e']] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { distance: 24, color: '#aab8ae', fontSize: 10, formatter: (v: number) => v === 0 || v === max ? `${v}%` : (v === yellowStart || v === greenStart ? `${v}%` : '') }, detail: { valueAnimation: true, offsetCenter: [0, '-7%'], color: '#edf4ef', fontSize: 25, fontWeight: 700, formatter: (v: number) => `${v.toFixed(2).replace('.', ',')}%` }, data: [{ value: safe }] }]
  };
  return <article className="panel gauge-panel"><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="tag">INDICADOR</span></div><ReactECharts option={option} style={{ height: 190, marginTop: 4 }}/><div className={`gauge-status ${zone.toLowerCase()}`}>Faixa atual: {zone} · {safe.toFixed(2).replace('.', ',')}%</div></article>;
}
