// Solicitações de embarque (SPEC.md, seção 3): o agente de cargas cadastra o que cada fornecedor pede
// (containers de cada tipo, saída e valor de cada container) e o Gabriel aprova ou recusa. O Agente vê
// só as próprias solicitações; a equipe (admin, editor e Consulta) vê todas, e a ficha mostra a situação
// do fornecedor para a aprovação ser feita com os números à vista.

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  approvalProblem,
  approvedLess,
  BOOKING_STATUS_LABELS,
  bookingProblem,
  bookingTotalCents,
  canCancelBooking,
  canEditBookingReference,
  CONTAINER_LABELS,
  CONTAINER_TYPES,
  containerCount,
  containersText,
  departureText,
  groupBookings,
  matchesBooking,
  normalizeReference,
  otherBookingsOfSupplier,
  parseContainerPrice,
  pendingCount,
  portSuggestions,
  REFERENCE_MAX,
  referenceProblem,
  sortedLines,
  type BookingRequest,
  type BookingStatus,
  type ContainerType,
} from '../core/bookings';
import { formatQuantity, formatUsd } from '../core/money';
import { arrivalState, arrivalText, daysBetween, formatDay, shipmentUnits, spDate } from '../core/shipments';
import type { SupplierSummary } from '../core/suppliers';
import { api, ApiError, type BookingsData, type Me, type ProductionData } from './api';
import { Dialog, FormError, formatDateTime, hueStyle, supplierHue } from './components';
import { Icon, type IconName } from './icons';

/** De quanto em quanto tempo a tela aberta busca solicitações novas (o painel avisa das que chegam). */
const REFRESH_MS = 30_000;
/** Quantas aprovadas aparecem antes de "Mostrar todas". */
const APPROVED_SHOWN = 12;

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Erro inesperado. Tente de novo.';
}

/** Dia (AAAA-MM-DD) em São Paulo de um instante gravado pelo servidor. */
function dayOf(iso: string): string {
  return spDate(new Date(iso));
}

// ---------- Dados ----------

/** Carrega as solicitações, recarrega a cada meio minuto e ao voltar para a aba. */
export function useBookings(enabled: boolean) {
  const [data, setData] = useState<BookingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.bookings());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar as solicitações.');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, reload]);

  /** Aplica na hora a solicitação que a própria pessoa gravou. */
  const put = useCallback((request: BookingRequest) => {
    setData((d) =>
      d ? { ...d, requests: d.requests.some((r) => r.id === request.id) ? d.requests.map((r) => (r.id === request.id ? request : r)) : [request, ...d.requests] } : d,
    );
  }, []);

  return { data, loadError, reload, put };
}

// ---------- Peças ----------

const STATUS_ICONS: Record<BookingStatus, IconName> = { aguardando: 'relogio', aprovada: 'check', recusada: 'fechar', cancelada: 'desfazer' };
const GROUP_TITLES: Record<Exclude<BookingStatus, 'aguardando'>, string> = { aprovada: 'Aprovadas', recusada: 'Recusadas', cancelada: 'Canceladas' };
const STATUS_TONES: Record<BookingStatus, string> = { aguardando: 'alerta', aprovada: 'ok', recusada: 'critico', cancelada: '' };

function StatusPill({ status }: { status: BookingStatus }) {
  return (
    <span className={`pilula ${STATUS_TONES[status]}`.trim()}>
      <Icon name={STATUS_ICONS[status]} />
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

function SupplierName({ request }: { request: Pick<BookingRequest, 'supplierId' | 'supplierName'> }) {
  return (
    <span className="sol-forn">
      <span className="forn-ponto h" style={hueStyle(request.supplierId ? supplierHue(request.supplierId) : 0)} aria-hidden="true" />
      {request.supplierName}
    </span>
  );
}

/** A saída que aguarda aprovação e está perto (ou já passou) aparece em destaque. */
function DepartureHint({ date, today }: { date: string; today: string }) {
  const days = daysBetween(today, date);
  const tone = days < 0 ? 'critico-texto' : days <= 3 ? 'alerta-texto' : 'mudo';
  return <span className={tone}>{departureText(date, today)}</span>;
}

/** Os números que importam: o aprovado, quando aprovada; o pedido, nos outros casos. */
function shownAmount(r: BookingRequest): 'aprovado' | 'pedido' {
  return r.status === 'aprovada' ? 'aprovado' : 'pedido';
}

// ---------- Aviso do painel ----------

/** No topo do painel, enquanto há solicitações aguardando (pedido do Gabriel em 19/11/2026). */
export function PendingBookingsNotice({ data }: { data: BookingsData }) {
  const pending = data.requests.filter((r) => r.status === 'aguardando');
  if (pending.length === 0) return null;
  const containers = pending.reduce((sum, r) => sum + containerCount(r.lines), 0);
  return (
    <div className="lembrete-sol" role="status">
      <Icon name="container" />
      <span>
        <b>{pending.length === 1 ? '1 solicitação de embarque' : `${pending.length} solicitações de embarque`}</b>{' '}
        {data.canDecide ? 'aguardando a sua aprovação' : 'aguardando aprovação'} ({containers === 1 ? '1 container' : `${containers} containers`}).
      </span>
      <a className="btn primario" href="#solicitacoes">
        {data.canDecide ? 'Ver e decidir' : 'Ver solicitações'}
      </a>
    </div>
  );
}

// ---------- Lista ----------

interface ViewProps {
  data: BookingsData;
  onOpen: (id: string) => void;
  /** Só para o agente: abre o formulário de nova solicitação. */
  onNew?: () => void;
}

export function BookingsView({ data, onOpen, onNew }: ViewProps) {
  const [query, setQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [allApproved, setAllApproved] = useState(false);
  const agent = Boolean(onNew);
  const { today } = data;

  // Só os fornecedores que têm solicitação entram no filtro.
  const suppliers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data.requests) if (r.supplierId) seen.set(r.supplierId, r.supplierName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [data.requests]);
  const shown = data.requests.filter((r) => (!supplierId || r.supplierId === supplierId) && matchesBooking(r, query));
  const groups = groupBookings(shown);

  const pending = data.requests.filter((r) => r.status === 'aguardando');
  const cutoff = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const recent = (status: BookingStatus) => data.requests.filter((r) => r.status === status && r.decidedAt && dayOf(r.decidedAt) >= cutoff);
  const approved = recent('aprovada');
  const refused = recent('recusada');
  const pendingContainers = pending.reduce((sum, r) => sum + containerCount(r.lines), 0);
  const approvedContainers = approved.reduce((sum, r) => sum + containerCount(r.lines, 'aprovado'), 0);

  const newButton = onNew && (
    <button type="button" className="btn primario" onClick={onNew}>
      <Icon name="mais" />
      Nova solicitação
    </button>
  );

  if (data.requests.length === 0) {
    return (
      <section className="vazio" aria-labelledby="sol-vazio">
        <h2 id="sol-vazio">{agent ? 'Nenhuma solicitação ainda.' : 'Nenhuma solicitação de embarque ainda.'}</h2>
        <p>
          {agent
            ? 'Quando um fornecedor pedir containers, cadastre aqui: fornecedor, quantos containers de cada tipo, a saída e o valor de cada container. A resposta aparece nesta tela. Reserve só o que for aprovado.'
            : 'O agente de cargas cadastra aqui o que cada fornecedor pede (containers de cada tipo, saída e valor), e cada solicitação aguarda a aprovação antes da reserva. Quem aprova é avisado no painel.'}
        </p>
        {newButton && <div className="vazio-acoes">{newButton}</div>}
      </section>
    );
  }

  return (
    <>
      <section className="sol-faixa" aria-label="Resumo das solicitações">
        <div className="emb-total">
          <span className="forn-rot">{data.canDecide ? 'Aguardando a sua aprovação' : 'Aguardando aprovação'}</span>
          <b>{pending.length === 1 ? '1 solicitação' : `${pending.length} solicitações`}</b>
          <span className="forn-sub">
            {pending.length ? `${pendingContainers === 1 ? '1 container' : `${pendingContainers} containers`} · ${formatUsd(pending.reduce((s, r) => s + bookingTotalCents(r.lines), 0))}` : 'Nada para decidir agora'}
          </span>
        </div>
        <div className="emb-stat ok">
          <span className="stat-ic">
            <Icon name="check" />
          </span>
          <span>
            <b>{approvedContainers === 1 ? '1 container' : `${approvedContainers} containers`}</b>
            <span>
              {approvedContainers === 1 ? 'aprovado' : 'aprovados'} nos últimos 30 dias
              {approved.length ? ` · ${formatUsd(approved.reduce((s, r) => s + bookingTotalCents(r.lines, 'aprovado'), 0))}` : ''}
            </span>
          </span>
        </div>
        <div className={`emb-stat${refused.length ? ' critico' : ''}`}>
          <span className="stat-ic">
            <Icon name="fechar" />
          </span>
          <span>
            <b>{refused.length}</b>
            <span>{refused.length === 1 ? 'recusada' : 'recusadas'} nos últimos 30 dias</span>
          </span>
        </div>
      </section>

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input className="campo" type="search" placeholder="Buscar fornecedor, porto ou container" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {suppliers.length > 1 && (
          <select className="campo filtro-sel" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Fornecedor">
            <option value="">Todos os fornecedores</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {newButton && <div className="filtros-acoes">{newButton}</div>}
      </div>

      {groups.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhuma solicitação com esta busca.</div>
      ) : (
        groups.map(({ status, requests }) => {
          const title = status === 'aguardando' ? (data.canDecide ? 'Aguardando a sua aprovação' : 'Aguardando aprovação') : GROUP_TITLES[status];
          const count = requests.length === 1 ? '1 solicitação' : `${requests.length} solicitações`;
          if (status === 'recusada' || status === 'cancelada') {
            return (
              <details key={status} className="emb-grupo">
                <summary>
                  <h2>{title}</h2>
                  <span className="mudo">{count}</span>
                </summary>
                <CardGrid requests={requests} today={today} agent={agent} onOpen={onOpen} />
              </details>
            );
          }
          const limited = status === 'aprovada' && !allApproved && requests.length > APPROVED_SHOWN;
          return (
            <section key={status} className={`emb-grupo sol-${status}`} aria-labelledby={`sol-grupo-${status}`}>
              <div className="emb-grupo-topo sol-grupo-topo">
                <h2 id={`sol-grupo-${status}`}>
                  {status === 'aguardando' && <Icon name="relogio" />}
                  {title}
                </h2>
                <span className="mudo">{count}</span>
              </div>
              <CardGrid requests={limited ? requests.slice(0, APPROVED_SHOWN) : requests} today={today} agent={agent} onOpen={onOpen} />
              {limited && (
                <button type="button" className="btn-texto sol-mais" onClick={() => setAllApproved(true)}>
                  Mostrar todas as {requests.length} aprovadas
                </button>
              )}
            </section>
          );
        })
      )}
    </>
  );
}

function CardGrid({ requests, today, agent, onOpen }: { requests: BookingRequest[]; today: string; agent: boolean; onOpen: (id: string) => void }) {
  return (
    <ul className="emb-grade">
      {requests.map((r) => (
        <li key={r.id}>
          <BookingCard request={r} today={today} agent={agent} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function BookingCard({ request: r, today, agent, onOpen }: { request: BookingRequest; today: string; agent: boolean; onOpen: (id: string) => void }) {
  const which = shownAmount(r);
  return (
    <button type="button" className={`emb-cartao sol-cartao estado-${r.status}`} onClick={() => onOpen(r.id)}>
      <span className="emb-topo">
        <SupplierName request={r} />
        <StatusPill status={r.status} />
      </span>
      <span className="emb-titulo">{r.reference || <span className="sol-sem-ref">Sem referência</span>}</span>
      <span className="sol-conteineres">
        {containersText(r.lines, which)}
        {approvedLess(r) && <span className="sol-nota"> (pedido: {containersText(r.lines)})</span>}
      </span>
      <span className="emb-meta">
        {r.departurePort} · saída {formatDay(r.departureDate, true)}
        {r.status === 'aguardando' && (
          <>
            {' · '}
            <DepartureHint date={r.departureDate} today={today} />
          </>
        )}
      </span>
      <span className="emb-pe">
        <span>
          {agent ? 'Pedido' : `${r.createdBy.name.split(' ')[0]} pediu`} em {formatDay(dayOf(r.createdAt), true)}
        </span>
        <b>{formatUsd(bookingTotalCents(r.lines, which))}</b>
      </span>
    </button>
  );
}

// ---------- Ficha ----------

export interface BookingContext {
  production: ProductionData | null;
  suppliers: SupplierSummary[] | null;
}

/** O número de referência na ficha: quem pode (o agente nas dele, admin e editor) preenche e corrige ali. */
function ReferenceValue({ request: r, editable, onSaved }: { request: BookingRequest; editable: boolean; onSaved: (request: BookingRequest, message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.reference);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = referenceProblem(value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateBookingReference(r.id, normalizeReference(value));
      setEditing(false);
      onSaved(res.request, 'Número de referência salvo.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="sol-ref-form" onSubmit={save} noValidate>
        <label className="so-leitor" htmlFor={inputId}>
          Número de referência
        </label>
        <input
          id={inputId}
          className="campo"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={REFERENCE_MAX}
          autoComplete="off"
          autoFocus
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="btn primario" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setEditing(false);
            setValue(r.reference);
            setError(null);
          }}
        >
          Cancelar
        </button>
        <FormError message={error} />
      </form>
    );
  }
  return (
    <span className="sol-ref">
      {r.reference ? <b>{r.reference}</b> : <span className="sol-sem-ref">Sem referência</span>}
      {editable && (
        <button
          type="button"
          className="btn-texto"
          onClick={() => {
            setValue(r.reference);
            setEditing(true);
          }}
        >
          {r.reference ? 'Corrigir' : 'Preencher'}
        </button>
      )}
    </span>
  );
}

interface DialogProps {
  request: BookingRequest | null;
  data: BookingsData;
  me: Me;
  /** Situação do fornecedor (só para a equipe). */
  context?: BookingContext;
  onClose: () => void;
  onSaved: (request: BookingRequest, message: string) => void;
  /** Leva à produção do fornecedor (só para a equipe). */
  onProduction?: (supplierId: string) => void;
}

type Mode = 'ver' | 'aprovar' | 'recusar' | 'cancelar';

export function BookingDialog({ request, data, me, context, onClose, onSaved, onProduction }: DialogProps) {
  const [mode, setMode] = useState<Mode>('ver');
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const id = request?.id;

  useEffect(() => {
    setMode('ver');
    setNote('');
    setError(null);
    setBusy(false);
  }, [id]);

  if (!request) return <Dialog title="Solicitação de embarque" open={false} onClose={onClose} />;
  const r = request;
  const decider = data.canDecide && r.status === 'aguardando';
  const cancellable = canCancelBooking(r, me);
  const agentView = me.role === 'agente';

  function startApproval() {
    setApproved(Object.fromEntries(r.lines.map((l) => [l.containerType, String(l.quantity)])));
    setNote('');
    setError(null);
    setMode('aprovar');
  }

  function go(next: Mode) {
    setNote('');
    setError(null);
    setMode(next);
  }

  const approvedLines = r.lines.map((l) => ({ containerType: l.containerType, approvedQuantity: /^\d+$/.test((approved[l.containerType] ?? '').trim()) ? Number(approved[l.containerType]) : NaN }));
  const approvedPreview = r.lines.map((l, i) => ({ ...l, approvedQuantity: Number.isNaN(approvedLines[i]!.approvedQuantity) ? 0 : approvedLines[i]!.approvedQuantity }));
  const approvedCount = containerCount(approvedPreview, 'aprovado');

  async function run(action: () => Promise<{ request: BookingRequest }>, done: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      onSaved(res.request, done);
      setMode('ver');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function approve(e: FormEvent) {
    e.preventDefault();
    const problem = approvalProblem(r.lines, approvedLines.map((l) => ({ ...l, approvedQuantity: Number.isNaN(l.approvedQuantity) ? -1 : l.approvedQuantity })));
    if (problem) return setError(problem);
    void run(
      () => api.approveBooking(r.id, { lines: approvedLines, note: note.trim() }),
      `Aprovada: ${containersText(approvedPreview, 'aprovado')} da ${r.supplierName}. O agente já vê a aprovação.`,
    );
  }

  function refuse(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return setError('Informe o motivo da recusa.');
    void run(() => api.refuseBooking(r.id, note.trim()), `Recusada. O agente vê o motivo na tela dele.`);
  }

  function cancel() {
    void run(() => api.cancelBooking(r.id), 'Solicitação cancelada.');
  }

  const title =
    mode === 'aprovar'
      ? 'Aprovar solicitação'
      : mode === 'recusar'
        ? 'Recusar solicitação'
        : mode === 'cancelar'
          ? 'Cancelar solicitação'
          : `${r.reference || 'Solicitação'} · ${r.supplierName}`;

  return (
    <Dialog title={title} open onClose={onClose} wide className="dlg-solicitacao">
      {mode === 'aprovar' ? (
        <form onSubmit={approve}>
          <div className="dlg-corpo">
            <p className="dica-texto">
              Quantos containers de cada tipo a {r.supplierName} pode embarcar, saindo de {r.departurePort} em {formatDay(r.departureDate, true)}. Dá para aprovar menos que o pedido.
            </p>
            <fieldset className="sol-aprovar">
              <legend className="rotulo">Containers aprovados</legend>
              {sortedLines(r.lines).map((l) => (
                <ApprovedField
                  key={l.containerType}
                  type={l.containerType}
                  requested={l.quantity}
                  priceCents={l.priceCents}
                  value={approved[l.containerType] ?? ''}
                  onChange={(v) => setApproved((a) => ({ ...a, [l.containerType]: v }))}
                />
              ))}
            </fieldset>
            <p className="sol-total" aria-live="polite">
              Total aprovado: <b>{approvedCount === 1 ? '1 container' : `${approvedCount} containers`}</b> · <b>{formatUsd(bookingTotalCents(approvedPreview, 'aprovado'))}</b>
            </p>
            <div className="grupo">
              <label className="rotulo" htmlFor={noteId}>
                Observação para o agente (opcional)
              </label>
              <textarea id={noteId} className="campo" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
            </div>
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => go('ver')} disabled={busy}>
              Voltar
            </button>
            <button type="submit" className="btn primario" disabled={busy || approvedCount === 0}>
              <Icon name="check" />
              {busy ? 'Aprovando…' : approvedCount === 1 ? 'Aprovar 1 container' : `Aprovar ${approvedCount} containers`}
            </button>
          </div>
        </form>
      ) : mode === 'recusar' ? (
        <form onSubmit={refuse}>
          <div className="dlg-corpo">
            <p className="dica-texto">
              {containersText(r.lines)} da {r.supplierName}, saindo de {r.departurePort} em {formatDay(r.departureDate, true)}. O agente vê o motivo e não reserva.
            </p>
            <div className="grupo">
              <label className="rotulo" htmlFor={noteId}>
                Motivo da recusa
              </label>
              <textarea id={noteId} className="campo" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} required autoFocus />
            </div>
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => go('ver')} disabled={busy}>
              Voltar
            </button>
            <button type="submit" className="btn perigo" disabled={busy}>
              <Icon name="fechar" />
              {busy ? 'Recusando…' : 'Recusar solicitação'}
            </button>
          </div>
        </form>
      ) : mode === 'cancelar' ? (
        <>
          <div className="dlg-corpo">
            <p className="dica-texto">
              {containersText(r.lines)} da {r.supplierName} sai da fila de aprovação. Para pedir de novo, cadastre outra solicitação.
            </p>
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => go('ver')} disabled={busy}>
              Voltar
            </button>
            <button type="button" className="btn perigo" onClick={cancel} disabled={busy}>
              {busy ? 'Cancelando…' : 'Cancelar solicitação'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="dlg-corpo">
            <Decision request={r} agentView={agentView} />
            <dl className="sol-dados">
              <dt>Número de referência</dt>
              <dd>
                <ReferenceValue key={r.id} request={r} editable={canEditBookingReference(r, me)} onSaved={onSaved} />
              </dd>
              <dt>Fornecedor</dt>
              <dd>
                <SupplierName request={r} />
              </dd>
              <dt>Saída</dt>
              <dd>
                {r.departurePort}, {formatDay(r.departureDate, true)}
                {r.status === 'aguardando' && (
                  <>
                    {' · '}
                    <DepartureHint date={r.departureDate} today={data.today} />
                  </>
                )}
              </dd>
              <dt>Pedido por</dt>
              <dd>
                {r.createdBy.name}, {formatDateTime(r.createdAt)}
              </dd>
              {r.notes && (
                <>
                  <dt>Observações</dt>
                  <dd className="sol-texto">{r.notes}</dd>
                </>
              )}
            </dl>
            <LinesTable request={r} />
            {context && r.supplierId && <SupplierContext request={r} data={data} context={context} onProduction={onProduction} />}
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            {decider ? (
              <>
                <div className="esq">
                  <button type="button" className="btn perigo" onClick={() => go('recusar')}>
                    <Icon name="fechar" />
                    Recusar
                  </button>
                </div>
                <button type="button" className="btn primario" onClick={startApproval}>
                  <Icon name="check" />
                  Aprovar
                </button>
              </>
            ) : (
              <>
                {cancellable && (
                  <div className="esq">
                    <button type="button" className="btn perigo" onClick={() => go('cancelar')}>
                      Cancelar solicitação
                    </button>
                  </div>
                )}
                <button type="button" className="btn" onClick={onClose}>
                  Fechar
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

function ApprovedField({ type, requested, priceCents, value, onChange }: { type: ContainerType; requested: number; priceCents: number; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="sol-aprovar-linha">
      <label htmlFor={id}>
        <b>{CONTAINER_LABELS[type]}</b>
        <span className="mudo">
          Pedidos: {requested} · {formatUsd(priceCents)} cada
        </span>
      </label>
      <input id={id} className="campo campo-qtd" type="number" inputMode="numeric" min={0} max={requested} step={1} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}

/** A situação da solicitação, com quem decidiu e o que escreveu. */
function Decision({ request: r, agentView }: { request: BookingRequest; agentView: boolean }) {
  const by = r.decidedBy?.name ?? '';
  const when = r.decidedAt ? formatDateTime(r.decidedAt) : '';
  switch (r.status) {
    case 'aguardando':
      return (
        <p className="aviso alerta">
          <Icon name="relogio" />
          <span>{agentView ? 'Aguardando aprovação. Não reserve os containers antes da resposta.' : `Aguardando aprovação desde ${formatDateTime(r.createdAt)}.`}</span>
        </p>
      );
    case 'aprovada':
      return (
        <div className="aviso ok">
          <Icon name="check" />
          <span>
            Aprovada por {by} em {when}
            {approvedLess(r) ? `: ${containersText(r.lines, 'aprovado')}, de ${containersText(r.lines)} pedidos.` : '.'}
            {agentView && ' Pode reservar o que foi aprovado.'}
            {r.decisionNote && <span className="sol-citacao">{r.decisionNote}</span>}
          </span>
        </div>
      );
    case 'recusada':
      return (
        <div className="aviso critico">
          <Icon name="fechar" />
          <span>
            Recusada por {by} em {when}.{agentView && ' Não reserve.'}
            <span className="sol-citacao">{r.decisionNote}</span>
          </span>
        </div>
      );
    case 'cancelada':
      return (
        <p className="aviso neutro">
          <Icon name="desfazer" />
          <span>
            Cancelada por {by} em {when}.
          </span>
        </p>
      );
  }
}

function LinesTable({ request: r }: { request: BookingRequest }) {
  const decided = r.status === 'aprovada';
  return (
    <div className="tabela-caixa resumo-caixa sol-tabela" role="region" aria-label="Containers" tabIndex={0}>
      <table className="tabela-resumo">
        <thead>
          <tr>
            <th>Container</th>
            <th className="num">Pedidos</th>
            {decided && <th className="num">Aprovados</th>}
            <th className="num">Valor de cada</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sortedLines(r.lines).map((l) => (
            <tr key={l.containerType}>
              <td>{CONTAINER_LABELS[l.containerType]}</td>
              <td className="num" data-rot="Pedidos">
                {l.quantity}
              </td>
              {decided && (
                <td className={`num${(l.approvedQuantity ?? 0) < l.quantity ? ' alerta-texto' : ''}`} data-rot="Aprovados">
                  {l.approvedQuantity ?? 0}
                </td>
              )}
              <td className="num" data-rot="Valor de cada">
                {formatUsd(l.priceCents)}
              </td>
              <td className="num" data-rot="Total">
                {formatUsd((decided ? (l.approvedQuantity ?? 0) : l.quantity) * l.priceCents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total{decided ? ' aprovado' : ''}</th>
            <td className="num" data-rot="Pedidos">
              {containerCount(r.lines)}
            </td>
            {decided && (
              <td className="num" data-rot="Aprovados">
                {containerCount(r.lines, 'aprovado')}
              </td>
            )}
            <td className="sol-vazio" />
            <td className="num" data-rot="Total">
              {formatUsd(bookingTotalCents(r.lines, shownAmount(r)))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** O que o fornecedor tem em produção e no mar, a última chegada e as outras solicitações dele. */
function SupplierContext({ request: r, data, context, onProduction }: { request: BookingRequest; data: BookingsData; context: BookingContext; onProduction?: (supplierId: string) => void }) {
  const { production, suppliers } = context;
  const summary = suppliers?.find((s) => s.supplierId === r.supplierId) ?? null;
  const seeValues = production?.seeValues ?? false;
  const orders = useMemo(
    () => new Set((production?.items ?? []).filter((i) => i.status === 'producao' && i.supplierId === r.supplierId && i.purchaseOrderId).map((i) => i.purchaseOrderId)).size,
    [production, r.supplierId],
  );
  const coming = useMemo(
    () =>
      production
        ? shipmentUnits(production.bills, production.invoices, production.today)
            .filter((u) => u.group !== 'chegaram' && u.supplierIds.includes(r.supplierId))
            .sort((a, b) => (a.eta ?? '9999').localeCompare(b.eta ?? '9999'))
        : [],
    [production, r.supplierId],
  );
  const others = otherBookingsOfSupplier(data.requests, r);
  const amount = (a: { quantity: number; valueCents?: number }) => (seeValues && a.valueCents !== undefined ? `${formatUsd(a.valueCents)} · ${formatQuantity(a.quantity)} ex.` : `${formatQuantity(a.quantity)} ex.`);
  const next = coming[0];

  return (
    <section className="sol-contexto" aria-labelledby="sol-contexto-titulo">
      <div className="sol-contexto-topo">
        <h3 id="sol-contexto-titulo">A {r.supplierName} agora</h3>
        {onProduction && r.supplierId && (
          <button type="button" className="btn-texto" onClick={() => onProduction(r.supplierId!)}>
            Ver a produção
          </button>
        )}
      </div>
      {!production || !suppliers ? (
        <p className="mudo" role="status">
          Carregando a situação do fornecedor…
        </p>
      ) : (
        <div className="sol-ctx-grade">
          <div>
            <span className="rotulo">Em produção</span>
            <b>{summary ? amount(summary.production) : '0 ex.'}</b>
            <span className="mudo">{orders === 0 ? 'Nenhuma PO aberta' : orders === 1 ? 'em 1 PO' : `em ${orders} POs`}</span>
          </div>
          <div>
            <span className="rotulo">No mar</span>
            <b>{summary && summary.atSea.quantity > 0 ? amount(summary.atSea) : 'Nada no mar'}</b>
            <span className="mudo">
              {coming.length === 0
                ? 'Nenhum embarque a caminho'
                : `${coming.length === 1 ? '1 embarque' : `${coming.length} embarques`} · ${next?.eta ? arrivalText(arrivalState(next.eta, null, production.today)).toLowerCase() : 'sem previsão'}`}
            </span>
          </div>
          <div>
            <span className="rotulo">Última chegada</span>
            <b>{summary?.lastArrival ? formatDay(summary.lastArrival, true) : 'Nenhuma'}</b>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div className="sol-outras">
          <span className="rotulo">Outras solicitações da {r.supplierName}</span>
          <ul>
            {others.map((o) => (
              <li key={o.id}>
                <span>
                  {o.reference && `${o.reference} · `}
                  {formatDay(dayOf(o.createdAt), true)} · {containersText(o.lines, shownAmount(o))}
                </span>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------- Nova solicitação (agente) ----------

interface LineDraft {
  key: number;
  containerType: ContainerType;
  quantity: string;
  price: string;
}

let nextKey = 1;
function draft(containerType: ContainerType): LineDraft {
  return { key: nextKey++, containerType, quantity: '', price: '' };
}

export function NewBookingDialog({ open, data, onClose, onCreated }: { open: boolean; data: BookingsData; onClose: () => void; onCreated: (request: BookingRequest) => void }) {
  const [reference, setReference] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [port, setPort] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [draft('40HC')]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { reference: useId(), supplier: useId(), port: useId(), ports: useId(), date: useId(), notes: useId() };
  const ports = useMemo(() => portSuggestions(data.requests), [data.requests]);

  useEffect(() => {
    if (!open) return;
    setReference('');
    setSupplierId('');
    setPort('');
    setDate('');
    setNotes('');
    setLines([draft('40HC')]);
    setError(null);
    setBusy(false);
  }, [open]);

  const parsed = lines.map((l) => ({
    containerType: l.containerType,
    quantity: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : NaN,
    priceCents: parseContainerPrice(l.price) ?? NaN,
  }));
  const complete = parsed.every((l) => Number.isFinite(l.quantity) && Number.isFinite(l.priceCents));
  const count = parsed.reduce((s, l) => s + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const total = complete ? parsed.reduce((s, l) => s + l.quantity * l.priceCents, 0) : null;
  const unused = CONTAINER_TYPES.filter((t) => !lines.some((l) => l.containerType === t));

  function update(key: number, change: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const referenceError = referenceProblem(reference);
    if (referenceError) return setError(referenceError);
    if (!supplierId) return setError('Escolha o fornecedor.');
    const unreadable = lines.find((l, i) => l.price.trim() && Number.isNaN(parsed[i]!.priceCents));
    if (unreadable) return setError(`O valor de cada container de ${CONTAINER_LABELS[unreadable.containerType]} não é um número. Escreva, por exemplo, 2.850,00.`);
    const input = { reference: normalizeReference(reference), departurePort: port.replace(/\s+/g, ' ').trim(), departureDate: date, lines: parsed.map((l) => ({ ...l, quantity: Number.isNaN(l.quantity) ? 0 : l.quantity, priceCents: Number.isNaN(l.priceCents) ? 0 : l.priceCents })) };
    const problem = bookingProblem(input, data.today);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await api.createBooking({ supplierId, notes: notes.trim(), ...input });
      onCreated(res.request);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Nova solicitação de embarque" open={open} onClose={onClose} wide className="dlg-solicitacao">
      <form onSubmit={submit} noValidate>
        <div className="dlg-corpo">
          <p className="dica-texto">O que o fornecedor está pedindo para este embarque. A solicitação vai para aprovação; reserve os containers só depois da resposta, que aparece nesta tela.</p>
          <div className="grupo sol-ref-campo">
            <label className="rotulo" htmlFor={ids.reference}>
              Número de referência
            </label>
            <input
              id={ids.reference}
              className="campo"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={REFERENCE_MAX}
              placeholder="Ex.: SZX-2026-118"
              required
              autoComplete="off"
              aria-describedby={`${ids.reference}-dica`}
            />
            <span id={`${ids.reference}-dica`} className="dica">
              O número que você dá a este embarque. Aparece no lugar de destaque da solicitação; dá para corrigir depois.
            </span>
          </div>
          <div className="grade-campos sol-campos">
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.supplier}>
                Fornecedor
              </label>
              <select id={ids.supplier} className="campo" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Escolha o fornecedor</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.port}>
                Porto de saída
              </label>
              <input id={ids.port} className="campo" value={port} onChange={(e) => setPort(e.target.value)} list={ids.ports} maxLength={80} placeholder="Ex.: Shenzhen" required autoComplete="off" />
              <datalist id={ids.ports}>
                {ports.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={ids.date}>
                Saída prevista
              </label>
              <input id={ids.date} className="campo" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <fieldset className="sol-linhas">
            <legend className="rotulo">Containers</legend>
            {lines.map((l, i) => (
              <ContainerLine
                key={l.key}
                line={l}
                index={i}
                types={CONTAINER_TYPES.filter((t) => t === l.containerType || !lines.some((o) => o.containerType === t))}
                onChange={(change) => update(l.key, change)}
                onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((o) => o.key !== l.key)) : undefined}
              />
            ))}
            {unused.length > 0 && (
              <button type="button" className="btn alinha-inicio" onClick={() => setLines((ls) => [...ls, draft(unused[0]!)])}>
                <Icon name="mais" />
                Outro tipo de container
              </button>
            )}
          </fieldset>
          <p className="sol-total" aria-live="polite">
            Total: <b>{count === 1 ? '1 container' : `${count} containers`}</b>
            {total !== null && (
              <>
                {' · '}
                <b>{formatUsd(total)}</b>
              </>
            )}
          </p>

          <div className="grupo">
            <label className="rotulo" htmlFor={ids.notes}>
              Observações (opcional)
            </label>
            <textarea id={ids.notes} className="campo" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder="Navio, número da reserva, o que o fornecedor disse…" />
          </div>
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar para aprovação'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ContainerLine({ line, index, types, onChange, onRemove }: { line: LineDraft; index: number; types: readonly ContainerType[]; onChange: (change: Partial<LineDraft>) => void; onRemove?: () => void }) {
  const ids = { type: useId(), qty: useId(), price: useId() };
  const n = index + 1;
  return (
    <div className="sol-linha" role="group" aria-label={`Container ${n}`}>
      <div className="grupo">
        <label className="rotulo" htmlFor={ids.type}>
          Tipo
        </label>
        <select id={ids.type} className="campo" value={line.containerType} onChange={(e) => onChange({ containerType: e.target.value as ContainerType })}>
          {types.map((t) => (
            <option key={t} value={t}>
              {CONTAINER_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="grupo">
        <label className="rotulo" htmlFor={ids.qty}>
          Quantidade
        </label>
        <input id={ids.qty} className="campo" type="number" inputMode="numeric" min={1} max={99} step={1} value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} required />
      </div>
      <div className="grupo">
        <label className="rotulo" htmlFor={ids.price}>
          Valor de cada (US$)
        </label>
        <input id={ids.price} className="campo" inputMode="decimal" value={line.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="2.850,00" required autoComplete="off" />
      </div>
      {onRemove ? (
        <button type="button" className="btn sol-tirar" onClick={onRemove} aria-label={`Tirar o container ${CONTAINER_LABELS[line.containerType]}`}>
          <Icon name="lixeira" />
        </button>
      ) : (
        <span className="sol-tirar-vago" aria-hidden="true" />
      )}
    </div>
  );
}

/** Contador da aba: o número e, para o leitor de tela, a frase inteira. */
export function PendingBadge({ data }: { data: BookingsData | null }) {
  const n = data ? pendingCount(data.requests) : 0;
  if (!n) return null;
  return (
    <span className="aba-conta">
      {n}
      <span className="so-leitor"> aguardando aprovação</span>
    </span>
  );
}
