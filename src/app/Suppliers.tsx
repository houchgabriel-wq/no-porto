// Tela Fornecedores (SPEC.md, seção 5): o que cada fornecedor tem em produção e no mar, o que
// entregou no ano e no total, e a última chegada. A ficha mostra o entregue por ano e permite
// corrigir o nome e anotar observações; o admin junta dois fornecedores que são a mesma empresa. O
// leitor vê exemplares no lugar dos valores.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { formatQuantity, formatUsdWhole } from '../core/money';
import { can } from '../core/roles';
import { formatDay } from '../core/shipments';
import type { Amount, SupplierSummary } from '../core/suppliers';
import { api, ApiError, type Me } from './api';
import { Dialog, FormError, supplierHue, hueStyle } from './components';
import { Icon } from './icons';
import { itemsCount } from './Production';

export interface SuppliersData {
  suppliers: SupplierSummary[];
  seeValues: boolean;
}

function amount(a: Amount): string {
  if (a.items === 0) return '—';
  return a.valueCents === undefined ? `${formatQuantity(a.quantity)} ex.` : formatUsdWhole(a.valueCents);
}

function sub(a: Amount, seeValues: boolean): string {
  if (a.items === 0) return '';
  return seeValues ? `${itemsCount(a.items)} · ${formatQuantity(a.quantity)} ex.` : itemsCount(a.items);
}

const yearLabel = (y: string) => (y === 'sem-data' ? 'Sem data' : y);

interface Props {
  data: SuppliersData;
  year: string;
  onOpen: (s: SupplierSummary) => void;
  actions: React.ReactNode;
}

export function SuppliersView({ data, year, onOpen, actions }: Props) {
  const { seeValues, suppliers } = data;
  const inYear = (s: SupplierSummary) => s.byYear.find((y) => y.year === year) ?? { items: 0, quantity: 0, ...(seeValues ? { valueCents: 0 } : {}) };
  return (
    <>
      <div className="filtros">
        <p className="dica-texto">
          {suppliers.length} {suppliers.length === 1 ? 'fornecedor' : 'fornecedores'}. Clique num fornecedor para ver o entregue por ano e as observações.
        </p>
        <div className="filtros-acoes">{actions}</div>
      </div>
      <div className="tabela-caixa">
        <table className="tabela-forn tabela-empilha">
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th className="num">Em produção</th>
              <th className="num">No mar</th>
              <th className="num">Recebido em {year}</th>
              <th className="num">Recebido desde 2023</th>
              <th>Última chegada</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.supplierId ?? 'sem'}>
                <td>
                  <button type="button" className="abrir-item" onClick={() => onOpen(s)}>
                    <span className="forn-ponto h" style={hueStyle(s.supplierId ? supplierHue(s.supplierId) : 0)} aria-hidden="true" />
                    {s.name}
                  </button>
                  {s.notes && <span className="t-isbn">{s.notes}</span>}
                </td>
                {[s.production, s.atSea, inYear(s), s.delivered].map((a, i) => (
                  <td key={i} className="num" data-rot={['Em produção', 'No mar', `Recebido em ${year}`, 'Recebido desde 2023'][i]}>
                    <b className={a.items ? undefined : 'mudo'}>{amount(a)}</b>
                    <span className="t-isbn">{sub(a, seeValues)}</span>
                  </td>
                ))}
                <td className="nowrap" data-rot="Última chegada">{s.lastArrival ? formatDay(s.lastArrival, true) : <span className="mudo">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** O que a confirmação de juntar diz que vai passar de um fornecedor para o outro. */
function movedText(gone: SupplierSummary, keepName: string): string {
  const n = gone.production.items + gone.atSea.items + gone.delivered.items;
  if (n === 0) return `${gone.name} não tem itens; só o nome deixa de aparecer.`;
  return `${n === 1 ? 'O item' : `Os ${itemsCount(n)}`} de ${gone.name} ${n === 1 ? 'passa' : 'passam'} para ${keepName}.`;
}

export function SupplierDialog({
  supplier,
  all,
  me,
  seeValues,
  onClose,
  onSaved,
  onProduction,
}: {
  supplier: SupplierSummary | null;
  /** Todos os fornecedores, para escolher com qual juntar. */
  all: readonly SupplierSummary[];
  me: Me;
  seeValues: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onProduction: (supplierId: string) => void;
}) {
  const ids = useId();
  const canEdit = can(me.role, 'edit') && supplier?.supplierId !== null;
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canMerge = can(me.role, 'delete') && supplier?.supplierId !== null;
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState('');
  const [confirmMerge, setConfirmMerge] = useState(false);

  useEffect(() => {
    setName(supplier?.name ?? '');
    setNotes(supplier?.notes ?? '');
    setError(null);
    setBusy(false);
    setMerging(false);
    setInto('');
    setConfirmMerge(false);
  }, [supplier]);

  if (!supplier) return <Dialog title="Fornecedor" open={false} onClose={onClose} />;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateSupplier(supplier!.supplierId!, { name, notes });
      onSaved('Fornecedor salvo.');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
      setBusy(false);
    }
  }

  const others = all.filter((s) => s.supplierId && s.supplierId !== supplier.supplierId);
  const target = others.find((s) => s.supplierId === into);

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.mergeSupplier(supplier!.supplierId!, into);
      onSaved(`${supplier!.name} agora faz parte de ${res.supplier.name}.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível juntar os fornecedores.');
      setConfirmMerge(false);
      setBusy(false);
    }
  }

  return (
    <Dialog title={supplier.name} open onClose={onClose} wide>
      <div className="dlg-corpo">
        <div className="prod-stats">
          <div>
            <b>{amount(supplier.production)}</b>
            <span>em produção</span>
          </div>
          <div>
            <b>{amount(supplier.atSea)}</b>
            <span>no mar</span>
          </div>
          <div>
            <b>{amount(supplier.delivered)}</b>
            <span>recebido desde 2023</span>
          </div>
          <div>
            <b>{supplier.lastArrival ? formatDay(supplier.lastArrival, true) : '—'}</b>
            <span>última chegada</span>
          </div>
        </div>
        {supplier.byYear.length > 0 && (
          <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="Recebido por ano">
            <table className="tabela-resumo">
              <thead>
                <tr>
                  <th>Ano de chegada</th>
                  <th className="num">Itens</th>
                  <th className="num">Exemplares</th>
                  {seeValues && <th className="num">Valor</th>}
                </tr>
              </thead>
              <tbody>
                {supplier.byYear.map((y) => (
                  <tr key={y.year}>
                    <td>{yearLabel(y.year)}</td>
                    <td className="num">{y.items}</td>
                    <td className="num">{formatQuantity(y.quantity)}</td>
                    {seeValues && <td className="num">{formatUsdWhole(y.valueCents ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {supplier.supplierId && supplier.production.items > 0 && (
          <button type="button" className="btn-texto alinha-inicio" onClick={() => onProduction(supplier.supplierId!)}>
            <Icon name="caixa" /> Ver os itens em produção
          </button>
        )}
      </div>
      {supplier.supplierId && (
        <form onSubmit={save}>
          <fieldset className="dlg-corpo grade" disabled={!canEdit || busy}>
            <legend className="so-leitor">Dados do fornecedor</legend>
            <div className="grupo largo">
              <label className="rotulo" htmlFor={`${ids}-n`}>
                Nome
              </label>
              <input id={`${ids}-n`} className="campo" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grupo largo">
              <label className="rotulo" htmlFor={`${ids}-o`}>
                Observações
              </label>
              <textarea id={`${ids}-o`} className="campo" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contato, prazos, condições de pagamento…" />
            </div>
          </fieldset>
          {canMerge && others.length > 0 && (
            <div className="dlg-corpo juntar-caixa">
              {!merging ? (
                <button type="button" className="btn-texto alinha-inicio" onClick={() => setMerging(true)} disabled={busy}>
                  <Icon name="pessoas" /> Juntar com outro fornecedor
                </button>
              ) : (
                <section className="juntar" aria-labelledby={`${ids}-jt`}>
                  <h3 id={`${ids}-jt`}>Juntar com outro fornecedor</h3>
                  <p className="mudo">
                    Para quando são a mesma empresa. Tudo o que é de {supplier.name} (produção, embarques, histórico e solicitações de embarque) passa para o
                    fornecedor escolhido, as observações se somam e {supplier.name} deixa de aparecer.
                  </p>
                  <div className="juntar-linha">
                    <div className="grupo">
                      <label className="rotulo" htmlFor={`${ids}-j`}>
                        Passar tudo para
                      </label>
                      <select
                        id={`${ids}-j`}
                        className="campo"
                        value={into}
                        disabled={busy || confirmMerge}
                        onChange={(e) => setInto(e.target.value)}
                      >
                        <option value="">Escolha o fornecedor</option>
                        {others.map((s) => (
                          <option key={s.supplierId} value={s.supplierId!}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="btn" disabled={!target || busy || confirmMerge} onClick={() => setConfirmMerge(true)}>
                      Juntar…
                    </button>
                    <button
                      type="button"
                      className="btn-texto"
                      disabled={busy}
                      onClick={() => {
                        setMerging(false);
                        setInto('');
                        setConfirmMerge(false);
                      }}
                    >
                      Desistir
                    </button>
                  </div>
                  {confirmMerge && target && (
                    <div className="confirma-exclusao confirma-juntar" role="alertdialog" aria-label={`Juntar ${supplier.name} em ${target.name}`}>
                      <p>
                        <b>
                          Juntar {supplier.name} em {target.name}?
                        </b>{' '}
                        {movedText(supplier, target.name)} Não dá para desfazer pelo app.
                      </p>
                      <div className="confirma-acoes">
                        <button type="button" className="btn" onClick={() => setConfirmMerge(false)} disabled={busy} autoFocus>
                          Cancelar
                        </button>
                        <button type="button" className="btn primario" onClick={() => void merge()} disabled={busy}>
                          {busy ? 'Juntando…' : `Juntar em ${target.name}`}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
          <div className="dlg-corpo sem-topo">
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={onClose}>
              {canEdit ? 'Cancelar' : 'Fechar'}
            </button>
            {canEdit && (
              <button type="submit" className="btn primario" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar'}
              </button>
            )}
          </div>
        </form>
      )}
      {!supplier.supplierId && (
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      )}
    </Dialog>
  );
}
