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
    expect(row).toEqual({ po: 'Sem PO', supplier: 'Claire', description: 'Livro Café com Aristóteles', isbn: '9786560950856', quantity: 6000, piecesPerCarton: 40, unitPrice: 0.575, total: 3450, notes: '' });
  });

  it('não traz preço nem total para o leitor', () => {
    const [row] = itemExportRows([itemForViewer(item, false)], [], [], false);
    expect(row).not.toHaveProperty('unitPrice');
    expect(row).not.toHaveProperty('total');
    expect(row!.supplier).toBe('');
  });
});
