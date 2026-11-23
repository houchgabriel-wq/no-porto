// Aba Previsão de estoque (pedido do Gabriel em 20/11/2026): a curva ABC da semana cruzada com o que o
// No Porto tem de cada título. A tela calcula a previsão (src/core/stockForecast.ts) com a curva e o que
// está embarcado e em produção, que vêm do servidor; mostra cobertura, sugestão de reimpressão e aviso
// de embarque, com filtros, a ficha de cada título e o Baixar .xlsx. Admin e editor carregam a curva.

import { useId, useMemo, useState, type ReactNode } from 'react';
import { searchKey } from '../core/items';
import { formatQuantity } from '../core/money';
import { daysBetween, formatDay } from '../core/shipments';
import { formatMonth } from '../core/shipPlan';
import { CURVE_MAX_ROWS, curveDateFromName, readStockCurve, type CurveInfo, type CurveRead } from '../core/stockCurve';
import {
  FORECAST,
  LEAD_MONTHS,
  forecastAlerts,
  forecastSummary,
  needsReprint,
  shipNeedsAttention,
  stockForecast,
  type ForecastRow,
  type MissingTitle,
  type ReprintAdvice,
  type ShipAdvice,
} from '../core/stockForecast';
import { api, ApiError, type StockData } from './api';
import { Dialog, FormError, formatDateTime } from './components';
import { downloadXlsx } from './download';
import { Icon } from './icons';
import type { ExportColumn } from './spreadsheet';

/** Quantas linhas aparecem de cada vez. */
const PAGE = 200;
/** A curva é semanal: depois destes dias, a aba lembra de carregar a nova. */
const OLD_CURVE_DAYS = 8;

type Show = 'todos' | 'acao' | 'reimprimir' | 'embarcar';
const SHOWS: readonly string[] = ['todos', 'acao', 'reimprimir', 'embarcar'] satisfies Show[];
type Sort = 'urgencia' | 'venda' | 'cobertura' | 'titulo';

interface Filters {
  query: string;
  show: Show;
  abc: string;
  imported: boolean;
  sort: Sort;
}

// A aba abre em todos os títulos, do que mais vende para o que menos vende (pedido do Gabriel em 23/11/2026).
const EMPTY_FILTERS: Filters = { query: '', show: 'todos', abc: '', imported: false, sort: 'venda' };

const titulos = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'título' : 'títulos'}`;
const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Cobertura em meses: "4,5", "12", "100+", "< 0,1"; sem venda, "sem venda". Arredonda para baixo. */
export function formatCover(months: number | null): string {
  if (months === null) return 'sem venda';
  if (months > 0 && months < 0.1) return '< 0,1';
  if (months >= 100) return '100+';
  if (months >= 10) return String(Math.floor(months));
  return oneDecimal.format(Math.floor(months * 10) / 10);
}

const monthly = (n: number) => formatQuantity(Math.round(n));

function matches(r: ForecastRow, f: Filters, today: string): boolean {
  if (f.show === 'acao' && !r.needsAction) return false;
  if (f.show === 'reimprimir' && !needsReprint(r)) return false;
  if (f.show === 'embarcar' && !shipNeedsAttention(r.ship, today)) return false;
  if (f.abc && r.abcClass !== f.abc) return false;
  if (f.imported && !r.imported) return false;
  const q = searchKey(f.query);
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && (r.isbn.includes(digits) || r.code.includes(digits))) return true;
  const title = searchKey(r.title);
  return q.split(' ').every((w) => title.includes(w));
}

function sortRows(rows: ForecastRow[], sort: Sort): ForecastRow[] {
  if (sort === 'urgencia') return rows;
  const top = (r: ForecastRow) => Math.max(r.monthly3, r.monthly6);
  const copy = [...rows];
  if (sort === 'venda') copy.sort((a, b) => top(b) - top(a));
  if (sort === 'cobertura') copy.sort((a, b) => (a.cover.total3 ?? Infinity) - (b.cover.total3 ?? Infinity) || top(b) - top(a));
  if (sort === 'titulo') copy.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return copy;
}

interface Props {
  data: StockData;
  /** Carrega a curva ABC (admin e editor); ausente para quem só vê. */
  onLoad?: () => void;
  /** Abre a ficha do produto no No Porto. */
  onProduct?: (productId: string) => void;
  onToast: (msg: string) => void;
  /** O cartão já escolhido quando a aba abre por uma linha do painel (#estoque/embarcar). */
  initialShow?: string;
}

export function StockView({ data, onLoad, onProduct, onToast, initialShow }: Props) {
  const ids = useId();
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, show: initialShow && SHOWS.includes(initialShow) ? (initialShow as Show) : EMPTY_FILTERS.show }));
  const [shownCount, setShownCount] = useState(PAGE);
  const [open, setOpen] = useState<ForecastRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const { curve, today } = data;
  const forecast = useMemo(() => (curve ? stockForecast({ stockDate: curve.stockDate, rows: data.rows }, data.holdings, today) : null), [curve, data.rows, data.holdings, today]);
  const rows = useMemo(() => forecast?.rows ?? [], [forecast]);
  const summary = useMemo(() => forecastSummary(rows, today), [rows, today]);
  const shown = useMemo(() => sortRows(rows.filter((r) => matches(r, filters, today)), filters.sort), [rows, filters, today]);
  const classes = useMemo(() => [...new Set(rows.map((r) => r.abcClass).filter(Boolean))].sort(), [rows]);
  const filtered = filters.query.trim() !== '' || filters.abc !== '' || filters.imported || filters.sort !== EMPTY_FILTERS.sort || filters.show !== EMPTY_FILTERS.show;

  function change(f: Filters) {
    setFilters(f);
    setShownCount(PAGE);
  }

  async function exportRows() {
    if (!curve) return;
    setExporting(true);
    try {
      const { buildExport } = await import('./spreadsheet');
      downloadXlsx(await buildExport('Previsão de estoque', exportColumns(), shown), `previsao-estoque-${curve.stockDate}.xlsx`);
    } catch {
      onToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

  const loadButton = onLoad && (
    <button type="button" className="btn" onClick={onLoad}>
      <Icon name="atualizar" />
      <span className="rot">Carregar curva ABC</span>
    </button>
  );

  if (!curve || !forecast) {
    return (
      <section className="bloco prev-vazio" aria-labelledby={`${ids}-vazio`}>
        <span className="prev-vazio-ic" aria-hidden="true">
          <Icon name="tendencia" />
        </span>
        <h2 id={`${ids}-vazio`}>Nenhuma curva ABC carregada</h2>
        <p>
          A previsão cruza o estoque e as vendas de cada título, que vêm da curva ABC do sistema de vendas, com o que está embarcado e em produção no No Porto: cobertura em
          meses, sugestão de reimpressão e até quando cada pedido precisa embarcar.
        </p>
        {onLoad ? (
          <button type="button" className="btn primario" onClick={onLoad}>
            <Icon name="atualizar" />
            Carregar curva ABC
          </button>
        ) : (
          <p className="mudo">Peça ao admin ou ao editor para carregar a curva ABC.</p>
        )}
      </section>
    );
  }

  const age = daysBetween(curve.stockDate, today);
  const cards: { show: Show; label: string; value: number; sub: ReactNode; tone: string; icon: 'alerta' | 'livro' | 'navio' | 'tabela' }[] = [
    { show: 'todos', label: 'Todos os títulos', value: summary.titles, sub: `${titulos(rows.filter((r) => r.imported).length)} no No Porto`, tone: 'neutro', icon: 'tabela' },
    { show: 'acao', label: 'Precisam de ação', value: summary.action, sub: 'reimprimir, embarcar ou avisos', tone: 'acento', icon: 'alerta' },
    {
      show: 'reimprimir',
      label: 'Reimpressão sugerida',
      value: summary.reprint,
      sub: `${summary.reprint3.toLocaleString('pt-BR')} pela média de 3 meses · ${summary.reprint6.toLocaleString('pt-BR')} pela de 6`,
      tone: 'alerta',
      icon: 'livro',
    },
    {
      show: 'embarcar',
      label: 'Atenção no embarque',
      value: summary.ship,
      sub: `${summary.shipSoon.toLocaleString('pt-BR')} com prazo em até 30 dias · ${summary.late.toLocaleString('pt-BR')} ${summary.late === 1 ? 'pode' : 'podem'} faltar`,
      tone: summary.late > 0 ? 'critico' : 'navio',
      icon: 'navio',
    },
  ];

  return (
    <>
      <p className={age > OLD_CURVE_DAYS ? 'prev-curva antiga' : 'prev-curva'}>
        <Icon name={age > OLD_CURVE_DAYS ? 'alerta' : 'tendencia'} />
        <span>
          Curva ABC com o estoque de <b>{formatDay(curve.stockDate, true)}</b>
          {age > OLD_CURVE_DAYS && ` (há ${age} dias: carregue a desta semana)`} · carregada por {curve.uploadedBy || 'alguém'} em {formatDateTime(curve.uploadedAt)}
        </span>
      </p>

      <div className="prev-resumo" role="group" aria-label="Mostrar">
        {cards.map((c) => (
          <button key={c.show} type="button" className={`prev-cartao ${c.tone}`} aria-pressed={filters.show === c.show} onClick={() => change({ ...filters, show: c.show })}>
            <span className="prev-cartao-topo">
              <Icon name={c.icon} />
              {c.label}
            </span>
            <b>{c.value.toLocaleString('pt-BR')}</b>
            <span className="prev-cartao-sub">{c.sub}</span>
          </button>
        ))}
      </div>

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input className="campo" type="search" placeholder="Buscar título, ISBN ou código" value={filters.query} onChange={(e) => change({ ...filters, query: e.target.value })} />
        </label>
        <label className="so-leitor" htmlFor={`${ids}-classe`}>
          Classe
        </label>
        <select id={`${ids}-classe`} className="campo filtro-sel" value={filters.abc} onChange={(e) => change({ ...filters, abc: e.target.value })}>
          <option value="">Classe: todas</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              Classe {c}
            </option>
          ))}
        </select>
        <label className="marcar prev-importados">
          <input type="checkbox" checked={filters.imported} onChange={(e) => change({ ...filters, imported: e.target.checked })} />
          Só importados
        </label>
        <label className="so-leitor" htmlFor={`${ids}-ordem`}>
          Ordem
        </label>
        <select id={`${ids}-ordem`} className="campo filtro-sel prev-ordem" value={filters.sort} onChange={(e) => change({ ...filters, sort: e.target.value as Sort })}>
          <option value="venda">Maior venda primeiro</option>
          <option value="urgencia">Mais urgentes primeiro</option>
          <option value="cobertura">Menor cobertura primeiro</option>
          <option value="titulo">Título (A–Z)</option>
        </select>
        <div className="filtros-acoes">
          <button type="button" className="btn" onClick={() => void exportRows()} disabled={exporting || shown.length === 0}>
            <Icon name="arquivo" />
            <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
          </button>
          {loadButton}
        </div>
      </div>

      <p className="contagem-linha" role="status">
        {shown.length === rows.length ? titulos(rows.length) : `${shown.length.toLocaleString('pt-BR')} de ${titulos(rows.length)}`}
        {filtered && (
          <>
            {' '}
            <button type="button" className="btn-texto" onClick={() => change(EMPTY_FILTERS)}>
              Ver todos, sem filtros
            </button>
          </>
        )}
      </p>
      <p className="dica prev-legenda">
        Nas colunas duplas, em cima é pela média de 3 meses e embaixo pela de 6. Cobertura em meses de venda. Prazos: produção de {FORECAST.productionDays} dias a partir da data da
        PO e viagem de {FORECAST.shippingDays} dias.
      </p>

      {shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum título com estes filtros.</div>
      ) : (
        <>
          <div className="tabela-caixa">
            <table className="tabela-estoque tabela-empilha">
              <thead>
                <tr>
                  <th>Título</th>
                  <th className="num">Estoque</th>
                  <th className="num">Embarcado</th>
                  <th className="num">Em produção</th>
                  <th className="num">Venda por mês</th>
                  <th className="num">Cobertura do físico</th>
                  <th className="num">Cobertura com embarcado</th>
                  <th className="num">Reimpressão</th>
                  <th>Embarque</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, shownCount).map((r) => (
                  <Row key={r.isbn} row={r} today={today} onOpen={() => setOpen(r)} />
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > shownCount && (
            <p className="mais-linhas">
              <button type="button" className="btn" onClick={() => setShownCount((n) => n + PAGE)}>
                Mostrar mais {Math.min(PAGE, shown.length - shownCount)} de {shown.length - shownCount}
              </button>
            </p>
          )}
        </>
      )}

      {forecast.missing.length > 0 && <MissingList missing={forecast.missing} today={today} onProduct={onProduct} />}

      <TitleDialog row={open} curve={curve} today={today} onClose={() => setOpen(null)} onProduct={onProduct} />
    </>
  );
}

/** Um valor por média: 3 meses em cima, 6 embaixo. */
function Pair({ three, six }: { three: ReactNode; six: ReactNode }) {
  return (
    <>
      <span className="par-linha">
        <span className="par-rot" aria-hidden="true">
          3m
        </span>
        <span className="so-leitor">média de 3 meses: </span>
        {three}
      </span>
      <span className="par-linha">
        <span className="par-rot" aria-hidden="true">
          6m
        </span>
        <span className="so-leitor">média de 6 meses: </span>
        {six}
      </span>
    </>
  );
}

function reprintCell(a: ReprintAdvice): ReactNode {
  if (a.kind === 'reprint') return <b className="prev-reimp">{formatQuantity(a.quantity)}</b>;
  if (a.kind === 'lowSales') return <span className="mudo">venda baixa</span>;
  return <span className="mudo">—</span>;
}

/** A situação do embarque, em texto (com ícone; nunca só a cor). */
function shipState(ship: ShipAdvice, today: string): { tone: 'critico' | 'alerta' | 'neutro'; text: string } {
  if (ship.overdue) return { tone: 'critico', text: 'Embarcar já' };
  if (ship.late) return { tone: 'critico', text: 'Pode faltar' };
  const days = daysBetween(today, ship.shipBy);
  if (days <= FORECAST.soonDays) return { tone: 'alerta', text: days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `Em ${days} dias` };
  if (ship.planLate) return { tone: 'alerta', text: 'Programação depois do prazo' };
  return { tone: 'neutro', text: `Em ${days} dias` };
}

function Row({ row: r, today, onOpen }: { row: ForecastRow; today: string; onOpen: () => void }) {
  const state = r.ship ? shipState(r.ship, today) : null;
  return (
    <tr>
      <td className="t-produto">
        <button type="button" className="abrir-item" onClick={onOpen}>
          {r.title}
        </button>
        <span className="t-isbn prev-sub">
          {r.abcClass && <span className="selo">Classe {r.abcClass}</span>}
          <span>{r.isbn}</span>
          {r.imported && <span className="prev-np">No Porto</span>}
        </span>
        {r.gapBeforeArrival && (
          <span className="pilula critico prev-pilula">
            <Icon name="alerta" />
            Acaba antes de o embarcado chegar
          </span>
        )}
      </td>
      <td className="num" data-rot="Estoque">
        {formatQuantity(r.stock)}
      </td>
      <td className="num" data-rot="Embarcado">
        {r.atSea ? formatQuantity(r.atSea) : <span className="mudo">—</span>}
        {r.nextEta && <span className="t-isbn">chega {formatDay(r.nextEta)}</span>}
      </td>
      <td className="num" data-rot="Em produção">
        {r.production ? formatQuantity(r.production) : <span className="mudo">—</span>}
        {r.orders.length > 0 && <span className="t-isbn">{r.orders.map((o) => o.code ?? 'Sem PO').join(', ')}</span>}
      </td>
      <td className="num par" data-rot="Venda por mês">
        <Pair three={monthly(r.monthly3)} six={monthly(r.monthly6)} />
      </td>
      <td className="num par" data-rot="Cobertura do físico (meses)">
        <Pair three={formatCover(r.cover.stock3)} six={formatCover(r.cover.stock6)} />
      </td>
      <td className="num par" data-rot="Cobertura com embarcado (meses)">
        <Pair three={formatCover(r.cover.total3)} six={formatCover(r.cover.total6)} />
      </td>
      <td className="num par" data-rot="Reimpressão">
        <Pair three={reprintCell(r.reprint3)} six={reprintCell(r.reprint6)} />
      </td>
      <td className="prev-embarque" data-rot="Embarque">
        {r.ship && state ? (
          <>
            <b>até {formatDay(r.ship.shipBy, true)}</b>
            <span className="t-isbn">pelo menos {formatQuantity(r.ship.quantity)} ex.</span>
            <span className={`pilula ${state.tone === 'neutro' ? '' : state.tone}`}>
              {state.tone !== 'neutro' && <Icon name="alerta" />}
              {state.text}
            </span>
          </>
        ) : r.production > 0 ? (
          <span className="mudo">Sem venda</span>
        ) : (
          <span className="mudo">—</span>
        )}
      </td>
    </tr>
  );
}

/** O que está em produção ou a caminho no No Porto e não aparece na curva. */
function MissingList({ missing, today, onProduct }: { missing: MissingTitle[]; today: string; onProduct?: (productId: string) => void }) {
  return (
    <details className="bloco fora-curva">
      <summary>
        {titulos(missing.length)} em produção ou a caminho no No Porto não {missing.length === 1 ? 'está' : 'estão'} na curva
      </summary>
      <p className="dica">Sem estoque nem vendas na curva, não há como calcular a previsão. Pode ser um lançamento, um título sem ISBN no No Porto ou com outro código na curva.</p>
      <ul className="fora-lista">
        {missing.map((m) => (
          <li key={m.productId}>
            {onProduct ? (
              <button type="button" className="abrir-item" onClick={() => onProduct(m.productId)}>
                {m.title}
              </button>
            ) : (
              <span className="t-nome">{m.title}</span>
            )}
            <span className="t-isbn">
              {m.isbn ?? 'Sem ISBN'}
              {m.production > 0 && ` · ${formatQuantity(m.production)} em produção (${m.orders.map((o) => o.code ?? 'Sem PO').join(', ')})`}
              {m.atSea > 0 && ` · ${formatQuantity(m.atSea)} a caminho${m.nextEta ? `, chega ${formatDay(m.nextEta)}` : ''}`}
              {m.nextEta && m.nextEta < today && ' (previsão vencida)'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function reprintText(a: ReprintAdvice, sales: number, months: number, have: number): string {
  const per = Math.round(sales / months);
  if (sales <= 0) return 'Sem venda no período: sem sugestão.';
  if (a.kind === 'none') {
    return `Não precisa agora: ${formatQuantity(have)} (físico + embarcado + produção) cobrem mais de ${LEAD_MONTHS + FORECAST.safetyMonths} meses de ${formatQuantity(per)} por mês.`;
  }
  if (a.kind === 'lowSales') {
    return `Venda baixa: a tiragem mínima (${formatQuantity(FORECAST.reprintMin)}) cobriria ${a.months} meses de venda, mais que ${FORECAST.lowSalesMonths}. Sem sugestão.`;
  }
  return `Reimprimir ${formatQuantity(a.quantity)}: ${formatQuantity(have)} não cobrem ${LEAD_MONTHS + FORECAST.safetyMonths} meses de ${formatQuantity(per)} por mês. A sugestão cobre ${LEAD_MONTHS} meses de prazo mais ${FORECAST.reprintMonths} de venda, menos o que já existe, em múltiplos de ${formatQuantity(FORECAST.reprintStep)} (mínimo de ${formatQuantity(FORECAST.reprintMin)}).`;
}

/** A ficha de um título: as vendas, o que há de estoque, as contas e o porquê de cada sugestão. */
function TitleDialog({ row: r, curve, today, onClose, onProduct }: { row: ForecastRow | null; curve: CurveInfo; today: string; onClose: () => void; onProduct?: (productId: string) => void }) {
  const have = r ? r.stock + r.atSea + r.production : 0;
  const alerts = r ? forecastAlerts(r) : [];
  const top = r ? Math.max(r.monthly3, r.monthly6) : 0;
  const sales: [string, number | null][] = r
    ? [
        ['1 mês', r.sales.m1],
        ['3 meses', r.sales.m3],
        ['6 meses', r.sales.m6],
        ['9 meses', r.sales.m9],
        ['12 meses', r.sales.m12],
      ]
    : [];
  return (
    <Dialog title={r?.title ?? ''} open={r !== null} onClose={onClose} wide>
      {r && (
        <>
          <div className="dlg-corpo prev-ficha">
            <p className="prev-sub t-isbn">
              {r.abcClass && <span className="selo">Classe {r.abcClass}</span>}
              <span>ISBN {r.isbn}</span>
              {r.code && <span>Código {r.code}</span>}
              <span>{r.imported ? 'Aparece no No Porto' : 'Não aparece no No Porto'}</span>
            </p>
            {alerts.length > 0 && (
              <ul className="prev-avisos">
                {alerts.map((a) => (
                  <li key={a} className="aviso critico">
                    <Icon name="alerta" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}

            <section aria-label="Vendas">
              <h3>Vendas (total de cada período, na curva)</h3>
              <dl className="prev-dl">
                {sales.map(([label, n]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{n === null ? '—' : formatQuantity(n)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Por mês (3 meses)</dt>
                  <dd>{monthly(r.monthly3)}</dd>
                </div>
                <div>
                  <dt>Por mês (6 meses)</dt>
                  <dd>{monthly(r.monthly6)}</dd>
                </div>
              </dl>
              {r.recentOnly && <p className="dica">Só vendeu nos últimos 3 meses (as vendas de 3 e de 6 meses são iguais): a média de 6 meses fica pela metade.</p>}
            </section>

            <section aria-label="Estoque">
              <h3>Estoque</h3>
              <dl className="prev-dl">
                <div>
                  <dt>Físico, em {formatDay(curve.stockDate, true)}</dt>
                  <dd>{formatQuantity(r.stock)}</dd>
                </div>
                <div>
                  <dt>Embarcado</dt>
                  <dd>
                    {formatQuantity(r.atSea)}
                    {r.nextEta && <span className="dica">chega {formatDay(r.nextEta, true)}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Em produção</dt>
                  <dd>{formatQuantity(r.production)}</dd>
                </div>
                <div>
                  <dt>Cobertura do físico</dt>
                  <dd>
                    <span>
                      {formatCover(r.cover.stock3)} <span className="mudo">·</span> {formatCover(r.cover.stock6)}
                    </span>
                    <span className="dica">meses, pela média de 3 · de 6</span>
                  </dd>
                </div>
                <div>
                  <dt>Cobertura com embarcado</dt>
                  <dd>
                    <span>
                      {formatCover(r.cover.total3)} <span className="mudo">·</span> {formatCover(r.cover.total6)}
                    </span>
                    <span className="dica">meses, pela média de 3 · de 6</span>
                  </dd>
                </div>
              </dl>
              {r.arrivedAfter > 0 && (
                <p className="dica">
                  O embarcado inclui {formatQuantity(r.arrivedAfter)} que chegaram depois de {formatDay(curve.stockDate, true)}, a data do estoque da curva: a planilha ainda não os
                  conta.
                </p>
              )}
              {r.orders.length > 0 && (
                <ul className="prev-pos">
                  {r.orders.map((o) => (
                    <li key={o.code ?? 'sem'}>
                      <b>{o.code ?? 'Sem PO'}</b> · {formatQuantity(o.quantity)} ex. · {o.orderedAt ? `PO de ${formatDay(o.orderedAt, true)}` : 'PO sem data'}
                    </li>
                  ))}
                  {r.nextPlan && <li className="mudo">Primeiro envio programado: {formatMonth(r.nextPlan)}</li>}
                </ul>
              )}
            </section>

            <section aria-label="Reimpressão">
              <h3>Reimpressão</h3>
              <p>
                <b>Pela média de 3 meses.</b> {reprintText(r.reprint3, r.sales.m3, 3, have)}
              </p>
              <p>
                <b>Pela média de 6 meses.</b> {reprintText(r.reprint6, r.sales.m6, 6, have)}
              </p>
            </section>

            <section aria-label="Embarque">
              <h3>Embarque</h3>
              {r.ship && r.runsOutAt ? (
                <>
                  <p>
                    <b>
                      Embarcar até {formatDay(r.ship.shipBy, true)} pelo menos {formatQuantity(r.ship.quantity)} ex.
                    </b>{' '}
                    Pela maior média ({monthly(top)} por mês), físico + embarcado acabam em {formatDay(r.runsOutAt, true)}; a viagem leva {FORECAST.shippingDays} dias. A quantidade
                    é de {FORECAST.shipMonths} meses de venda{r.ship.short ? ', mas a produção não chega a isso' : ''}.
                  </p>
                  <p className="dica">
                    {r.ship.readyAt
                      ? `A PO mais antiga fica pronta em ${formatDay(r.ship.readyAt, true)} (${FORECAST.productionDays} dias depois da data dela)${r.ship.late ? ': depois do prazo para embarcar.' : '.'}`
                      : 'A PO não tem data: não dá para conferir se fica pronta a tempo.'}
                    {r.ship.overdue && ` O prazo passou há ${daysBetween(r.ship.shipBy, today)} dias.`}
                  </p>
                </>
              ) : r.production > 0 ? (
                <p className="mudo">O título não vendeu no período: sem aviso de embarque.</p>
              ) : (
                <p className="mudo">Nada em produção no No Porto.</p>
              )}
            </section>
          </div>
          <div className="dlg-pe">
            {r.productId && onProduct && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const id = r.productId!;
                  onClose();
                  onProduct(id);
                }}
              >
                <Icon name="livro" />
                Ficha do produto no No Porto
              </button>
            )}
            <button type="button" className="btn primario" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** As colunas do Baixar .xlsx: o que a tela mostra, com as vendas de cada período e os avisos. */
function exportColumns(): ExportColumn<ForecastRow>[] {
  const reprint = (a: ReprintAdvice) => (a.kind === 'reprint' ? a.quantity : a.kind === 'lowSales' ? `venda baixa (${a.months} meses)` : null);
  const cover = (n: number | null) => (n === null ? null : Math.floor(n * 10) / 10);
  const br = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '');
  const n0 = '#,##0';
  return [
    { header: 'Título', width: 60, value: (r) => r.title },
    { header: 'ISBN', width: 16, value: (r) => r.isbn },
    { header: 'Código', width: 10, value: (r) => r.code },
    { header: 'Classe', width: 8, value: (r) => r.abcClass },
    { header: 'No No Porto', width: 11, value: (r) => (r.imported ? 'Sim' : 'Não') },
    { header: 'Estoque físico', width: 13, value: (r) => r.stock, numFmt: n0 },
    { header: 'Embarcado', width: 12, value: (r) => r.atSea, numFmt: n0 },
    { header: 'Chegada prevista', width: 14, value: (r) => br(r.nextEta) },
    { header: 'Em produção', width: 12, value: (r) => r.production, numFmt: n0 },
    { header: 'POs em produção', width: 18, value: (r) => r.orders.map((o) => o.code ?? 'Sem PO').join(', ') },
    { header: 'Vendas 1 mês', width: 12, value: (r) => r.sales.m1, numFmt: n0 },
    { header: 'Vendas 3 meses', width: 13, value: (r) => r.sales.m3, numFmt: n0 },
    { header: 'Vendas 6 meses', width: 13, value: (r) => r.sales.m6, numFmt: n0 },
    { header: 'Vendas 9 meses', width: 13, value: (r) => r.sales.m9, numFmt: n0 },
    { header: 'Vendas 12 meses', width: 14, value: (r) => r.sales.m12, numFmt: n0 },
    { header: 'Venda/mês (3 meses)', width: 15, value: (r) => Math.round(r.monthly3), numFmt: n0 },
    { header: 'Venda/mês (6 meses)', width: 15, value: (r) => Math.round(r.monthly6), numFmt: n0 },
    { header: 'Cobertura físico (3 meses)', width: 15, value: (r) => cover(r.cover.stock3), numFmt: '0.0' },
    { header: 'Cobertura físico (6 meses)', width: 15, value: (r) => cover(r.cover.stock6), numFmt: '0.0' },
    { header: 'Cobertura com embarcado (3 meses)', width: 17, value: (r) => cover(r.cover.total3), numFmt: '0.0' },
    { header: 'Cobertura com embarcado (6 meses)', width: 17, value: (r) => cover(r.cover.total6), numFmt: '0.0' },
    { header: 'Reimpressão (3 meses)', width: 16, value: (r) => reprint(r.reprint3), numFmt: n0 },
    { header: 'Reimpressão (6 meses)', width: 16, value: (r) => reprint(r.reprint6), numFmt: n0 },
    { header: 'Embarcar até', width: 13, value: (r) => br(r.ship?.shipBy) },
    { header: 'Embarcar (ex.)', width: 13, value: (r) => r.ship?.quantity ?? null, numFmt: n0 },
    { header: 'PO pronta em', width: 13, value: (r) => br(r.ship?.readyAt) },
    { header: 'Avisos', width: 50, value: (r) => forecastAlerts(r).join('; ') },
  ];
}

type CurveStep = { kind: 'escolher' } | { kind: 'lendo' } | { kind: 'conferir'; fileName: string; sheet: string; read: CurveRead; date: string; fromName: boolean } | { kind: 'gravando' };

/** Carregar a curva ABC da semana: lê a planilha no navegador, mostra o que foi lido e pede a data do estoque. */
export function CurveDialog({ open, today, onClose, onLoaded }: { open: boolean; today: string; onClose: () => void; onLoaded: (result: { stockDate: string; rowCount: number }) => void }) {
  const ids = useId();
  const [step, setStep] = useState<CurveStep>({ kind: 'escolher' });
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (step.kind === 'gravando') return;
    setStep({ kind: 'escolher' });
    setError(null);
    onClose();
  }

  async function read(file: File) {
    setError(null);
    setStep({ kind: 'lendo' });
    try {
      const { readWorkbook } = await import('./spreadsheet');
      const sheets = await readWorkbook(await file.arrayBuffer(), CURVE_MAX_ROWS + 20);
      let first: string | null = null;
      for (const sheet of sheets) {
        const result = readStockCurve(sheet.rows);
        if ('error' in result) {
          first ??= result.error;
          continue;
        }
        if (result.rows.length === 0) throw new Error('A planilha não tem nenhum título.');
        const named = curveDateFromName([file.name, sheet.name], today);
        setStep({ kind: 'conferir', fileName: file.name, sheet: sheet.name, read: result, date: named ?? today, fromName: named !== null });
        return;
      }
      throw new Error(first ?? 'A planilha está vazia.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setStep({ kind: 'escolher' });
    }
  }

  async function save(s: Extract<CurveStep, { kind: 'conferir' }>) {
    if (!s.date || s.date > today) {
      setError(!s.date ? 'Informe a data do estoque.' : 'A data do estoque não pode ser depois de hoje.');
      return;
    }
    setError(null);
    setStep({ kind: 'gravando' });
    try {
      const result = await api.loadStockCurve({ stockDate: s.date, fileName: s.fileName, rows: s.read.rows });
      setStep({ kind: 'escolher' });
      onLoaded(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a curva. Tente de novo.');
      setStep(s);
    }
  }

  return (
    <Dialog title="Carregar curva ABC" open={open} onClose={close} wide>
      {step.kind === 'escolher' || step.kind === 'lendo' ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a planilha da <b>curva ABC</b> do jeito que ela sai do sistema de vendas, com o estoque atual e as vendas de 1, 3, 6, 9 e 12 meses de cada título. A carga
            substitui a curva anterior. Os valores em dinheiro da planilha não são lidos.
          </p>
          <label className="btn primario arquivo">
            <Icon name="arquivo" />
            {step.kind === 'lendo' ? 'Lendo a planilha…' : 'Escolher planilha'}
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={step.kind === 'lendo'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void read(f);
              }}
            />
          </label>
          <FormError message={error} />
        </div>
      ) : step.kind === 'gravando' ? (
        <div className="dlg-corpo" role="status">
          <p>Carregando a curva…</p>
        </div>
      ) : (
        <>
          <div className="dlg-corpo">
            <p className="aviso ok">
              <Icon name="check" />
              <span>
                {titulos(step.read.rows.length)} lidos da aba &quot;{step.sheet}&quot; de {step.fileName}.
              </span>
            </p>
            {(step.read.merged.length > 0 || step.read.ignored.length > 0 || step.read.negativeSales > 0 || step.read.negativeStock > 0) && (
              <ul className="lista-dicas">
                {step.read.merged.length > 0 && (
                  <li>
                    {step.read.merged.length === 1 ? 'Um código aparece' : `${step.read.merged.length} códigos aparecem`} em mais de uma linha, com códigos de produto diferentes:
                    estoque e vendas foram somados ({step.read.merged.slice(0, 3).map((m) => m.title).join('; ')}
                    {step.read.merged.length > 3 ? '…' : ''}).
                  </li>
                )}
                {step.read.ignored.length > 0 && (
                  <li>
                    {step.read.ignored.length === 1 ? 'Uma linha ficou' : `${step.read.ignored.length} linhas ficaram`} de fora:{' '}
                    {step.read.ignored
                      .slice(0, 3)
                      .map((n) => `linha ${n.row}, ${n.text} (${n.reason})`)
                      .join('; ')}
                    {step.read.ignored.length > 3 ? `; e mais ${step.read.ignored.length - 3}` : ''}.
                  </li>
                )}
                {step.read.negativeSales > 0 && (
                  <li>
                    {titulos(step.read.negativeSales)} {step.read.negativeSales === 1 ? 'tem' : 'têm'} venda negativa em algum período (devolução maior que a venda): conta como
                    zero.
                  </li>
                )}
                {step.read.negativeStock > 0 && (
                  <li>
                    {titulos(step.read.negativeStock)} com estoque negativo: conta como zero.
                  </li>
                )}
              </ul>
            )}
            <div className="prev-data">
              <label className="rotulo" htmlFor={`${ids}-data`}>
                Data do estoque
              </label>
              <input
                id={`${ids}-data`}
                className="campo"
                type="date"
                value={step.date}
                max={today}
                aria-describedby={`${ids}-data-dica`}
                onChange={(e) => setStep({ ...step, date: e.target.value })}
              />
              <p id={`${ids}-data-dica`} className="dica">
                {step.fromName
                  ? 'A planilha não traz a data; esta veio do nome do arquivo. Confira.'
                  : 'A planilha não traz a data. Confira: é o dia em que a curva saiu do sistema de vendas.'}{' '}
                O que chegou no No Porto depois desta data conta como embarcado.
              </p>
            </div>
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => setStep({ kind: 'escolher' })}>
              Escolher outra
            </button>
            <button type="button" className="btn primario" onClick={() => void save(step)}>
              Carregar {titulos(step.read.rows.length)}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
