// Painel (SPEC.md, seção 5). Neste marco, só a produção: o total em destaque e a divisão por
// fornecedor e pelas POs maiores. Embarques, chegadas e pagamentos entram nos próximos marcos.

import { useMemo } from 'react';
import { totals, totalsByOrder, totalsBySupplier } from '../core/items';
import { formatQuantity } from '../core/money';
import type { ProductionData } from './api';
import { hueFor, hueStyle } from './components';
import { Icon } from './icons';
import { headline, itemsCount } from './Production';

export function Dashboard({ data, onSupplier, onOrder }: { data: ProductionData; onSupplier: (id: string) => void; onOrder: (id: string) => void }) {
  const { seeValues } = data;
  const all = useMemo(() => totals(data.items, seeValues), [data.items, seeValues]);
  const bySupplier = useMemo(() => totalsBySupplier(data.items, data.suppliers, seeValues), [data, seeValues]);
  const byOrder = useMemo(
    () =>
      totalsByOrder(data.items, data.orders, data.suppliers, seeValues)
        .filter((o) => o.orderId !== null)
        .sort((a, b) => (b.valueCents ?? b.quantity) - (a.valueCents ?? a.quantity))
        .slice(0, 8),
    [data, seeValues],
  );
  const orderCount = new Set(data.items.map((i) => i.purchaseOrderId).filter(Boolean)).size;
  const top = (t: { valueCents?: number; quantity: number }) => (seeValues ? (t.valueCents ?? 0) : t.quantity);
  const max = Math.max(1, ...bySupplier.map(top));
  const maxOrder = Math.max(1, ...byOrder.map(top));

  return (
    <>
      <section className="heroi" aria-labelledby="heroi-titulo">
        <div className="heroi-topo">
          <div>
            <h2 id="heroi-titulo" className="heroi-rot">
              Em produção nos fornecedores
            </h2>
            <div className="heroi-num">
              <b>{headline(all)}</b>
              {seeValues && <span>{formatQuantity(all.quantity)} exemplares</span>}
            </div>
          </div>
          <div className="heroi-linhas">
            <div className="hl">
              <span className="hl-ic">
                <Icon name="caixa" />
              </span>
              <div>
                <b>{all.items}</b>
                <span>itens</span>
              </div>
            </div>
            <div className="hl">
              <span className="hl-ic">
                <Icon name="tabela" />
              </span>
              <div>
                <b>{orderCount}</b>
                <span>POs abertas</span>
              </div>
            </div>
            <div className="hl">
              <span className="hl-ic">
                <Icon name="pessoas" />
              </span>
              <div>
                <b>{bySupplier.filter((s) => s.supplierId).length}</b>
                <span>fornecedores</span>
              </div>
            </div>
          </div>
        </div>
        {seeValues && all.unpriced > 0 && (
          <p className="aviso alerta">
            <Icon name="alerta" />
            <span>
              {all.unpriced} {all.unpriced === 1 ? 'item está sem preço e não entra' : 'itens estão sem preço e não entram'} no total.
            </span>
          </p>
        )}
      </section>

      <div className="painel-grade">
        <section className="bloco">
          <div className="bloco-topo">
            <h2>Por fornecedor</h2>
            <span className="mudo">{seeValues ? 'valor em produção' : 'exemplares em produção'}</span>
          </div>
          <ul className="lista">
            {bySupplier.map((s) => (
              <li key={s.supplierId ?? 'sem'}>
                <button type="button" className="barra-linha h" style={hueStyle(s.supplierId ? hueFor(s.supplierId) : 0)} onClick={() => onSupplier(s.supplierId ?? 'sem')}>
                  <span className="barra-nome">{s.name}</span>
                  <b>{headline(s)}</b>
                  <span className="barra larga" aria-hidden="true">
                    <span style={{ width: `${Math.max(1.5, (top(s) / max) * 100)}%` }} />
                  </span>
                  <span className="barra-sub">
                    {itemsCount(s.items)}
                    {seeValues && ` · ${formatQuantity(s.quantity)} ex.`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="bloco">
          <div className="bloco-topo">
            <h2>POs maiores</h2>
            <span className="mudo">{seeValues ? 'por valor' : 'por exemplares'}</span>
          </div>
          <ul className="lista">
            {byOrder.map((o) => (
              <li key={o.orderId}>
                <button type="button" className="barra-linha h" style={hueStyle(32)} onClick={() => onOrder(o.orderId!)}>
                  <span className="barra-nome">
                    {o.code} <span className="mudo">· {o.suppliers.join(', ')}</span>
                  </span>
                  <b>{headline(o)}</b>
                  <span className="barra larga" aria-hidden="true">
                    <span style={{ width: `${Math.max(1.5, (top(o) / maxOrder) * 100)}%` }} />
                  </span>
                  <span className="barra-sub">{itemsCount(o.items)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
