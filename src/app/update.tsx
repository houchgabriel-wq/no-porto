// Aviso de versão nova (pedido do Gabriel em 30/10/2026; regras em src/core/appUpdate.ts): um cartão
// no canto, que espera a pessoa terminar o que está fazendo e não tira o foco de nada.

import { useCallback, useEffect, useState } from 'react';
import { isNewVersion, showUpdateNotice, UPDATE_CHECK_MS, UPDATE_SNOOZE_MS } from '../core/appUpdate';
import { Icon } from './icons';

const SNOOZE_KEY = 'no-porto:versao-depois';
/** Enquanto há versão nova, de quanto em quanto tempo confere se a pessoa já terminou a tarefa. */
const CALM_CHECK_MS = 1000;

function readSnooze(): number | null {
  try {
    const v = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveSnooze(until: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(until));
  } catch {
    // Só não lembra nas outras abas.
  }
}

/**
 * A pessoa está no meio de uma tarefa: janela aberta, item sendo
 * arrastado, campo em edição ou itens selecionados na tabela.
 */
function isBusy(): boolean {
  if (document.querySelector('dialog[open], .arrastando, .lote')) return true;
  const el = document.activeElement;
  return !!el && el.matches('input, textarea, select, [contenteditable="true"]');
}

export function UpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (res.ok && isNewVersion(__BUILD_ID__, await res.json())) setAvailable(true);
    } catch {
      // Sem conexão ou resposta estranha: confere de novo depois.
    }
  }, []);

  useEffect(() => {
    if (available) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, UPDATE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [available, check]);

  // Com versão nova, o cartão aparece e some conforme a pessoa começa ou termina uma tarefa. O
  // "Depois" é lido a cada vez, para valer também quando foi dado em outra aba.
  useEffect(() => {
    if (!available) return;
    const update = () => setVisible(showUpdateNotice({ available, snoozedUntil: readSnooze(), now: Date.now(), busy: isBusy() }));
    update();
    const timer = setInterval(update, CALM_CHECK_MS);
    return () => clearInterval(timer);
  }, [available]);

  if (!visible) return null;
  return (
    <section className="nova-versao" role="status" aria-labelledby="nova-versao-titulo">
      <div className="selo-ic">
        <Icon name="atualizar" />
      </div>
      <h2 id="nova-versao-titulo">Nova versão do No Porto</h2>
      <p>Saiu uma atualização. Salve o que estiver editando e atualize a página para usar a versão nova.</p>
      <div className="acoes">
        <button
          type="button"
          className="btn"
          onClick={() => {
            saveSnooze(Date.now() + UPDATE_SNOOZE_MS);
            setVisible(false);
          }}
        >
          Depois
        </button>
        <button type="button" className="btn primario" onClick={() => window.location.reload()}>
          Atualizar agora
        </button>
      </div>
    </section>
  );
}
