import { describe, expect, it } from 'vitest';
import { approvalChanges, approvalKey, orderFromPrintOrder, type ApprovalTarget, type NoPreloApproval } from './noPrelo';

const ALICE = '9786583970527';
const approval = (over: Partial<NoPreloApproval>): NoPreloApproval => ({ isbn: '978-65-83970-52-7', printOrder: 'PO-070', approvedAt: '2026-11-12', title: 'Coleção Alice', printer: 'Nicola', ...over });
const item = (over: Partial<ApprovalTarget>): ApprovalTarget => ({ id: 'a', isbn: ALICE, orderCode: 'PO-070', fileApprovedAt: null, fileApprovedFrom: null, ...over });

describe('chave da ligação', () => {
  it('a PO sai da ordem de impressão, escrita de vários jeitos; sem PO, não casa', () => {
    expect(orderFromPrintOrder('PO-070')).toBe('PO-070');
    expect(orderFromPrintOrder('po 70')).toBe('PO-070');
    expect(orderFromPrintOrder('PO-070 / lote 2')).toBe('PO-070');
    expect(orderFromPrintOrder('OP 1234')).toBeNull();
    expect(orderFromPrintOrder('')).toBeNull();
  });

  it('o ISBN vale com ou sem hífens; ISBN inválido ou vazio não casa', () => {
    expect(approvalKey('978-65-83970-52-7', 'PO-070')).toBe(`${ALICE}|PO-070`);
    expect(approvalKey('978-65-83970-52-0', 'PO-070')).toBeNull();
    expect(approvalKey('', 'PO-070')).toBeNull();
    expect(approvalKey(ALICE, null)).toBeNull();
  });
});

describe('aprovações do No Prelo nos itens', () => {
  it('a data de aprovação vai para o item do mesmo ISBN e da mesma PO, inclusive as partes que já embarcaram', () => {
    const items = [item({ id: 'saldo' }), item({ id: 'embarcado' }), item({ id: 'outra-po', orderCode: 'PO-056' }), item({ id: 'outro-livro', isbn: '9786587817675' })];
    expect(approvalChanges([approval({})], items)).toEqual([
      { itemId: 'saldo', from: null, to: '2026-11-12', source: 'noprelo' },
      { itemId: 'embarcado', from: null, to: '2026-11-12', source: 'noprelo' },
    ]);
  });

  it('vale a do No Prelo: a data digitada no No Porto é trocada; a que já veio de lá e está igual não muda', () => {
    expect(approvalChanges([approval({})], [item({ fileApprovedAt: '2026-11-01' })])).toEqual([{ itemId: 'a', from: '2026-11-01', to: '2026-11-12', source: 'noprelo' }]);
    expect(approvalChanges([approval({})], [item({ fileApprovedAt: '2026-11-12', fileApprovedFrom: 'noprelo' })])).toEqual([]);
    // A mesma data, mas digitada no No Porto: passa a vir do No Prelo (fica travada), sem mudar a data.
    expect(approvalChanges([approval({})], [item({ fileApprovedAt: '2026-11-12' })])).toEqual([{ itemId: 'a', from: '2026-11-12', to: '2026-11-12', source: 'noprelo' }]);
  });

  it('o mesmo livro e a mesma PO duas vezes (no quadro e no histórico, ou em dois lotes): vale a aprovação mais antiga', () => {
    const twice = [approval({ approvedAt: '2026-11-20' }), approval({ approvedAt: '2026-11-12', isbn: ALICE, printOrder: 'po 70' })];
    expect(approvalChanges(twice, [item({})])).toEqual([{ itemId: 'a', from: null, to: '2026-11-12', source: 'noprelo' }]);
  });

  it('sem PO na ordem de impressão, com data inválida ou ISBN errado, não casa', () => {
    const bad = [approval({ printOrder: '' }), approval({ approvedAt: '31/12/2026' }), approval({ approvedAt: '2026-02-30' }), approval({ isbn: '978-65-83970-52-0' })];
    expect(approvalChanges(bad, [item({})])).toEqual([]);
  });

  it('o item que vinha do No Prelo e não tem mais aprovação lá fica com a data e volta a poder ser mudado', () => {
    expect(approvalChanges([], [item({ fileApprovedAt: '2026-11-12', fileApprovedFrom: 'noprelo' })])).toEqual([{ itemId: 'a', from: '2026-11-12', to: '2026-11-12', source: null }]);
    // O que foi digitado no No Porto, sem aprovação no No Prelo, não é tocado.
    expect(approvalChanges([], [item({ fileApprovedAt: '2026-11-01' })])).toEqual([]);
  });
});
