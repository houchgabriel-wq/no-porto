// Carga completa (SPEC.md, seção 7), só para o admin: a planilha status_importações (ou a cópia
// completa baixada do app) inteira de uma vez. Lê as abas Produção, Embarques e Entregues, mostra o
// resumo de cada uma e grava nessa ordem. Para começar do zero, apaga antes o que está no app,
// depois de a pessoa digitar APAGAR.

import { useEffect, useId, useState } from 'react';
import { summarizeHistory, type HistoryImportReport } from '../core/importHistory';
import { summarizeImport, type ImportReport } from '../core/importProduction';
import { summarizeShipments, type ShipmentImportReport } from '../core/importShipments';
import { formatQuantity, formatUsd } from '../core/money';
import { api, ApiError } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import { HistorySummary, parseSheet, ProductionSummary, saveSheet, ShipmentSummary, type ImportSheet, type Report, type SaveResult } from './ImportDialog';
import type { Production } from './production';

const SHEETS: readonly ImportSheet[] = ['Produção', 'Embarques', 'Entregues'];
const RESET_WORD = 'APAGAR';

type Parsed = { report: Report } | { error: string };

type Step =
  | { kind: 'escolher' }
  | { kind: 'lendo' }
  | { kind: 'conferir'; file: string; parsed: Record<ImportSheet, Parsed> }
  | { kind: 'gravando'; phase: 'apagando' | ImportSheet; done: number; total: number }
  | { kind: 'pronto'; results: Partial<Record<ImportSheet, SaveResult>>; wiped: boolean };

function total(sheet: ImportSheet, report: Report): { items: number; quantity: number; valueCents: number } {
  if (sheet === 'Produção') return summarizeImport((report as ImportReport).items).total;
  if (sheet === 'Embarques') return summarizeShipments((report as ShipmentImportReport).items).total;
  return summarizeHistory((report as HistoryImportReport).items).total;
}

interface Props {
  open: boolean;
  /** O app já tem fornecedores e itens cadastrados. */
  hasData: boolean;
  production: Production;
  backingUp: boolean;
  onBackup: () => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function FullImportDialog({ open, hasData, production, backingUp, onBackup, onClose, onToast }: Props) {
  const ids = useId();
  const [step, setStep] = useState<Step>({ kind: 'escolher' });
  const [wipe, setWipe] = useState(true);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep({ kind: 'escolher' });
    setWipe(true);
    setWord('');
    setError(null);
  }, [open]);

  function close() {
    if (step.kind === 'gravando') return;
    onClose();
  }

  async function read(file: File) {
    setError(null);
    setStep({ kind: 'lendo' });
    try {
      const { readSheets } = await import('./spreadsheet');
      const { sheets, names } = await readSheets(await file.arrayBuffer(), SHEETS);
      if (SHEETS.every((s) => sheets[s] === null)) {
        throw new Error(`A planilha não tem as abas Produção, Embarques e Entregues. Abas encontradas: ${names.join(', ') || 'nenhuma'}.`);
      }
      const parsed = {} as Record<ImportSheet, Parsed>;
      for (const s of SHEETS) {
        const rows = sheets[s];
        const r = rows ? parseSheet(s, rows) : { error: `A planilha não tem a aba "${s}".` };
        parsed[s] = 'error' in r ? { error: r.error } : { report: r };
      }
      setStep({ kind: 'conferir', file: file.name, parsed });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setStep({ kind: 'escolher' });
    }
  }

  async function save(parsed: Record<ImportSheet, Parsed>) {
    const willWipe = hasData && wipe;
    if (willWipe && word.trim().toUpperCase() !== RESET_WORD) return setError(`Digite ${RESET_WORD} para confirmar que o que está no app será apagado.`);
    setError(null);
    const results: Partial<Record<ImportSheet, SaveResult>> = {};
    let current: ImportSheet | 'apagando' = 'apagando';
    try {
      await production.write(async () => {
        if (willWipe) {
          setStep({ kind: 'gravando', phase: 'apagando', done: 0, total: 1 });
          await api.reset(RESET_WORD);
        }
        // Na ordem da planilha: produção, embarques e, por fim, o histórico.
        for (const s of SHEETS) {
          const p = parsed[s];
          if (!('report' in p)) continue;
          current = s;
          const items = p.report.items;
          setStep({ kind: 'gravando', phase: s, done: 0, total: items.length });
          results[s] = await saveSheet(s, items, (done) => setStep({ kind: 'gravando', phase: s, done, total: items.length }));
        }
      });
      setStep({ kind: 'pronto', results, wiped: willWipe });
      const inserted = Object.values(results).reduce((n, r) => n + r.inserted, 0);
      onToast(`Carga completa: ${formatQuantity(inserted)} itens gravados.`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Não foi possível gravar.';
      const done = SHEETS.filter((s) => results[s]).join(', ');
      setError(
        current === 'apagando'
          ? `${msg} Nada foi apagado nem gravado.`
          : `${msg} Parou na aba ${current}${done ? ` (${done} já ${done.includes(',') ? 'foram gravadas' : 'foi gravada'})` : ''}. Mande a planilha de novo, sem apagar: o que já entrou é pulado.`,
      );
      setWipe(false);
      setWord('');
      setStep({ kind: 'conferir', file: '', parsed });
    }
  }

  const loadable = step.kind === 'conferir' ? SHEETS.filter((s) => 'report' in step.parsed[s]) : [];

  return (
    <Dialog title="Carga completa da planilha" open={open} onClose={close} wide>
      {step.kind === 'escolher' || step.kind === 'lendo' ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a planilha <b>status_importações</b> em .xlsx (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel), ou a cópia completa baixada do app. As abas{' '}
            <b>Produção</b>, <b>Embarques</b> e <b>Entregues</b> são lidas de uma vez; antes de gravar, aparece o resumo de cada uma para comparar com a planilha.
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
        <>
          <div className="dlg-corpo">
            {step.file && (
              <p className="dica-texto">
                <b>{step.file}</b>: confira o resumo de cada aba antes de gravar.
              </p>
            )}
            <div className="carga-abas">
              {SHEETS.map((s) => {
                const p = step.parsed[s];
                if (!('report' in p)) {
                  return (
                    <p key={s} className="aviso alerta">
                      <Icon name="alerta" />
                      <span>
                        <b>{s}</b>: {p.error} Esta aba fica de fora.
                      </span>
                    </p>
                  );
                }
                const t = total(s, p.report);
                return (
                  <details key={s} className="conferir carga-aba">
                    <summary>
                      <span>{s}</span>
                      <span className="mudo">
                        {formatQuantity(t.items)} itens · {formatQuantity(t.quantity)} ex. · {formatUsd(t.valueCents)}
                      </span>
                    </summary>
                    <div className="carga-aba-corpo">
                      {s === 'Produção' ? (
                        <ProductionSummary report={p.report as ImportReport} file="" />
                      ) : s === 'Embarques' ? (
                        <ShipmentSummary report={p.report as ShipmentImportReport} file="" />
                      ) : (
                        <HistorySummary report={p.report as HistoryImportReport} file="" />
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            {hasData && (
              <fieldset className="carga-zerar">
                <legend className="so-leitor">O que já está no app</legend>
                <p className="aviso alerta">
                  <Icon name="alerta" />
                  <span>O app já tem dados. Para começar do zero, apague tudo antes de carregar: fornecedores, POs, itens, embarques, pagamentos e o histórico. Os usuários ficam.</span>
                </p>
                <label className="chegada-invoice">
                  <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
                  <span>Apagar o que está no app antes de carregar</span>
                </label>
                {wipe ? (
                  <div className="carga-confirma">
                    <button type="button" className="btn" onClick={onBackup} disabled={backingUp}>
                      <Icon name="arquivo" />
                      {backingUp ? 'Gerando a cópia…' : 'Baixar a cópia completa antes'}
                    </button>
                    <div className="grupo estreito">
                      <label className="rotulo" htmlFor={`${ids}-apagar`}>
                        Digite {RESET_WORD} para confirmar
                      </label>
                      <input id={`${ids}-apagar`} className="campo" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
                    </div>
                  </div>
                ) : (
                  <p className="dica">
                    Sem apagar, o que já está cadastrado igual é pulado. Mas um item que na planilha mudou de aba (por exemplo, embarcou) fica duplicado: continua onde estava no
                    app e entra de novo na aba nova.
                  </p>
                )}
              </fieldset>
            )}
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => setStep({ kind: 'escolher' })}>
              Outra planilha
            </button>
            <button type="button" className="btn primario" disabled={loadable.length === 0} onClick={() => void save(step.parsed)}>
              {hasData && wipe ? 'Apagar e carregar' : `Gravar ${loadable.length === 3 ? 'as três abas' : loadable.join(' e ')}`}
            </button>
          </div>
        </>
      ) : step.kind === 'gravando' ? (
        <div className="dlg-corpo" role="status">
          {step.phase === 'apagando' ? (
            <p>Apagando o que estava no app…</p>
          ) : (
            <>
              <p>
                Gravando a aba {step.phase}… {formatQuantity(step.done)} de {formatQuantity(step.total)} itens.
              </p>
              <progress max={step.total} value={step.done} className="progresso" />
            </>
          )}
        </div>
      ) : (
        <>
          <div className="dlg-corpo">
            <p className="aviso ok">
              <Icon name="check" />
              <span>{step.wiped ? 'O app foi apagado e a planilha carregada.' : 'Planilha carregada.'}</span>
            </p>
            <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="Resultado da carga">
              <table className="tabela-resumo">
                <thead>
                  <tr>
                    <th>Aba</th>
                    <th className="num">Gravados</th>
                    <th className="num">Pulados</th>
                  </tr>
                </thead>
                <tbody>
                  {SHEETS.filter((s) => step.results[s]).map((s) => (
                    <tr key={s}>
                      <td>{s}</td>
                      <td className="num">{formatQuantity(step.results[s]!.inserted)}</td>
                      <td className="num">{step.results[s]!.skipped ? formatQuantity(step.results[s]!.skipped) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(step.results['Produção']?.withoutOrder.length ?? 0) > 0 && (
              <details className="conferir">
                <summary>{step.results['Produção']!.withoutOrder.length} itens entraram sem PO, porque a PO já é de outro fornecedor</summary>
                <ul>
                  {step.results['Produção']!.withoutOrder.map((m, i) => (
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
