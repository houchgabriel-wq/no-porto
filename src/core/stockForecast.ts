// Previsão de estoque (pedido do Gabriel em 20/11/2026; as regras estão no SPEC.md, seção 6): cruza a
// curva ABC (estoque e vendas de cada título) com o que o No Porto sabe de cada um (o que está
// embarcado e o que está em produção nos fornecedores) e calcula a cobertura em meses, a sugestão de
// reimpressão e o aviso de embarque. Só quantidades: nada de valores em dinheiro.

import { toIsbn13 } from './isbn';
import type { ItemStatus } from './items';
import { daysBetween, formatDay } from './shipments';
import { formatMonth, sortPlan, type ShipPlan } from './shipPlan';
import type { CurveRow } from './stockCurve';

/** Os prazos e os números das contas (decididos pelo Gabriel em 20/11/2026). */
export const FORECAST = {
  /** Produção de um pedido, em dias, contados da data da PO. */
  productionDays: 60,
  /** Viagem, depois que o pedido fica pronto. */
  shippingDays: 60,
  /** Um mês, nas contas de data. */
  monthDays: 30,
  /** Folga: a reimpressão é sugerida quando o que se tem não cobre o prazo mais estes meses. */
  safetyMonths: 3,
  /** Meses de venda que a reimpressão garante depois de chegar. */
  reprintMonths: 9,
  /** A sugestão é arredondada para cima em múltiplos de... */
  reprintStep: 1000,
  /** ...com este mínimo (a tiragem mínima). */
  reprintMin: 2000,
  /** Sem sugestão quando a tiragem mínima cobriria mais que estes meses de venda ("venda baixa"). */
  lowSalesMonths: 24,
  /** O embarque leva pelo menos estes meses de venda. */
  shipMonths: 3,
  /** O painel conta os títulos que precisam embarcar nestes próximos dias. */
  soonDays: 30,
} as const;

/** Do pedido até a chegada: produção + viagem, em meses (120 dias = 4 meses). */
export const LEAD_MONTHS = (FORECAST.productionDays + FORECAST.shippingDays) / FORECAST.monthDays;

/** Um item do No Porto, com o que a previsão precisa (a chegada é a da invoice ou do BL). */
export interface ForecastItem {
  productId: string;
  isbn: string | null;
  description: string;
  status: ItemStatus;
  quantity: number;
  orderCode: string | null;
  /** Data da PO (AAAA-MM-DD). */
  orderedAt: string | null;
  shipPlan: ShipPlan;
  /** Chegada prevista do embarque. */
  eta: string | null;
  /** Chegada à editora. */
  arrivedAt: string | null;
}

/** Uma PO com o título em produção. */
export interface TitleOrder {
  code: string | null;
  orderedAt: string | null;
  quantity: number;
}

/** Sugestão de reimpressão por uma das médias. */
export type ReprintAdvice =
  /** Não precisa reimprimir agora (ou o título não vende). */
  | { kind: 'none' }
  | { kind: 'reprint'; quantity: number }
  /** Precisaria, mas vende tão pouco que a tiragem mínima cobriria `months` meses. */
  | { kind: 'lowSales'; months: number };

/** Aviso de embarque, para o título com quantidade em produção. */
export interface ShipAdvice {
  /** Embarcar até (AAAA-MM-DD): o dia em que físico + embarcado acabam, menos a viagem. */
  shipBy: string;
  /** Quanto embarcar: pelo menos 3 meses de venda, até o que está em produção. */
  quantity: number;
  /** A produção não chega a 3 meses de venda. */
  short: boolean;
  /** Pronto em: a PO mais antiga + 60 dias; null quando nenhuma PO tem data. */
  readyAt: string | null;
  /** Fica pronto depois do "embarcar até": pode faltar. */
  late: boolean;
  /** O "embarcar até" já passou. */
  overdue: boolean;
  /** O primeiro envio programado é num mês depois do "embarcar até". */
  planLate: boolean;
}

export interface ForecastRow extends CurveRow {
  /** O título aparece no No Porto (em produção, embarcado ou no histórico). */
  imported: boolean;
  /** O produto no No Porto, para abrir a ficha; null quando o título não é importado. */
  productId: string | null;
  /** Embarcado: o que está a caminho mais o que chegou depois da data da curva. */
  atSea: number;
  /** Parte do embarcado que já chegou, mas depois da data do estoque da curva. */
  arrivedAfter: number;
  /** A chegada prevista mais próxima do que está a caminho. */
  nextEta: string | null;
  production: number;
  /** As POs em produção, da mais antiga para a mais nova. */
  orders: TitleOrder[];
  /** O mês (AAAA-MM) do primeiro envio programado entre os itens em produção. */
  nextPlan: string | null;
  /** Venda mensal pela média de 3 e de 6 meses (com fração; a tela arredonda). */
  monthly3: number;
  monthly6: number;
  /** Cobertura em meses; null sem venda. */
  cover: { stock3: number | null; stock6: number | null; total3: number | null; total6: number | null };
  reprint3: ReprintAdvice;
  reprint6: ReprintAdvice;
  /** O dia em que físico + embarcado acabam, pela maior das duas médias; null sem venda. */
  runsOutAt: string | null;
  ship: ShipAdvice | null;
  /** O estoque físico acaba antes da chegada prevista do que está a caminho. */
  gapBeforeArrival: boolean;
  /** Só vendeu nos últimos 3 meses (vendas de 3 meses = de 6 meses): a média de 6 meses fica baixa. */
  recentOnly: boolean;
  /** Precisa de alguma coisa: reimpressão, embarque nos próximos 30 dias (ou atrasado) ou algum aviso. */
  needsAction: boolean;
}

/** Título com quantidade em produção ou a caminho no No Porto que não está na curva. */
export interface MissingTitle {
  productId: string;
  isbn: string | null;
  title: string;
  atSea: number;
  production: number;
  nextEta: string | null;
  orders: TitleOrder[];
}

export interface Forecast {
  rows: ForecastRow[];
  missing: MissingTitle[];
}

/** O que o No Porto tem de um título (o servidor junta os itens; a tela calcula a previsão). */
export interface TitleHolding {
  /** O ISBN-13 (o ISBN-10 vira ISBN-13), ou "produto:<id>" para o produto sem ISBN. */
  key: string;
  productId: string;
  isbn: string | null;
  title: string;
  /** A caminho, mais o que chegou depois da data do estoque da curva. */
  atSea: number;
  /** O que chegou depois da data do estoque da curva. */
  arrivedAfter: number;
  nextEta: string | null;
  production: number;
  orders: TitleOrder[];
  nextPlan: string | null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const RANK: Record<ItemStatus, number> = { producao: 3, embarcado: 2, entregue: 1 };

/**
 * O que o No Porto tem de cada título, pela chave do código de barras (ISBN-13), na ordem em que os
 * produtos aparecem. `items` na ordem em que entraram.
 */
export function titleHoldings(items: readonly ForecastItem[], stockDate: string): TitleHolding[] {
  const map = new Map<string, TitleHolding>();
  const rank = new Map<string, number>();
  for (const item of items) {
    const key = item.isbn ? toIsbn13(item.isbn) : `produto:${item.productId}`;
    let h = map.get(key);
    if (!h) {
      h = { key, productId: item.productId, isbn: item.isbn, title: item.description, atSea: 0, arrivedAfter: 0, nextEta: null, production: 0, orders: [], nextPlan: null };
      map.set(key, h);
    }
    // O nome atual: o do item em produção que entrou por último; sem produção, o do que está a caminho.
    if (RANK[item.status] >= (rank.get(key) ?? 0)) {
      rank.set(key, RANK[item.status]);
      h.title = item.description;
    }
    if (item.status === 'producao') {
      h.production += item.quantity;
      const order = h.orders.find((o) => o.code === item.orderCode);
      if (order) order.quantity += item.quantity;
      else h.orders.push({ code: item.orderCode, orderedAt: item.orderedAt, quantity: item.quantity });
      const first = sortPlan(item.shipPlan)[0];
      if (first && (h.nextPlan === null || first.month < h.nextPlan)) h.nextPlan = first.month;
    } else if (item.status === 'embarcado') {
      h.atSea += item.quantity;
      if (item.eta && (h.nextEta === null || item.eta < h.nextEta)) h.nextEta = item.eta;
    } else if (item.arrivedAt && item.arrivedAt > stockDate) {
      // Chegou depois da data do estoque da curva: o estoque da planilha ainda não tem.
      h.atSea += item.quantity;
      h.arrivedAfter += item.quantity;
    }
  }
  for (const h of map.values()) {
    h.orders.sort((a, b) => (a.orderedAt ?? '9999').localeCompare(b.orderedAt ?? '9999') || (a.code ?? '').localeCompare(b.code ?? ''));
  }
  return [...map.values()];
}

/**
 * Sugestão de reimpressão pela venda de `months` meses (3 ou 6): aparece quando físico + embarcado +
 * produção (`have`) não cobrem o prazo (4 meses) mais a folga (3); a quantidade cobre o prazo mais 9
 * meses, menos o que se tem, arredondada para cima em múltiplos de 1.000, com mínimo de 2.000. Contas
 * em números inteiros, para a média com fração não errar o arredondamento.
 */
export function reprintAdvice(sales: number, months: number, have: number): ReprintAdvice {
  if (sales <= 0) return { kind: 'none' };
  if (have * months >= sales * (LEAD_MONTHS + FORECAST.safetyMonths)) return { kind: 'none' };
  if (FORECAST.reprintMin * months > FORECAST.lowSalesMonths * sales) return { kind: 'lowSales', months: Math.round((FORECAST.reprintMin * months) / sales) };
  const steps = Math.ceil((sales * (LEAD_MONTHS + FORECAST.reprintMonths) - have * months) / (months * FORECAST.reprintStep));
  return { kind: 'reprint', quantity: Math.max(FORECAST.reprintMin, steps * FORECAST.reprintStep) };
}

/** Dias que uma quantidade dura, vendendo `monthly` por mês (até 100 anos). */
function daysOf(quantity: number, monthly: number): number {
  return Math.min(36_500, Math.floor((quantity / monthly) * FORECAST.monthDays));
}

/**
 * Calcula a previsão de cada título da curva, na ordem de urgência, e lista os títulos do No Porto fora
 * dela. `holdings` vem de titleHoldings, com a mesma data do estoque da curva.
 */
export function stockForecast(curve: { stockDate: string; rows: readonly CurveRow[] }, holdings: readonly TitleHolding[], today: string): Forecast {
  const held = new Map(holdings.map((h) => [h.key, h]));
  const inCurve = new Set<string>();
  const rows = curve.rows.map((row): ForecastRow => {
    inCurve.add(row.isbn);
    const h = held.get(row.isbn);
    const atSea = h?.atSea ?? 0;
    const arrivedAfter = h?.arrivedAfter ?? 0;
    const production = h?.production ?? 0;
    const { m3, m6 } = row.sales;
    const monthly3 = m3 / 3;
    const monthly6 = m6 / 6;
    const top = Math.max(monthly3, monthly6);
    const cover = (quantity: number, monthly: number) => (monthly > 0 ? quantity / monthly : null);
    const have = row.stock + atSea + production;
    const runsOutAt = top > 0 ? addDays(curve.stockDate, daysOf(row.stock + atSea, top)) : null;

    let ship: ShipAdvice | null = null;
    if (production > 0 && runsOutAt) {
      const shipBy = addDays(runsOutAt, -FORECAST.shippingDays);
      const want = Math.max(Math.ceil((m3 * FORECAST.shipMonths) / 3), Math.ceil((m6 * FORECAST.shipMonths) / 6));
      const oldest = h!.orders.find((o) => o.orderedAt)?.orderedAt ?? null;
      const readyAt = oldest ? addDays(oldest, FORECAST.productionDays) : null;
      ship = {
        shipBy,
        quantity: Math.min(production, want),
        short: production < want,
        readyAt,
        late: readyAt !== null && readyAt > shipBy,
        overdue: shipBy < today,
        planLate: h!.nextPlan !== null && h!.nextPlan > shipBy.slice(0, 7),
      };
    }

    // O físico (com o que chegou depois da curva) acaba antes de chegar o que está a caminho?
    const inTransit = atSea - arrivedAfter;
    const gapBeforeArrival = inTransit > 0 && !!h?.nextEta && top > 0 && addDays(curve.stockDate, daysOf(row.stock + arrivedAfter, top)) < h.nextEta;

    const reprint3 = reprintAdvice(m3, 3, have);
    const reprint6 = reprintAdvice(m6, 6, have);
    const needsAction = needsReprint({ reprint3, reprint6 }) || gapBeforeArrival || shipNeedsAttention(ship, today) || !!ship?.planLate;

    return {
      ...row,
      imported: !!h,
      productId: h?.productId ?? null,
      atSea,
      arrivedAfter,
      nextEta: h?.nextEta ?? null,
      production,
      orders: h?.orders ?? [],
      nextPlan: h?.nextPlan ?? null,
      monthly3,
      monthly6,
      cover: { stock3: cover(row.stock, monthly3), stock6: cover(row.stock, monthly6), total3: cover(row.stock + atSea, monthly3), total6: cover(row.stock + atSea, monthly6) },
      reprint3,
      reprint6,
      runsOutAt,
      ship,
      gapBeforeArrival,
      recentOnly: m3 > 0 && m3 === m6,
      needsAction,
    };
  });
  rows.sort(compareUrgency);

  const missing: MissingTitle[] = [];
  for (const [key, h] of held) {
    if (inCurve.has(key)) continue;
    const inTransit = h.atSea - h.arrivedAfter;
    if (h.production === 0 && inTransit === 0) continue;
    missing.push({ productId: h.productId, isbn: h.isbn, title: h.title, atSea: inTransit, production: h.production, nextEta: h.nextEta, orders: h.orders });
  }
  missing.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return { rows, missing };
}

/** Só o que a previsão usa: os títulos da curva e os que têm produção ou algo a caminho. */
export function holdingsFor(curveRows: readonly CurveRow[], holdings: readonly TitleHolding[]): TitleHolding[] {
  const keys = new Set(curveRows.map((r) => r.isbn));
  return holdings.filter((h) => keys.has(h.key) || h.production > 0 || h.atSea - h.arrivedAfter > 0);
}

/**
 * Os mais urgentes primeiro: os que precisam de alguma coisa; entre eles, os que ficam sem estoque
 * antes; no empate, os que vendem mais.
 */
export function compareUrgency(a: ForecastRow, b: ForecastRow): number {
  return (
    Number(b.needsAction) - Number(a.needsAction) ||
    (a.runsOutAt ?? '9999-12-31').localeCompare(b.runsOutAt ?? '9999-12-31') ||
    Math.max(b.monthly3, b.monthly6) - Math.max(a.monthly3, a.monthly6) ||
    a.title.localeCompare(b.title, 'pt-BR')
  );
}

/** Os avisos de um título, em texto (na tela e na planilha baixada). */
export function forecastAlerts(row: ForecastRow): string[] {
  const out: string[] = [];
  const s = row.ship;
  if (s?.overdue) out.push('Embarcar já: o prazo passou');
  if (s?.late && s.readyAt) out.push(`Pode faltar: a PO fica pronta em ${formatDay(s.readyAt, true)}`);
  if (s?.planLate && row.nextPlan) out.push(`Envio programado para ${formatMonth(row.nextPlan)}, depois do prazo`);
  if (row.gapBeforeArrival) out.push('O estoque acaba antes de o embarcado chegar');
  if (s?.short) out.push('A produção não cobre 3 meses de venda');
  return out;
}

/** O prazo para embarcar vence nos próximos 30 dias (ou já venceu). */
export function shipDueSoon(ship: ShipAdvice | null, today: string): boolean {
  return !!ship && (ship.overdue || daysBetween(today, ship.shipBy) <= FORECAST.soonDays);
}

/** O embarque pede atenção: o prazo vence em até 30 dias (ou venceu), ou a PO fica pronta depois dele. */
export function shipNeedsAttention(ship: ShipAdvice | null, today: string): boolean {
  return shipDueSoon(ship, today) || !!ship?.late;
}

/** Tem sugestão de reimpressão por alguma das médias. */
export function needsReprint(row: Pick<ForecastRow, 'reprint3' | 'reprint6'>): boolean {
  return row.reprint3.kind === 'reprint' || row.reprint6.kind === 'reprint';
}

export interface ForecastSummary {
  titles: number;
  /** Títulos que precisam de alguma coisa (reimpressão, embarque ou aviso). */
  action: number;
  /** Títulos com sugestão de reimpressão por alguma das médias, pela de 3 e pela de 6 meses. */
  reprint: number;
  reprint3: number;
  reprint6: number;
  /** Títulos em que o embarque pede atenção: os dois casos abaixo, juntos. */
  ship: number;
  /** Títulos com o prazo para embarcar nos próximos 30 dias (ou vencido). */
  shipSoon: number;
  /** Títulos em que a PO fica pronta depois do "embarcar até": pode faltar. */
  late: number;
  /** Títulos em que o estoque acaba antes de o embarcado chegar. */
  gaps: number;
}

/** Os números dos cartões, na aba e no painel. */
export function forecastSummary(rows: readonly ForecastRow[], today: string): ForecastSummary {
  const s: ForecastSummary = { titles: rows.length, action: 0, reprint: 0, reprint3: 0, reprint6: 0, ship: 0, shipSoon: 0, late: 0, gaps: 0 };
  for (const r of rows) {
    if (r.needsAction) s.action++;
    if (needsReprint(r)) s.reprint++;
    if (r.reprint3.kind === 'reprint') s.reprint3++;
    if (r.reprint6.kind === 'reprint') s.reprint6++;
    if (shipNeedsAttention(r.ship, today)) s.ship++;
    if (shipDueSoon(r.ship, today)) s.shipSoon++;
    if (r.ship?.late) s.late++;
    if (r.gapBeforeArrival) s.gaps++;
  }
  return s;
}
