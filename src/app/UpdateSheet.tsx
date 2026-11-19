// Atualizar pela planilha (pedido do Gabriel em 19/11/2026), para admin e editor: a lista baixada pelo
// "Baixar .xlsx" da Produção volta com o que foi mudado nela. Lê a planilha no navegador, compara com o
// app (src/core/updateSheet.ts), mostra só os itens que mudaram, com o antes e o depois, e grava depois
// da confirmação. Só mudam a aprovação do arquivo, a programação de envio e as observações.

import { Fragment, useState, type ReactNode } from 'react';
import { IMPORT_BATCH, IMPORT_MAX_ROWS, type RowNote } from '../core/importProduction';
import { NO_ORDER } from '../core/items';
import { isItemCodeHeader, parseUpdateRows, SHEET_FIELD_LABELS, SHEET_FIELDS, type UpdateSheetReport } from '../core/updateSheet';
import { api, ApiError } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

type Step =
  | { kind: 'escolher' }
  | { kind: 'lendo' }
  | { kind: 'conferir'; file: string; report: UpdateSheetReport }
  | { kind: 'gravando'; done: number; total: number }
  | { kind: 'pronto'; updated: number; skipped: RowNote[] };

const itens = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'item' : 'itens'}`;
const linhas = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'linha' : 'linhas'}`;

/** A aba com o código do item: a lista baixada tem uma aba só, "Produção", que a pessoa pode ter renomeado. */
function pickSheet(sheets: readonly { name: string; rows: string[][] }[]): string[][] {
  const isProduction = (s: { name: string }) => s.name.normalize('NFC').trim().toLowerCase() === 'produção';
  const withCode = sheets.filter((s) => s.rows.slice(0, 15).some((r) => r.some(isItemCodeHeader)));
  return (withCode.find(isProduction) ?? withCode[0] ?? sheets.find(isProduction) ?? sheets[0])?.rows ?? [];
}

export function UpdateSheetDialog({ open, production, onClose, onToast }: { open: boolean; production: Production; onClose: () => void; onToast: (msg: string) => void }) {
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
      const { readWorkbook } = await import('./spreadsheet');
      // Compara com o app como está agora, não com a tela carregada há até meio minuto.
      const [sheets, fresh] = await Promise.all([readWorkbook(await file.arrayBuffer(), IMPORT_MAX_ROWS), api.production()]);
      const report = parseUpdateRows(pickSheet(sheets), fresh.items, fresh.orders);
      if ('error' in report) throw new Error(report.error);
      setStep({ kind: 'conferir', file: file.name, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
      setStep({ kind: 'escolher' });
    }
  }

  async function save(file: string, report: UpdateSheetReport) {
    const items = report.updates.map((u) => ({ id: u.id, row: u.row, marks: u.marks, ...u.patch }));
    let updated = 0;
    const skipped: RowNote[] = [];
    setError(null);
    setStep({ kind: 'gravando', done: 0, total: items.length });
    try {
      await production.write(async () => {
        for (let i = 0; i < items.length; i += IMPORT_BATCH) {
          const res = await api.updateItemsFromSheet(items.slice(i, i + IMPORT_BATCH));
          updated += res.updated;
          skipped.push(...res.skipped);
          setStep({ kind: 'gravando', done: Math.min(items.length, i + IMPORT_BATCH), total: items.length });
        }
      });
      setStep({ kind: 'pronto', updated, skipped });
      onToast(updated === 1 ? '1 item atualizado.' : `${itens(updated)} atualizados.`);
    } catch (e) {
      // As partes já gravadas ficam; mandar de novo não repete nada (o que já está gravado não muda).
      const saved = updated ? ` ${updated === 1 ? '1 item já foi gravado' : `${itens(updated)} já foram gravados`}; grave de novo para continuar.` : '';
      setError(`${e instanceof ApiError ? e.message : 'Não foi possível gravar.'}${saved}`);
      setStep({ kind: 'conferir', file, report });
    }
  }

  return (
    <Dialog title="Atualizar pela planilha" open={open} onClose={close} wide>
      {step.kind === 'escolher' || step.kind === 'lendo' ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a lista baixada pelo <b>Baixar .xlsx</b> da Produção, depois de mudar nela a <b>aprovação do arquivo</b>, a <b>programação de envio</b> ou as{' '}
            <b>observações</b>. Antes de gravar, aparecem só os itens que mudaram, com o antes e o depois.
          </p>
          <ul className="lista-dicas">
            <li>Quantidade, preço, PO e o resto só mudam na ficha do item.</li>
            <li>A programação de envio vai como &quot;dez/2026: 20.000; fev/2027: 20.000&quot;; um mês sozinho vale para o item inteiro.</li>
            <li>Não mude a coluna &quot;Código do item&quot;: é por ela que o app acha cada item.</li>
          </ul>
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
        <Review report={step.report} file={step.file} error={error} onBack={() => setStep({ kind: 'escolher' })} onSave={() => void save(step.file, step.report)} onClose={close} />
      ) : step.kind === 'gravando' ? (
        <div className="dlg-corpo" role="status">
          <p>
            Gravando… {step.done} de {itens(step.total)}.
          </p>
          <progress max={step.total} value={step.done} className="progresso" />
        </div>
      ) : (
        <>
          <div className="dlg-corpo">
            {step.updated > 0 ? (
              <p className="aviso ok">
                <Icon name="check" />
                <span>{step.updated === 1 ? '1 item atualizado' : `${itens(step.updated)} atualizados`}, com a mudança no histórico de cada um.</span>
              </p>
            ) : (
              <p className="aviso alerta">
                <Icon name="alerta" />
                <span>Nenhum item foi gravado.</span>
              </p>
            )}
            {step.skipped.length > 0 && (
              <details className="conferir" open>
                <summary>
                  {itens(step.skipped.length)} não {step.skipped.length === 1 ? 'foi gravado' : 'foram gravados'}
                </summary>
                <ul>
                  {step.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="mudo">Linha {s.row}:</span> {s.message}
                    </li>
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

function Value({ text }: { text: string }) {
  return text ? <span className="mud-valor">{text}</span> : <span className="mud-valor mud-vazio">vazio</span>;
}

function Notes({ title, notes, open }: { title: string; notes: readonly RowNote[]; open?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <details className="conferir" open={open}>
      <summary>{title}</summary>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>
            <span className="mudo">Linha {n.row}:</span> {n.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Review({ report, file, error, onBack, onSave, onClose }: { report: UpdateSheetReport; file: string; error: string | null; onBack: () => void; onSave: () => void; onClose: () => void }) {
  const n = report.updates.length;
  const problems = report.problems.length;
  const total = n + report.unchanged + problems;
  const missing = SHEET_FIELDS.filter((f) => !report.fields.includes(f)).map((f) => SHEET_FIELD_LABELS[f]);
  // "81 itens na planilha. 5 mudaram; 74 estão como no app; 2 não entram (veja abaixo)."
  const parts: ReactNode[] = [];
  if (n > 0) parts.push(<b key="n">{n === 1 ? '1 mudou' : `${n.toLocaleString('pt-BR')} mudaram`}</b>);
  if (report.unchanged === total) parts.push(total === 1 ? 'Ele está como no app' : 'Todos estão como no app');
  else if (report.unchanged > 0) parts.push(`${report.unchanged.toLocaleString('pt-BR')} ${report.unchanged === 1 ? 'está' : 'estão'} como no app`);
  if (problems > 0) parts.push(`${problems.toLocaleString('pt-BR')} não ${problems === 1 ? 'entra' : 'entram'} (veja abaixo)`);
  return (
    <>
      <div className="dlg-corpo">
        <p className="dica-texto">
          {file && (
            <>
              <b>{file}</b>:{' '}
            </>
          )}
          {itens(total)} na planilha.{' '}
          {parts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && '; '}
              {part}
            </Fragment>
          ))}
          .{n > 0 && ' Confira antes de gravar.'}
        </p>
        {n > 0 ? (
          <div className="tabela-caixa resumo-caixa mud-caixa" tabIndex={0} role="region" aria-label="Itens que mudam">
            <ul className="mud-lista">
              {report.updates.map((u) => (
                <li key={u.id} className="mud-item">
                  <p className="mud-cab">
                    <span className="mud-nome">{u.description}</span>
                    <span className="mud-meta">
                      {u.orderCode ?? NO_ORDER} · linha {u.row}
                    </span>
                  </p>
                  <dl className="mud-campos">
                    {u.changes.map((c) => (
                      <div key={c.field} className="mud-campo">
                        <dt>{SHEET_FIELD_LABELS[c.field]}</dt>
                        <dd className="mud-antes">
                          <span className="mud-rot">Antes</span>
                          <Value text={c.from} />
                        </dd>
                        <dd className="mud-depois">
                          <span className="mud-rot">Depois</span>
                          <Value text={c.to} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="aviso neutro">
            <Icon name="check" />
            <span>Nenhum item mudou na aprovação do arquivo, na programação de envio nem nas observações.</span>
          </p>
        )}
        <Notes title={`${linhas(report.problems.length)} não ${report.problems.length === 1 ? 'entra' : 'entram'}`} notes={report.problems} open />
        <Notes title={`${linhas(report.warnings.length)} com aviso`} notes={report.warnings} />
        {missing.length > 0 && (
          <p className="dica">
            {missing.length === 1
              ? `A planilha não tem a coluna ${missing[0]}; ela fica como está no app.`
              : `A planilha não tem as colunas ${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}; elas ficam como estão no app.`}
          </p>
        )}
        <FormError message={error} />
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onBack}>
          Outra planilha
        </button>
        {n > 0 ? (
          <button type="button" className="btn primario" onClick={onSave}>
            Gravar {itens(n)}
          </button>
        ) : (
          <button type="button" className="btn primario" onClick={onClose}>
            Fechar
          </button>
        )}
      </div>
    </>
  );
}
