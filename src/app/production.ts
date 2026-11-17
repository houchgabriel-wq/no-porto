// Dados da produção na tela: carrega, recarrega a cada meio minuto e ao voltar para a aba, e aplica
// na hora o que a própria pessoa grava.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '../core/items';
import { api, ApiError, type ProductionData } from './api';

/** De quanto em quanto tempo a tela aberta busca as mudanças dos outros. */
const REFRESH_MS = 30_000;

export function useProduction() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = useRef(0);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.production();
      // Não troca os dados no meio de uma gravação, para a mudança da pessoa não piscar.
      if (busy.current === 0) setData(fresh);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar a produção.');
    }
  }, []);

  useEffect(() => {
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
  }, [reload]);

  /** Roda uma gravação e recarrega depois (fornecedor ou PO novos vêm junto). */
  const write = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      busy.current++;
      try {
        return await action();
      } finally {
        busy.current--;
        await reload();
      }
    },
    [reload],
  );

  const putItem = useCallback((item: Item) => {
    setData((d) => (d ? { ...d, items: d.items.some((i) => i.id === item.id) ? d.items.map((i) => (i.id === item.id ? item : i)) : [...d.items, item] } : d));
  }, []);

  const removeItem = useCallback((id: string) => {
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== id) } : d));
  }, []);

  return { data, loadError, reload, write, putItem, removeItem };
}

export type Production = ReturnType<typeof useProduction>;
