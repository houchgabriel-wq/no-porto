// Tela Fornecedores (SPEC.md, seção 5): o que cada fornecedor tem em produção e no mar, o que
// entregou no ano e no total, e a última chegada. A ficha mostra o entregue por ano e permite
// corrigir o nome e anotar observações. O leitor vê exemplares no lugar dos valores.

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

export function SupplierDialog({
  supplier,
  me,
  seeValues,
  onClose,
  onSaved,
  onProduction,
}: {
  supplier: SupplierSummary | null;
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

  useEffect(() => {
    setName(supplier?.name ?? '');
    setNotes(supplier?.notes ?? '');
    setError(null);
    setBusy(false);
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
