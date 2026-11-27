// Produção › Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do Brasil,
// com as propostas lado a lado (os itens que a gráfica cobra, o papel da gráfica ou o nosso, pela tabela de papéis,
// o custo por unidade e o PDF), os pedidos em produção e as entregas no estoque, em uma ou mais partes. Admin e
// editor lançam; Consulta vê tudo; o leitor vê sem os valores (o servidor não manda os preços nem o PDF).

import { Fragment, useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  bestOffer,
  boxProduct,
  brazilSummary,
  brlTotalCents,
  brlUnitInput,
  countedProducts,
  formatBrl,
  formatBrlUnit,
  formatKg,
  kgInput,
  matchesBrazil,
  offerCost,
  offerExpiry,
  orderState,
  orderStateText,
  orderTotalCents,
  PAPER_PART_LABELS,
  PAPER_PARTS,
  paperCostCents,
  parseBrlUnitPrice,
  parseKgGrams,
  productStates,
  quoteProductsProblem,
  type BrOrder,
  type Offer,
  type OfferCost,
  type Paper,
  type PaperBy,
  type PaperPart,
  type Quote,
  type QuoteProduct,
} from '../core/brazil';
import { searchKey } from '../core/items';
import { matchItemsToProducts, matchPaper, matchPrinter, paperDisplayName, productsFromItems, specificationFromItems } from '../core/proposalPdf';
import type { CatalogEntry } from '../core/newOrder';
import { formatQuantity } from '../core/money';
import { can } from '../core/roles';
import { formatDay, spDate } from '../core/shipments';
import { api, ApiError, type BrazilData, type Me, type OfferInput, type QuoteInput, type QuoteProductInput } from './api';
import { Dialog, FormError } from './components';
import { MAX_FILE_BYTES, toBase64 } from './fileUpload';
import { Icon } from './icons';
import { readProposalFile, type ProposalFile } from './proposalFile';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Quantidade digitada ("5000", "5.000"); null se não for um número inteiro positivo. */
function parseCopies(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(t)) return null;
  const n = Number(t.replace(/\./g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type DialogState =
  | { kind: 'quote'; quote?: Quote }
  | { kind: 'offer'; quoteId: string; offer?: Offer; pdf?: ProposalFile }
  | { kind: 'close'; quote: Quote; offer: Offer }
  | { kind: 'delivery'; order: BrOrder }
  | { kind: 'due'; order: BrOrder }
  | { kind: 'papers' }
  | null;

/** Gravar e recarregar; devolve o erro para a janela mostrar, ou null quando deu certo. `keepOpen` não fecha a janela. */
type Submit = (action: () => Promise<unknown>, done: string, keepOpen?: boolean) => Promise<string | null>;

/** `initialQuery`: a busca já preenchida, quando a sub-aba abre por um pedido do painel ou pelo terminal de consulta. */
export function BrazilView({ me, onToast, initialQuery = '' }: { me: Me; onToast: (msg: string) => void; initialQuery?: string }) {
  const [data, setData] = useState<BrazilData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [dialog, setDialog] = useState<DialogState>(null);
  const canEdit = can(me.role, 'edit');

  const reload = useCallback(async () => {
    try {
      setData(await api.brazil());
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e, 'Não foi possível carregar a produção no Brasil.'));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const submit: Submit = async (action, done, keepOpen) => {
    try {
      await action();
      await reload();
      onToast(done);
      if (!keepOpen) setDialog(null);
      return null;
    } catch (e) {
      return message(e, 'Não foi possível salvar.');
    }
  };
  /** As ações direto no cartão: o erro aparece no topo. */
  const act = async (action: () => Promise<unknown>, done: string) => {
    setActionError(await submit(action, done));
  };

  const printers = useMemo(() => new Map((data?.printers ?? []).map((p) => [p.id, p.name])), [data]);
  if (loadError) return <FormError message={loadError} />;
  if (!data) return <p className="dica-texto">Carregando a produção no Brasil…</p>;

  const today = data.today;
  const summary = brazilSummary(data.quotes, data.orders, today);
  const printerNames = (ids: string[]) => ids.map((id) => printers.get(id) ?? '');
  const quotes = data.quotes.filter((q) => matchesBrazil(query, { title: q.title, isbn: q.isbn, printers: printerNames(q.offers.map((o) => o.printerId)), products: q.products }));
  const orders = data.orders.filter((o) => matchesBrazil(query, { title: o.title, isbn: o.isbn, printers: printerNames([o.printerId]), products: o.products }));
  const open = quotes.filter((q) => q.status === 'aberto');
  const closedQuotes = quotes.filter((q) => q.status !== 'aberto');
  const states = new Map(orders.map((o) => [o.id, orderState(o, today)]));
  const producing = orders
    .filter((o) => states.get(o.id)!.stage !== 'entregue')
    .sort((a, b) => Number(states.get(b.id)!.late) - Number(states.get(a.id)!.late) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  const delivered = orders.filter((o) => states.get(o.id)!.stage === 'entregue').sort((a, b) => states.get(b.id)!.finishedAt!.localeCompare(states.get(a.id)!.finishedAt!));
  const ctx: Ctx = { data, printers, canEdit, today, setDialog, act };
  // Cada janela fecha só a si mesma: o "close" do <dialog> chega depois, e não pode fechar a que abriu em seguida
  // (a proposta que abre ao cadastrar o orçamento começado pelo PDF).
  const closeKind = (kind: NonNullable<DialogState>['kind']) => () => setDialog((d) => (d?.kind === kind ? null : d));
  // A proposta abre pelo orçamento atual (o recém-cadastrado também, depois de recarregar).
  const offerQuote = dialog?.kind === 'offer' ? data.quotes.find((q) => q.id === dialog.quoteId) : undefined;
  const offerState = dialog?.kind === 'offer' && offerQuote ? { quote: offerQuote, offer: dialog.offer, pdf: dialog.pdf } : null;
  const empty = data.quotes.length === 0 && data.orders.length === 0;

  return (
    <>
      <section className="emb-faixa br-faixa" aria-label="Resumo da produção no Brasil">
        <div className="emb-total">
          <span className="forn-rot">Em produção no Brasil</span>
          <b>{formatQuantity(summary.producing.copies)} ex.</b>
          <span className="forn-sub">
            {summary.producing.orders === 1 ? '1 pedido' : `${summary.producing.orders} pedidos`}
            {summary.producing.valueCents !== null && ` · ${formatBrl(summary.producing.valueCents)}`}
          </span>
        </div>
        <div className="emb-stat">
          <span className="stat-ic">
            <Icon name="balao" />
          </span>
          <div>
            <b>{summary.openQuotes}</b>
            <span>{summary.openQuotes === 1 ? 'orçamento aberto' : 'orçamentos abertos'}</span>
          </div>
        </div>
        <div className={`emb-stat${summary.late ? ' alerta' : ''}`}>
          <span className="stat-ic">
            <Icon name="alerta" />
          </span>
          <div>
            <b>{summary.late}</b>
            <span>{summary.late === 1 ? 'pedido atrasado' : 'pedidos atrasados'}</span>
          </div>
        </div>
        <div className="emb-stat ok">
          <span className="stat-ic">
            <Icon name="check" />
          </span>
          <div>
            <b>{formatQuantity(summary.deliveredLast30)} ex.</b>
            <span>entregues nos últimos 30 dias</span>
          </div>
        </div>
      </section>

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input className="campo" type="search" placeholder="Buscar produto, ISBN ou gráfica" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {canEdit && (
          <div className="filtros-acoes">
            <button type="button" className="btn" onClick={() => setDialog({ kind: 'papers' })}>
              <Icon name="tabela" />
              Papéis
            </button>
            <button type="button" className="btn primario" onClick={() => setDialog({ kind: 'quote' })}>
              <Icon name="mais" />
              Novo orçamento
            </button>
          </div>
        )}
      </div>
      <FormError message={actionError} />

      {empty ? (
        <div className="bloco tabela-vazia">
          {canEdit ? 'Nenhum orçamento ainda. Use "Novo orçamento" para cadastrar o primeiro, com as propostas das gráficas.' : 'Nenhum orçamento ainda.'}
        </div>
      ) : (
        <>
          <section className="emb-grupo" aria-labelledby="br-orcamentos">
            <div className="emb-grupo-topo">
              <h2 id="br-orcamentos">Orçamentos abertos</h2>
              <span className="mudo">{open.length === 1 ? '1 orçamento' : `${open.length} orçamentos`}</span>
            </div>
            {open.length === 0 ? <p className="dica-texto">{query ? 'Nenhum orçamento aberto com esta busca.' : 'Nenhum orçamento aberto.'}</p> : open.map((q) => <QuoteCard key={q.id} quote={q} ctx={ctx} />)}
          </section>

          <section className="emb-grupo" aria-labelledby="br-producao">
            <div className="emb-grupo-topo">
              <h2 id="br-producao">Em produção no Brasil</h2>
              <span className="mudo">{producing.length === 1 ? '1 pedido' : `${producing.length} pedidos`}</span>
            </div>
            {producing.length === 0 ? (
              <p className="dica-texto">{query ? 'Nenhum pedido em produção com esta busca.' : 'Nenhum pedido em produção. Feche um orçamento para o pedido aparecer aqui.'}</p>
            ) : (
              <ul className="br-grade">
                {producing.map((o) => (
                  <li key={o.id}>
                    <OrderCard order={o} ctx={ctx} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {delivered.length > 0 && (
            <details className="emb-grupo chegaram">
              <summary>
                <h2>Entregues</h2>
                <span className="mudo">{delivered.length === 1 ? '1 pedido' : `${delivered.length} pedidos`}</span>
              </summary>
              <ul className="br-grade">
                {delivered.map((o) => (
                  <li key={o.id}>
                    <OrderCard order={o} ctx={ctx} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {closedQuotes.length > 0 && (
            <details className="emb-grupo chegaram">
              <summary>
                <h2>Orçamentos fechados e cancelados</h2>
                <span className="mudo">{closedQuotes.length === 1 ? '1 orçamento' : `${closedQuotes.length} orçamentos`}</span>
              </summary>
              {closedQuotes.map((q) => (
                <QuoteCard key={q.id} quote={q} ctx={ctx} />
              ))}
            </details>
          )}
        </>
      )}

      {canEdit && (
        <>
          <QuoteDialog
            state={dialog?.kind === 'quote' ? dialog : null}
            onClose={closeKind('quote')}
            submit={submit}
            onCreatedWithPdf={(quoteId, pdf) => setDialog({ kind: 'offer', quoteId, pdf })}
          />
          <OfferDialog state={offerState} printers={printers} papers={data.papers} onClose={closeKind('offer')} submit={submit} />
          <PapersDialog open={dialog?.kind === 'papers'} papers={data.papers} onClose={closeKind('papers')} submit={submit} />
          <CloseDialog state={dialog?.kind === 'close' ? dialog : null} printers={printers} today={today} onClose={closeKind('close')} submit={submit} />
          <DeliveryDialog state={dialog?.kind === 'delivery' ? dialog : null} printers={printers} today={today} onClose={closeKind('delivery')} submit={submit} />
          <DueDialog state={dialog?.kind === 'due' ? dialog : null} onClose={closeKind('due')} submit={submit} />
        </>
      )}
    </>
  );
}

interface Ctx {
  data: BrazilData;
  printers: Map<string, string>;
  canEdit: boolean;
  today: string;
  setDialog: (d: DialogState) => void;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}

/** O orçamento com as propostas das gráficas lado a lado; a de menor preço por exemplar fica em destaque. */
function QuoteCard({ quote: q, ctx }: { quote: Quote; ctx: Ctx }) {
  const ids = useId();
  const { data, printers, canEdit, today, setDialog, act } = ctx;
  const open = q.status === 'aberto';
  const many = q.products.length > 1;
  const best = open ? bestOffer(q.offers, q.products) : null;
  const order = q.orderId ? data.orders.find((o) => o.id === q.orderId) : undefined;
  const chosen = order?.offerId ?? null;
  return (
    <article className={`br-cartao br-orcamento ${q.status}`} aria-labelledby={`${ids}-t`}>
      <div className="br-topo">
        <h3 id={`${ids}-t`} className="br-titulo">
          {q.title}
        </h3>
        <span className={`pilula br-situacao ${q.status}`}>{q.status === 'aberto' ? 'Orçamento aberto' : q.status === 'fechado' ? 'Fechado' : 'Cancelado'}</span>
      </div>
      <p className="br-meta">
        {!many && `${q.products[0]?.isbn ?? q.isbn ?? 'Sem ISBN'} · ${formatQuantity(q.products[0]?.quantity ?? q.quantity)} ex. · `}
        {many && `${q.products.length} produtos · `}
        {q.createdBy ? `cadastrado por ${q.createdBy} ` : 'cadastrado '}em {formatDay(spDate(new Date(q.createdAt)), true)}
      </p>
      {many && <ProductList products={q.products} />}
      {q.specification && <Specification text={q.specification} />}
      {q.notes && <p className="br-obs">{q.notes}</p>}
      {q.offers.length === 0 ? (
        <p className="mudo br-sem">Nenhuma proposta ainda.</p>
      ) : (
        <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label={`Propostas para ${q.title}`}>
          <table className="tabela-resumo br-propostas tabela-empilha">
            <thead>
              <tr>
                <th>Gráfica</th>
                <th className="num">Quantidade</th>
                {data.seeValues ? (
                  <>
                    <th className="num">Gráfica cobra</th>
                    <th className="num">Papel nosso</th>
                    <th className="num">{many ? 'Custo' : 'Por unidade'}</th>
                  </>
                ) : (
                  <th>Papel</th>
                )}
                <th className="num">Prazo</th>
                {canEdit && open && (
                  <th>
                    <span className="so-leitor">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {q.offers.map((o) => {
                const name = printers.get(o.printerId) ?? 'Gráfica';
                const cost = offerCost(o, q.products);
                const expiry = offerExpiry(o, today);
                const productName = (id: string | null) => (many ? (q.products.find((p) => p.id === id)?.title ?? 'Sem produto') : null);
                const proposal = [
                  o.proposalNumber && `Proposta ${o.proposalNumber}`,
                  o.proposalDate && `de ${formatDay(o.proposalDate, true)}`,
                  expiry && `vale até ${formatDay(expiry.until, true)}`,
                  o.paymentTerms && `pagamento ${o.paymentTerms}`,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <tr key={o.id} className={o.id === best?.id || o.id === chosen ? 'br-destaque' : undefined}>
                    <td>
                      <b>{name}</b>
                      {o.id === best?.id && q.offers.length > 1 && <span className="pilula ok br-selo">Menor custo</span>}
                      {o.id === chosen && <span className="pilula ok br-selo">Escolhida</span>}
                      {open && expiry?.expired && <span className="pilula alerta br-selo">Vencida</span>}
                      <span className="t-isbn">
                        {o.items.map((i) => `${productName(i.productId) ?? i.description}: ${formatQuantity(i.quantity)}${i.unitPriceE4 !== null ? ` × ${formatBrlUnit(i.unitPriceE4)}` : ''}`).join(' · ')}
                      </span>
                      {proposal && <span className="t-isbn">{proposal}</span>}
                      {o.notes && <span className="t-isbn">{o.notes}</span>}
                      {o.document && (
                        <a className="br-pdf" href={`/api/brasil/offers/${encodeURIComponent(o.id)}/document`} download={o.document.name}>
                          <Icon name="arquivo" />
                          {o.document.name}
                        </a>
                      )}
                    </td>
                    <td className="num" data-rot="Quantidade">
                      {formatQuantity(o.quantity)}
                    </td>
                    {data.seeValues ? (
                      <>
                        <td className="num" data-rot="Gráfica cobra">
                          {cost ? formatBrl(cost.printerCents) : '—'}
                        </td>
                        <td className="num" data-rot="Papel nosso">
                          {o.paperBy === 'grafica' ? <span className="mudo">da gráfica</span> : cost ? formatBrl(cost.paperCents) : '—'}
                          {o.paperBy === 'editora' &&
                            o.papers.map((pl, k) => (
                              <span key={k} className="t-isbn">
                                {PAPER_PART_LABELS[pl.part]}: {pl.paperName}, {formatKg(pl.grams)}
                                {pl.pricePerKgE4 !== null && ` × ${formatBrlUnit(pl.pricePerKgE4)}/kg`}
                              </span>
                            ))}
                        </td>
                        <td className="num br-custo-celula" data-rot={many ? 'Custo' : 'Por unidade'}>
                          {!cost ? (
                            '—'
                          ) : many ? (
                            <>
                              <CostLines cost={cost} products={q.products} />
                              <span className="t-isbn">total {formatBrl(cost.totalCents)}</span>
                            </>
                          ) : (
                            <>
                              <b>{formatBrlUnit(cost.unitCostE4)}</b>
                              <span className="t-isbn">total {formatBrl(cost.totalCents)}</span>
                            </>
                          )}
                        </td>
                      </>
                    ) : (
                      <td data-rot="Papel">{o.paperBy === 'grafica' ? 'da gráfica' : 'nosso'}</td>
                    )}
                    <td className="num" data-rot="Prazo">
                      {o.leadDays === null ? '—' : o.leadDays === 1 ? '1 dia' : `${o.leadDays} dias`}
                    </td>
                    {canEdit && open && (
                      <td className="br-prop-acoes">
                        <button type="button" className="btn primario br-fechar" onClick={() => setDialog({ kind: 'close', quote: q, offer: o })}>
                          Fechar com esta
                          <span className="so-leitor"> proposta da {name}</span>
                        </button>
                        <button type="button" className="btn-texto" onClick={() => setDialog({ kind: 'offer', quoteId: q.id, offer: o })}>
                          Alterar
                          <span className="so-leitor"> a proposta da {name}</span>
                        </button>
                        <button type="button" className="btn-texto" onClick={() => void act(() => api.deleteOffer(o.id), `Proposta da ${name} tirada.`)}>
                          Tirar
                          <span className="so-leitor"> a proposta da {name}</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && open && (
        <div className="br-acoes">
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'offer', quoteId: q.id })}>
            <Icon name="mais" />
            Adicionar proposta
          </button>
          <button type="button" className="btn-texto" onClick={() => setDialog({ kind: 'quote', quote: q })}>
            Alterar o orçamento
          </button>
          <button type="button" className="btn-texto perigo" onClick={() => void act(() => api.updateQuote(q.id, { status: 'cancelado' }), 'Orçamento cancelado. Dá para reabrir em "Orçamentos fechados e cancelados".')}>
            Cancelar o orçamento
          </button>
        </div>
      )}
      {canEdit && q.status === 'cancelado' && (
        <div className="br-acoes">
          <button type="button" className="btn-texto" onClick={() => void act(() => api.updateQuote(q.id, { status: 'aberto' }), 'Orçamento reaberto.')}>
            Reabrir o orçamento
          </button>
        </div>
      )}
    </article>
  );
}

/** O pedido na gráfica: a situação, o que já chegou e o que falta, e as entregas. */
function OrderCard({ order: o, ctx }: { order: BrOrder; ctx: Ctx }) {
  const ids = useId();
  const { data, printers, canEdit, today, setDialog, act } = ctx;
  const s = orderState(o, today);
  const printer = printers.get(o.printerId) ?? 'Gráfica';
  const total = orderTotalCents(o);
  const counted = countedProducts(o);
  const many = o.products.length > 1;
  const countedQty = counted.reduce((n, p) => n + p.quantity, 0);
  const pct = Math.min(100, Math.round((s.delivered / Math.max(1, countedQty)) * 100));
  // No kit, o custo por kit: o box e o que vai dentro dele, pela quantidade de boxes.
  const box = boxProduct(o.products);
  const kitCents = box ? [box, ...o.products.filter((p) => p.inBox)].reduce<number | null>((n, p) => (n === null || p.costCents === null ? null : n + p.costCents), 0) : null;
  // As entregas registradas juntas (o box e o avulso no mesmo dia) aparecem numa linha só.
  const groups = [...new Map(o.deliveries.map((d) => [d.groupId, o.deliveries.filter((x) => x.groupId === d.groupId)])).values()];
  const nameOf = (productId: string | null) => o.products.find((p) => p.id === productId)?.title ?? '';
  return (
    <article className={`br-cartao br-pedido estado-${s.late ? 'atrasado' : s.stage}`} aria-labelledby={`${ids}-t`}>
      <div className="br-topo">
        <h3 id={`${ids}-t`} className="br-titulo">
          {o.title}
        </h3>
        <span className={`pilula br-estado ${s.late ? 'atrasado' : s.stage}`}>
          {s.late && <Icon name="alerta" />}
          {orderStateText(s, o.dueAt, today)}
        </span>
      </div>
      <p className="br-meta">
        <b>{printer}</b> · {many ? `${o.products.length} produtos` : (o.isbn ?? 'Sem ISBN')} · fechado em {formatDay(o.orderedAt, true)}
        {o.dueAt && s.stage !== 'entregue' && ` · entrega prevista em ${formatDay(o.dueAt, true)}`}
        {s.finishedAt && ` · entregue em ${formatDay(s.finishedAt, true)}`}
      </p>
      <div className="br-progresso">
        <span className="br-barra" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span>
          {formatQuantity(s.delivered)} de {formatQuantity(countedQty)} ex. entregues
          {s.remaining > 0 && ` · faltam ${formatQuantity(s.remaining)}`}
        </span>
      </div>
      {many && <ProductList products={o.products} states={productStates(o)} />}
      {data.seeValues && total !== null && (
        <p className="br-valor">
          {box && kitCents !== null
            ? `${formatBrlUnit(Math.round((kitCents * 100) / box.quantity))} por kit · `
            : !many && `${formatBrlUnit(Math.round((total * 100) / countedQty))} por unidade · `}
          <b>{formatBrl(total)}</b>
          {o.paperCents! > 0 && ` (gráfica ${formatBrl(o.printerCents!)} + papel nosso ${formatBrl(o.paperCents!)})`}
        </p>
      )}
      {groups.length > 0 && (
        <ul className="br-entregas" aria-label={`Entregas de ${o.title}`}>
          {groups.map((g) => (
            <li key={g[0]!.groupId}>
              <Icon name="caixa" />
              <span>
                {formatDay(g[0]!.deliveredAt, true)} ·{' '}
                {g.map((d, k) => (
                  <Fragment key={d.id}>
                    {k > 0 && ' + '}
                    <b>{formatQuantity(d.quantity)} ex.</b>
                    {many && ` ${nameOf(d.productId)}`}
                  </Fragment>
                ))}
                {g.some((d) => d.last) && ' · última entrega'}
                {g[0]!.notes && <span className="mudo"> · {g[0]!.notes}</span>}
              </span>
              {canEdit && (
                <button type="button" className="btn-texto" onClick={() => void act(() => api.deleteDelivery(g[0]!.groupId), 'Entrega desfeita.')}>
                  Desfazer
                  <span className="so-leitor">
                    {' '}
                    a entrega de {formatDay(g[0]!.deliveredAt, true)} de {o.title}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="br-acoes">
          {s.stage !== 'entregue' && (
            <button type="button" className="btn primario" onClick={() => setDialog({ kind: 'delivery', order: o })}>
              <Icon name="check" />
              Registrar entrega
              <span className="so-leitor"> de {o.title}</span>
            </button>
          )}
          {s.stage !== 'entregue' && (
            <button type="button" className="btn-texto" onClick={() => setDialog({ kind: 'due', order: o })}>
              Mudar a entrega prevista
              <span className="so-leitor"> de {o.title}</span>
            </button>
          )}
          {o.deliveries.length === 0 && (
            <button type="button" className="btn-texto" onClick={() => void act(() => api.reopenOrder(o.id), 'Fechamento desfeito: o orçamento voltou a ficar aberto.')}>
              Desfazer o fechamento
              <span className="so-leitor"> de {o.title}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** A especificação no cartão: a curta inteira; a longa (a que veio do PDF da proposta) recolhida, com o começo à vista. */
function Specification({ text }: { text: string }) {
  if (text.length <= 280 && !text.includes('\n\n')) return <p className="br-espec">{text}</p>;
  return (
    <details className="br-espec-dobra">
      <summary>
        Especificação <span className="mudo">· {text.slice(0, 90).replace(/\s+/g, ' ')}…</span>
      </summary>
      <p className="br-espec">{text}</p>
    </details>
  );
}

/**
 * Os produtos do orçamento ou do pedido, um por linha: o ISBN, a quantidade e o que vai dentro do box; no pedido, o
 * que já chegou de cada um que conta.
 */
function ProductList({ products, states }: { products: readonly (QuoteProduct | (QuoteProduct & { costCents: number | null }))[]; states?: ReturnType<typeof productStates> }) {
  const box = boxProduct(products);
  return (
    <ul className="br-produtos">
      {products.map((p) => {
        const st = states?.find((x) => x.productId === p.id);
        return (
          <li key={p.id}>
            <span>
              {p.title}
              {box === p && <span className="selo br-selo-box">Box</span>}
              {p.inBox && <span className="mudo"> · dentro do box</span>}
              <span className="mudo"> · {p.isbn ?? 'sem ISBN'}</span>
            </span>
            <span className="br-produto-num">
              {st ? `${formatQuantity(st.delivered)} de ${formatQuantity(st.quantity)}${st.finishedAt ? ' · entregue' : ''}` : p.inBox && states ? `${formatQuantity(p.quantity)} · vem no box` : `${formatQuantity(p.quantity)} ex.`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Janelas ----------

/** Uma linha de produto na janela do orçamento. */
interface ProductRow {
  key: number;
  /** O produto que já existia (na alteração). */
  id?: string;
  title: string;
  isbn: string;
  quantity: string;
  inBox: boolean;
}

/**
 * O orçamento (27/11/2026): um ou mais produtos (cada ISBN; no kit, o box e os livros que vão dentro dele, e o avulso),
 * a especificação e as observações. No orçamento novo, dá para começar pelo PDF de uma proposta: os produtos e a
 * especificação vêm dele, e, depois de cadastrar, a proposta abre já preenchida com o mesmo arquivo.
 */
function QuoteDialog({
  state,
  onClose,
  submit,
  onCreatedWithPdf,
}: {
  state: { quote?: Quote } | null;
  onClose: () => void;
  submit: Submit;
  onCreatedWithPdf: (quoteId: string, pdf: ProposalFile) => void;
}) {
  const ids = useId();
  const quote = state?.quote;
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [specification, setSpecification] = useState('');
  const [notes, setNotes] = useState('');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [pdf, setPdf] = useState<ProposalFile | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setRows(
      quote
        ? quote.products.map((p) => ({ key: rowKey++, id: p.id, title: p.title, isbn: p.isbn ?? '', quantity: String(p.quantity), inBox: p.inBox }))
        : [{ key: rowKey++, title: '', isbn: '', quantity: '', inBox: false }],
    );
    setSpecification(quote?.specification ?? '');
    setNotes(quote?.notes ?? '');
    setPdf(null);
    setReadNote(null);
    setError(null);
    setBusy(false);
    // Os produtos para sugerir: os que já tiveram PO e os títulos da curva ABC, como na Nova PO.
    api.poCatalog().then(
      (r) => setCatalog(r.products),
      () => setCatalog([]),
    );
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const many = rows.length > 1;
  const box = boxProduct(rows);
  const setRow = (key: number, patch: Partial<ProductRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const suggestionsFor = (title: string) => {
    const key = searchKey(title);
    return key.length < 2 ? [] : catalog.filter((c) => searchKey(c.title).includes(key)).slice(0, 30);
  };
  function pickTitle(row: ProductRow, value: string) {
    const found = catalog.find((c) => c.title === value);
    setRow(row.key, { title: value, ...(found?.isbn && !row.isbn ? { isbn: found.isbn } : {}) });
  }

  async function readFile(file: File) {
    setReading(true);
    setError(null);
    try {
      const read = await readProposalFile(file);
      if (!read || read.read.items.length === 0) {
        setPdf(read);
        setReadNote('Não consegui ler os produtos deste arquivo. Preencha os produtos à mão.');
        return;
      }
      setPdf(read);
      setRows(productsFromItems(read.read.items).map((p) => ({ key: rowKey++, title: p.title, isbn: '', quantity: String(p.quantity), inBox: p.inBox })));
      if (!specification.trim()) setSpecification(specificationFromItems(read.read.items));
      const n = read.read.items.length;
      setReadNote(
        `Li ${n === 1 ? '1 produto' : `${n} produtos`} da proposta${read.read.printerName ? ` da ${read.read.printerName}` : ''}. Escolha cada um na lista (para vir o ISBN) e confira o que vai dentro do box. Depois de cadastrar, a proposta abre já preenchida com este arquivo.`,
      );
    } catch {
      setReadNote('Não consegui ler o PDF. Preencha os produtos à mão.');
    } finally {
      setReading(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const products: QuoteProductInput[] = [];
    for (const r of rows) {
      const qty = parseCopies(r.quantity);
      if (!r.title.trim()) return setError(many ? `Informe o nome do ${rows.indexOf(r) + 1}º produto.` : 'Informe o produto.');
      if (!qty) return setError(many ? `Informe a quantidade de ${r.title.trim()} (só números, como 15000).` : 'Informe a quantidade (só números, como 5000).');
      products.push({ ...(r.id ? { id: r.id } : {}), title: r.title.trim(), isbn: r.isbn.trim() || null, quantity: qty, inBox: many && r.inBox });
    }
    const problem = quoteProductsProblem(products);
    if (problem) return setError(problem);
    const body: QuoteInput = { products, specification, notes };
    let createdId = '';
    setBusy(true);
    const failed = await submit(
      async () => {
        if (quote) await api.updateQuote(quote.id, body);
        else createdId = (await api.createQuote(body)).id;
      },
      quote ? 'Orçamento salvo.' : pdf?.read.items.length ? 'Orçamento cadastrado. Confira a proposta lida do PDF.' : 'Orçamento cadastrado. Agora adicione as propostas das gráficas.',
    );
    setBusy(false);
    setError(failed);
    if (!failed && createdId && pdf?.read.items.length) onCreatedWithPdf(createdId, pdf);
  }

  return (
    <Dialog title={quote ? 'Alterar o orçamento' : 'Novo orçamento'} open={Boolean(state)} onClose={onClose} wide className="dlg-br">
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {!quote && (
            <div className="grupo br-ler-pdf">
              <label className="btn arquivo">
                <Icon name="arquivo" />
                {reading ? 'Lendo o PDF…' : pdf ? 'Ler outro PDF' : 'Começar pelo PDF da proposta'}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void readFile(f);
                  }}
                />
              </label>
              <span className="dica">Opcional: o sistema lê os produtos, as quantidades e a especificação da proposta que a gráfica mandou.</span>
              {readNote && (
                <p className={pdf?.read.items.length ? 'aviso ok' : 'aviso alerta'} role="status">
                  <Icon name={pdf?.read.items.length ? 'check' : 'alerta'} />
                  <span>{readNote}</span>
                </p>
              )}
            </div>
          )}
          <fieldset className="br-bloco">
            <legend>{many ? 'Produtos' : 'Produto'}</legend>
            {rows.map((r, k) => {
              const suggestions = suggestionsFor(r.title);
              return (
                <div key={r.key} className="br-linha-produto">
                  <div className="grupo br-produto-nome">
                    <label className="rotulo" htmlFor={`${ids}-t${r.key}`}>
                      {many ? `Produto ${k + 1}` : 'Produto'}
                      {box && r === box && <span className="selo br-selo-box">É o box</span>}
                    </label>
                    <input id={`${ids}-t${r.key}`} className="campo" list={`${ids}-c${r.key}`} value={r.title} maxLength={300} autoComplete="off" onChange={(e) => pickTitle(r, e.target.value)} />
                    <datalist id={`${ids}-c${r.key}`}>
                      {suggestions.map((c) => (
                        <option key={`${c.title}-${c.isbn ?? ''}`} value={c.title}>
                          {c.isbn ?? ''}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div className="grupo">
                    <label className="rotulo" htmlFor={`${ids}-i${r.key}`}>
                      ISBN <span className="mudo">(opcional)</span>
                      {many && <span className="so-leitor"> do produto {k + 1}</span>}
                    </label>
                    <input id={`${ids}-i${r.key}`} className="campo" inputMode="numeric" value={r.isbn} maxLength={40} onChange={(e) => setRow(r.key, { isbn: e.target.value })} />
                  </div>
                  <div className="grupo">
                    <label className="rotulo" htmlFor={`${ids}-q${r.key}`}>
                      Quantidade{many && <span className="so-leitor"> do produto {k + 1}</span>}
                    </label>
                    <input id={`${ids}-q${r.key}`} className="campo" inputMode="numeric" value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} />
                  </div>
                  {many ? (
                    <label className="marcar br-dentro">
                      <input type="checkbox" checked={r.inBox} onChange={(e) => setRow(r.key, { inBox: e.target.checked })} />
                      Vai dentro do box<span className="so-leitor"> (produto {k + 1})</span>
                    </label>
                  ) : (
                    <span />
                  )}
                  {many ? (
                    <button type="button" className="btn-texto br-linha-tirar" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                      Tirar<span className="so-leitor"> o produto {k + 1}</span>
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
            <button type="button" className="btn-texto br-adicionar" onClick={() => setRows((list) => [...list, { key: rowKey++, title: '', isbn: '', quantity: '', inBox: false }])}>
              <Icon name="mais" />
              Adicionar produto
            </button>
            <p className="dica">
              Vários produtos num orçamento só: no kit, o box e os livros que vão dentro dele (marque "Vai dentro do box"; eles não contam no estoque do livro, e o box é o
              primeiro produto que não vai dentro), e o avulso com a quantidade dele.
            </p>
          </fieldset>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-espec`}>
              Especificação <span className="mudo">(formato, páginas, papel, acabamento)</span>
            </label>
            <textarea id={`${ids}-espec`} className="campo" rows={3} maxLength={2000} value={specification} onChange={(e) => setSpecification(e.target.value)} />
          </div>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-obs`}>
              Observações <span className="mudo">(opcional)</span>
            </label>
            <textarea id={`${ids}-obs`} className="campo" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy || reading}>
            {busy ? 'Gravando…' : quote ? 'Salvar' : 'Cadastrar orçamento'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ItemRow {
  key: number;
  /** O produto do orçamento que o item cobra (com vários produtos). */
  productId: string;
  description: string;
  specification: string;
  quantity: string;
  price: string;
}

interface PaperRow {
  key: number;
  /** O produto que usa o papel; vazio é a proposta toda. */
  productId: string;
  part: PaperPart;
  paper: string;
  kg: string;
  price: string;
  /** O preço por kg veio da tabela de papéis (e acompanha a troca do papel) ou foi digitado. */
  fromTable: boolean;
}

let rowKey = 0;

const PROPOSAL_FILES = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

/** O tipo do arquivo da proposta pelo nome; null se não for PDF, PNG ou JPG. */
function proposalContentType(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : null;
}

/** O nome do produto na lista: "Curso Básico de Desenho - Mangá (dentro do box)". */
const productLabel = (p: QuoteProduct) => `${p.title}${p.inBox ? ' (dentro do box)' : ''}`;

/** O custo da proposta em poucas linhas: o kit (o box e o que vai dentro), os outros produtos e o que falta orçar. */
function CostLines({ cost, products }: { cost: OfferCost; products: readonly QuoteProduct[] }) {
  const box = boxProduct(products);
  const inside = products.filter((p) => p.inBox);
  const others = products.filter((p) => !p.inBox && p !== box);
  const unit = (p: QuoteProduct) => cost.products.find((c) => c.productId === p.id)?.unitCostE4 ?? null;
  const missing = products.filter((p) => unit(p) === null);
  return (
    <>
      {box && cost.kitUnitCostE4 !== null && (
        <span className="br-custo-linha">
          Kit (o box e {inside.length === 1 ? '1 produto dentro' : `${inside.length} produtos dentro`}): <b>{formatBrlUnit(cost.kitUnitCostE4)}</b> por kit
        </span>
      )}
      {(box ? others : products).map((p) =>
        unit(p) !== null ? (
          <span key={p.id} className="br-custo-linha">
            {p.title}: <b>{formatBrlUnit(unit(p)!)}</b> por unidade
          </span>
        ) : null,
      )}
      {missing.length > 0 && <span className="br-custo-linha alerta-texto">Falta o preço de: {missing.map((p) => p.title).join(', ')}</span>}
    </>
  );
}

/**
 * A proposta da gráfica (27/11/2026): o cabeçalho (gráfica, número, data, validade, pagamento e prazo), os itens que a
 * gráfica cobra (com vários produtos, cada item diz qual produto cobra), o papel (da gráfica, incluído no preço, ou
 * nosso, com a parte, o peso e o preço por kg da tabela de papéis, que dá para ajustar) e o PDF. Ao escolher o PDF, o
 * sistema lê a gráfica, os itens, os preços e o papel, e a pessoa confere antes de salvar. O custo aparece enquanto se
 * digita: por unidade e, com vários produtos, por produto e por kit.
 */
function OfferDialog({
  state,
  printers,
  papers,
  onClose,
  submit,
}: {
  state: { quote: Quote; offer?: Offer; pdf?: ProposalFile } | null;
  printers: Map<string, string>;
  papers: Paper[];
  onClose: () => void;
  submit: Submit;
}) {
  const ids = useId();
  const quote = state?.quote;
  const offer = state?.offer;
  const products = useMemo(() => quote?.products ?? [], [quote]);
  const many = products.length > 1;
  const [printer, setPrinter] = useState('');
  const [quantity, setQuantity] = useState('');
  const [paperBy, setPaperBy] = useState<PaperBy>('grafica');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [paperRows, setPaperRows] = useState<PaperRow[]>([]);
  const [lead, setLead] = useState('');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [valid, setValid] = useState('');
  const [payment, setPayment] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paperByName = useMemo(() => new Map(papers.map((p) => [p.name.toLowerCase(), p])), [papers]);

  /** Preenche a proposta com o que foi lido do PDF. */
  function applyRead(pdf: ProposalFile, q: Quote) {
    const { read } = pdf;
    const registered = matchPrinter(pdf.text, [...printers.entries()].map(([id, name]) => ({ id, name })));
    setPrinter(registered?.name ?? read.printerName ?? '');
    setNumber(read.proposalNumber);
    if (read.proposalDate) setDate(read.proposalDate);
    if (read.validDays !== null) setValid(String(read.validDays));
    if (read.paymentTerms) setPayment(read.paymentTerms);
    if (read.leadDays !== null) setLead(String(read.leadDays));
    setPaperBy(read.paperBy);
    const matched = matchItemsToProducts(read.items, q.products);
    if (read.items.length) {
      setItems(
        read.items.map((i, k) => ({
          key: rowKey++,
          productId: q.products.length > 1 ? (q.products[matched[k]!]?.id ?? '') : '',
          description: i.description,
          specification: i.specification,
          quantity: String(i.quantity),
          price: brlUnitInput(i.unitPriceE4),
        })),
      );
      if (q.products.length === 1) setQuantity(String(read.items.length === 1 ? read.items[0]!.quantity : q.products[0]!.quantity));
    }
    const missingPapers: string[] = [];
    if (read.papers.length) {
      setPaperRows(
        read.papers.map((pl) => {
          const known = matchPaper(pl.paperName, papers);
          if (!known) missingPapers.push(paperDisplayName(pl.paperName));
          const itemProduct = q.products.length > 1 ? (q.products[matched[pl.item] ?? -1]?.id ?? '') : '';
          return {
            key: rowKey++,
            productId: itemProduct,
            part: pl.part,
            paper: known?.name ?? paperDisplayName(pl.paperName),
            kg: kgInput(pl.grams),
            price: known?.pricePerKgE4 != null ? brlUnitInput(known.pricePerKgE4) : '',
            fromTable: !!known,
          };
        }),
      );
    }
    setFile(pdf.file);
    setRemoveFile(false);
    const n = read.items.length;
    const lines = [
      n
        ? `Li do PDF ${registered ? `a ${registered.name}` : read.printerName ? `a ${read.printerName} (gráfica nova)` : 'a proposta (a gráfica não apareceu no texto)'}, ${n === 1 ? '1 item' : `${n} itens`}${read.papers.length ? ` e ${read.papers.length === 1 ? '1 linha' : `${read.papers.length} linhas`} de papel nosso` : ''}. Confira antes de salvar.`
        : 'Não consegui ler os itens deste PDF. Ele fica anexado; preencha a proposta à mão.',
      ...read.warnings.filter((w) => n || !w.startsWith('Não consegui ler os itens')),
      ...[...new Set(missingPapers)].map((m) => `O papel ${m} não está na tabela: informe o preço por kg (ele entra na tabela com esse preço).`),
      ...(many && matched.some((m) => m < 0) ? ['Algum item não casou com um produto do orçamento: escolha o produto.'] : []),
    ];
    setReadResult({ ok: n > 0, lines });
  }

  useEffect(() => {
    if (!state) return;
    const { quote: q, offer: o, pdf } = state;
    setPrinter(o ? (printers.get(o.printerId) ?? '') : '');
    setQuantity(String(o?.quantity ?? q.products[0]?.quantity ?? q.quantity));
    setPaperBy(o?.paperBy ?? 'grafica');
    setItems(
      o
        ? o.items.map((i) => ({ key: rowKey++, productId: i.productId ?? '', description: i.description, specification: i.specification, quantity: String(i.quantity), price: brlUnitInput(i.unitPriceE4) }))
        : q.products.map((p) => ({ key: rowKey++, productId: q.products.length > 1 ? p.id : '', description: p.title, specification: '', quantity: String(p.quantity), price: '' })),
    );
    setPaperRows(
      o && o.papers.length
        ? o.papers.map((pl) => ({ key: rowKey++, productId: pl.productId ?? '', part: pl.part, paper: pl.paperName, kg: kgInput(pl.grams), price: brlUnitInput(pl.pricePerKgE4), fromTable: false }))
        : [
            { key: rowKey++, productId: '', part: 'capa', paper: '', kg: '', price: '', fromTable: true },
            { key: rowKey++, productId: '', part: 'miolo', paper: '', kg: '', price: '', fromTable: true },
          ],
    );
    setLead(o?.leadDays == null ? '' : String(o.leadDays));
    setNumber(o?.proposalNumber ?? '');
    setDate(o?.proposalDate ?? '');
    setValid(o?.validDays == null ? '' : String(o.validDays));
    setPayment(o?.paymentTerms ?? '');
    setNotes(o?.notes ?? '');
    setFile(null);
    setRemoveFile(false);
    setReadResult(null);
    setReading(false);
    setError(null);
    setBusy(false);
    // A proposta que vem do orçamento novo, começado pelo PDF, já abre preenchida.
    if (pdf && !o) applyRead(pdf, q);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function chooseFile(f: File | null) {
    setFile(f);
    setReadResult(null);
    if (!f || !quote || offer) return;
    // Na proposta nova, o PDF é lido na hora; a imagem só é anexada.
    if (!/\.pdf$/i.test(f.name)) return;
    setReading(true);
    try {
      const read = await readProposalFile(f);
      if (read) applyRead(read, quote);
      else setReadResult({ ok: false, lines: ['Este PDF não tem texto (pode ser escaneado): ele fica anexado, e a proposta é preenchida à mão.'] });
    } catch {
      setReadResult({ ok: false, lines: ['Não consegui ler o PDF: ele fica anexado, e a proposta é preenchida à mão.'] });
    } finally {
      setReading(false);
    }
  }

  async function fillFromFile() {
    if (!file || !quote) return;
    setReading(true);
    try {
      const read = await readProposalFile(file);
      if (read) applyRead(read, quote);
      else setReadResult({ ok: false, lines: ['Este arquivo não tem texto para ler.'] });
    } finally {
      setReading(false);
    }
  }

  const itemTotals = items.map((i) => {
    const q = parseCopies(i.quantity);
    const u = parseBrlUnitPrice(i.price);
    return q && u ? brlTotalCents(q, u) : null;
  });
  const filledPapers = paperRows.filter((pl) => pl.paper.trim() || pl.kg.trim() || pl.price.trim());
  const paperTotals = paperRows.map((pl) => {
    const g = parseKgGrams(pl.kg);
    const u = parseBrlUnitPrice(pl.price);
    return g && u ? paperCostCents(g, u) : null;
  });
  // A quantidade pronta: com um produto, a digitada; com vários, a do maior item do box (ou do maior item).
  const box = boxProduct(products);
  const derivedQty = Math.max(0, ...items.filter((i) => !box || i.productId === box.id).map((i) => parseCopies(i.quantity) ?? 0));
  const offerQty = many ? derivedQty || null : parseCopies(quantity);
  const preview: Pick<Offer, 'quantity' | 'paperBy' | 'items' | 'papers'> | null =
    offerQty && itemTotals.every((t) => t !== null) && (paperBy === 'grafica' || (filledPapers.length > 0 && filledPapers.every((pl) => paperTotals[paperRows.indexOf(pl)] !== null)))
      ? {
          quantity: offerQty,
          paperBy,
          items: items.map((i) => ({ productId: i.productId || null, description: i.description, specification: '', quantity: parseCopies(i.quantity)!, unitPriceE4: parseBrlUnitPrice(i.price)! })),
          papers:
            paperBy === 'editora'
              ? filledPapers.map((pl) => ({ productId: pl.productId || null, part: pl.part, paperId: null, paperName: pl.paper, grams: parseKgGrams(pl.kg)!, pricePerKgE4: parseBrlUnitPrice(pl.price)! }))
              : [],
        }
      : null;
  const cost = preview ? offerCost(preview, products) : null;

  function changeQuantity(value: string) {
    // Com um item só, que acompanhava a quantidade da proposta, ele continua acompanhando.
    if (items.length === 1 && items[0]!.quantity === quantity) setItems([{ ...items[0]!, quantity: value }]);
    setQuantity(value);
  }
  const setItem = (key: number, patch: Partial<ItemRow>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  function chooseProduct(row: ItemRow, productId: string) {
    const p = products.find((x) => x.id === productId);
    // O item vazio ganha o nome e a quantidade do produto escolhido.
    setItem(row.key, { productId, ...(p && !row.description.trim() ? { description: p.title } : {}), ...(p && !row.quantity.trim() ? { quantity: String(p.quantity) } : {}) });
  }
  const setPaperRow = (key: number, patch: Partial<PaperRow>) => setPaperRows((list) => list.map((pl) => (pl.key === key ? { ...pl, ...patch } : pl)));
  function choosePaper(row: PaperRow, name: string) {
    const known = paperByName.get(name.trim().toLowerCase());
    // O preço por kg vem da tabela de papéis, enquanto a pessoa não digitar outro.
    setPaperRow(row.key, { paper: name, ...(known && known.pricePerKgE4 !== null && (row.fromTable || !row.price) ? { price: brlUnitInput(known.pricePerKgE4), fromTable: true } : {}) });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!quote) return;
    if (!printer.trim()) return setError('Informe a gráfica.');
    if (!offerQty) return setError(many ? 'Informe a quantidade dos itens.' : 'Informe quantos produtos prontos a proposta entrega (só números, como 15000).');
    const parsedItems: OfferInput['items'] = [];
    for (const [k, i] of items.entries()) {
      const q = parseCopies(i.quantity);
      const u = parseBrlUnitPrice(i.price);
      if (many && !i.productId) return setError(`Item ${k + 1}: escolha o produto que ele cobra.`);
      if (!i.description.trim() || !q || !u) return setError(`Item ${k + 1}: informe a descrição, a quantidade e o preço por unidade (como 3,29).`);
      parsedItems.push({ productId: many ? i.productId : null, description: i.description.trim(), specification: i.specification.trim(), quantity: q, unitPriceE4: u });
    }
    const parsedPapers: OfferInput['papers'] = [];
    if (paperBy === 'editora') {
      if (!filledPapers.length) return setError('Com o papel nosso, informe o papel: a parte, o papel, o peso em kg e o preço por kg.');
      for (const [k, pl] of filledPapers.entries()) {
        const g = parseKgGrams(pl.kg);
        const u = parseBrlUnitPrice(pl.price);
        if (!pl.paper.trim() || !g || !u) return setError(`Papel ${k + 1}: informe o papel, o peso em kg (como 707 ou 2463,44) e o preço por kg (como 8,50).`);
        parsedPapers.push({ productId: many && pl.productId ? pl.productId : null, part: pl.part, paper: pl.paper.trim(), grams: g, pricePerKgE4: u });
      }
    }
    const leadDays = lead.trim() === '' ? null : Number(lead);
    const validDays = valid.trim() === '' ? null : Number(valid);
    for (const [v, label] of [
      [leadDays, 'O prazo'],
      [validDays, 'A validade'],
    ] as const) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 365)) return setError(`${label} é um número de dias, de 0 a 365.`);
    }
    if (file && !proposalContentType(file.name)) return setError('Anexe a proposta em PDF, PNG ou JPG.');
    if (file && file.size > MAX_FILE_BYTES) return setError('O arquivo da proposta pode ter no máximo 5 MB.');
    const body: OfferInput = {
      printer: printer.trim(),
      quantity: offerQty,
      paperBy,
      items: parsedItems,
      papers: parsedPapers,
      leadDays,
      proposalNumber: number.trim(),
      proposalDate: date || null,
      validDays,
      paymentTerms: payment.trim(),
      notes,
    };
    setBusy(true);
    const problem = await submit(
      async () => {
        let id = offer?.id;
        if (id) await api.updateOffer(id, body);
        else id = (await api.addOffer(quote.id, body)).id;
        if (file) await api.putOfferDocument(id, { name: file.name, contentType: proposalContentType(file.name)!, data: await toBase64(file) });
        else if (removeFile && offer?.document) await api.deleteOfferDocument(id);
      },
      offer ? 'Proposta salva.' : `Proposta da ${body.printer} adicionada.`,
    );
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title={offer ? 'Alterar a proposta' : 'Adicionar proposta'} open={Boolean(state)} onClose={onClose} wide className="dlg-br">
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {quote && (
            <p className="dica-texto">
              {quote.title}
              {many ? ` · ${products.length} produtos` : ` · ${formatQuantity(quote.products[0]?.quantity ?? quote.quantity)} ex.`}
            </p>
          )}
          <div className="grupo br-ler-pdf">
            <span className="rotulo">PDF da proposta</span>
            {offer?.document && !removeFile && !file && (
              <span className="br-arquivo-atual">
                <Icon name="arquivo" />
                {offer.document.name}
                <button type="button" className="btn-texto" onClick={() => setRemoveFile(true)}>
                  Tirar
                </button>
              </span>
            )}
            <span className="br-ler-acoes">
              <label className="btn arquivo br-anexar">
                <Icon name="arquivo" />
                {reading ? 'Lendo o PDF…' : file ? `Arquivo: ${file.name}` : offer?.document && !removeFile ? 'Trocar o arquivo' : 'Escolher o PDF da gráfica'}
                <input
                  type="file"
                  accept={PROPOSAL_FILES}
                  disabled={reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    void chooseFile(f);
                  }}
                />
              </label>
              {offer && file && /\.pdf$/i.test(file.name) && (
                <button type="button" className="btn-texto" onClick={() => void fillFromFile()} disabled={reading}>
                  Preencher com o que está no PDF
                </button>
              )}
            </span>
            {!offer && !readResult && <span className="dica">Ao escolher o PDF, o sistema lê a gráfica, os itens, os preços e o papel nosso. Imagem só fica anexada.</span>}
            <div role="status">
              {readResult && (
                <ul className="br-lido">
                  {readResult.lines.map((line, k) => (
                    <li key={k} className={`aviso ${k === 0 && readResult.ok ? 'ok' : 'alerta'}`}>
                      <Icon name={k === 0 && readResult.ok ? 'check' : 'alerta'} />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grade-campos tres">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-graf`}>
                Gráfica
              </label>
              <input id={`${ids}-graf`} className="campo" list={`${ids}-graficas`} value={printer} maxLength={100} autoComplete="off" onChange={(e) => setPrinter(e.target.value)} />
              <datalist id={`${ids}-graficas`}>
                {[...printers.values()].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-num`}>
                Nº da proposta <span className="mudo">(opcional)</span>
              </label>
              <input id={`${ids}-num`} className="campo" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-data`}>
                Data da proposta
              </label>
              <input id={`${ids}-data`} className="campo" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className={many ? 'grade-campos tres' : 'grade-campos quatro'}>
            {!many && (
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-qtd`}>
                  Quantidade pronta
                </label>
                <input id={`${ids}-qtd`} className="campo" inputMode="numeric" value={quantity} onChange={(e) => changeQuantity(e.target.value)} />
              </div>
            )}
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-prazo`}>
                Prazo (dias)
              </label>
              <input id={`${ids}-prazo`} className="campo" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-validade`}>
                Validade (dias)
              </label>
              <input id={`${ids}-validade`} className="campo" inputMode="numeric" value={valid} onChange={(e) => setValid(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-pgto`}>
                Pagamento
              </label>
              <input id={`${ids}-pgto`} className="campo" placeholder="Ex.: 30 DDL" value={payment} maxLength={100} onChange={(e) => setPayment(e.target.value)} />
            </div>
          </div>
          {!many && <p className="dica">A quantidade pronta é quantos produtos a proposta entrega (o kit conta como um): é a base do custo por unidade.</p>}

          <fieldset className="br-bloco">
            <legend>Itens que a gráfica cobra</legend>
            <p className="dica">{many ? 'Cada item com o produto do orçamento que ele cobra, a quantidade e o preço por unidade.' : 'No kit, um item para o box e outro para os livros, cada um com a quantidade da gráfica.'}</p>
            {items.map((i, k) => (
              <div key={i.key} className="br-item">
                {many && (
                  <div className="br-item-topo">
                    <label className="rotulo" htmlFor={`${ids}-ip${i.key}`}>
                      Item {k + 1}
                      <span className="so-leitor">: produto</span>
                    </label>
                    <select id={`${ids}-ip${i.key}`} className="campo br-item-produto" value={i.productId} onChange={(e) => chooseProduct(i, e.target.value)}>
                      <option value="">Escolha o produto que o item cobra</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {productLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="br-linha-item">
                  <div className="grupo br-desc">
                    <label className="rotulo" htmlFor={`${ids}-d${i.key}`}>
                      {many ? (
                        <>
                          Descrição<span className="so-leitor"> do item {k + 1}</span>
                        </>
                      ) : (
                        `Item ${k + 1}`
                      )}
                    </label>
                    <input id={`${ids}-d${i.key}`} className="campo" value={i.description} maxLength={300} onChange={(e) => setItem(i.key, { description: e.target.value })} />
                  </div>
                  <div className="grupo">
                    <label className="rotulo" htmlFor={`${ids}-q${i.key}`}>
                      Quantidade<span className="so-leitor"> do item {k + 1}</span>
                    </label>
                    <input id={`${ids}-q${i.key}`} className="campo" inputMode="numeric" value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} />
                  </div>
                  <div className="grupo">
                    <label className="rotulo" htmlFor={`${ids}-p${i.key}`}>
                      Preço por unidade (R$)<span className="so-leitor"> do item {k + 1}</span>
                    </label>
                    <input id={`${ids}-p${i.key}`} className="campo" inputMode="decimal" value={i.price} onChange={(e) => setItem(i.key, { price: e.target.value })} />
                  </div>
                  <span className="br-linha-total">{itemTotals[k] !== null ? formatBrl(itemTotals[k]!) : '—'}</span>
                  {items.length > 1 ? (
                    <button type="button" className="btn-texto br-linha-tirar" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
                      Tirar<span className="so-leitor"> o item {k + 1}</span>
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                <details className="br-item-espec">
                  <summary>
                    Especificação<span className="so-leitor"> do item {k + 1}</span>
                    {i.specification ? <span className="mudo"> · {i.specification.length > 70 ? `${i.specification.slice(0, 70)}…` : i.specification}</span> : <span className="mudo"> (opcional)</span>}
                  </summary>
                  <textarea className="campo" aria-label={`Especificação do item ${k + 1}`} rows={3} maxLength={2000} value={i.specification} onChange={(e) => setItem(i.key, { specification: e.target.value })} />
                </details>
              </div>
            ))}
            <button
              type="button"
              className="btn-texto br-adicionar"
              onClick={() => setItems((list) => [...list, { key: rowKey++, productId: '', description: '', specification: '', quantity: '', price: '' }])}
            >
              <Icon name="mais" />
              Adicionar item
            </button>
          </fieldset>

          <fieldset className="br-bloco">
            <legend>Papel</legend>
            <label className="chegada-invoice">
              <input type="radio" name={`${ids}-papel`} checked={paperBy === 'grafica'} onChange={() => setPaperBy('grafica')} />
              <span>
                Papel da gráfica <span className="mudo">(incluído no preço)</span>
              </span>
            </label>
            <label className="chegada-invoice">
              <input type="radio" name={`${ids}-papel`} checked={paperBy === 'editora'} onChange={() => setPaperBy('editora')} />
              <span>
                Papel nosso <span className="mudo">(a editora compra e manda para a gráfica)</span>
              </span>
            </label>
            {paperBy === 'editora' && (
              <>
                {paperRows.map((pl, k) => (
                  <div key={pl.key} className="br-item">
                    {many && (
                      <div className="br-item-topo">
                        <label className="rotulo" htmlFor={`${ids}-pr${pl.key}`}>
                          Papel {k + 1}
                          <span className="so-leitor">: produto que usa</span>
                        </label>
                        <select id={`${ids}-pr${pl.key}`} className="campo br-item-produto" value={pl.productId} onChange={(e) => setPaperRow(pl.key, { productId: e.target.value })}>
                          <option value="">Toda a proposta</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {productLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="br-linha-papel">
                      <div className="grupo">
                        <label className="rotulo" htmlFor={`${ids}-pp${pl.key}`}>
                          Parte<span className="so-leitor"> do papel {k + 1}</span>
                        </label>
                        <select id={`${ids}-pp${pl.key}`} className="campo" value={pl.part} onChange={(e) => setPaperRow(pl.key, { part: e.target.value as PaperPart })}>
                          {PAPER_PARTS.map((part) => (
                            <option key={part} value={part}>
                              {PAPER_PART_LABELS[part]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grupo br-papel-campo">
                        <label className="rotulo" htmlFor={`${ids}-pn${pl.key}`}>
                          Papel<span className="so-leitor"> {k + 1}</span>
                        </label>
                        <input id={`${ids}-pn${pl.key}`} className="campo" list={`${ids}-papeis`} value={pl.paper} maxLength={100} autoComplete="off" onChange={(e) => choosePaper(pl, e.target.value)} />
                      </div>
                      <div className="grupo">
                        <label className="rotulo" htmlFor={`${ids}-pk${pl.key}`}>
                          Peso (kg)<span className="so-leitor"> do papel {k + 1}</span>
                        </label>
                        <input id={`${ids}-pk${pl.key}`} className="campo" inputMode="decimal" value={pl.kg} onChange={(e) => setPaperRow(pl.key, { kg: e.target.value })} />
                      </div>
                      <div className="grupo">
                        <label className="rotulo" htmlFor={`${ids}-pv${pl.key}`}>
                          Preço por kg (R$)<span className="so-leitor"> do papel {k + 1}</span>
                        </label>
                        <input id={`${ids}-pv${pl.key}`} className="campo" inputMode="decimal" value={pl.price} onChange={(e) => setPaperRow(pl.key, { price: e.target.value, fromTable: false })} />
                      </div>
                      <span className="br-linha-total">{paperTotals[k] !== null ? formatBrl(paperTotals[k]!) : '—'}</span>
                      <button type="button" className="btn-texto br-linha-tirar" onClick={() => setPaperRows((list) => list.filter((x) => x.key !== pl.key))}>
                        Tirar<span className="so-leitor"> o papel {k + 1}</span>
                      </button>
                    </div>
                  </div>
                ))}
                <datalist id={`${ids}-papeis`}>
                  {papers.map((pp) => (
                    <option key={pp.id} value={pp.name} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className="btn-texto br-adicionar"
                  onClick={() => setPaperRows((list) => [...list, { key: rowKey++, productId: '', part: 'miolo', paper: '', kg: '', price: '', fromTable: true }])}
                >
                  <Icon name="mais" />
                  Adicionar papel
                </button>
                <p className="dica">
                  O preço por kg vem da tabela de papéis e pode ser ajustado só nesta proposta. Um papel novo entra na tabela com o preço digitado.
                  {many && ' O papel de toda a proposta se reparte pelos produtos, na proporção do que a gráfica cobra de cada um.'}
                </p>
              </>
            )}
          </fieldset>

          <p className="br-total br-custo" aria-live="polite">
            {cost ? (
              <>
                <span className="br-custo-linha">
                  {paperBy === 'editora' ? (
                    <>
                      Gráfica <b>{formatBrl(cost.printerCents)}</b> + papel nosso <b>{formatBrl(cost.paperCents)}</b> = <b>{formatBrl(cost.totalCents)}</b>
                    </>
                  ) : (
                    <>
                      Total <b>{formatBrl(cost.totalCents)}</b>
                    </>
                  )}
                  {!many && (
                    <>
                      {' '}
                      · <b>{formatBrlUnit(cost.unitCostE4)}</b> por unidade
                    </>
                  )}
                </span>
                {many && <CostLines cost={cost} products={products} />}
              </>
            ) : (
              'O custo aparece com os itens e o papel preenchidos.'
            )}
          </p>

          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-obs`}>
              Observações <span className="mudo">(opcional)</span>
            </label>
            <textarea id={`${ids}-obs`} className="campo" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy || reading}>
            {busy ? 'Gravando…' : offer ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CloseDialog({
  state,
  printers,
  today,
  onClose,
  submit,
}: {
  state: { quote: Quote; offer: Offer } | null;
  printers: Map<string, string>;
  today: string;
  onClose: () => void;
  submit: Submit;
}) {
  const ids = useId();
  const [orderedAt, setOrderedAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lead = state?.offer.leadDays ?? null;

  useEffect(() => {
    if (!state) return;
    setOrderedAt(today);
    setDueAt(lead === null ? '' : addDays(today, lead));
    setError(null);
    setBusy(false);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) return <Dialog title="Fechar o orçamento" open={false} onClose={onClose} />;
  const { quote, offer } = state;
  const printer = printers.get(offer.printerId) ?? 'a gráfica';
  const many = quote.products.length > 1;
  const cost = offerCost(offer, quote.products);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!orderedAt) return setError('Informe o dia do fechamento.');
    setBusy(true);
    const problem = await submit(() => api.closeQuote(quote.id, { offerId: offer.id, orderedAt, dueAt: dueAt || null }), `Orçamento fechado com a ${printer}. O pedido está em produção no Brasil.`);
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title="Fechar o orçamento" open onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {many ? (
            <>
              <p>
                <b>{quote.title}</b> com a <b>{printer}</b>
                {cost && `: total de ${formatBrl(cost.totalCents)}${cost.paperCents ? `, com ${formatBrl(cost.paperCents)} de papel nosso` : ''}`}
                {cost?.kitUnitCostE4 != null && `, ${formatBrlUnit(cost.kitUnitCostE4)} por kit`}
                {lead !== null && `, prazo de ${lead === 1 ? '1 dia' : `${lead} dias`}`}.
              </p>
              {cost && (
                <ul className="br-produtos">
                  {quote.products.map((p, n) => (
                    <li key={p.id}>
                      <span>
                        {p.title}
                        {p.inBox && <span className="mudo"> · dentro do box</span>}
                      </span>
                      <span className="br-produto-num">
                        {cost.products[n]!.quantity ? `${formatQuantity(cost.products[n]!.quantity)} ex.` : 'não orçado'}
                        {cost.products[n]!.unitCostE4 !== null && ` · ${formatBrlUnit(cost.products[n]!.unitCostE4!)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>
              <b>{quote.title}</b> com a <b>{printer}</b>: {formatQuantity(offer.quantity)} unidades
              {cost && `, ${formatBrlUnit(cost.unitCostE4)} por unidade (${formatBrl(cost.totalCents)}${cost.paperCents ? `, com ${formatBrl(cost.paperCents)} de papel nosso` : ''})`}
              {lead !== null && `, prazo de ${lead === 1 ? '1 dia' : `${lead} dias`}`}.
            </p>
          )}
          <p className="dica-texto">O pedido vai para "Em produção no Brasil". As outras propostas continuam registradas no orçamento.</p>
          <div className="grade-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-dia`}>
                Dia do fechamento
              </label>
              <input
                id={`${ids}-dia`}
                className="campo"
                type="date"
                max={today}
                value={orderedAt}
                onChange={(e) => {
                  setOrderedAt(e.target.value);
                  if (lead !== null && e.target.value) setDueAt(addDays(e.target.value, lead));
                }}
              />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-entrega`}>
                Entrega prevista
              </label>
              <input id={`${ids}-entrega`} className="campo" type="date" min={orderedAt || undefined} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Gravando…' : 'Fechar o orçamento'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A entrega da gráfica: o dia e quanto chegou. No pedido com vários produtos, a quantidade de cada um que conta (o box e
 * o avulso; o que vai dentro do box vem com ele), já preenchida com o que falta.
 */
function DeliveryDialog({ state, printers, today, onClose, submit }: { state: { order: BrOrder } | null; printers: Map<string, string>; today: string; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const [day, setDay] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [last, setLast] = useState(false);
  const [lastTouched, setLastTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = state ? orderState(state.order, today) : null;
  const open = state ? productStates(state.order).filter((p) => !p.finishedAt) : [];

  useEffect(() => {
    if (!state || !s) return;
    setDay(today);
    setQuantities(Object.fromEntries(open.map((p) => [p.productId ?? '', p.remaining > 0 ? String(p.remaining) : ''])));
    setLast(s.remaining > 0);
    setLastTouched(false);
    setNotes('');
    setError(null);
    setBusy(false);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state || !s) return <Dialog title="Registrar entrega" open={false} onClose={onClose} />;
  const { order } = state;
  const many = open.length > 1 || countedProducts(order).length > 1;
  const parts = open.map((p) => ({ product: p, qty: (quantities[p.productId ?? ''] ?? '').trim() === '' ? 0 : parseCopies(quantities[p.productId ?? '']!) }));
  const total = parts.reduce((n, p) => n + (p.qty ?? 0), 0);
  const completes = (qs: typeof parts) => qs.every((p) => (p.qty ?? 0) >= p.product.remaining);

  function change(productId: string, value: string) {
    const next = { ...quantities, [productId]: value };
    setQuantities(next);
    // Sem a pessoa mexer na caixa, ela acompanha: a entrega que completa o pedido é a última.
    if (!lastTouched) setLast(completes(open.map((p) => ({ product: p, qty: (next[p.productId ?? ''] ?? '').trim() === '' ? 0 : parseCopies(next[p.productId ?? '']!) }))));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!day) return setError('Informe o dia da entrega.');
    if (parts.some((p) => p.qty === null)) return setError('Informe os exemplares só com números.');
    if (total === 0) return setError('Informe quantos exemplares chegaram (só números).');
    setBusy(true);
    const done = last || completes(parts);
    const body = { deliveredAt: day, parts: parts.filter((p) => p.qty).map((p) => ({ productId: p.product.productId!, quantity: p.qty! })), last, notes };
    const problem = await submit(
      () => api.addDelivery(order.id, body),
      done ? `Entrega registrada: ${order.title} foi entregue.` : `Entrega de ${formatQuantity(total)} ex. registrada. Faltam ${formatQuantity(Math.max(0, s!.remaining - total))} ex.`,
    );
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title="Registrar entrega" open onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          <p>
            <b>{order.title}</b> · {printers.get(order.printerId) ?? 'Gráfica'}
            {!many && ` · pedido de ${formatQuantity(countedProducts(order)[0]!.quantity)} ex.`}
            {s.delivered > 0 && ` · já entregues ${formatQuantity(s.delivered)}`} · faltam {formatQuantity(s.remaining)}
          </p>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-dia`}>
              Dia da entrega
            </label>
            <input id={`${ids}-dia`} className="campo br-campo-dia" type="date" max={today} min={order.orderedAt} value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          {many ? (
            <fieldset className="br-bloco">
              <legend>Exemplares que chegaram</legend>
              {open.map((p) => (
                <div key={p.productId} className="br-linha-entrega">
                  <label className="rotulo" htmlFor={`${ids}-q${p.productId}`}>
                    {p.title}
                    <span className="mudo">
                      {' '}
                      · faltam {formatQuantity(p.remaining)} de {formatQuantity(p.quantity)}
                    </span>
                  </label>
                  <input id={`${ids}-q${p.productId}`} className="campo" inputMode="numeric" value={quantities[p.productId ?? ''] ?? ''} onChange={(e) => change(p.productId ?? '', e.target.value)} />
                </div>
              ))}
              <p className="dica">O que vai dentro do box chega com ele. Deixe em branco o que não chegou nesta entrega.</p>
            </fieldset>
          ) : (
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-qtd`}>
                Exemplares que chegaram
              </label>
              <input id={`${ids}-qtd`} className="campo" inputMode="numeric" value={quantities[open[0]?.productId ?? ''] ?? ''} onChange={(e) => change(open[0]?.productId ?? '', e.target.value)} />
            </div>
          )}
          <label className="chegada-invoice br-ultima">
            <input
              type="checkbox"
              checked={last}
              onChange={(e) => {
                setLast(e.target.checked);
                setLastTouched(true);
              }}
            />
            <span>
              {many ? 'É a última entrega do que chegou agora' : 'É a última entrega deste pedido'}
              <span className="dica">Marque quando a gráfica não vai entregar mais nada {many ? 'desses produtos' : ''}, mesmo que chegue um pouco menos que o pedido.</span>
            </span>
          </label>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-obs`}>
              Observações <span className="mudo">(opcional)</span>
            </label>
            <input id={`${ids}-obs`} className="campo" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Gravando…' : 'Registrar entrega'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DueDialog({ state, onClose, submit }: { state: { order: BrOrder } | null; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!state) return;
    setDueAt(state.order.dueAt ?? '');
    setError(null);
    setBusy(false);
  }, [state]);
  if (!state) return <Dialog title="Mudar a entrega prevista" open={false} onClose={onClose} />;
  const { order } = state;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const problem = await submit(() => api.updateOrder(order.id, { dueAt: dueAt || null }), dueAt ? `Entrega prevista para ${formatDay(dueAt, true)}.` : 'O pedido ficou sem entrega prevista.');
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title="Mudar a entrega prevista" open onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          <p>
            <b>{order.title}</b> · fechado em {formatDay(order.orderedAt, true)}
          </p>
          <div className="grupo estreito">
            <label className="rotulo" htmlFor={`${ids}-entrega`}>
              Entrega prevista
            </label>
            <input id={`${ids}-entrega`} className="campo" type="date" min={order.orderedAt} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <span className="dica">Deixe em branco para ficar sem entrega prevista.</span>
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Gravando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A tabela de papéis (27/11/2026): o preço por kg do papel que a editora compra. Ele vem sugerido nas propostas com
 * o papel nosso; mudar aqui vale para as próximas propostas, e as já feitas ficam com o preço que usaram.
 */
function PapersDialog({ open, papers, onClose, submit }: { open: boolean; papers: Paper[]; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setNewName('');
    setNewPrice('');
    setError(null);
    setBusy(false);
  }, [open]);

  async function saveRow(e: FormEvent, paper: Paper) {
    e.preventDefault();
    const u = parseBrlUnitPrice(price);
    if (!name.trim() || !u) return setError('Informe o nome do papel e o preço por kg, como 8,50.');
    setBusy(true);
    const problem = await submit(() => api.updatePaper(paper.id, { name: name.trim(), pricePerKgE4: u }), `${name.trim()}: ${formatBrlUnit(u)} por kg.`, true);
    setBusy(false);
    setError(problem);
    if (!problem) setEditing(null);
  }

  async function addPaper(e: FormEvent) {
    e.preventDefault();
    const u = parseBrlUnitPrice(newPrice);
    if (!newName.trim() || !u) return setError('Informe o nome do papel e o preço por kg, como 8,50.');
    setBusy(true);
    const problem = await submit(() => api.createPaper({ name: newName.trim(), pricePerKgE4: u }), `${newName.trim()} entrou na tabela de papéis.`, true);
    setBusy(false);
    setError(problem);
    if (!problem) {
      setNewName('');
      setNewPrice('');
    }
  }

  return (
    <Dialog title="Tabela de papéis" open={open} onClose={onClose}>
      <div className="dlg-corpo">
        <p className="dica-texto">O preço por kg do papel que a editora compra. Ele vem sugerido nas propostas com o papel nosso; mudar aqui vale para as próximas propostas.</p>
        {papers.length === 0 ? (
          <p className="mudo">Nenhum papel ainda. Cadastre abaixo, ou digite um papel novo numa proposta com o papel nosso.</p>
        ) : (
          <ul className="br-papeis">
            {papers.map((pp) => (
              <li key={pp.id}>
                {editing === pp.id ? (
                  <form className="br-papel-form" onSubmit={(e) => void saveRow(e, pp)}>
                    <label className="so-leitor" htmlFor={`${ids}-n${pp.id}`}>
                      Nome do papel
                    </label>
                    <input id={`${ids}-n${pp.id}`} className="campo" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                    <label className="so-leitor" htmlFor={`${ids}-v${pp.id}`}>
                      Preço por kg (R$)
                    </label>
                    <input id={`${ids}-v${pp.id}`} className="campo br-papel-preco" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                    <button type="submit" className="btn primario" disabled={busy}>
                      Salvar
                    </button>
                    <button type="button" className="btn-texto" onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="br-papel-nome">{pp.name}</span>
                    {pp.pricePerKgE4 !== null && <b className="num">{formatBrlUnit(pp.pricePerKgE4)}/kg</b>}
                    <span className="mudo">atualizado em {formatDay(spDate(new Date(pp.updatedAt)), true)}</span>
                    <button
                      type="button"
                      className="btn-texto"
                      onClick={() => {
                        setEditing(pp.id);
                        setName(pp.name);
                        setPrice(brlUnitInput(pp.pricePerKgE4));
                        setError(null);
                      }}
                    >
                      Alterar<span className="so-leitor"> {pp.name}</span>
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="br-papel-novo" onSubmit={(e) => void addPaper(e)}>
          <h3>Novo papel</h3>
          <div className="grade-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-novo`}>
                Papel
              </label>
              <input id={`${ids}-novo`} className="campo" placeholder="Ex.: Offwhite 60 g" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-novo-preco`}>
                Preço por kg (R$)
              </label>
              <input id={`${ids}-novo-preco`} className="campo" inputMode="decimal" placeholder="Ex.: 7,20" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn alinha-inicio" disabled={busy}>
            <Icon name="mais" />
            Adicionar papel
          </button>
        </form>
        <FormError message={error} />
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
}
