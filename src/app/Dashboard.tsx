// Painel (SPEC.md, seção 5): em produção, no mar e a pagar em destaque; próximas chegadas (com os
// atrasos), a produção por fornecedor e as POs maiores. O leitor vê exemplares e não vê o que falta
// pagar.

import { useMemo } from 'react';
import { NO_SUPPLIER, totals, totalsByOrder, totalsBySupplier } from '../core/items';
import { formatQuantity, formatUsdWhole } from '../core/money';
import { arrivalState, arrivalText, formatDay, shipmentUnits, totalDue } from '../core/shipments';
import type { Amount } from '../core/suppliers';
import type { ProductionData } from './api';
import { hueFor, hueStyle } from './components';
import { Icon } from './icons';
import { headline, itemsCount } from './Production';

interface Props {
  data: ProductionData;
  onSupplier: (id: string) => void;
  onOrder: (id: string) => void;
  onShipment: (unitKey: string) => void;
  /** Recebido no ano corrente (do resumo por fornecedor); null enquanto carrega. */
  received: { year: string; amount: Amount } | null;
}

export function Dashboard({ data, onSupplier, onOrder, onShipment, received }: Props) {
  const { seeValues } = data;
  const production = useMemo(() => data.items.filter((i) => i.status === 'producao'), [data.items]);
  const inProduction = useMemo(() => totals(production, seeValues), [production, seeValues]);
  const atSea = useMemo(() => totals(data.items.filter((i) => i.status === 'embarcado'), seeValues), [data.items, seeValues]);
  const due = useMemo(() => (seeValues ? totalDue(data.invoices, data.items, data.payments) : null), [seeValues, data]);
  const units = useMemo(() => shipmentUnits(data.bills, data.invoices, data.today).filter((u) => u.group !== 'chegaram'), [data.bills, data.invoices, data.today]);
  const clearing = units.filter((u) => u.group === 'liberacao').length;
  const bySupplier = useMemo(() => totalsBySupplier(production, data.suppliers, seeValues), [production, data.suppliers, seeValues]);
  const byOrder = useMemo(
    () =>
      totalsByOrder(production, data.orders, data.suppliers, seeValues)
        .filter((o) => o.orderId !== null)
        .sort((a, b) => (b.valueCents ?? b.quantity) - (a.valueCents ?? a.quantity))
        .slice(0, 8),
    [production, data.orders, data.suppliers, seeValues],
  );
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);
  const top = (t: { valueCents?: number; quantity: number }) => (seeValues ? (t.valueCents ?? 0) : t.quantity);
  const max = Math.max(1, ...bySupplier.map(top));
  const maxOrder = Math.max(1, ...byOrder.map(top));
  const unitItems = (key: string) => {
    const unit = units.find((u) => u.key === key)!;
    const ids = new Set(unit.invoices.map((v) => v.id));
    return totals(
      data.items.filter((i) => i.invoiceId && ids.has(i.invoiceId)),
      seeValues,
    );
  };

  return (
    <>
      <section className="heroi" aria-label="Resumo">
        <div className="heroi-tres">
          <div className="heroi-bloco">
            <h2 className="heroi-rot">Em produção</h2>
            <b className="heroi-valor">{headline(inProduction)}</b>
            <span className="heroi-sub">
              {itemsCount(inProduction.items)}
              {seeValues && ` · ${formatQuantity(inProduction.quantity)} ex.`}
            </span>
          </div>
          <div className="heroi-bloco">
            <h2 className="heroi-rot">No mar</h2>
            <b className="heroi-valor">{headline(atSea)}</b>
            <span className="heroi-sub">
              {units.length === 1 ? '1 embarque a caminho' : `${units.length} embarques a caminho`}
              {clearing > 0 && <span className="alerta-texto"> · {clearing} em liberação</span>}
            </span>
          </div>
          {received && (
            <div className="heroi-bloco">
              <h2 className="heroi-rot">Recebido em {received.year}</h2>
              <b className="heroi-valor">{headline({ ...received.amount, unpriced: 0 })}</b>
              <span className="heroi-sub">
                {itemsCount(received.amount.items)}
                {seeValues && ` · ${formatQuantity(received.amount.quantity)} ex.`}
              </span>
            </div>
          )}
          {due && (
            <div className="heroi-bloco">
              <h2 className="heroi-rot">A pagar</h2>
              <b className="heroi-valor">{formatUsdWhole(due.dueCents)}</b>
              <span className="heroi-sub">{due.invoices ? `${due.invoices} ${due.invoices === 1 ? 'invoice' : 'invoices'}` : 'Tudo pago'}</span>
            </div>
          )}
        </div>
        {seeValues && inProduction.unpriced > 0 && (
          <p className="aviso alerta">
            <Icon name="alerta" />
            <span>
              {inProduction.unpriced} {inProduction.unpriced === 1 ? 'item em produção está sem preço e não entra' : 'itens em produção estão sem preço e não entram'} no total.
            </span>
          </p>
        )}
      </section>

      <div className="painel-grade">
        <section className="bloco">
          <div className="bloco-topo">
            <h2>Próximas chegadas</h2>
            <a className="btn-texto" href="#embarques">
              Ver embarques
            </a>
          </div>
          {units.length === 0 ? (
            <p className="vazio-lista">Nenhum embarque a caminho.</p>
          ) : (
            <ul className="lista">
              {units.slice(0, 7).map((u) => {
                const state = arrivalState(u.eta, u.arrivedAt, data.today);
                const t = unitItems(u.key);
                const suppliers = u.supplierIds.map((id) => (id ? (names.get(id) ?? NO_SUPPLIER) : NO_SUPPLIER)).join(', ');
                return (
                  <li key={u.key}>
                    <button type="button" className="chegada-linha" onClick={() => onShipment(u.key)}>
                      <span className={`chegada-dia ${state.kind}`}>
                        {u.eta ? (
                          <>
                            <b>{formatDay(u.eta).split(' ')[0]}</b>
                            <span>{formatDay(u.eta).split(' ')[1]}</span>
                          </>
                        ) : (
                          <b>?</b>
                        )}
                      </span>
                      <span className="chegada-meio">
                        <span className="barra-nome">{u.bill ? `BL ${u.bill.number}` : `Invoice ${u.invoices[0]?.number ?? ''}`}</span>
                        <span className="barra-sub">
                          {suppliers} · {u.invoices.length === 1 ? '1 invoice' : `${u.invoices.length} invoices`} · {formatQuantity(t.quantity)} ex.
                        </span>
                      </span>
                      <span className={`pilula chegada ${state.kind}`}>
                        {state.kind === 'liberacao' && <Icon name="alerta" />}
                        {arrivalText(state)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="bloco">
          <div className="bloco-topo">
            <h2>Produção por fornecedor</h2>
            <span className="mudo">{seeValues ? 'valor' : 'exemplares'}</span>
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
            <h2>POs maiores em produção</h2>
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
