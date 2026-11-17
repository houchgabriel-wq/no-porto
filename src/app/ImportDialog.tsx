// Carga das abas Produção e Embarques (SPEC.md, seção 7), só para o admin: lê a planilha no
// navegador, mostra o resumo para comparar com a planilha (por fornecedor, ou por invoice) e grava em
// partes de 500 itens.

import { useState } from 'react';
import { IMPORT_BATCH, parseProductionRows, summarizeImport, type ImportReport } from '../core/importProduction';
import { parseShipmentRows, summarizeShipments, type ShipmentImportReport } from '../core/importShipments';
import { formatDay } from '../core/shipments';
import { formatQuantity, formatUsd } from '../core/money';
import { api, ApiError } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

export type ImportSheet = 'Produção' | 'Embarques';

type Report = ImportReport | ShipmentImportReport;

type Step =
  | { kind: 'escolher' }
  | { kind: 'lendo' }
  | { kind: 'conferir'; file: string; report: Report }
  | { kind: 'gravando'; done: number; total: number }
  | { kind: 'pronto'; inserted: number; skipped: number; withoutOrder: string[] };

export function ImportDialog({ sheet, production, onClose, onToast }: { sheet: ImportSheet | null; production: Production; onClose: () => void; onToast: (msg: string) => void }) {
  const SHEET = sheet ?? 'Produção';
  const [step, setStep] = useState<Step>({ kind: 'escolher' });
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (step.kind === 'gravando') return;
    setStep({ kind: 'escolher' });
    setError(null);
    onClose();
  }

  async function read(file: File) {
    setError(null);
    setStep({ kind: 'lendo' });
    try {
      const { readSheetRows } = await import('./spreadsheet');
      const res = await readSheetRows(await file.arrayBuffer(), SHEET);
      if ('missing' in res) throw new Error(`A planilha não tem a aba "${SHEET}". Abas encontradas: ${res.missing.join(', ') || 'nenhuma'}.`);
      const report = SHEET === 'Produção' ? parseProductionRows(res.rows) : parseShipmentRows(res.rows);
      if ('error' in report) throw new Error(report.error);
      if (report.items.length === 0) throw new Error(`A aba "${SHEET}" não tem itens.`);
      setStep({ kind: 'conferir', file: file.name, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setStep({ kind: 'escolher' });
    }
  }

  async function save(report: Report) {
    const items = report.items;
    let inserted = 0;
    let skipped = 0;
    const withoutOrder: string[] = [];
    setError(null);
    setStep({ kind: 'gravando', done: 0, total: items.length });
    try {
      await production.write(async () => {
        for (let i = 0; i < items.length; i += IMPORT_BATCH) {
          const part = items.slice(i, i + IMPORT_BATCH);
          const res =
            SHEET === 'Produção'
              ? await api.importProduction(part as ImportReport['items'])
              : { ...(await api.importShipments(part as ShipmentImportReport['items'])), withoutOrder: [] };
          inserted += res.inserted;
          skipped += res.skipped;
          withoutOrder.push(...res.withoutOrder);
          setStep({ kind: 'gravando', done: Math.min(items.length, i + IMPORT_BATCH), total: items.length });
        }
      });
      setStep({ kind: 'pronto', inserted, skipped, withoutOrder });
      onToast(`${inserted} itens gravados.`);
    } catch (e) {
      // As partes já gravadas ficam; mandar de novo pula o que já entrou.
      setError(
        `${e instanceof ApiError ? e.message : 'Não foi possível gravar.'} ${inserted ? `${inserted} itens já foram gravados; mande a planilha de novo para continuar (o que já entrou é pulado).` : ''}`.trim(),
      );
      setStep({ kind: 'conferir', file: '', report });
    }
  }

  return (
    <Dialog title={`Carga da aba ${SHEET}`} open={sheet !== null} onClose={close} wide>
      {step.kind === 'escolher' || step.kind === 'lendo' ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a planilha <b>status_importações</b> em .xlsx (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel). Só a aba <b>{SHEET}</b> é lida. Antes de
            gravar, aparece um resumo {SHEET === 'Produção' ? 'por fornecedor' : 'por invoice'} para comparar com a planilha.
          </p>
          <label className="btn primario arquivo">
            <Icon name="arquivo" />
            {step.kind === 'lendo' ? 'Lendo a planilha…' : 'Escolher planilha'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={step.kind === 'lendo'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void read(f);
              }}
            />
          </label>
          <FormError message={error} />
        </div>
      ) : step.kind === 'conferir' ? (
        SHEET === 'Produção' ? (
          <Review report={step.report as ImportReport} file={step.file} error={error} onBack={() => setStep({ kind: 'escolher' })} onSave={() => void save(step.report)} />
        ) : (
          <ShipmentReview report={step.report as ShipmentImportReport} file={step.file} error={error} onBack={() => setStep({ kind: 'escolher' })} onSave={() => void save(step.report)} />
        )
      ) : step.kind === 'gravando' ? (
        <div className="dlg-corpo" role="status">
          <p>
            Gravando… {step.done} de {step.total} itens.
          </p>
          <progress max={step.total} value={step.done} className="progresso" />
        </div>
      ) : (
        <>
          <div className="dlg-corpo">
            <p className="aviso ok">
              <Icon name="check" />
              <span>
                {step.inserted} itens gravados.
                {step.skipped > 0 && ` ${step.skipped} já estavam cadastrados e foram pulados.`}
              </span>
            </p>
            {step.withoutOrder.length > 0 && (
              <details className="conferir" open>
                <summary>
                  {step.withoutOrder.length} {step.withoutOrder.length === 1 ? 'item entrou' : 'itens entraram'} sem PO, porque a PO já é de outro fornecedor
                </summary>
                <ul>
                  {step.withoutOrder.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn primario" onClick={close}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Review({ report, file, error, onBack, onSave }: { report: ImportReport; file: string; error: string | null; onBack: () => void; onSave: () => void }) {
  const summary = summarizeImport(report.items);
  return (
    <>
      <div className="dlg-corpo">
        <p className="dica-texto">
          {file && (
            <>
              <b>{file}</b>:{' '}
            </>
          )}
          {report.items.length} itens em {summary.orders} POs. Compare com a planilha antes de gravar.
        </p>
        <div className="tabela-caixa resumo-caixa">
          <table className="tabela-resumo">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th className="num">Itens</th>
                <th className="num">Exemplares</th>
                <th className="num">Valor</th>
                <th className="num">Sem preço</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySupplier.map((r) => (
                <tr key={r.supplier}>
                  <td>{r.supplier}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{formatQuantity(r.quantity)}</td>
                  <td className="num">{formatUsd(r.valueCents)}</td>
                  <td className="num">{r.unpriced || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{summary.total.items}</td>
                <td className="num">{formatQuantity(summary.total.quantity)}</td>
                <td className="num">{formatUsd(summary.total.valueCents)}</td>
                <td className="num">{summary.total.unpriced || '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {report.warnings.length > 0 && (
          <details className="conferir">
            <summary>
              {report.warnings.length} {report.warnings.length === 1 ? 'linha entra' : 'linhas entram'} com aviso
            </summary>
            <ul>
              {report.warnings.map((w, i) => (
                <li key={i}>
                  <span className="mudo">Linha {w.row}:</span> {w.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {report.skipped.length > 0 && (
          <details className="conferir">
            <summary>
              {report.skipped.length} {report.skipped.length === 1 ? 'linha não entra' : 'linhas não entram'}
            </summary>
            <ul>
              {report.skipped.map((w, i) => (
                <li key={i}>
                  <span className="mudo">Linha {w.row}:</span> {w.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="dica">Itens já cadastrados (mesma PO, produto, quantidade e preço) são pulados.</p>
        <FormError message={error} />
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onBack}>
          Outra planilha
        </button>
        <button type="button" className="btn primario" onClick={onSave}>
          Gravar {report.items.length} itens
        </button>
      </div>
    </>
  );
}

function Notes({ report }: { report: Report }) {
  return (
    <>
      {report.warnings.length > 0 && (
        <details className="conferir">
          <summary>
            {report.warnings.length} {report.warnings.length === 1 ? 'linha entra' : 'linhas entram'} com aviso
          </summary>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i}>
                <span className="mudo">Linha {w.row}:</span> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.skipped.length > 0 && (
        <details className="conferir">
          <summary>
            {report.skipped.length} {report.skipped.length === 1 ? 'linha não entra' : 'linhas não entram'}
          </summary>
          <ul>
            {report.skipped.map((w, i) => (
              <li key={i}>
                <span className="mudo">Linha {w.row}:</span> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ShipmentReview({ report, file, error, onBack, onSave }: { report: ShipmentImportReport; file: string; error: string | null; onBack: () => void; onSave: () => void }) {
  const summary = summarizeShipments(report.items);
  return (
    <>
      <div className="dlg-corpo">
        <p className="dica-texto">
          {file && (
            <>
              <b>{file}</b>:{' '}
            </>
          )}
          {report.items.length} itens em {summary.invoices.length} invoices e {summary.bills} BLs. Compare com a planilha antes de gravar.
        </p>
        <div className="tabela-caixa resumo-caixa">
          <table className="tabela-resumo">
            <thead>
              <tr>
                <th>BL</th>
                <th>Invoice</th>
                <th>Fornecedor</th>
                <th>Chegada</th>
                <th className="num">Itens</th>
                <th className="num">Valor</th>
                <th>Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {summary.invoices.map((r) => (
                <tr key={`${r.supplier}|${r.invoice}`}>
                  <td className={r.bill ? undefined : 'mudo'}>{r.bill ?? 'Sem BL'}</td>
                  <td>
                    {r.invoice}
                    {r.ref && <span className="t-isbn">{r.ref}</span>}
                  </td>
                  <td>{r.supplier}</td>
                  <td className="nowrap">{r.eta ? formatDay(r.eta, true) : '—'}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{formatUsd(r.valueCents)}</td>
                  <td>{r.paid ? 'Pago' : 'A pagar'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  Total · {formatQuantity(summary.total.quantity)} exemplares
                </th>
                <td className="num">{summary.total.items}</td>
                <td className="num">{formatUsd(summary.total.valueCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <Notes report={report} />
        <p className="dica">Itens já cadastrados (mesma invoice, produto, quantidade e preço) são pulados. Invoice marcada como paga entra como paga, sem data e sem câmbio.</p>
        <FormError message={error} />
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onBack}>
          Outra planilha
        </button>
        <button type="button" className="btn primario" onClick={onSave}>
          Gravar {report.items.length} itens
        </button>
      </div>
    </>
  );
}
