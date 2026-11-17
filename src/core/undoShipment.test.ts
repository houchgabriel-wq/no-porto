import { describe, expect, it } from 'vitest';
import { itemOrigin, planShipmentUndo } from './undoShipment';

describe('itemOrigin', () => {
  it('pelo histórico do item', () => {
    expect(itemOrigin([{ type: 'imported', detail: { sheet: 'Embarques', row: 3 } }])).toEqual({ kind: 'outside' });
    expect(itemOrigin([{ type: 'shipped', detail: { invoice: 'A1', quantity: 200, notInProduction: true } }])).toEqual({ kind: 'outside' });
    expect(itemOrigin([{ type: 'shipped', detail: { invoice: 'A1', quantity: 1000, splitFrom: 'x' } }])).toEqual({ kind: 'split', from: 'x' });
    expect(
      itemOrigin([
        { type: 'created', detail: {} },
        { type: 'shipped', detail: { invoice: 'A1', quantity: 3000, previousPriceMicros: 1_700_000, previousPieces: null } },
      ]),
    ).toEqual({ kind: 'production', previousPriceMicros: 1_700_000, previousPieces: null });
    // Embarque antigo, sem o preço de antes registrado.
    expect(itemOrigin([{ type: 'imported', detail: { sheet: 'Produção' } }, { type: 'shipped', detail: { invoice: 'A1' } }])).toEqual({
      kind: 'production',
      previousPriceMicros: undefined,
      previousPieces: undefined,
    });
    expect(itemOrigin([])).toEqual({ kind: 'outside' });
  });
});

describe('planShipmentUndo', () => {
  it('volta, junta ao saldo ou apaga', () => {
    const plan = planShipmentUndo(
      [
        { id: 'a', quantity: 3000, origin: { kind: 'production', previousPriceMicros: 1_700_000, previousPieces: 20 } },
        { id: 'b', quantity: 1000, origin: { kind: 'split', from: 'saldo' } },
        { id: 'c', quantity: 500, origin: { kind: 'split', from: 'embarcado-depois' } },
        { id: 'd', quantity: 200, origin: { kind: 'outside' } },
      ],
      (id) => id === 'saldo',
    );
    expect(plan).toEqual({
      back: [{ id: 'a', priceMicros: 1_700_000, pieces: 20 }, { id: 'c' }],
      merge: [{ id: 'b', into: 'saldo', quantity: 1000 }],
      remove: ['d'],
    });
  });
});
