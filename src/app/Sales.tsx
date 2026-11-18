// Tela do perfil Vendas (SPEC.md, seção 4): a lista dos produtos a caminho, com a previsão de chegada,
// nada mais. O servidor manda só isso (GET /api/sales); fornecedor, invoice, BL, quantidades e valores
// não chegam ao navegador.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { searchKey } from '../core/items';
import { arrivalText, formatDay } from '../core/shipments';
import type { SalesArrival } from '../core/shippedItems';
import { api, ApiError } from './api';
import { FormError } from './components';
import { Icon } from './icons';

/** Recarrega a lista a cada 5 minutos, como as outras telas fazem com os dados. */
const REFRESH_MS = 5 * 60_000;

export function SalesView() {
  const [rows, setRows] = useState<SalesArrival[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setRows((await api.sales()).rows);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a lista.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const words = searchKey(query).split(' ').filter(Boolean);
  const shown = useMemo(
    () => (rows ?? []).filter((r) => words.every((w) => searchKey(`${r.description} ${r.isbn ?? ''}`).includes(w))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, query],
  );

  if (!rows) {
    return error ? (
      <div className="erro-carga">
        <FormError message={error} />
        <button className="btn" onClick={() => void load()}>
          Tentar de novo
        </button>
      </div>
    ) : (
      <p className="carregando" role="status">
        Carregando os embarques…
      </p>
    );
  }

  return (
    <>
      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input className="campo" type="search" placeholder="Buscar produto ou ISBN" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className="contagem-linha" role="status">
        {shown.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'produto a caminho' : 'produtos a caminho'}` : `${shown.length} de ${rows.length} produtos`}
        {query && (
          <>
            {' '}
            <button type="button" className="btn-texto" onClick={() => setQuery('')}>
              Limpar busca
            </button>
          </>
        )}
      </p>
      {rows.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum produto a caminho no momento.</div>
      ) : shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum produto com esta busca.</div>
      ) : (
        <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Produtos a caminho">
          <table className="tabela-vendas tabela-empilha">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Chegada</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.productId}|${r.eta ?? ''}`}>
                  <td className="t-produto">
                    {r.description}
                    <span className="t-isbn">{r.isbn ?? 'Sem ISBN'}</span>
                  </td>
                  <td className="t-chegada" data-rot="Chegada">
                    <b>{r.eta ? formatDay(r.eta, true) : 'Sem previsão'}</b>
                    {r.eta && (
                      <span className={`pilula chegada ${r.state.kind}`}>
                        {r.state.kind === 'liberacao' && <Icon name="alerta" />}
                        {arrivalText(r.state)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
