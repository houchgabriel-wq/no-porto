import { describe, expect, it } from 'vitest';
import { itemExportRows } from './exportItems';
import { itemForViewer, type Item } from './items';

const item: Item = {
  id: 'i',
  productId: 'p',
  isbn: '9786560950856',
  description: 'Livro Café com Aristóteles',
  supplierId: 's',
  purchaseOrderId: null,
  invoiceId: null,
  status: 'producao',
  quantity: 6000,
  piecesPerCarton: 40,
  unitPriceMicros: 575_000,
  notes: '',
  createdAt: '',
  updatedAt: '',
};

describe('planilha dos itens', () => {
  it('traz preço e total em dólar para quem vê valores', () => {
    const [row] = itemExportRows([itemForViewer(item, true)], [], [{ id: 's', name: 'Claire' }], true);
    expect(row).toEqual({ po: 'Sem PO', supplier: 'Claire', description: 'Livro Café com Aristóteles', isbn: '9786560950856', quantity: 6000, piecesPerCarton: 40, unitPrice: 0.575, total: 3450, fileApproved: '', shipPlanned: '', notes: '' });
  });

  it('traz a aprovação do arquivo e a programação de envio como dia/mês/ano', () => {
    const [row] = itemExportRows([{ ...item, fileApprovedAt: '2026-10-02', shipPlannedAt: '2026-12-05' }], [], [], false);
    expect([row!.fileApproved, row!.shipPlanned]).toEqual(['02/10/2026', '05/12/2026']);
  });

  it('não traz preço nem total para o leitor', () => {
    const [row] = itemExportRows([itemForViewer(item, false)], [], [], false);
    expect(row).not.toHaveProperty('unitPrice');
    expect(row).not.toHaveProperty('total');
    expect(row!.supplier).toBe('');
  });
});
