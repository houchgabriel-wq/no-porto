// Produção › Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do Brasil,
// com as propostas lado a lado, os pedidos em produção e as entregas no estoque, em uma ou mais partes. Admin e
// editor lançam; Consulta vê tudo; o leitor vê sem os valores (o servidor não manda os preços).

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  bestOffer,
  brazilSummary,
  brlTotalCents,
  brlUnitInput,
  formatBrl,
  formatBrlUnit,
  matchesBrazil,
  orderState,
  orderStateText,
  parseBrlUnitPrice,
  type BrOrder,
  type Offer,
  type Quote,
} from '../core/brazil';
import { searchKey } from '../core/items';
import type { CatalogEntry } from '../core/newOrder';
import { formatQuantity } from '../core/money';
import { can } from '../core/roles';
import { formatDay, spDate } from '../core/shipments';
import { api, ApiError, type BrazilData, type Me, type OfferInput, type QuoteInput } from './api';
import { Dialog, FormError } from './components';
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
  | null;

/** Gravar e recarregar; devolve o erro para a janela mostrar, ou null quando deu certo. */
type Submit = (action: () => Promise<unknown>, done: string) => Promise<string | null>;

export function BrazilView({ me, onToast }: { me: Me; onToast: (msg: string) => void }) {
  const [data, setData] = useState<BrazilData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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

  const submit: Submit = async (action, done) => {
    try {
      await action();
      await reload();
      onToast(done);
      setDialog(null);
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
          <OfferDialog state={dialog?.kind === 'offer' ? dialog : null} printers={printers} onClose={() => setDialog(null)} submit={submit} />
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
  const { data, printers, canEdit, setDialog, act } = ctx;
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
                {data.seeValues && (
                  <>
                    <th className="num">Por exemplar</th>
                    <th className="num">Total</th>
                  </>
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
                return (
                  <tr key={o.id} className={o.id === best?.id || o.id === chosen ? 'br-destaque' : undefined}>
                    <td>
                      <b>{name}</b>
                      {o.id === best?.id && q.offers.length > 1 && <span className="pilula ok br-selo">Menor preço</span>}
                      {o.id === chosen && <span className="pilula ok br-selo">Escolhida</span>}
                      {o.notes && <span className="t-isbn">{o.notes}</span>}
                    </td>
                    <td className="num" data-rot="Quantidade">
                      {formatQuantity(o.quantity)}
                    </td>
                    {data.seeValues && (
                      <>
                        <td className="num" data-rot="Por exemplar">
                          {o.unitPriceE4 === null ? '—' : formatBrlUnit(o.unitPriceE4)}
                        </td>
                        <td className="num" data-rot="Total">
                          {o.unitPriceE4 === null ? '—' : formatBrl(brlTotalCents(o.quantity, o.unitPriceE4))}
                        </td>
                      </>
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
      {data.seeValues && o.unitPriceE4 !== null && (
        <p className="br-valor">
          {formatBrlUnit(o.unitPriceE4)} por exemplar · <b>{formatBrl(brlTotalCents(o.quantity, o.unitPriceE4))}</b>
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

function OfferDialog({ state, printers, onClose, submit }: { state: { quote: Quote; offer?: Offer } | null; printers: Map<string, string>; onClose: () => void; submit: Submit }) {
  const ids = useId();
  const quote = state?.quote;
  const offer = state?.offer;
  const [printer, setPrinter] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [lead, setLead] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    setPrinter(offer ? (printers.get(offer.printerId) ?? '') : '');
    setQuantity(String(offer?.quantity ?? state.quote.quantity));
    setPrice(brlUnitInput(offer?.unitPriceE4 ?? null));
    setLead(offer?.leadDays === null || offer?.leadDays === undefined ? '' : String(offer.leadDays));
    setNotes(offer?.notes ?? '');
    setError(null);
    setBusy(false);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const qty = parseCopies(quantity);
  const unit = parseBrlUnitPrice(price);
  const total = qty && unit ? brlTotalCents(qty, unit) : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!quote) return;
    if (!printer.trim()) return setError('Informe a gráfica.');
    if (!qty) return setError('Informe a quantidade (só números, como 5000).');
    if (!unit) return setError('Informe o preço por exemplar em reais, como 3,70 (até quatro casas).');
    const leadDays = lead.trim() === '' ? null : Number(lead);
    if (leadDays !== null && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365)) return setError('O prazo é um número de dias, de 0 a 365.');
    const body: OfferInput = { printer: printer.trim(), quantity: qty, unitPriceE4: unit, leadDays, notes };
    setBusy(true);
    const problem = await submit(() => (offer ? api.updateOffer(offer.id, body) : api.addOffer(quote.id, body)), offer ? 'Proposta salva.' : `Proposta da ${body.printer} adicionada.`);
    setBusy(false);
    setError(problem);
  }

  return (
    <Dialog title={offer ? 'Alterar a proposta' : 'Adicionar proposta'} open={Boolean(state)} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {quote && (
            <p className="dica-texto">
              {quote.title} · {formatQuantity(quote.quantity)} ex.
            </p>
          )}
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-graf`}>
              Gráfica
            </label>
            <input id={`${ids}-graf`} className="campo" list={`${ids}-graficas`} value={printer} maxLength={100} autoComplete="off" onChange={(e) => setPrinter(e.target.value)} />
            <datalist id={`${ids}-graficas`}>
              {[...printers.values()].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <span className="dica">Uma gráfica nova entra no cadastro ao gravar.</span>
          </div>
          <div className="grade-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-qtd`}>
                Quantidade
              </label>
              <input id={`${ids}-qtd`} className="campo" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-preco`}>
                Preço por exemplar (R$)
              </label>
              <input id={`${ids}-preco`} className="campo" inputMode="decimal" placeholder="3,70" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-prazo`}>
                Prazo (dias)
              </label>
              <input id={`${ids}-prazo`} className="campo" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
            </div>
          </div>
          <p className="br-total" aria-live="polite">
            {total !== null ? (
              <>
                Total: <b>{formatBrl(total)}</b>
              </>
            ) : (
              'O total aparece com a quantidade e o preço.'
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
            <b>{quote.title}</b> com a <b>{printer}</b>: {formatQuantity(offer.quantity)} ex.
            {offer.unitPriceE4 !== null && ` a ${formatBrlUnit(offer.unitPriceE4)} por exemplar (${formatBrl(brlTotalCents(offer.quantity, offer.unitPriceE4))})`}
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
