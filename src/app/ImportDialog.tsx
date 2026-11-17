// Carga da aba Produção (SPEC.md, seção 7), só para o admin: lê a planilha no navegador, mostra o
// resumo por fornecedor para comparar com a planilha, e grava em partes de 500 itens.

import { useState } from 'react';
import { IMPORT_BATCH, parseProductionRows, summarizeImport, type ImportReport } from '../core/importProduction';
import { formatQuantity, formatUsd } from '../core/money';
import { api, ApiError } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

const SHEET = 'Produção';

type Step =
  | { kind: 'escolher' }
  | { kind: 'lendo' }
  | { kind: 'conferir'; file: string; report: ImportReport }
  | { kind: 'gravando'; done: number; total: number }
  | { kind: 'pronto'; inserted: number; skipped: number };

export function ImportDialog({ open, production, onClose, onToast }: { open: boolean; production: Production; onClose: () => void; onToast: (msg: string) => void }) {
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
      const report = parseProductionRows(res.rows);
      if ('error' in report) throw new Error(report.error);
      if (report.items.length === 0) throw new Error(`A aba "${SHEET}" não tem itens.`);
      setStep({ kind: 'conferir', file: file.name, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setStep({ kind: 'escolher' });
    }
  }

  async function save(report: ImportReport) {
    const items = report.items;
    let inserted = 0;
    let skipped = 0;
    setError(null);
    setStep({ kind: 'gravando', done: 0, total: items.length });
    try {
      await production.write(async () => {
        for (let i = 0; i < items.length; i += IMPORT_BATCH) {
          const res = await api.importProduction(items.slice(i, i + IMPORT_BATCH));
          inserted += res.inserted;
          skipped += res.skipped;
          setStep({ kind: 'gravando', done: Math.min(items.length, i + IMPORT_BATCH), total: items.length });
        }
      });
      setStep({ kind: 'pronto', inserted, skipped });
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
    <Dialog title="Carga da aba Produção" open={open} onClose={close} wide>
      {step.kind === 'escolher' || step.kind === 'lendo' ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a planilha <b>status_importações</b> em .xlsx (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel). Só a aba <b>{SHEET}</b> é lida. Antes de
            gravar, aparece um resumo por fornecedor para comparar com a planilha.
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
        <Review report={step.report} file={step.file} error={error} onBack={() => setStep({ kind: 'escolher' })} onSave={() => void save(step.report)} />
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
