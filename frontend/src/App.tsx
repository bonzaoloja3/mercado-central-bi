import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';

type Filters = {
  from: string;
  to: string;
  store: string;
  group: string;
  product: string;
  payment: string;
  weekday: string;
  hour: string;
};

type StoreSale = {
  id: number;
  name: string;
  revenue: number;
  coupons: number;
  average_ticket: number;
};

type GroupSale = {
  code: string;
  name: string;
  revenue: number;
  quantity?: number;
};

type MonthSale = {
  month: string;
  revenue: number;
  average_daily?: number;
  markup?: number;
};

type ProductSale = {
  product: string;
  quantity: number;
  revenue: number;
  cost: number;
  groupCode?: number;
  group?: string;
  markdown?: number;
};

type ProductSortKey =
  | 'product'
  | 'quantity'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'markup'
  | 'markdown';

type Dashboard = {
  stores: { id: number; name: string }[];
  storeSales?: StoreSale[];
  groupSales?: GroupSale[];
  monthly?: MonthSale[];
  kpis: {
    revenue: number | string;
    coupons: number | string;
    average_ticket: number | string;
    cost: number | string;
    gross_profit: number;
    gross_margin?: number;
    cost_percentage?: number;
    markup?: number;
    markdown?: number;
  };
  daily: { day: string; revenue: number }[];
  payments: {
    method: string;
    brand: string;
    amount: number;
    change_amount?: number;
  }[];
  products: ProductSale[];
  groups?: { code: string; name: string }[];
  cancellations?: {
    coupons: number;
    item_records: number;
    quantity: number;
    amount: number;
    stores?: any[];
  };
  cancelled?: {
    coupons: number;
    records?: number;
    quantity: number;
    value: number;
    byStore?: any[];
  };
  heatmap?: {
    weekday: number;
    hour: number;
    coupons: number;
    revenue: number;
  }[];
  generatedAt: string;
  source: 'demo' | 'live';
  cache?: {
    hit: boolean;
    updatedAt: string;
    expiresAt: string;
  };
};

const API = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

const money = (v: number | string) =>
  Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

const number = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const percent = (v: number) => `${Number(v || 0).toFixed(2).replace('.', ',')}%`;

const dateLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// input[type=date] trabalha internamente com AAAA-MM-DD.
// Normaliza também navegadores móveis que eventualmente retornem DD/MM/AAAA.
const normalizeDateInput = (value: string) => {
  const v = String(value || '').trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return v;
};

const today = dateLocal(new Date());
const week = dateLocal(new Date(Date.now() - 6 * 86400000));

const initialFilters: Filters = {
  from: week,
  to: today,
  store: '0',
  group: '',
  product: '',
  payment: '',
  weekday: '',
  hour: ''
};

function interpolateGreen(start: string, end: string, steps: number) {
  const hexToRgb = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  });

  const rgbToHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b]
      .map(v => Math.round(v).toString(16).padStart(2, '0'))
      .join('');

  const a = hexToRgb(start);
  const b = hexToRgb(end);

  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 0 : i / (steps - 1);
    return rgbToHex(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t
    );
  });
}

function createHeatmapPieces(step: number, limit: number) {
  const colors = interpolateGreen('#d5f0dc', '#174c2e', limit / step);

  return [
    { value: 0, color: '#e8f6eb' },
    ...colors.map((color, i) => ({
      min: i * step + 1,
      max: (i + 1) * step,
      color
    })),
    { min: limit + 1, color: '#103d25' }
  ];
}

const heatmapAllStoresPieces = createHeatmapPieces(10, 200);
const heatmapSingleStorePieces = createHeatmapPieces(5, 100);

const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [productSort, setProductSort] = useState<{ key: ProductSortKey; direction: 'asc' | 'desc' }>({
    key: 'revenue',
    direction: 'desc'
  });
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches);
  const [annualChartType, setAnnualChartType] = useState<'line' | 'bar'>('line');

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  const requestId = useRef(0);

  const load = useCallback(async (manual = false, override?: Filters) => {
    const current = override || filters;
    const id = ++requestId.current;
    setLoading(true);
    setError('');

    try {
      const q = new URLSearchParams({
        from: current.from,
        to: current.to,
        store: current.store
      });

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

      setData(result);
      setLastUpdated(result.cache?.updatedAt || result.generatedAt || new Date().toISOString());
    } catch (e: any) {
      if (id === requestId.current) setError(e.message || 'Falha de conexão com o backend.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const update = (patch: Partial<Filters>) => setFilters(old => ({ ...old, ...patch }));
  const resetFilters = () => setFilters(initialFilters);

  const dailyOption = useMemo(() => ({
    animationDuration: 500,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#203229',
      borderColor: '#45634f',
      textStyle: { color: '#edf4ef' },
      valueFormatter: (v: any) => money(v)
    },
    grid: { left: 12, right: 18, top: 24, bottom: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: data?.daily.map(x => x.day) || [],
      axisLine: { lineStyle: { color: '#34443b' } },
      axisLabel: { color: '#aab8ae' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: '#26352d' } }
    },
    series: [{
      data: data?.daily.map(x => x.revenue) || [],
      type: 'line',
      smooth: true,
      symbolSize: 8,
      lineStyle: { width: 3, color: '#79c99a' },
      itemStyle: { color: '#79c99a' },
      areaStyle: { color: 'rgba(121,201,154,.12)' },
      emphasis: { focus: 'series', scale: 1.5 }
    }]
  }), [data]);

  const paymentOptions = useMemo(() => {
    const opts = new Map<string, string>();
    for (const p of data?.payments || []) {
      opts.set(p.method, p.method);
      if (p.brand) opts.set(p.brand, `${p.brand} · ${p.method}`);
    }
    return [...opts];
  }, [data]);

  const paymentTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of data?.payments || []) {
      totals.set(p.method, (totals.get(p.method) || 0) + Number(p.amount));
    }
    return [...totals].map(([name, value]) => ({ name, value }));
  }, [data]);

  const paymentOption = useMemo(() => {
    const total = paymentTotals.reduce((sum, p) => sum + Number(p.value), 0);
    const percentage = (value: number) =>
      total > 0 ? `${((value / total) * 100).toFixed(1).replace('.', ',')}%` : '0%';

    return {
      animationDuration: 500,
      tooltip: {
        trigger: 'item',
        backgroundColor: '#203229',
        borderColor: '#45634f',
        textStyle: { color: '#edf4ef' },
        formatter: (p: any) =>
          `${p.name}<br/>${money(p.value)} (${p.percent.toFixed(1).replace('.', ',')}%)`
      },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 5,
        top: 'middle',
        bottom: 15,
        width: '43%',
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 13,
        pageIconColor: '#79c99a',
        pageTextStyle: { color: '#aab8ae' },
        textStyle: { color: '#aab8ae', fontSize: 10 },
        formatter: (name: string) => {
          const item = paymentTotals.find(p => p.name === name);
          return item ? `${name}  ${percentage(item.value)}` : name;
        }
      },
      series: [{
        type: 'pie',
        radius: ['43%', '66%'],
        center: ['28%', '50%'],
        itemStyle: { borderColor: '#17231c', borderWidth: 3 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 7,
          label: { show: false },
          itemStyle: { shadowBlur: 15, shadowColor: 'rgba(0,0,0,.3)' }
        },
        data: paymentTotals
      }],
      media: [{
        query: { maxWidth: 600 },
        option: {
          legend: {
            orient: 'vertical',
            left: '52%',
            right: 5,
            top: 'middle',
            bottom: 'auto',
            width: '45%',
            itemGap: 12,
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { fontSize: 9, color: '#aab8ae' }
          },
          series: [{ center: ['26%', '50%'], radius: ['30%', '45%'] }]
        }
      }]
    };
  }, [paymentTotals]);

  const groupOption = useMemo(() => {
    const groupData = (data?.groupSales || []).map(g => ({ name: g.name, value: Number(g.revenue) }));
    const total = groupData.reduce((sum, g) => sum + g.value, 0);
    const percentage = (value: number) =>
      total > 0 ? `${((value / total) * 100).toFixed(1).replace('.', ',')}%` : '0%';

    return {
      animationDuration: 600,
      tooltip: {
        trigger: 'item',
        backgroundColor: '#203229',
        borderColor: '#45634f',
        textStyle: { color: '#edf4ef' },
        formatter: (p: any) =>
          `${p.name}<br/>${money(p.value)} (${p.percent.toFixed(1).replace('.', ',')}%)`
      },
      legend: {
        orient: 'vertical',
        left: 8,
        top: 'middle',
        itemWidth: 13,
        itemHeight: 13,
        itemGap: 14,
        textStyle: { color: '#aab8ae', fontSize: 11 },
        formatter: (name: string) => {
          const item = groupData.find(g => g.name === name);
          return item ? `${name}  ${percentage(item.value)}` : name;
        }
      },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['69%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#17231c', borderWidth: 3 },
        label: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 8,
          label: {
            show: true,
            color: '#edf4ef',
            fontWeight: 700,
            formatter: (p: any) => `${p.percent.toFixed(1).replace('.', ',')}%`
          },
          itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,.35)' }
        },
        data: groupData
      }],
      media: [{
        query: { maxWidth: 600 },
        option: {
          legend: {
            orient: 'vertical',
            left: '52%',
            right: 5,
            top: 'middle',
            bottom: 'auto',
            width: '45%',
            itemGap: 12,
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { fontSize: 9, color: '#aab8ae' }
          },
          series: [{ center: ['26%', '50%'], radius: ['30%', '45%'] }]
        }
      }]
    };
  }, [data]);

  const monthlyOption = useMemo(() => ({
    animationDuration: 600,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#203229',
      borderColor: '#45634f',
      textStyle: { color: '#edf4ef' },
      valueFormatter: (v: any) => money(v)
    },
    legend: { top: 0, textStyle: { color: '#aab8ae' } },
    grid: { left: 12, right: 18, top: 38, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: (data?.monthly || []).map(m => m.month),
      axisLabel: { color: '#aab8ae' },
      axisLine: { lineStyle: { color: '#34443b' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#aab8ae', formatter: (v: number) => `R$${v}` },
      splitLine: { lineStyle: { color: '#26352d' } }
    },
    series: [{
      name: 'Venda total',
      type: 'bar',
      barMaxWidth: 30,
      data: (data?.monthly || []).map(m => m.revenue),
      itemStyle: { color: '#79c99a', borderRadius: [5, 5, 0, 0] },
      emphasis: { itemStyle: { color: '#a8dcb6' } }
    }]
  }), [data]);

  // Garante Jan-Dez do ano selecionado; meses ausentes são exibidos como zero, sem estimativas.
  const annualMonths = useMemo(() => {
    const year = filters.to.slice(0, 4) || String(new Date().getFullYear());
    const monthlyMap = new Map((data?.monthly || []).map(m => [m.month, m]));
    return monthNames.map((label, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const month = monthlyMap.get(key);
      return {
        key,
        label,
        revenue: Number(month?.revenue || 0),
        averageDaily: Number(month?.average_daily || 0),
        markup: month?.markup == null ? null : Number(month.markup)
      };
    });
  }, [data, filters.to]);

  const annualChartOption = useMemo(() => {
    const colors = ['#529ee0', '#a982c7', '#ef8585'];
    const useLines = isMobile || annualChartType === 'line';
    const series = [
      {
        name: 'Valor Total',
        type: useLines ? 'line' : 'bar',
        yAxisIndex: 0,
        smooth: useLines,
        showSymbol: useLines,
        symbol: 'circle',
        symbolSize: useLines ? 6 : 0,
        barMaxWidth: 26,
        data: annualMonths.map(m => m.revenue),
        itemStyle: { color: colors[0], borderRadius: useLines ? 0 : [4, 4, 0, 0] },
        lineStyle: { color: colors[0], width: 2.5 },
        emphasis: { focus: 'series', scale: 1.3 }
      },
      {
        name: 'Valor Médio Diário',
        type: useLines ? 'line' : 'bar',
        yAxisIndex: 1,
        smooth: useLines,
        showSymbol: useLines,
        symbol: 'circle',
        symbolSize: useLines ? 6 : 0,
        barMaxWidth: 26,
        data: annualMonths.map(m => m.averageDaily),
        itemStyle: { color: colors[1], borderRadius: useLines ? 0 : [4, 4, 0, 0] },
        lineStyle: { color: colors[1], width: 2.5 },
        emphasis: { focus: 'series', scale: 1.3 }
      },
      {
        name: 'Markup',
        type: 'line',
        yAxisIndex: 2,
        smooth: useLines,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 7,
        connectNulls: false,
        data: annualMonths.map(m => m.markup),
        lineStyle: { color: colors[2], width: 2.5 },
        itemStyle: { color: colors[2], borderColor: '#fff', borderWidth: 1 },
        emphasis: { focus: 'series', scale: 1.4 }
      }
    ];

    return {
      animationDuration: 650,
      color: colors,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: useLines ? 'line' : 'shadow' },
        backgroundColor: '#203229',
        borderColor: '#45634f',
        textStyle: { color: '#edf4ef' },
        formatter: (params: any[]) => {
          if (!params?.length) return '';
          const month = annualMonths[params[0].dataIndex];
          if (!month) return '';
          return [
            `<strong>${month.label}</strong>`,
            `<span style="color:${colors[0]}">●</span> Valor Total: <strong>${money(month.revenue)}</strong>`,
            `<span style="color:${colors[1]}">●</span> Valor Médio Diário: <strong>${money(month.averageDaily)}</strong>`,
            `<span style="color:${colors[2]}">●</span> Markup: <strong>${month.markup == null ? 'Sem dado' : percent(month.markup)}</strong>`
          ].join('<br/>');
        }
      },
      legend: {
        top: 5,
        left: 'center',
        itemGap: isMobile ? 10 : 22,
        textStyle: { color: '#aab8ae', fontSize: isMobile ? 10 : 12 },
        data: ['Valor Total', 'Valor Médio Diário', 'Markup']
      },
      // Espaço dedicado para cada escala: faturamento à esquerda;
      // média diária e markup à direita, sem compartilhar a mesma posição.
      grid: isMobile
        ? { left: 8, right: 8, top: 58, bottom: 48, containLabel: true }
        : { left: 88, right: 172, top: 62, bottom: 44, containLabel: false },
      xAxis: {
        type: 'category',
        boundaryGap: !useLines,
        data: annualMonths.map(m => m.label),
        axisLine: { lineStyle: { color: '#34443b' } },
        axisTick: { alignWithLabel: true },
        axisLabel: { color: '#aab8ae', fontSize: isMobile ? 9 : 11, interval: 0, rotate: isMobile ? 30 : 0 }
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: { show: true, lineStyle: { color: colors[0] } },
          axisLabel: { show: !isMobile, color: colors[0], margin: 12, formatter: (v: number) => `R$${number(v)}` },
          splitLine: { show: true, lineStyle: { color: '#26352d' } },
          axisTick: { show: false }
        },
        {
          type: 'value',
          position: 'right',
          offset: 0,
          axisLine: { show: !isMobile, lineStyle: { color: colors[1] } },
          axisLabel: { show: !isMobile, color: colors[1], margin: 10, formatter: (v: number) => `R$${number(v)}` },
          splitLine: { show: false },
          axisTick: { show: false }
        },
        {
          type: 'value',
          position: 'right',
          offset: 82,
          axisLine: { show: !isMobile, lineStyle: { color: colors[2] } },
          axisLabel: { show: !isMobile, color: colors[2], margin: 10, formatter: (v: number) => `${number(v)}%` },
          splitLine: { show: false },
          axisTick: { show: false }
        }
      ],
      series
    };
  }, [annualMonths, annualChartType, isMobile]);

  const onDailyClick = (p: any) => {
    if (p?.name) update({ from: p.name, to: p.name });
  };

  const onPaymentClick = (p: any) => {
    if (p?.name) update({ payment: filters.payment === p.name ? '' : p.name });
  };

  const onHeatmapClick = (p: any) => {
    const v = p?.data;
    if (Array.isArray(v) && v.length >= 2) {
      update({ hour: String(v[0]).replace(/^0/, ''), weekday: String(v[1]) });
    }
  };

  const weekdayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const heatmapHours = Array.from({ length: 14 }, (_, i) => String(i + 7).padStart(2, '0'));
  const heatmapVisibleData = (data?.heatmap || []).filter(item => {
    const hour = Number(item.hour);
    return hour >= 7 && hour <= 20;
  });

  const heatmapOption = useMemo(() => ({
    animationDuration: 500,
    tooltip: {
      position: 'top',
      backgroundColor: '#203229',
      borderColor: '#45634f',
      textStyle: { color: '#edf4ef' },
      formatter: (p: any) =>
        `${weekdayNames[p.data[1]]} · ${p.data[0]}h<br/>${number(p.data[2])} cupons<br/>${money(p.data[3])}`
    },
    grid: { left: 42, right: 18, top: 18, bottom: 35 },
    xAxis: {
      type: 'category',
      data: heatmapHours,
      splitArea: {
        show: true,
        areaStyle: { color: ['rgba(255,255,255,.015)', 'rgba(255,255,255,.025)'] }
      },
      axisLabel: { color: '#aab8ae', interval: 0 },
      axisLine: { lineStyle: { color: '#34443b' } }
    },
    yAxis: {
      type: 'category',
      data: weekdayNames,
      axisLabel: { color: '#aab8ae' },
      axisLine: { lineStyle: { color: '#34443b' } }
    },
    visualMap: {
      type: 'piecewise',
      dimension: 2,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      show: false,
      pieces: filters.store === '0' ? heatmapAllStoresPieces : heatmapSingleStorePieces
    },
    series: [{
      type: 'heatmap',
      data: heatmapVisibleData.map(item => [
        String(item.hour).padStart(2, '0'),
        item.weekday,
        Number(item.coupons),
        Number(item.revenue)
      ]),
      label: { show: false },
      itemStyle: { borderColor: '#17231c', borderWidth: 2, borderRadius: 3 },
      emphasis: {
        itemStyle: {
          borderColor: '#edf4ef',
          borderWidth: 2,
          shadowBlur: 8,
          shadowColor: 'rgba(0,0,0,.25)'
        }
      }
    }]
  }), [heatmapVisibleData, filters.store]);

  const onGroupClick = (p: any) => {
    const found = (data?.groupSales || []).find(g => g.name === p?.name);
    if (found) update({ group: filters.group === found.code ? '' : found.code });
  };

  const k = data?.kpis;
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : '—';

  const markupValue = Number(
    (k as any)?.markup ??
    ((Number(k?.gross_profit || 0) / Math.max(1, Number(k?.cost || 0))) * 100)
  );
  const markdownValue = Number((k as any)?.markdown ?? 0);
  const marginValue = Number(
    (k as any)?.gross_margin ??
    (Number(k?.revenue || 0)
      ? Number(k?.gross_profit || 0) / Number(k?.revenue || 1) * 100
      : 0)
  );
  const costPercent = Number(
    (k as any)?.cost_percentage ??
    (Number(k?.revenue || 0)
      ? Number(k?.cost || 0) / Number(k?.revenue || 1) * 100
      : 0)
  );

  const cancelled = data?.cancellations || (
    data?.cancelled
      ? {
          coupons: data.cancelled.coupons,
          item_records: data.cancelled.records || 0,
          quantity: data.cancelled.quantity,
          amount: data.cancelled.value
        }
      : null
  );

  const storeSales = data?.storeSales || [];

  const sortedProducts = useMemo(() => {
    const products = [...(data?.products || [])];

    const valueFor = (p: ProductSale): string | number | null => {
      const profit = Number(p.revenue || 0) - Number(p.cost || 0);
      const markup = Number(p.cost || 0) > 0 ? profit / Number(p.cost) * 100 : 0;
      switch (productSort.key) {
        case 'product': return p.product || '';
        case 'quantity': return Number(p.quantity || 0);
        case 'revenue': return Number(p.revenue || 0);
        case 'cost': return Number(p.cost || 0);
        case 'profit': return profit;
        case 'markup': return markup;
        case 'markdown': return p.markdown == null ? null : Number(p.markdown);
      }
    };

    products.sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const result = typeof av === 'string'
        ? av.localeCompare(String(bv), 'pt-BR', { sensitivity: 'base' })
        : Number(av) - Number(bv);
      return productSort.direction === 'asc' ? result : -result;
    });

    return products;
  }, [data?.products, productSort]);

  const changeProductSort = (key: ProductSortKey) => {
    setProductSort(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const sortArrow = (key: ProductSortKey) =>
    productSort.key === key
      ? productSort.direction === 'asc' ? '↑' : '↓'
      : '↕';

  const productHeading = (label: string, key: ProductSortKey) => (
    <th aria-sort={productSort.key === key
      ? productSort.direction === 'asc' ? 'ascending' : 'descending'
      : 'none'}>
      <button type="button" className="sort-button" onClick={() => changeProductSort(key)}>
        {label}<span>{sortArrow(key)}</span>
      </button>
    </th>
  );

  return (
    <main className="shell">
      <header>
        <div className="brand">
          <div className="mark">MC</div>
          <div>
            <strong>MERCADO CENTRAL</strong>
            <span>INTELLIGENCE · BUSINESS</span>
          </div>
        </div>
        <div className="status">
          <i />
          {data?.source === 'demo' ? 'Modo demonstração' : 'Consulta às lojas'}
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h1>Inteligência de vendas</h1>
          <p className="sub">Acompanhe o desempenho das três lojas em um só lugar.</p>
        </div>
        <button className="refresh" onClick={() => void load(true)} disabled={loading}>
          ↻ {loading ? 'Consultando...' : 'Atualizar agora'}
        </button>
      </section>

      <section className="filters">
        <label>
          Data inicial
          <input type="date" lang="pt-BR" value={normalizeDateInput(filters.from)} max={normalizeDateInput(filters.to)}
            onChange={e => update({ from: normalizeDateInput(e.currentTarget.value) })} />
        </label>
        <label>
          Data final
          <input type="date" lang="pt-BR" value={normalizeDateInput(filters.to)} min={normalizeDateInput(filters.from)}
            onChange={e => update({ to: normalizeDateInput(e.currentTarget.value) })} />
        </label>
        <label>
          Unidade
          <select value={filters.store} onChange={e => update({ store: e.target.value })}>
            <option value="0">Todas as lojas</option>
            <option value="1">Loja 1</option>
            <option value="2">Loja 2</option>
            <option value="3">Loja 3</option>
          </select>
        </label>
        <label>
          Grupo
          <select value={filters.group} onChange={e => update({ group: e.target.value })}>
            <option value="">Todos os grupos</option>
            {(data?.groups || []).map(g => (
              <option key={g.code} value={g.code}>{g.name}</option>
            ))}
          </select>
        </label>
        <label>
          Produto
          <input value={filters.product}
            onChange={e => update({ product: e.target.value })}
            placeholder="Nome, código ou barras" />
        </label>
        <label>
          Pagamento
          <select value={filters.payment} onChange={e => update({ payment: e.target.value })}>
            <option value="">Todas as formas</option>
            {paymentOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        {(filters.weekday !== '' || filters.hour !== '') && (
          <button className="clear" onClick={() => update({ weekday: '', hour: '' })}>
            Remover filtro de horário
          </button>
        )}

        <button onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Carregando...' : 'Consultar'}
        </button>
        <button className="clear" onClick={resetFilters}>Limpar filtros</button>
      </section>

      <div className="meta-line">
        <span>
          {data?.cache?.hit ? 'Resultado em cache' : 'Consulta atualizada'}
          {' · '}Última atualização: {updatedLabel}
        </span>
        <span>
          Cache de até 5 minutos · {data?.source === 'demo' ? 'Dados fictícios' : 'Dados do iServer'}
        </span>
      </div>

      {error && (
        <div className="error">
          {error}<br />
          Confira se o backend está ligado e, no modo real, se o agente está conectado à VPN.
        </div>
      )}

      <section className="kpis">
        <Kpi label="Faturamento" value={money(k?.revenue || 0)} detail="Cupons válidos" />
        <Kpi label="Quantidade de cupons" value={number(Number(k?.coupons || 0))} detail="Vendas registradas" />
        <Kpi label="Ticket médio" value={money(k?.average_ticket || 0)} detail="Faturamento ÷ cupons" />
        <Kpi label="Custo dos produtos" value={money(k?.cost || 0)} detail="Itens não cancelados" />
        <Kpi label="Lucro bruto estimado" value={money(k?.gross_profit || 0)} detail="Venda dos itens − custo" />
        <Kpi label="Margem bruta" value={`${marginValue.toFixed(2).replace('.', ',')}%`} detail="Lucro bruto ÷ faturamento" />
        <Kpi label="Custo percentual" value={`${costPercent.toFixed(2).replace('.', ',')}%`} detail="Custo ÷ faturamento" />
        <Kpi
          label="Itens cancelados"
          value={money(cancelled?.amount || 0)}
          detail={`${number(cancelled?.coupons || 0)} cupons · ${number(cancelled?.item_records || 0)} itens`}
        />
      </section>

      <section className="gauges">
        <Gauge title="Markdown" value={markdownValue} max={85}
          yellowStart={21.25} greenStart={42.5}
          subtitle="Desconto médio sobre o preço original" />
        <Gauge title="Markup" value={markupValue} max={100}
          yellowStart={33} greenStart={66}
          subtitle="Margem de acréscimo sobre o custo" />

        <article className="panel store-panel">
          <div className="panel-head">
            <div>
              <h2>Vendas totais por loja</h2>
              <p>Ticket médio, faturamento e quantidade de vendas.</p>
            </div>
            <span className="tag">LOJAS</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loja</th><th>Ticket médio</th><th>Venda total</th><th>Quantidade de vendas</th>
                </tr>
              </thead>
              <tbody>
                {storeSales.map(s => (
                  <tr key={s.id} className="interactive-row" onClick={() => update({ store: String(s.id) })}>
                    <td>{s.name}</td><td>{money(s.average_ticket)}</td>
                    <td>{money(s.revenue)}</td><td>{number(s.coupons)}</td>
                  </tr>
                ))}
                {!storeSales.length && (
                  <tr><td colSpan={4} className="empty">Resumo por loja indisponível nesta consulta.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="charts monthly-row">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Vendas nos últimos meses ({filters.to.slice(0, 4)})</h2>
              <p>Evolução mensal do faturamento no ano selecionado.</p>
            </div>
            <span className="tag">ANO</span>
          </div>
          <ReactECharts option={monthlyOption} notMerge={true} style={{ height: 285 }} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Vendas por grupos de produtos</h2>
              <p>Clique em uma fatia para filtrar o grupo.</p>
            </div>
          </div>
          <ReactECharts option={groupOption} notMerge={true}
            onEvents={{ click: onGroupClick }} style={{ height: 320 }} />
        </article>
      </section>

      <section className="panel products">
        <div className="panel-head">
          <div>
            <h2>Movimento por dia e horário</h2>
            <p>
              Horários das 07h às 20h. Selecione uma célula para filtrar todo o dashboard.
              Quanto mais escuro o verde, maior o movimento.
            </p>
          </div>
          <span className="tag">HORÁRIOS</span>
        </div>
        <ReactECharts option={heatmapOption} notMerge={true}
          onEvents={{ click: onHeatmapClick }} style={{ height: 300 }} />
        {filters.weekday !== '' && filters.hour !== '' && (
          <button className="clear" onClick={() => update({ weekday: '', hour: '' })}>
            Limpar seleção: {weekdayNames[Number(filters.weekday)]} às {String(filters.hour).padStart(2, '0')}h
          </button>
        )}
      </section>

      <section className="charts">
        <article className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Faturamento por dia</h2>
              <p>Clique em um dia para filtrar o painel inteiro.</p>
            </div>
            <span className="tag">VENDAS</span>
          </div>
          <ReactECharts option={dailyOption} onEvents={{ click: onDailyClick }}
            style={{ height: 300 }} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Formas de pagamento</h2>
              <p>Clique em uma fatia para filtrar.</p>
            </div>
          </div>
          <ReactECharts option={paymentOption} notMerge={true}
            onEvents={{ click: onPaymentClick }} style={{ height: 340 }} />
        </article>
      </section>

      <section className="panel products">
        <div className="panel-head">
          <div>
            <h2>Detalhamento dos pagamentos</h2>
            <p>
              Uma linha por forma. Clique para abrir as bandeiras;
              o troco fica separado e não é subtraído do faturamento.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Forma de pagamento</th><th>Valor registrado</th><th>Troco</th></tr>
            </thead>
            <tbody>
              {[...new Set((data?.payments || []).map(p => p.method))].map(method => {
                const rows = (data?.payments || []).filter(p => p.method === method);
                const total = rows.reduce((a, p) => a + Number(p.amount), 0);
                const change = rows.reduce((a, p) => a + Number(p.change_amount || 0), 0);
                const open = expandedPayment === method;

                return (
                  <Fragment key={method}>
                    <tr className="interactive-row" onClick={() => setExpandedPayment(open ? null : method)}>
                      <td>{open ? '▾' : '▸'} {method}</td>
                      <td>{money(total)}</td><td>{money(change)}</td>
                    </tr>
                    {open && rows.filter(p => p.brand).map((p, i) => (
                      <tr key={`${method}-${p.brand}-${i}`}>
                        <td style={{ paddingLeft: 32, color: '#9aaca0' }}>↳ {p.brand}</td>
                        <td>{money(p.amount)}</td><td>{money(p.change_amount || 0)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              {!(data?.payments || []).length && (
                <tr><td colSpan={3} className="empty">Nenhum pagamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel monthly-combined-panel">
        <div className="panel-head">
          <div>
            <h2>Desempenho mensal comparativo</h2>
            <p>Faturamento, média diária e markup ao longo dos 12 meses. Selecione os indicadores na legenda.</p>
          </div>
          <div className="annual-chart-actions">
            {!isMobile && (
              <div className="chart-type-switch" role="group" aria-label="Tipo de gráfico">
                <button type="button" className={annualChartType === 'line' ? 'active' : ''} onClick={() => setAnnualChartType('line')}>Linhas</button>
                <button type="button" className={annualChartType === 'bar' ? 'active' : ''} onClick={() => setAnnualChartType('bar')}>Colunas</button>
              </div>
            )}
            <span className="tag">ANÁLISE ANUAL</span>
          </div>
        </div>
        <ReactECharts option={annualChartOption} notMerge={true}
          lazyUpdate={true} style={{ height: isMobile ? 300 : 430, width: '100%' }} />
      </section>


      <section className="panel products product-list-panel">
        <div className="panel-head">
          <div>
            <h2>Produtos em destaque</h2>
            <p>Use as setinhas nos títulos para ordenar os produtos.</p>
          </div>
          <span className="tag">PRODUTOS</span>
        </div>
        <div className="table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                {productHeading('Produto', 'product')}
                {productHeading('Quantidade', 'quantity')}
                {productHeading('Faturamento', 'revenue')}
                {productHeading('Custo', 'cost')}
                {productHeading('Lucro', 'profit')}
                {productHeading('Markup', 'markup')}
                {productHeading('Markdown', 'markdown')}
              </tr>
            </thead>
            <tbody>
              {sortedProducts.map((p, i) => {
                const revenue = Number(p.revenue || 0);
                const cost = Number(p.cost || 0);
                const profit = revenue - cost;
                const markup = cost > 0 ? profit / cost * 100 : 0;
                return (
                  <tr key={`${p.product}-${i}`}
                    className={`interactive-row ${filters.product === p.product ? 'selected-product' : ''}`}
                    onClick={() => update({ product: filters.product === p.product ? '' : p.product })}>
                    <td>{p.product}</td>
                    <td>{number(p.quantity)}</td>
                    <td>{money(revenue)}</td>
                    <td>{money(cost)}</td>
                    <td>{money(profit)}</td>
                    <td>{percent(markup)}</td>
                    <td>{p.markdown == null ? '—' : percent(Number(p.markdown))}</td>
                  </tr>
                );
              })}
              {!sortedProducts.length && (
                <tr><td colSpan={7} className="empty">Nenhum produto encontrado para os filtros selecionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        Mercado Central BI
        <span> · Consultas sem armazenamento permanente · Cache temporário de 5 minutos</span>
      </footer>
    </main>
  );
}

function Kpi({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Gauge({
  title,
  value,
  max,
  yellowStart,
  greenStart,
  subtitle
}: {
  title: string;
  value: number;
  max: number;
  yellowStart: number;
  greenStart: number;
  subtitle: string;
}) {
  const displayedValue = Math.max(0, Number.isFinite(value) ? value : 0);
  const needleValue = Math.min(max, displayedValue);
  const zone = needleValue < yellowStart ? 'Vermelho' : needleValue < greenStart ? 'Amarelo' : 'Verde';
  const formattedValue = percent(displayedValue);

  const option = {
    animationDuration: 700,
    tooltip: { formatter: `${title}: ${formattedValue}` },
    series: [{
      type: 'gauge',
      min: 0,
      max,
      startAngle: 180,
      endAngle: 0,
      center: ['50%', '76%'],
      radius: '100%',
      pointer: {
        show: true,
        length: '62%',
        width: 5,
        itemStyle: { color: '#dce7df' }
      },
      anchor: {
        show: true,
        showAbove: true,
        size: 9,
        itemStyle: { color: '#a8dcb6', borderColor: '#17231c', borderWidth: 2 }
      },
      progress: { show: false },
      axisLine: {
        lineStyle: {
          width: 18,
          color: [
            [yellowStart / max, '#e35d5b'],
            [greenStart / max, '#e6b94f'],
            [1, '#65b77e']
          ]
        }
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: { show: false },
      data: [{ value: needleValue }]
    }]
  };

  return (
    <article className="panel gauge-panel">
      <div className="panel-head">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <span className="tag">INDICADOR</span>
      </div>
      <ReactECharts option={option} style={{ height: 175, marginTop: 4 }} />
      <div className="gauge-value">{formattedValue}</div>
      <div className={`gauge-status ${zone.toLowerCase()}`}>Faixa atual: {zone}</div>
    </article>
  );
}
