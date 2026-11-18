// Ficha do produto (SPEC.md, seção 5): todas as compras de um produto desde 2023 (em produção,
// embarcadas e entregues), com fornecedor, PO ou invoice, quantidade e preço, e a variação do preço.

import { useEffect, useState } from 'react';
import { priceStats, purchaseDate } from '../core/history';
import { NO_SUPPLIER, STATUS_HUES, STATUS_LABELS, type Item, type Supplier } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd } from '../core/money';
import { formatDay } from '../core/shipments';
import { api, ApiError } from './api';
import { Dialog, FormError, hueStyle } from './components';

type Product = Awaited<ReturnType<typeof api.product>>;

export function ProductDialog({ productId, suppliers, onClose }: { productId: string | null; suppliers: Supplier[]; onClose: () => void }) {
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
