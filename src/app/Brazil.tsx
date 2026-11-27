// Produção › Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do Brasil,
// com as propostas lado a lado (os itens que a gráfica cobra, o papel da gráfica ou o nosso, pela tabela de papéis,
// o custo por unidade e o PDF), os pedidos em produção e as entregas no estoque, em uma ou mais partes. Admin e
// editor lançam; Consulta vê tudo; o leitor vê sem os valores (o servidor não manda os preços nem o PDF).

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  bestOffer,
  brazilSummary,
  brlTotalCents,
  brlUnitInput,
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
  type BrOrder,
  type Offer,
  type Paper,
  type PaperBy,
  type PaperPart,
  type Quote,
} from '../core/brazil';
import { searchKey } from '../core/items';
import type { CatalogEntry } from '../core/newOrder';
import { formatQuantity } from '../core/money';
import { can } from '../core/roles';
import { formatDay, spDate } from '../core/shipments';
import { api, ApiError, type BrazilData, type Me, type OfferInput, type QuoteInput } from './api';
import { Dialog, FormError } from './components';
import { MAX_FILE_BYTES, toBase64 } from './fileUpload';
import { Icon } from './icons';

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
  | { kind: 'offer'; quote: Quote; offer?: Offer }
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
  const quotes = data.quotes.filter((q) => matchesBrazil(query, { title: q.title, isbn: q.isbn, printers: printerNames(q.offers.map((o) => o.printerId)) }));
  const orders = data.orders.filter((o) => matchesBrazil(query, { title: o.title, isbn: o.isbn, printers: printerNames([o.printerId]) }));
  const open = quotes.filter((q) => q.status === 'aberto');
  const closedQuotes = quotes.filter((q) => q.status !== 'aberto');
  const states = new Map(orders.map((o) => [o.id, orderState(o, today)]));
  const producing = orders
    .filter((o) => states.get(o.id)!.stage !== 'entregue')
    .sort((a, b) => Number(states.get(b.id)!.late) - Number(states.get(a.id)!.late) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  const delivered = orders.filter((o) => states.get(o.id)!.stage === 'entregue').sort((a, b) => states.get(b.id)!.finishedAt!.localeCompare(states.get(a.id)!.finishedAt!));
  const ctx: Ctx = { data, printers, canEdit, today, setDialog, act };
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
          <QuoteDialog state={dialog?.kind === 'quote' ? dialog : null} onClose={() => setDialog(null)} submit={submit} />
          <OfferDialog state={dialog?.kind === 'offer' ? dialog : null} printers={printers} papers={data.papers} onClose={() => setDialog(null)} submit={submit} />
          <PapersDialog open={dialog?.kind === 'papers'} papers={data.papers} onClose={() => setDialog(null)} submit={submit} />
          <CloseDialog state={dialog?.kind === 'close' ? dialog : null} printers={printers} today={today} onClose={() => setDialog(null)} submit={submit} />
          <DeliveryDialog state={dialog?.kind === 'delivery' ? dialog : null} printers={printers} today={today} onClose={() => setDialog(null)} submit={submit} />
          <DueDialog state={dialog?.kind === 'due' ? dialog : null} onClose={() => setDialog(null)} submit={submit} />
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
  const best = open ? bestOffer(q.offers) : null;
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
        {q.isbn ?? 'Sem ISBN'} · {formatQuantity(q.quantity)} ex.
        {q.createdBy ? ` · cadastrado por ${q.createdBy}` : ''} em {formatDay(spDate(new Date(q.createdAt)), true)}
      </p>
      {q.specification && <p className="br-espec">{q.specification}</p>}
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
                    <th className="num">Por unidade</th>
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
                const cost = offerCost(o);
                const expiry = offerExpiry(o, today);
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
                      <span className="t-isbn">{o.items.map((i) => `${i.description}: ${formatQuantity(i.quantity)}${i.unitPriceE4 !== null ? ` × ${formatBrlUnit(i.unitPriceE4)}` : ''}`).join(' · ')}</span>
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
                        <td className="num" data-rot="Por unidade">
                          {cost ? (
                            <>
                              <b>{formatBrlUnit(cost.unitCostE4)}</b>
                              <span className="t-isbn">total {formatBrl(cost.totalCents)}</span>
                            </>
                          ) : (
                            '—'
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
                        <button type="button" className="btn-texto" onClick={() => setDialog({ kind: 'offer', quote: q, offer: o })}>
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
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'offer', quote: q })}>
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
  const pct = Math.min(100, Math.round((s.delivered / o.quantity) * 100));
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
        <b>{printer}</b> · {o.isbn ?? 'Sem ISBN'} · fechado em {formatDay(o.orderedAt, true)}
        {o.dueAt && s.stage !== 'entregue' && ` · entrega prevista em ${formatDay(o.dueAt, true)}`}
        {s.finishedAt && ` · entregue em ${formatDay(s.finishedAt, true)}`}
      </p>
      <div className="br-progresso">
        <span className="br-barra" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span>
          {formatQuantity(s.delivered)} de {formatQuantity(o.quantity)} ex. entregues
          {s.remaining > 0 && ` · faltam ${formatQuantity(s.remaining)}`}
        </span>
      </div>
      {data.seeValues && total !== null && (
        <p className="br-valor">
          {formatBrlUnit(Math.round((total * 100) / o.quantity))} por unidade · <b>{formatBrl(total)}</b>
          {o.paperCents! > 0 && ` (gráfica ${formatBrl(o.printerCents!)} + papel nosso ${formatBrl(o.paperCents!)})`}
        </p>
      )}
      {o.deliveries.length > 0 && (
        <ul className="br-entregas" aria-label={`Entregas de ${o.title}`}>
          {o.deliveries.map((d) => (
            <li key={d.id}>
              <Icon name="caixa" />
              <span>
                {formatDay(d.deliveredAt, true)} · <b>{formatQuantity(d.quantity)} ex.</b>
                {d.last && ' · última entrega'}
                {d.notes && <span className="mudo"> · {d.notes}</span>}
              </span>
              {canEdit && (
                <button type="button" className="btn-texto" onClick={() => void act(() => api.deleteDelivery(d.id), 'Entrega desfeita.')}>
                  Desfazer
                  <span className="so-leitor">
                    {' '}
                    a entrega de {formatDay(d.deliveredAt, true)} de {o.title}
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

// ---------- Janelas ----------

function QuoteDialog({ state, onClose, submit }: { state: { quote?: Quote } | null; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const quote = state?.quote;
  const [title, setTitle] = useState('');
  const [isbn, setIsbn] = useState('');
  const [quantity, setQuantity] = useState('');
  const [specification, setSpecification] = useState('');
  const [notes, setNotes] = useState('');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setTitle(quote?.title ?? '');
    setIsbn(quote?.isbn ?? '');
    setQuantity(quote ? String(quote.quantity) : '');
    setSpecification(quote?.specification ?? '');
    setNotes(quote?.notes ?? '');
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

  const suggestions = useMemo(() => {
    const key = searchKey(title);
    if (key.length < 2) return [];
    return catalog.filter((c) => searchKey(c.title).includes(key)).slice(0, 30);
  }, [catalog, title]);

  function pickTitle(value: string) {
    setTitle(value);
    const found = catalog.find((c) => c.title === value);
    if (found?.isbn && !isbn) setIsbn(found.isbn);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const qty = parseCopies(quantity);
    if (!title.trim()) return setError('Informe o produto.');
    if (!qty) return setError('Informe a quantidade (só números, como 5000).');
    const body: QuoteInput = { title: title.trim(), isbn: isbn.trim() || null, quantity: qty, specification, notes };
    setBusy(true);
    const problem = await submit(() => (quote ? api.updateQuote(quote.id, body) : api.createQuote(body)), quote ? 'Orçamento salvo.' : 'Orçamento cadastrado. Agora adicione as propostas das gráficas.');
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title={quote ? 'Alterar o orçamento' : 'Novo orçamento'} open={Boolean(state)} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-titulo`}>
              Produto
            </label>
            <input id={`${ids}-titulo`} className="campo" list={`${ids}-catalogo`} value={title} maxLength={300} autoComplete="off" onChange={(e) => pickTitle(e.target.value)} />
            <datalist id={`${ids}-catalogo`}>
              {suggestions.map((c) => (
                <option key={`${c.title}-${c.isbn ?? ''}`} value={c.title}>
                  {c.isbn ?? ''}
                </option>
              ))}
            </datalist>
            <span className="dica">Escolha entre os produtos que já tiveram PO e os títulos da curva ABC, ou escreva um novo.</span>
          </div>
          <div className="grade-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-isbn`}>
                ISBN <span className="mudo">(opcional)</span>
              </label>
              <input id={`${ids}-isbn`} className="campo" inputMode="numeric" value={isbn} maxLength={40} onChange={(e) => setIsbn(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-qtd`}>
                Quantidade
              </label>
              <input id={`${ids}-qtd`} className="campo" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
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
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Gravando…' : quote ? 'Salvar' : 'Cadastrar orçamento'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ItemRow {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

interface PaperRow {
  key: number;
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

/**
 * A proposta da gráfica (27/11/2026): o cabeçalho (gráfica, número, data, validade, pagamento e prazo), quantos
 * produtos prontos ela entrega, os itens que a gráfica cobra (o kit tem o box e os livros), o papel (da gráfica,
 * incluído no preço, ou nosso, com a parte, o peso e o preço por kg da tabela de papéis, que dá para ajustar) e o
 * PDF. O custo por unidade aparece enquanto se digita.
 */
function OfferDialog({
  state,
  printers,
  papers,
  onClose,
  submit,
}: {
  state: { quote: Quote; offer?: Offer } | null;
  printers: Map<string, string>;
  papers: Paper[];
  onClose: () => void;
  submit: Submit;
}) {
  const ids = useId();
  const quote = state?.quote;
  const offer = state?.offer;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paperByName = useMemo(() => new Map(papers.map((p) => [p.name.toLowerCase(), p])), [papers]);

  useEffect(() => {
    if (!state) return;
    const { quote: q, offer: o } = state;
    setPrinter(o ? (printers.get(o.printerId) ?? '') : '');
    setQuantity(String(o?.quantity ?? q.quantity));
    setPaperBy(o?.paperBy ?? 'grafica');
    setItems(
      o
        ? o.items.map((i) => ({ key: rowKey++, description: i.description, quantity: String(i.quantity), price: brlUnitInput(i.unitPriceE4) }))
        : [{ key: rowKey++, description: q.title, quantity: String(q.quantity), price: '' }],
    );
    setPaperRows(
      o && o.papers.length
        ? o.papers.map((pl) => ({ key: rowKey++, part: pl.part, paper: pl.paperName, kg: kgInput(pl.grams), price: brlUnitInput(pl.pricePerKgE4), fromTable: false }))
        : [
            { key: rowKey++, part: 'capa', paper: '', kg: '', price: '', fromTable: true },
            { key: rowKey++, part: 'miolo', paper: '', kg: '', price: '', fromTable: true },
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
    setError(null);
    setBusy(false);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const offerQty = parseCopies(quantity);
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
  const printerCents = itemTotals.every((t) => t !== null) ? itemTotals.reduce<number>((sum, t) => sum + t!, 0) : null;
  const paperCents =
    paperBy === 'grafica'
      ? 0
      : filledPapers.length && paperRows.every((pl, k) => paperTotals[k] !== null || !filledPapers.includes(pl))
        ? paperTotals.reduce<number>((sum, t) => sum + (t ?? 0), 0)
        : null;
  const total = printerCents !== null && paperCents !== null ? printerCents + paperCents : null;

  function changeQuantity(value: string) {
    // Com um item só, que acompanhava a quantidade da proposta, ele continua acompanhando.
    if (items.length === 1 && items[0]!.quantity === quantity) setItems([{ ...items[0]!, quantity: value }]);
    setQuantity(value);
  }
  const setItem = (key: number, patch: Partial<ItemRow>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
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
    if (!offerQty) return setError('Informe quantos produtos prontos a proposta entrega (só números, como 15000).');
    const parsedItems: OfferInput['items'] = [];
    for (const [k, i] of items.entries()) {
      const q = parseCopies(i.quantity);
      const u = parseBrlUnitPrice(i.price);
      if (!i.description.trim() || !q || !u) return setError(`Item ${k + 1}: informe a descrição, a quantidade e o preço por unidade (como 3,29).`);
      parsedItems.push({ description: i.description.trim(), quantity: q, unitPriceE4: u });
    }
    const parsedPapers: OfferInput['papers'] = [];
    if (paperBy === 'editora') {
      if (!filledPapers.length) return setError('Com o papel nosso, informe o papel: a parte, o papel, o peso em kg e o preço por kg.');
      for (const [k, pl] of filledPapers.entries()) {
        const g = parseKgGrams(pl.kg);
        const u = parseBrlUnitPrice(pl.price);
        if (!pl.paper.trim() || !g || !u) return setError(`Papel ${k + 1}: informe o papel, o peso em kg (como 707 ou 2463,44) e o preço por kg (como 8,50).`);
        parsedPapers.push({ part: pl.part, paper: pl.paper.trim(), grams: g, pricePerKgE4: u });
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
    <Dialog title={offer ? 'Alterar a proposta' : 'Adicionar proposta'} open={Boolean(state)} onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {quote && (
            <p className="dica-texto">
              {quote.title} · {formatQuantity(quote.quantity)} ex.
            </p>
          )}
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
          <div className="grade-campos quatro">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-qtd`}>
                Quantidade pronta
              </label>
              <input id={`${ids}-qtd`} className="campo" inputMode="numeric" value={quantity} onChange={(e) => changeQuantity(e.target.value)} />
            </div>
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
          <p className="dica">A quantidade pronta é quantos produtos a proposta entrega (o kit conta como um): é a base do custo por unidade.</p>

          <fieldset className="br-bloco">
            <legend>Itens que a gráfica cobra</legend>
            <p className="dica">No kit, um item para o box e outro para os livros, cada um com a quantidade da gráfica.</p>
            {items.map((i, k) => (
              <div key={i.key} className="br-linha-item">
                <div className="grupo br-desc">
                  <label className="rotulo" htmlFor={`${ids}-d${i.key}`}>
                    Item {k + 1}
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
            ))}
            <button type="button" className="btn-texto br-adicionar" onClick={() => setItems((list) => [...list, { key: rowKey++, description: '', quantity: '', price: '' }])}>
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
                  <div key={pl.key} className="br-linha-papel">
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
                ))}
                <datalist id={`${ids}-papeis`}>
                  {papers.map((pp) => (
                    <option key={pp.id} value={pp.name} />
                  ))}
                </datalist>
                <button type="button" className="btn-texto br-adicionar" onClick={() => setPaperRows((list) => [...list, { key: rowKey++, part: 'miolo', paper: '', kg: '', price: '', fromTable: true }])}>
                  <Icon name="mais" />
                  Adicionar papel
                </button>
                <p className="dica">O preço por kg vem da tabela de papéis e pode ser ajustado só nesta proposta. Um papel novo entra na tabela com o preço digitado.</p>
              </>
            )}
          </fieldset>

          <p className="br-total br-custo" aria-live="polite">
            {total !== null && offerQty ? (
              <>
                Gráfica <b>{formatBrl(printerCents!)}</b>
                {paperBy === 'editora' && (
                  <>
                    {' '}
                    + papel nosso <b>{formatBrl(paperCents!)}</b>
                  </>
                )}{' '}
                = <b>{formatBrl(total)}</b> · <b>{formatBrlUnit(Math.round((total * 100) / offerQty))}</b> por unidade
              </>
            ) : (
              'O custo por unidade aparece com os itens e o papel preenchidos.'
            )}
          </p>

          <div className="grupo">
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
            <label className="btn-texto arquivo br-anexar">
              {file ? `Arquivo: ${file.name}` : offer?.document && !removeFile ? 'Trocar o arquivo' : 'Anexar o PDF da gráfica'}
              <input type="file" accept={PROPOSAL_FILES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
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
          <button type="submit" className="btn primario" disabled={busy}>
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
  const cost = offerCost(offer);

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
          <p>
            <b>{quote.title}</b> com a <b>{printer}</b>: {formatQuantity(offer.quantity)} unidades
            {cost && `, ${formatBrlUnit(cost.unitCostE4)} por unidade (${formatBrl(cost.totalCents)}${cost.paperCents ? `, com ${formatBrl(cost.paperCents)} de papel nosso` : ''})`}
            {lead !== null && `, prazo de ${lead === 1 ? '1 dia' : `${lead} dias`}`}.
          </p>
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

function DeliveryDialog({ state, printers, today, onClose, submit }: { state: { order: BrOrder } | null; printers: Map<string, string>; today: string; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const [day, setDay] = useState('');
  const [quantity, setQuantity] = useState('');
  const [last, setLast] = useState(false);
  const [lastTouched, setLastTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = state ? orderState(state.order, today) : null;

  useEffect(() => {
    if (!state || !s) return;
    setDay(today);
    setQuantity(s.remaining > 0 ? String(s.remaining) : '');
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
  const qty = parseCopies(quantity);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!day) return setError('Informe o dia da entrega.');
    if (!qty) return setError('Informe quantos exemplares chegaram (só números).');
    setBusy(true);
    const done = last || qty >= s!.remaining;
    const problem = await submit(
      () => api.addDelivery(order.id, { deliveredAt: day, quantity: qty, last, notes }),
      done ? `Entrega registrada: ${order.title} foi entregue.` : `Entrega de ${formatQuantity(qty)} ex. registrada. Faltam ${formatQuantity(Math.max(0, s!.remaining - qty))} ex.`,
    );
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title="Registrar entrega" open onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          <p>
            <b>{order.title}</b> · {printers.get(order.printerId) ?? 'Gráfica'} · pedido de {formatQuantity(order.quantity)} ex.
            {s.delivered > 0 && ` · já entregues ${formatQuantity(s.delivered)}`} · faltam {formatQuantity(s.remaining)}
          </p>
          <div className="grade-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-dia`}>
                Dia da entrega
              </label>
              <input id={`${ids}-dia`} className="campo" type="date" max={today} min={order.orderedAt} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-qtd`}>
                Exemplares que chegaram
              </label>
              <input
                id={`${ids}-qtd`}
                className="campo"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  // Sem a pessoa mexer na caixa, ela acompanha: a entrega que completa o pedido é a última.
                  const n = parseCopies(e.target.value);
                  if (!lastTouched) setLast(n !== null && n >= s.remaining);
                }}
              />
            </div>
          </div>
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
              É a última entrega deste pedido
              <span className="dica">Marque quando a gráfica não vai entregar mais nada, mesmo que chegue um pouco menos que o pedido.</span>
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
