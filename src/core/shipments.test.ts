import { describe, expect, it } from 'vitest';
import type { Item } from './items';
import {
  arrivalGroup,
  arrivalOf,
  arrivalState,
  arrivalText,
  daysBetween,
  formatDay,
  invoiceTotal,
  itemStatusFor,
  parseDate,
  paymentSummary,
  shipProblem,
  spDate,
} from './shipments';

describe('datas', () => {
  it('dia em São Paulo', () => {
    expect(spDate(new Date('2026-11-18T02:30:00Z'))).toBe('2026-11-17');
    expect(spDate(new Date('2026-11-18T03:30:00Z'))).toBe('2026-11-18');
  });

  it('lê dia/mês/ano e AAAA-MM-DD, recusando datas que não existem', () => {
    expect(parseDate('26/11/2026')).toBe('2026-11-26');
    expect(parseDate('2/1/2027')).toBe('2027-01-02');
    expect(parseDate('2026-12-10')).toBe('2026-12-10');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('chegada 29/08')).toBeNull();
  });

  it('dias entre datas e formato curto', () => {
    expect(daysBetween('2026-11-17', '2026-11-26')).toBe(9);
    expect(daysBetween('2026-11-17', '2026-11-13')).toBe(-4);
    expect(formatDay('2026-11-26')).toBe('26 nov');
    expect(formatDay('2026-11-26', true)).toBe('26/11/2026');
  });
});

describe('chegada', () => {
  const bills = new Map([['b1', { eta: '2026-11-26', arrivedAt: null }]]);

  it('com BL vale a do BL; sem BL, a da invoice', () => {
    expect(arrivalOf({ billId: 'b1', eta: '2026-01-01', arrivedAt: null }, bills)).toEqual({ eta: '2026-11-26', arrivedAt: null });
    expect(arrivalOf({ billId: null, eta: '2026-11-21', arrivedAt: null }, bills)).toEqual({ eta: '2026-11-21', arrivedAt: null });
  });

  it('atrasado, previsto, chegou e sem previsão', () => {
    const today = '2026-11-17';
    expect(arrivalState('2026-11-13', null, today)).toEqual({ kind: 'atrasado', days: 4 });
    expect(arrivalState('2026-11-17', null, today)).toEqual({ kind: 'previsto', days: 0 });
    expect(arrivalState('2026-11-26', '2026-11-25', today)).toEqual({ kind: 'chegou', on: '2026-11-25' });
    expect(arrivalState(null, null, today)).toEqual({ kind: 'sem_previsao' });
    expect(arrivalText({ kind: 'atrasado', days: 4 })).toBe('Atrasado 4 dias');
    expect(arrivalText({ kind: 'previsto', days: 1 })).toBe('Chega amanhã');
    expect(arrivalText({ kind: 'previsto', days: 9 })).toBe('Chega em 9 dias');
  });

  it('grupos da lista de chegadas, por semana (segunda a domingo)', () => {
    // 17/11/2026 é uma terça-feira.
    const today = '2026-11-17';
    expect(arrivalGroup('2026-11-13', null, today)).toBe('atrasados');
    expect(arrivalGroup('2026-11-22', null, today)).toBe('semana');
    expect(arrivalGroup('2026-11-23', null, today)).toBe('proxima');
    expect(arrivalGroup('2026-12-10', null, today)).toBe('depois');
    expect(arrivalGroup(null, null, today)).toBe('sem_previsao');
    expect(arrivalGroup('2026-11-13', '2026-11-14', today)).toBe('chegaram');
  });

  it('situação do item pelo embarque', () => {
    expect(itemStatusFor(null, null)).toBe('producao');
    expect(itemStatusFor('inv', null)).toBe('embarcado');
    expect(itemStatusFor('inv', '2026-11-20')).toBe('entregue');
  });
});

describe('pagamento da invoice', () => {
  it('a pagar, pago em parte e pago', () => {
    expect(paymentSummary(100_000, [])).toEqual({ status: 'a_pagar', paidCents: 0, dueCents: 100_000, paidReaisCents: 0 });
    expect(paymentSummary(100_000, [{ amountCents: 30_000, exchangeRateE4: 54_000 }])).toEqual({
      status: 'parcial',
      paidCents: 30_000,
      dueCents: 70_000,
      paidReaisCents: 162_000,
    });
    expect(paymentSummary(100_000, [{ amountCents: 30_000, exchangeRateE4: null }, { amountCents: 70_000, exchangeRateE4: null }]).status).toBe('pago');
  });

  it('pagamento antigo, sem valor, quita a invoice', () => {
    expect(paymentSummary(100_000, [{ amountCents: null, exchangeRateE4: null }])).toEqual({ status: 'pago', paidCents: 0, dueCents: 0, paidReaisCents: 0 });
  });

  it('invoice sem itens com preço e sem pagamento continua a pagar', () => {
    expect(paymentSummary(0, []).status).toBe('a_pagar');
  });

  it('total da invoice: soma dos itens com preço', () => {
    const base = { id: '', productId: '', isbn: null, description: '', supplierId: 's', purchaseOrderId: null, status: 'embarcado' as const, piecesPerCarton: null, notes: '', createdAt: '', updatedAt: '' };
    const items: Item[] = [
      { ...base, quantity: 9440, unitPriceMicros: 330_000 },
      { ...base, quantity: 100, unitPriceMicros: null },
    ];
    expect(invoiceTotal(items)).toBe(311_520);
  });
});

describe('embarcar', () => {
  const item = (id: string, supplierId: string | null, quantity = 1000, status: 'producao' | 'embarcado' = 'producao') => ({ id, supplierId, quantity, status, description: `Livro ${id}` });

  it('aceita itens em produção do mesmo fornecedor, inteiros ou em parte', () => {
    expect(shipProblem([{ item: item('a', 's1'), quantity: 1000 }, { item: item('b', 's1'), quantity: 400 }], null)).toBeNull();
    expect(shipProblem([{ item: item('a', 's1'), quantity: 1000 }], 's1')).toBeNull();
  });

  it('recusa fornecedores misturados, invoice de outro fornecedor e item sem fornecedor', () => {
    expect(shipProblem([{ item: item('a', 's1'), quantity: 1 }, { item: item('b', 's2'), quantity: 1 }], null)).toBe(
      'Uma invoice tem um fornecedor só: embarque os itens de cada fornecedor separadamente.',
    );
    expect(shipProblem([{ item: item('a', 's1'), quantity: 1 }], 's2')).toBe('Esta invoice é de outro fornecedor.');
    expect(shipProblem([{ item: item('a', null), quantity: 1 }], null)).toContain('sem fornecedor');
  });

  it('recusa quantidade fora do que está em produção e item já embarcado', () => {
    expect(shipProblem([{ item: item('a', 's1'), quantity: 1001 }], null)).toBe('"Livro a": só há 1000 em produção.');
    expect(shipProblem([{ item: item('a', 's1'), quantity: 0 }], null)).toContain('maior que zero');
    expect(shipProblem([{ item: item('a', 's1', 1000, 'embarcado'), quantity: 10 }], null)).toBe('"Livro a" já está embarcado.');
    expect(shipProblem([], null)).toBe('Escolha os itens para embarcar.');
  });
});
