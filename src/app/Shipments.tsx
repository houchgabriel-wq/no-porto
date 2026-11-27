// Tela Embarques (SPEC.md, seção 5): os BLs e as invoices a caminho, agrupados pela chegada
// (os em liberação primeiro), com o valor no mar e o que falta pagar. Funciona também como a lista de
// chegadas. Quem não vê valores (o leitor) vê exemplares e não vê pagamentos. Os containers com
// prioridade no desembaraço e no transporte têm a marca e vêm antes no seu grupo (26/11/2026).

import { useMemo, useState } from 'react';
import { NO_SUPPLIER, searchKey, totals, type Item } from '../core/items';
import { formatQuantity, formatUsd } from '../core/money';
import {
  ARRIVAL_GROUP_LABELS,
  arrivalState,
  arrivalText,
  containerArrival,
  formatDay,
  hasPriority,
  invoiceTotal,
  partialArrivalText,
  PAYMENT_LABELS,
  paymentSummary,
  shipmentUnits,
  totalDue,
  type ArrivalGroup,
  type ShipmentUnit,
} from '../core/shipments';
import type { ProductionData } from './api';
import { supplierHue, hueStyle } from './components';
import { Icon } from './icons';
import { headline, itemsCount } from './Production';

interface Props {
  data: ProductionData;
  onOpen: (unitKey: string) => void;
  actions: React.ReactNode;
}

export function ShipmentsView({ data, onOpen, actions }: Props) {
  const [query, setQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [onlyPriority, setOnlyPriority] = useState(false);
  // O perfil Embarques, que o marketing usa, não vê os fornecedores (24/11/2026).
  const { seeValues, seeSuppliers } = data;
  const units = useMemo(() => shipmentUnits(data.bills, data.invoices, data.today), [data.bills, data.invoices, data.today]);
  const itemsByInvoice = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of data.items) if (item.invoiceId) map.set(item.invoiceId, [...(map.get(item.invoiceId) ?? []), item]);
    return map;
  }, [data.items]);
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);
  const atSea = useMemo(() => totals(data.items.filter((i) => i.status === 'embarcado'), seeValues), [data.items, seeValues]);
  const due = useMemo(() => (seeValues ? totalDue(data.invoices, data.items, data.payments) : null), [seeValues, data]);

  const words = searchKey(query).split(' ').filter(Boolean);
  // Containers com prioridade que ainda não chegaram; sem nenhum, o filtro some (e deixa de valer).
  const priorityCount = units.reduce((s, u) => s + u.priority, 0);
  const priorityOnly = onlyPriority && priorityCount > 0;
  const shown = units.filter((u) => {
    if (priorityOnly && u.priority === 0) return false;
    if (supplierId && !u.supplierIds.includes(supplierId)) return false;
    if (!words.length) return true;
    const hay = searchKey(
      [
        u.bill?.number ?? '',
        ...u.invoices.flatMap((v) => [v.number, v.ref, v.supplierId ? (names.get(v.supplierId) ?? '') : '', ...(itemsByInvoice.get(v.id) ?? []).map((i) => `${i.description} ${i.isbn ?? ''}`)]),
      ].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
  const groups = new Map<ArrivalGroup, ShipmentUnit[]>();
  for (const u of shown) groups.set(u.group, [...(groups.get(u.group) ?? []), u]);
  const clearing = units.filter((u) => u.group === 'liberacao').length;
  const onTheWay = units.filter((u) => u.group !== 'chegaram').length;
  const suppliersOnTheWay = data.suppliers.filter((s) => units.some((u) => u.supplierIds.includes(s.id)));

  const ctx = { data, itemsByInvoice, names, onOpen };

  return (
    <>
      <section className="emb-faixa" aria-label="Resumo dos embarques">
        <div className="emb-total">
          <span className="forn-rot">No mar</span>
          <b>{headline(atSea)}</b>
          <span className="forn-sub">
            {itemsCount(atSea.items)}
            {seeValues && ` · ${formatQuantity(atSea.quantity)} ex.`}
          </span>
        </div>
        <div className="emb-stat">
          <span className="stat-ic">
            <Icon name="navio" />
          </span>
          <div>
            <b>{onTheWay}</b>
            <span>{onTheWay === 1 ? 'embarque a caminho' : 'embarques a caminho'}</span>
          </div>
        </div>
        <div className={`emb-stat${clearing ? ' alerta' : ''}`}>
          <span className="stat-ic">
            <Icon name="alerta" />
          </span>
          <div>
            <b>{clearing}</b>
            <span>em liberação (previsão já passou)</span>
          </div>
        </div>
        {due && (
          <div className={`emb-stat${due.dueCents ? ' alerta' : ' ok'}`}>
            <span className="stat-ic">
              <Icon name="check" />
            </span>
            <div>
              <b>{formatUsd(due.dueCents)}</b>
              <span>{due.invoices ? `a pagar em ${due.invoices} ${due.invoices === 1 ? 'invoice' : 'invoices'}` : 'tudo pago'}</span>
            </div>
          </div>
        )}
      </section>

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input className="campo" type="search" placeholder="Buscar BL, invoice, ref., produto" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {seeSuppliers && (
          <>
            <label className="so-leitor" htmlFor="emb-forn">
              Fornecedor
            </label>
            <select id="emb-forn" className="campo filtro-sel" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Fornecedor: todos</option>
              {suppliersOnTheWay.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}
        {priorityCount > 0 && (
          <button type="button" className={`btn filtro-prioridade${priorityOnly ? ' ativo' : ''}`} aria-pressed={priorityOnly} onClick={() => setOnlyPriority(!priorityOnly)}>
            <Icon name="flag" />
            {priorityCount === 1 ? '1 container com prioridade' : `${priorityCount} containers com prioridade`}
          </button>
        )}
        <div className="filtros-acoes">{actions}</div>
      </div>

      {units.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum embarque ainda. Marque itens na Produção e use "Embarcar", ou faça a carga da aba Embarques.</div>
      ) : shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum embarque com estes filtros.</div>
      ) : (
        [...groups].map(([group, list]) =>
          group === 'chegaram' ? (
            <details key={group} className="emb-grupo chegaram">
              <summary>
                <h2>{ARRIVAL_GROUP_LABELS[group]}</h2>
                <span className="mudo">{list.length} nos últimos 60 dias</span>
              </summary>
              <UnitGrid units={list} ctx={ctx} />
            </details>
          ) : (
            <section key={group} className={`emb-grupo ${group}`} aria-labelledby={`grupo-${group}`}>
              <div className="emb-grupo-topo">
                <h2 id={`grupo-${group}`}>
                  {group === 'liberacao' && <Icon name="alerta" />}
                  {ARRIVAL_GROUP_LABELS[group]}
                </h2>
                <span className="mudo">{list.length === 1 ? '1 embarque' : `${list.length} embarques`}</span>
              </div>
              <UnitGrid units={list} ctx={ctx} />
            </section>
          ),
        )
      )}
    </>
  );
}

interface Ctx {
  data: ProductionData;
  itemsByInvoice: Map<string, Item[]>;
  names: Map<string, string>;
  onOpen: (unitKey: string) => void;
}

function UnitGrid({ units, ctx }: { units: ShipmentUnit[]; ctx: Ctx }) {
  return (
    <ul className="emb-grade">
      {units.map((u) => (
        <li key={u.key}>
          <UnitCard unit={u} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

function UnitCard({ unit, ctx }: { unit: ShipmentUnit; ctx: Ctx }) {
  const { data, itemsByInvoice, names } = ctx;
  const state = arrivalState(unit.eta, unit.arrivedAt, data.today);
  const items = unit.invoices.flatMap((v) => itemsByInvoice.get(v.id) ?? []);
  const t = totals(items, data.seeValues);
  const suppliers = unit.supplierIds.map((id) => (id ? (names.get(id) ?? NO_SUPPLIER) : NO_SUPPLIER));
  const title = unit.bill ? `BL ${unit.bill.number}` : `Invoice ${unit.invoices[0]?.number ?? ''}`;
  return (
    <button type="button" className={`emb-cartao estado-${state.kind}${unit.priority ? ' prioridade' : ''}`} onClick={() => ctx.onOpen(unit.key)}>
      <span className="emb-topo">
        <span className="emb-titulo">{title}</span>
        <span className="emb-topo-pilulas">
          {unit.priority > 0 && (
            <span className="pilula prioridade">
              <Icon name="flag" />
              {unit.invoices.length > 1 && unit.priority < unit.invoices.length ? `Prioridade em ${unit.priority} de ${unit.invoices.length}` : 'Prioridade'}
            </span>
          )}
          <span className={`pilula chegada ${state.kind}`}>
            {state.kind === 'liberacao' && <Icon name="alerta" />}
            {arrivalText(state)}
          </span>
          {/* Parte dos containers do BL chegou (27/11/2026): cada um chega no seu dia. */}
          {unit.arrived > 0 && unit.arrived < unit.invoices.length && (
            <span className="pilula parcial">
              <Icon name="check" />
              {partialArrivalText(unit.arrived, unit.invoices.length)}
            </span>
          )}
        </span>
      </span>
      <span className="emb-meta">
        {data.seeSuppliers &&
          suppliers.map((s, i) => (
            <span key={s}>
              {i > 0 && ', '}
              <span className="forn-ponto h" style={hueStyle(unit.supplierIds[i] ? supplierHue(unit.supplierIds[i]!) : 0)} aria-hidden="true" />
              {s}
            </span>
          ))}
        {/* Sem os fornecedores, a linha começa pela previsão, sem o " · " na frente. */}
        {[
          unit.eta && state.kind !== 'chegou' ? `previsão ${formatDay(unit.eta, true)}` : null,
          !unit.bill ? 'sem BL' : null,
        ]
          .filter((t): t is string => t !== null)
          .map((t, i) => (
            <span key={t} className="mudo">
              {data.seeSuppliers || i > 0 ? ' · ' : ''}
              {t}
            </span>
          ))}
      </span>
      <span className="emb-invoices">
        {unit.invoices.map((v) => {
          const its = itemsByInvoice.get(v.id) ?? [];
          const pay = data.seeValues ? paymentSummary(invoiceTotal(its), data.payments.filter((p) => p.invoiceId === v.id)) : null;
          // No BL que chegou em parte, o container que já chegou leva o dia.
          const came = unit.arrived < unit.invoices.length ? containerArrival(v, unit.bill) : null;
          return (
            <span key={v.id} className="emb-inv">
              <span className="emb-inv-num">
                {hasPriority(v, unit) && unit.invoices.length > 1 && (
                  <span className="emb-inv-prio" title="Container com prioridade">
                    <Icon name="flag" />
                    <span className="so-leitor">Prioridade: </span>
                  </span>
                )}
                {v.number}
                {v.ref && v.ref !== v.number && <span className="mudo"> · {v.ref}</span>}
                {v.unit && <span className="emb-inv-ctr"> · {v.unit.container}</span>}
                {came && (
                  <span className="emb-inv-chegou">
                    {' '}
                    · <Icon name="check" />
                    chegou em {formatDay(came)}
                  </span>
                )}
              </span>
              <span className="emb-inv-dir">
                {data.seeValues ? formatUsd(invoiceTotal(its)) : `${formatQuantity(its.reduce((s, i) => s + i.quantity, 0))} ex.`}
                {pay && <span className={`pilula pag ${pay.status}`}>{PAYMENT_LABELS[pay.status]}</span>}
              </span>
            </span>
          );
        })}
      </span>
      <span className="emb-pe">
        <span>
          {itemsCount(t.items)} · {formatQuantity(t.quantity)} ex.
        </span>
        {data.seeValues && <b>{formatUsd(t.valueCents ?? 0)}</b>}
      </span>
    </button>
  );
}
