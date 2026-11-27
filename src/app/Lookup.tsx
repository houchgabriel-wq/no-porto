// Terminal de consulta do painel (pedido do Gabriel em 19/11/2026): digita-se o nome do produto ou o
// ISBN, e cada produto que bate aparece com o que está em produção, o que está embarcado e a última
// chegada. O resumo de todos os produtos vem do servidor na primeira vez que a pessoa usa o campo (e de
// novo depois de dois minutos); a busca corre no navegador, enquanto a pessoa digita.

import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { STATUS_HUES } from '../core/items';
import { formatQuantity } from '../core/money';
import { searchProducts, type ProductSummary } from '../core/productLookup';
import { formatMonth, parcelPassed } from '../core/shipPlan';
import { arrivalState, arrivalText, formatDay } from '../core/shipments';
import { api, ApiError } from './api';
import { hueStyle } from './components';
import { Icon } from './icons';

/** Depois de quanto tempo o resumo é buscado de novo, quando a pessoa volta ao campo. */
const STALE_MS = 2 * 60_000;

export function LookupTerminal({ today, onProduct }: { today: string; onProduct: (productId: string) => void }) {
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
        <span className="mudo">Em produção, embarcado e última chegada de cada produto</span>
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
              <ProductCard product={p} today={today} onOpen={() => p.productId && onProduct(p.productId)} />
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

/** Um produto: o nome abre a ficha do produto, com todas as compras. */
function ProductCard({ product: p, today, onOpen }: { product: ProductSummary; today: string; onOpen: () => void }) {
  const eta = p.atSea.nextEta;
  const arrival = arrivalText(arrivalState(eta, null, today));
  return (
    <button type="button" className="consulta-item" onClick={onOpen}>
      <span className="consulta-cab">
        <span className="consulta-nome">{p.title}</span>
        <span className="consulta-isbn">{p.isbn ?? 'Sem ISBN'}</span>
      </span>
      <span className="consulta-numeros">
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
        <Figure
          label="Última chegada"
          hue={STATUS_HUES.entregue}
          value={p.lastArrival ? formatDay(p.lastArrival.date, true) : null}
          empty="Nenhuma"
          sub={p.lastArrival && `${formatQuantity(p.lastArrival.quantity)} ex.`}
        />
      </span>
    </button>
  );
}
