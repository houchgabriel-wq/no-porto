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
  shipmentUnits,
  shipProblem,
  spDate,
  totalDue,
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
    // Chegada registrada na própria invoice vale mais que a do BL (containers em dias diferentes).
    expect(arrivalOf({ billId: 'b1', eta: null, arrivedAt: '2026-11-20' }, bills)).toEqual({ eta: '2026-11-26', arrivedAt: '2026-11-20' });
  });

  it('em liberação, previsto, chegou e sem previsão', () => {
    const today = '2026-11-17';
    expect(arrivalState('2026-11-13', null, today)).toEqual({ kind: 'liberacao', days: 4 });
    expect(arrivalState('2026-11-17', null, today)).toEqual({ kind: 'previsto', days: 0 });
    expect(arrivalState('2026-11-26', '2026-11-25', today)).toEqual({ kind: 'chegou', on: '2026-11-25' });
    expect(arrivalState(null, null, today)).toEqual({ kind: 'sem_previsao' });
    expect(arrivalText({ kind: 'liberacao', days: 4 })).toBe('Em liberação · previsão há 4 dias');
    expect(arrivalText({ kind: 'previsto', days: 1 })).toBe('Chega amanhã');
    expect(arrivalText({ kind: 'previsto', days: 9 })).toBe('Chega em 9 dias');
  });

  it('grupos da lista de chegadas, por semana (segunda a domingo)', () => {
    // 17/11/2026 é uma terça-feira.
    const today = '2026-11-17';
    expect(arrivalGroup('2026-11-13', null, today)).toBe('liberacao');
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
    const base = { id: '', productId: '', isbn: null, description: '', supplierId: 's', purchaseOrderId: null, invoiceId: 'v', status: 'embarcado' as const, piecesPerCarton: null, notes: '', createdAt: '', updatedAt: '' };
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

describe('tela de embarques', () => {
  const bill = (id: string, eta: string | null, arrivedAt: string | null = null) => ({ id, number: id.toUpperCase(), eta, arrivedAt, notes: '' });
  const invoice = (id: string, billId: string | null, supplierId: string, eta: string | null = null) => ({ id, number: id, ref: '', supplierId, billId, eta, arrivedAt: null, notes: '' });

  it('junta as invoices por BL e ordena pela chegada', () => {
    const today = '2026-11-17';
    const units = shipmentUnits(
      [bill('b1', '2026-12-10'), bill('b2', '2026-11-13'), bill('b3', '2026-11-01', '2026-11-05'), bill('b4', '2026-11-20')],
      [invoice('46a', 'b4', 's1'), invoice('46b', 'b4', 's1'), invoice('w1', 'b1', 's1'), invoice('55', 'b2', 's2'), invoice('108', null, 's3', '2026-11-21'), invoice('old', 'b3', 's2')],
      today,
    );
    expect(units.map((u) => [u.key, u.group, u.invoices.map((i) => i.id)])).toEqual([
      ['bl:b2', 'liberacao', ['55']],
      ['bl:b4', 'semana', ['46a', '46b']],
      ['inv:108', 'semana', ['108']],
      ['bl:b1', 'depois', ['w1']],
      ['bl:b3', 'chegaram', ['old']],
    ]);
  });

  it('a pagar: soma o que falta nas invoices, sem as quitadas', () => {
    const base = { productId: '', isbn: null, description: '', supplierId: 's', purchaseOrderId: null, status: 'embarcado' as const, piecesPerCarton: null, notes: '', createdAt: '', updatedAt: '' };
    const items: Item[] = [
      { ...base, id: '1', invoiceId: 'a', quantity: 1000, unitPriceMicros: 500_000 },
      { ...base, id: '2', invoiceId: 'b', quantity: 1000, unitPriceMicros: 300_000 },
      { ...base, id: '3', invoiceId: 'c', quantity: 1000, unitPriceMicros: 200_000 },
    ];
    const invoices = ['a', 'b', 'c'].map((id) => invoice(id, null, 's'));
    const payments = [
      { id: 'p1', invoiceId: 'a', paidAt: null, amountCents: null, exchangeRateE4: null, notes: '' },
      { id: 'p2', invoiceId: 'b', paidAt: null, amountCents: 10_000, exchangeRateE4: null, notes: '' },
    ];
    expect(totalDue(invoices, items, payments)).toEqual({ dueCents: 20_000 + 20_000, invoices: 2 });
  });
});
