// Ficha do produto (SPEC.md, seção 5): todas as compras de um produto desde 2023 (em produção,
// embarcadas e entregues), com fornecedor, PO ou invoice, quantidade e preço, e a variação do preço.
// Desde 27/11/2026, também os pedidos nas gráficas do Brasil com o mesmo ISBN.

import { useEffect, useState } from 'react';
import { dueText, formatBrl, formatBrlUnit, orderState, type ProductBrazilOrder } from '../core/brazil';
import { priceStats, purchaseDate } from '../core/history';
import { NO_SUPPLIER, STATUS_HUES, STATUS_LABELS, type Item, type Supplier } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd } from '../core/money';
import { formatDay } from '../core/shipments';
import { api, ApiError } from './api';
import { BRAZIL_HUE, Dialog, FormError, hueStyle } from './components';

type Product = Awaited<ReturnType<typeof api.product>>;

export function ProductDialog({ productId, suppliers, today, onClose }: { productId: string | null; suppliers: Supplier[]; today: string; onClose: () => void }) {
  const [data, setData] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    let alive = true;
    setData(null);
    setError(null);
    api
      .product(productId)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Não foi possível carregar o produto.'));
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!productId) return <Dialog title="Produto" open={false} onClose={onClose} />;
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const invoices = new Map((data?.invoices ?? []).map((v) => [v.id, v]));
  const orders = new Map((data?.orders ?? []).map((o) => [o.id, o.code]));
  const purchases = (data?.items ?? [])
    .map((item) => {
      const invoice = item.invoiceId ? invoices.get(item.invoiceId) : undefined;
      return { item, invoice, date: purchaseDate(item, invoice ? { arrivedAt: invoice.arrivedAt } : undefined) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const stats = data?.seeValues ? priceStats(purchases.map((p) => p.item)) : null;
  const totalQty = purchases.reduce((s, p) => s + p.item.quantity, 0);
  const where = (item: Item) => {
    const invoice = item.invoiceId ? invoices.get(item.invoiceId) : undefined;
    if (invoice) return `Invoice ${invoice.number}${invoice.billNumber ? ` · BL ${invoice.billNumber}` : ''}`;
    return item.purchaseOrderId ? (orders.get(item.purchaseOrderId) ?? '') : 'Sem PO';
  };

  return (
    <Dialog title={data?.product.title ?? 'Produto'} open onClose={onClose} wide className="dlg-produto">
      <div className="dlg-corpo">
        {error && <FormError message={error} />}
        {!data && !error && <p className="carregando" role="status">Carregando as compras…</p>}
        {data && (
          <>
            <p className="mudo">{data.product.isbn ? `ISBN ${data.product.isbn}` : 'Sem ISBN'}</p>
            <div className="prod-stats">
              <div>
                <b>{purchases.length}</b>
                <span>{purchases.length === 1 ? 'compra' : 'compras'}</span>
              </div>
              <div>
                <b>{formatQuantity(totalQty)}</b>
                <span>exemplares</span>
              </div>
              {stats && (
                <>
                  <div>
                    <b>{formatUnitPrice(stats.lastMicros)}</b>
                    <span>último preço</span>
                  </div>
                  <div>
                    <b>
                      {formatUnitPrice(stats.minMicros)} – {formatUnitPrice(stats.maxMicros).replace('US$ ', '')}
                    </b>
                    <span>menor e maior</span>
                  </div>
                  {stats.changePermille !== null && (
                    <div className={stats.changePermille > 0 ? 'sobe' : stats.changePermille < 0 ? 'desce' : undefined}>
                      <b>
                        {stats.changePermille > 0 ? '+' : ''}
                        {(stats.changePermille / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                      </b>
                      <span>da primeira para a última compra</span>
                    </div>
                  )}
                </>
              )}
            </div>
            {data.specification ? (
              <details className="conferir espec-produto" open>
                <summary>
                  Especificação
                  {data.specification.orderCode && <span className="mudo"> · da {data.specification.orderCode}</span>}
                </summary>
                <p>{data.specification.specification}</p>
              </details>
            ) : (
              <p className="dica">Sem especificação registrada. Ela vem da coluna Specifications da PO, no Novo pedido.</p>
            )}
            <div className="tabela-caixa resumo-caixa prod-caixa" tabIndex={0} role="region" aria-label="Compras do produto">
              <table className="tabela-produto">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Situação</th>
                    <th>Fornecedor</th>
                    <th>PO ou invoice</th>
                    <th className="num">Quantidade</th>
                    {data.seeValues && (
                      <>
                        <th className="num">Preço</th>
                        <th className="num">Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...purchases].reverse().map(({ item, date }) => (
                    <tr key={item.id}>
                      <td className="nowrap">{formatDay(date, true)}</td>
                      <td>
                        <span className="etapa-pilula h" style={hueStyle(STATUS_HUES[item.status])}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td className="nowrap">{item.supplierId ? (names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER}</td>
                      <td>
                        {where(item)}
                        {item.description !== data.product.title && <span className="t-isbn">{item.description}</span>}
                      </td>
                      <td className="num">{formatQuantity(item.quantity)}</td>
                      {data.seeValues && (
                        <>
                          <td className="num">{item.unitPriceMicros == null ? <span className="mudo">—</span> : formatUnitPrice(item.unitPriceMicros)}</td>
                          <td className="num">{item.totalCents == null ? <span className="mudo">—</span> : formatUsd(item.totalCents)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.brazil.length > 0 && <BrazilOrders orders={data.brazil} seeValues={data.seeValues} today={today} />}
          </>
        )}
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
}

/** Os pedidos do produto nas gráficas do Brasil, do mais novo para o mais antigo; o custo, só para quem vê valores. */
function BrazilOrders({ orders, seeValues, today }: { orders: ProductBrazilOrder[]; seeValues: boolean; today: string }) {
  return (
    <section className="prod-brasil" aria-label="Produção no Brasil">
      <h3>Produção no Brasil</h3>
      <div className="tabela-caixa resumo-caixa prod-caixa" tabIndex={0} role="region" aria-label="Pedidos nas gráficas do Brasil">
        <table className="tabela-produto tabela-produto-br">
          <thead>
            <tr>
              <th>Pedido em</th>
              <th>Gráfica</th>
              <th>Situação</th>
              <th className="num">Entregue</th>
              {seeValues && (
                <>
                  <th className="num">Custo por ex.</th>
                  <th className="num">Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[...orders].reverse().map((o) => {
              const state = orderState(o, today);
              const due = dueText(state, o.dueAt, today);
              return (
                <tr key={o.id}>
                  <td className="nowrap">{formatDay(o.orderedAt, true)}</td>
                  <td>{o.printer}</td>
                  <td>
                    <span className="etapa-pilula h" style={hueStyle(state.stage === 'entregue' ? STATUS_HUES.entregue : BRAZIL_HUE)}>
                      {state.stage === 'entregue' ? 'Entregue' : state.stage === 'parcial' ? 'Entregue em parte' : 'Em produção'}
                    </span>
                    <span className={state.late ? 't-isbn alerta-texto' : 't-isbn'}>
                      {state.stage === 'entregue' ? `em ${formatDay(state.finishedAt!, true)}` : due.charAt(0).toLowerCase() + due.slice(1)}
                    </span>
                  </td>
                  <td className="num nowrap">
                    {formatQuantity(state.delivered)} de {formatQuantity(o.quantity)}
                  </td>
                  {seeValues && (
                    <>
                      <td className="num">{o.totalCents === null ? <span className="mudo">—</span> : formatBrlUnit(Math.round((o.totalCents * 100) / o.quantity))}</td>
                      <td className="num">{o.totalCents === null ? <span className="mudo">—</span> : formatBrl(o.totalCents)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
