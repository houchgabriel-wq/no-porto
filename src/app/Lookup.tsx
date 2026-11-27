// Terminal de consulta do painel (pedido do Gabriel em 19/11/2026): digita-se o nome do produto ou o
// ISBN, e cada produto que bate aparece com o que está em produção, o que está embarcado e a última
// chegada. O resumo de todos os produtos vem do servidor na primeira vez que a pessoa usa o campo (e de
// novo depois de dois minutos); a busca corre no navegador, enquanto a pessoa digita.
// Desde 27/11/2026, também a produção no Brasil, junto com a importação.

import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { dueText } from '../core/brazil';
import { STATUS_HUES } from '../core/items';
import { formatQuantity } from '../core/money';
import { searchProducts, type ProductSummary } from '../core/productLookup';
import { formatMonth, parcelPassed } from '../core/shipPlan';
import { arrivalState, arrivalText, daysBetween, formatDay } from '../core/shipments';
import { api, ApiError } from './api';
import { BRAZIL_HUE, hueStyle } from './components';
import { Icon } from './icons';

/** Depois de quanto tempo o resumo é buscado de novo, quando a pessoa volta ao campo. */
const STALE_MS = 2 * 60_000;

interface Props {
  today: string;
  /** Abre a ficha do produto. */
  onProduct: (productId: string) => void;
  /** Abre Produção › Brasil já com a busca, para o que só tem pedidos no Brasil (sem ficha de produto). */
  onBrazil: (query: string) => void;
}

export function LookupTerminal({ today, onProduct, onBrazil }: Props) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<{ products: ProductSummary[]; at: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function load() {
    if (busy.current || (catalog && Date.now() - catalog.at < STALE_MS)) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await api.lookup();
      setCatalog({ products: res.products, at: Date.now() });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar os produtos. Tente de novo.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  const typed = query.trim();
  const result = useMemo(() => (catalog ? searchProducts(catalog.products, typed) : null), [catalog, typed]);

  let status = '';
  if (error) status = error;
  else if (typed.length === 1) status = 'Digite pelo menos duas letras ou números.';
  else if (typed && !result) status = loading ? 'Carregando os produtos…' : '';
  else if (typed && result) {
    if (result.total === 0) status = `Nenhum produto com “${typed}”.`;
    else if (result.total > result.products.length) status = `${result.products.length} de ${result.total} produtos. Digite mais para achar o que procura.`;
    else status = result.total === 1 ? '1 produto' : `${result.total} produtos`;
  }

  return (
    <section className="bloco consulta" aria-labelledby={`${ids}-titulo`}>
      <div className="consulta-topo">
        <h2 id={`${ids}-titulo`}>Terminal de consulta</h2>
        <span className="mudo">Em produção, embarcado, no Brasil e última chegada de cada produto</span>
      </div>
      <label className="busca consulta-busca">
        <Icon name="busca" />
        <input
          type="search"
          className="campo"
          value={query}
          placeholder="Nome do produto ou ISBN"
          aria-label="Nome do produto ou ISBN"
          aria-describedby={`${ids}-status`}
          autoComplete="off"
          enterKeyHint="search"
          onFocus={() => void load()}
          onChange={(e) => {
            setQuery(e.target.value);
            void load();
          }}
        />
      </label>
      <p id={`${ids}-status`} className={error ? 'consulta-status erro' : 'consulta-status'} role="status">
        {status}
      </p>
      {result && result.products.length > 0 && (
        <ul className="consulta-lista" aria-label="Produtos encontrados">
          {result.products.map((p) => (
            <li key={p.key}>
              <ProductCard product={p} today={today} onOpen={() => (p.productId ? onProduct(p.productId) : onBrazil(p.isbn ?? p.title))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Figure({ label, hue, value, empty = 'Nada', sub }: { label: string; hue: number; value: string | null; empty?: string; sub: ReactNode }) {
  return (
    <span className="consulta-num h" style={hueStyle(hue)}>
      <span className="consulta-rot">{label}</span>
      <b className={value ? undefined : 'consulta-nada'}>{value ?? empty}</b>
      {sub && <span className="consulta-sub">{sub}</span>}
    </span>
  );
}

/** A entrega prevista mais próxima no Brasil, em poucas palavras ("entrega em 8 dias", "atrasado há 3 dias"). */
function brazilDue(nextDue: string | null, today: string): string {
  const late = nextDue !== null && nextDue < today;
  const text = dueText({ late, lateDays: late ? daysBetween(nextDue, today) : 0 }, nextDue, today);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Um produto: abre a ficha do produto, com todas as compras. O que só tem pedidos no Brasil não tem ficha e abre
 * Produção › Brasil, já com a busca.
 */
function ProductCard({ product: p, today, onOpen }: { product: ProductSummary; today: string; onOpen: () => void }) {
  const eta = p.atSea.nextEta;
  const arrival = arrivalText(arrivalState(eta, null, today));
  const inBrazil = p.brazil.quantity > 0;
  const brazilLate = inBrazil && p.brazil.nextDue !== null && p.brazil.nextDue < today;
  return (
    <button type="button" className="consulta-item" onClick={onOpen}>
      <span className="consulta-cab">
        <span className="consulta-nome">{p.title}</span>
        <span className="consulta-isbn">
          {p.isbn ?? 'Sem ISBN'}
          {p.productId === null && <span className="consulta-so-brasil"> · Só no Brasil</span>}
        </span>
      </span>
      <span className={inBrazil ? 'consulta-numeros quatro' : 'consulta-numeros'}>
        <Figure
          label="Em produção"
          hue={STATUS_HUES.producao}
          value={p.production.quantity ? `${formatQuantity(p.production.quantity)} ex.` : null}
          sub={
            p.production.quantity > 0 && (
              <>
                {p.production.orders.join(', ') || 'Sem PO'}
                {p.production.nextShip && (
                  <Fragment>
                    {' '}
                    · envio {formatMonth(p.production.nextShip)}
                    {parcelPassed(p.production.nextShip, today) && ' (já passou)'}
                  </Fragment>
                )}
              </>
            )
          }
        />
        <Figure
          label="Embarcado"
          hue={STATUS_HUES.embarcado}
          value={p.atSea.quantity ? `${formatQuantity(p.atSea.quantity)} ex.` : null}
          sub={p.atSea.quantity > 0 && (eta ? `${formatDay(eta, true)} · ${arrival.charAt(0).toLowerCase()}${arrival.slice(1)}` : arrival)}
        />
        {inBrazil && (
          <Figure
            label="Produção no Brasil"
            hue={BRAZIL_HUE}
            value={`${formatQuantity(p.brazil.quantity)} ex.`}
            sub={
              <>
                {p.brazil.printers.join(', ')} ·{' '}
                {brazilLate ? (
                  <span className="consulta-atraso">
                    <Icon name="alerta" />
                    {brazilDue(p.brazil.nextDue, today)}
                  </span>
                ) : (
                  brazilDue(p.brazil.nextDue, today)
                )}
              </>
            }
          />
        )}
        <Figure
          label="Última chegada"
          hue={STATUS_HUES.entregue}
          value={p.lastArrival ? formatDay(p.lastArrival.date, true) : null}
          empty="Nenhuma"
          sub={p.lastArrival && `${formatQuantity(p.lastArrival.quantity)} ex.${p.lastArrival.printers.length ? ` · entrega de ${p.lastArrival.printers.join(', ')}` : ''}`}
        />
      </span>
    </button>
  );
}
