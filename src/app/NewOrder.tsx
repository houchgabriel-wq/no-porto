// Nova PO pelo sistema (pedido do Gabriel em 24/11/2026; SPEC.md, seção 3): o fornecedor, o número
// (sugerido: o seguinte ao maior), a data e os produtos, escolhidos entre os que já tiveram PO e os
// títulos da curva ABC. O preço, as peças por caixa e a especificação vêm da última compra, e dá para
// mudar. Ao criar, o sistema grava a PO (o mesmo POST do Novo pedido) e baixa o Excel no modelo da
// editora, para mandar ao fornecedor. Só admin e editor.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { parseQuantity } from '../core/documents';
import { normalizeOrderCode } from '../core/items';
import { formatQuantity, formatUsd, parseUnitPrice, unitPriceInput } from '../core/money';
import {
  newOrderProblem,
  nextOrderCode,
  orderFileName,
  orderItems,
  orderSender,
  orderSheet,
  orderTotals,
  SHRINK_WRAP_DEFAULT,
  type CatalogEntry,
  type LastPurchase,
  type NewOrder,
} from '../core/newOrder';
import { formatDay } from '../core/shipments';
import { api, ApiError, type Me, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { downloadXlsx } from './download';
import { Icon } from './icons';
import type { Production } from './production';

interface LineDraft {
  key: number;
  product: string;
  isbn: string;
  specification: string;
  shrinkWrap: string;
  pieces: string;
  quantity: string;
  price: string;
  comment: string;
  shipDate: string;
  /** De onde veio o produto escolhido: com a última compra, só da curva, ou digitado. */
  source: CatalogEntry['source'] | null;
  last: LastPurchase | null;
}

let nextKey = 1;
const emptyLine = (): LineDraft => ({
  key: nextKey++,
  product: '',
  isbn: '',
  specification: '',
  shrinkWrap: SHRINK_WRAP_DEFAULT,
  pieces: '',
  quantity: '',
  price: '',
  comment: '',
  shipDate: '',
  source: null,
  last: null,
});

/** O texto de cada produto na lista de sugestões: o nome e, se tiver, o código de barras. */
const optionValue = (e: CatalogEntry) => (e.isbn ? `${e.title} · ${e.isbn}` : e.title);

const isBlank = (l: LineDraft) => !l.product.trim() && !l.quantity.trim() && !l.price.trim() && !l.isbn.trim();

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Não foi possível criar a PO. Tente de novo.';
}

/** Os rascunhos viram a PO: o que não dá para ler fica como NaN, e a conferência avisa. */
function toOrder(head: { code: string; supplier: string; date: string; from: string }, lines: readonly LineDraft[]): NewOrder {
  return {
    ...head,
    lines: lines
      .filter((l) => !isBlank(l))
      .map((l) => ({
        description: l.product,
        isbn: l.isbn.trim() || null,
        specification: l.specification,
        shrinkWrap: l.shrinkWrap,
        piecesPerCarton: l.pieces.trim() ? (parseQuantity(l.pieces) ?? Number.NaN) : null,
        quantity: parseQuantity(l.quantity) ?? Number.NaN,
        unitPriceMicros: l.price.trim() ? (parseUnitPrice(l.price) ?? Number.NaN) : null,
        comment: l.comment,
        shipDate: l.shipDate || null,
      })),
  };
}

export function NewOrderDialog({
  open,
  data,
  me,
  production,
  onClose,
  onDone,
}: {
  open: boolean;
  data: ProductionData;
  me: Me;
  production: Production;
  onClose: () => void;
  onDone: (msg: string, orderId: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [supplier, setSupplier] = useState('');
  const [code, setCode] = useState('');
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { supplier: useId(), code: useId(), date: useId(), from: useId(), products: useId(), suppliers: useId(), wrap: useId() };

  // Ao abrir: o número seguinte, hoje, quem cria e uma linha vazia; o catálogo vem do servidor.
  useEffect(() => {
    if (!open) return;
    setSupplier('');
    setCode(nextOrderCode(data.orders.map((o) => o.code)));
    setDate(data.today);
    setFrom(orderSender(me.name));
    setLines([emptyLine()]);
    setError(null);
    setBusy(false);
    setCatalogError(null);
    let alive = true;
    api
      .poCatalog()
      .then((res) => alive && setCatalog(res.products))
      .catch((e) => alive && setCatalogError(e instanceof ApiError ? e.message : 'Não foi possível carregar os produtos.'));
    return () => {
      alive = false;
    };
    // Só ao abrir: os dados que se atualizam sozinhos não apagam o que a pessoa já preencheu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options = useMemo(() => new Map((catalog ?? []).map((e) => [optionValue(e), e])), [catalog]);
  const order = toOrder({ code, supplier, date, from }, lines);
  const totals = orderTotals(order.lines.map((l) => ({ quantity: l.quantity, unitPriceMicros: Number.isNaN(l.unitPriceMicros) ? null : l.unitPriceMicros })));
  const filled = order.lines.length;

  const update = (key: number, change: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  /** Ao escolher um produto da lista: o nome, o código e o que veio da última compra. */
  function pickProduct(key: number, value: string) {
    const entry = options.get(value);
    if (!entry) return update(key, { product: value, source: null, last: null });
    update(key, {
      product: entry.title,
      isbn: entry.isbn ?? '',
      source: entry.source,
      last: entry.last,
      price: unitPriceInput(entry.last?.unitPriceMicros ?? null),
      pieces: entry.last?.piecesPerCarton ? String(entry.last.piecesPerCarton) : '',
      specification: entry.last?.specification ?? '',
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = newOrderProblem(order, data.orders.map((o) => o.code));
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeOrderCode(order.code)!;
      // O arquivo é montado antes de gravar: se der erro, nada foi gravado.
      const { buildOrderFile } = await import('./spreadsheet');
      const file = await buildOrderFile(orderSheet(order));
      const res = await production.write(() => api.createOrder({ code: normalized, supplier: order.supplier.trim(), orderedAt: order.date, items: orderItems(order) }));
      downloadXlsx(file, orderFileName(order));
      onDone(`${normalized} criada: ${res.inserted} ${res.inserted === 1 ? 'item' : 'itens'} em produção. O Excel da PO foi baixado para mandar ao fornecedor.`, res.orderId);
      onClose();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Nova PO" open={open} onClose={onClose} wide className="dlg-po">
      <form onSubmit={submit} noValidate>
        <div className="dlg-corpo">
          <p className="dica-texto">
            Monte a PO aqui: o sistema cadastra os itens em produção e baixa o Excel no modelo da editora, para mandar ao fornecedor. Ao escolher um produto que já foi
            comprado, o preço, as peças por caixa e a especificação vêm da última compra; confira antes de criar.
          </p>
          <div className="grade-campos po-topo">
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.supplier}>
                Fornecedor
              </label>
              <input id={ids.supplier} className="campo" list={ids.suppliers} value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off" required />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.code}>
                Número da PO
              </label>
              <input id={ids.code} className="campo" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.date}>
                Data
              </label>
              <input id={ids.date} className="campo" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.from}>
                De (From)
              </label>
              <input id={ids.from} className="campo" value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="off" />
            </div>
          </div>

          {catalogError ? (
            <p className="aviso alerta">
              <Icon name="alerta" />
              <span>{catalogError} Dá para digitar os produtos assim mesmo.</span>
            </p>
          ) : (
            !catalog && <p className="mudo">Carregando os produtos…</p>
          )}

          <ol className="po-linhas">
            {lines.map((l, i) => (
              <li key={l.key}>
                <OrderLine
                  line={l}
                  n={i + 1}
                  productsList={ids.products}
                  wrapList={ids.wrap}
                  onChange={(change) => update(l.key, change)}
                  onProduct={(value) => pickProduct(l.key, value)}
                  onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined}
                />
              </li>
            ))}
          </ol>
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Icon name="mais" />
            Adicionar produto
          </button>

          <p className="sol-total po-total" aria-live="polite">
            Total: <b>{filled === 1 ? '1 produto' : `${filled} produtos`}</b> · <b>{formatQuantity(totals.quantity)} ex.</b> · <b>{formatUsd(totals.cents)}</b>
          </p>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            <Icon name="arquivo" />
            {busy ? 'Criando…' : 'Criar PO e baixar o Excel'}
          </button>
        </div>
      </form>
      <datalist id={ids.products}>
        {(catalog ?? []).map((e) => (
          <option key={optionValue(e)} value={optionValue(e)} label={e.last?.orderCode ? `última: ${e.last.orderCode}` : e.source === 'curva' ? 'curva ABC' : undefined} />
        ))}
      </datalist>
      <datalist id={ids.suppliers}>
        {data.suppliers.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <datalist id={ids.wrap}>
        <option value="YES" />
        <option value="NO" />
        <option value="blister" />
      </datalist>
    </Dialog>
  );
}

function OrderLine({
  line: l,
  n,
  productsList,
  wrapList,
  onChange,
  onProduct,
  onRemove,
}: {
  line: LineDraft;
  n: number;
  productsList: string;
  wrapList: string;
  onChange: (change: Partial<LineDraft>) => void;
  onProduct: (value: string) => void;
  onRemove?: () => void;
}) {
  const ids = { product: useId(), isbn: useId(), quantity: useId(), price: useId(), pieces: useId(), wrap: useId(), ship: useId(), spec: useId(), comment: useId() };
  const quantity = parseQuantity(l.quantity);
  const price = l.price.trim() ? parseUnitPrice(l.price) : null;
  const amount = quantity && price ? orderTotals([{ quantity, unitPriceMicros: price }]).cents : null;
  return (
    <fieldset className="po-linha">
      <legend className="po-linha-n">Produto {n}</legend>
      {onRemove && (
        <button type="button" className="btn sol-tirar po-tirar" onClick={onRemove} aria-label={`Tirar o produto ${n}`}>
          <Icon name="lixeira" />
        </button>
      )}
      <div className="grupo">
        <label className="rotulo" htmlFor={ids.product}>
          Produto
        </label>
        <input
          id={ids.product}
          className="campo"
          list={productsList}
          value={l.product}
          onChange={(e) => onProduct(e.target.value)}
          placeholder="Busque pelo nome ou pelo ISBN"
          autoComplete="off"
          aria-describedby={`${ids.product}-dica`}
        />
        <span id={`${ids.product}-dica`} className="dica">
          {l.last
            ? `Última compra: ${[l.last.orderCode, l.last.supplierName, formatDay(l.last.createdAt.slice(0, 10), true)].filter(Boolean).join(' · ')}. Preço, caixa e especificação vieram dela.`
            : l.source === 'curva'
              ? 'Da curva ABC: ainda sem compra no No Porto.'
              : l.product.trim()
                ? 'Produto novo: informe o ISBN, se tiver.'
                : 'Os que já tiveram PO e os títulos da curva ABC.'}
        </span>
      </div>
      <div className="grade-campos po-numeros">
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.isbn}>
            ISBN
          </label>
          <input id={ids.isbn} className="campo" inputMode="numeric" value={l.isbn} onChange={(e) => onChange({ isbn: e.target.value })} autoComplete="off" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.quantity}>
            Quantidade
          </label>
          <input id={ids.quantity} className="campo num" inputMode="numeric" value={l.quantity} onChange={(e) => onChange({ quantity: e.target.value })} autoComplete="off" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.price}>
            Preço (US$)
          </label>
          <input id={ids.price} className="campo num" inputMode="decimal" value={l.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="0,270" autoComplete="off" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.pieces}>
            Peças por caixa
          </label>
          <input id={ids.pieces} className="campo num" inputMode="numeric" value={l.pieces} onChange={(e) => onChange({ pieces: e.target.value })} autoComplete="off" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.wrap}>
            Shrink wrap?
          </label>
          <input id={ids.wrap} className="campo" list={wrapList} value={l.shrinkWrap} onChange={(e) => onChange({ shrinkWrap: e.target.value })} autoComplete="off" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.ship}>
            Envio previsto
          </label>
          <input id={ids.ship} className="campo" type="date" value={l.shipDate} onChange={(e) => onChange({ shipDate: e.target.value })} />
        </div>
      </div>
      <div className="grade-campos po-textos">
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.spec}>
            Especificação
          </label>
          <textarea id={ids.spec} className="campo" rows={3} value={l.specification} onChange={(e) => onChange({ specification: e.target.value })} placeholder="Formato, papel, acabamento" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={ids.comment}>
            Comentário
          </label>
          <textarea
            id={ids.comment}
            className="campo"
            rows={3}
            value={l.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            placeholder="New order: RUSH – ship by 16-Dec-2026 (out of stock)."
            aria-describedby={`${ids.comment}-dica`}
          />
          <span id={`${ids.comment}-dica`} className="dica">
            Em inglês, como vai ao fornecedor. "Ship in 2 lots: 15,000 pcs by … / 15,000 pcs by …" vira a programação de envio.
          </span>
        </div>
      </div>
      <p className="po-valor">{amount !== null ? <>Valor: <b>{formatUsd(amount)}</b></> : <span className="mudo">Sem preço: o fornecedor cota.</span>}</p>
    </fieldset>
  );
}
