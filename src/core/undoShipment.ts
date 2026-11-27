// Excluir um embarque ou um container lançado errado (SPEC.md, seção 3). Nada da produção se perde: o
// que saiu da produção volta para ela (a parte que tinha sido dividida se junta de novo ao saldo que
// ficou, com o preço e as peças por caixa de antes); o que não estava na produção (entrou pela invoice,
// ou pela carga da aba Embarques) é apagado.

export type ItemOrigin =
  /**
   * Saiu inteiro da produção; guarda o preço e as peças por caixa de antes, quando registrados, e o nome
   * de antes, quando o embarque trocou pelo da curva ABC (27/11/2026).
   */
  | { kind: 'production'; previousPriceMicros?: number | null; previousPieces?: number | null; previousDescription?: string }
  /** Parte embarcada de um item que ficou com o saldo em produção. */
  | { kind: 'split'; from: string }
  /** Não estava na produção do app. */
  | { kind: 'outside' };

export interface ItemEvent {
  type: string;
  detail: Record<string, unknown>;
}

/** De onde veio o item embarcado, pelos registros do histórico dele (na ordem em que aconteceram). */
export function itemOrigin(events: readonly ItemEvent[]): ItemOrigin {
  if (events.some((e) => e.type === 'imported' && e.detail.sheet !== 'Produção')) return { kind: 'outside' };
  // Vale o último embarque (o item pode ter ido e voltado da produção antes).
  const shipped = [...events].reverse().find((e) => e.type === 'shipped');
  if (!shipped) return { kind: 'outside' };
  if (shipped.detail.notInProduction) return { kind: 'outside' };
  if (typeof shipped.detail.splitFrom === 'string') return { kind: 'split', from: shipped.detail.splitFrom };
  const num = (v: unknown) => (typeof v === 'number' ? v : v === null ? null : undefined);
  const origin: ItemOrigin = { kind: 'production', previousPriceMicros: num(shipped.detail.previousPriceMicros), previousPieces: num(shipped.detail.previousPieces) };
  if (typeof shipped.detail.previousDescription === 'string') origin.previousDescription = shipped.detail.previousDescription;
  return origin;
}

export interface UndoPlan {
  /** Voltam para a produção como estão (com o preço, as peças e o nome de antes, quando conhecidos). */
  back: { id: string; priceMicros?: number | null; pieces?: number | null; description?: string }[];
  /** Juntam-se ao saldo que ficou em produção. */
  merge: { id: string; into: string; quantity: number }[];
  /** São apagados. */
  remove: string[];
}

/**
 * O que acontece com cada item da invoice excluída. `canMergeInto` diz se o saldo de origem ainda está
 * em produção (não foi embarcado nem apagado depois); sem ele, a parte volta sozinha para a produção.
 */
export function planShipmentUndo(items: readonly { id: string; quantity: number; origin: ItemOrigin }[], canMergeInto: (id: string) => boolean): UndoPlan {
  const plan: UndoPlan = { back: [], merge: [], remove: [] };
  for (const { id, quantity, origin } of items) {
    if (origin.kind === 'outside') plan.remove.push(id);
    else if (origin.kind === 'split' && canMergeInto(origin.from)) plan.merge.push({ id, into: origin.from, quantity });
    else if (origin.kind === 'production')
      plan.back.push({ id, priceMicros: origin.previousPriceMicros, pieces: origin.previousPieces, ...(origin.previousDescription !== undefined ? { description: origin.previousDescription } : {}) });
    else plan.back.push({ id });
  }
  return plan;
}
