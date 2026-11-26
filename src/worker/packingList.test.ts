// Packing list de cada container (26/11/2026): o Novo embarque anota o arquivo, e a ficha do embarque
// registra a packing list de um container já gravado, com as peças por caixa de cada item.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let claire: string;

const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: { code: 'PO-036', supplier: 'Claire', orderedAt: '2026-10-01', items: [line({ quantity: 6000 }), line({ description: 'Ágape', isbn: '9788543230139', quantity: 4000 })] },
  });
  claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers[0].id;
});

interface InvoiceView {
  id: string;
  number: string;
  unit: { container: string; cartons: number | null; weightGrams: number | null } | null;
  packingList: { name: string; at: string | null; by: string | null } | null;
}
const data = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/data', { cookie })).data as { invoices: InvoiceView[]; items: { id: string; invoiceId: string | null; description: string; piecesPerCarton: number | null }[] };

/** Dois containers: o primeiro com a packing list no Novo embarque, o segundo sem. */
async function ship() {
  const res = await app.call('POST', '/api/shipments', {
    cookie: who.editor.cookie,
    body: {
      bill: 'ROECHN26112871',
      eta: '2026-12-28',
      invoices: [
        { supplierId: claire, number: '126082125-3', container: 'YMLU5432079', packingList: 'PL-CTNR01.xlsx', lines: [line({ quantity: 3000, piecesPerCarton: 20 })] },
        { supplierId: claire, number: '126082125-4', lines: [line({ quantity: 3000 }), line({ description: 'Ágape', isbn: '9788543230139', quantity: 4000 })] },
      ],
    },
  });
  expect(res.status).toBe(201);
  const d = await data();
  const [a, b] = [...d.invoices].sort((x, y) => x.number.localeCompare(y.number));
  return { a: a!, b: b!, itemsOf: (v: InvoiceView, all = d.items) => all.filter((i) => i.invoiceId === v.id) };
}

const save = (invoiceId: string, body: object, cookie = who.editor.cookie) => app.call('POST', `/api/invoices/${invoiceId}/packing-list`, { cookie, body });

describe('packing list de cada container', () => {
  it('o Novo embarque anota a packing list do container que veio com ela', async () => {
    const { a, b } = await ship();
    expect(a.packingList).toEqual({ name: 'PL-CTNR01.xlsx', at: '2026-11-17T12:00:00.000Z', by: 'Bia Editora' });
    expect(b.packingList).toBeNull();
  });

  it('a ficha registra a packing list: as peças por caixa de cada item, o histórico, e o container só onde está vazio', async () => {
    const { a, b, itemsOf } = await ship();
    const [alice, agape] = itemsOf(b);
    const res = await save(b.id, {
      fileName: 'PL-CTNR02.xlsx',
      items: [
        { itemId: alice!.id, piecesPerCarton: 20 },
        { itemId: agape!.id, piecesPerCarton: 40 },
      ],
      container: 'YMLU5468929',
      cartons: 250,
      weightGrams: 2_900_000,
    });
    expect([res.status, res.data]).toEqual([200, { updated: 2 }]);
    const after = await data();
    const saved = after.invoices.find((v) => v.id === b.id)!;
    expect(saved.packingList).toEqual({ name: 'PL-CTNR02.xlsx', at: '2026-11-17T12:00:00.000Z', by: 'Bia Editora' });
    expect(saved.unit).toMatchObject({ container: 'YMLU5468929', cartons: 250, weightGrams: 2_900_000 });
    expect(itemsOf(b, after.items).map((i) => [i.description, i.piecesPerCarton])).toEqual([
      ['Coleção Alice', 20],
      ['Ágape', 40],
    ]);
    const events = await app.env.DB.prepare("SELECT entity_id, type, detail FROM events WHERE entity = 'item' AND detail LIKE '%packing-list%' ORDER BY detail").all<{ entity_id: string; type: string; detail: string }>();
    expect(events.results.map((e) => [e.entity_id, e.type, JSON.parse(e.detail)])).toEqual(
      expect.arrayContaining([
        [alice!.id, 'changed', { changes: [{ field: 'Peças por caixa', from: null, to: 20 }], source: 'packing-list', invoice: '126082125-4', file: 'PL-CTNR02.xlsx' }],
        [agape!.id, 'changed', { changes: [{ field: 'Peças por caixa', from: null, to: 40 }], source: 'packing-list', invoice: '126082125-4', file: 'PL-CTNR02.xlsx' }],
      ]),
    );
    // Trocar a packing list do primeiro: o container que já existe não muda, e o que é igual não conta.
    const [first] = itemsOf(a, after.items);
    const again = await save(a.id, { fileName: 'PL-CTNR01 v2.xlsx', items: [{ itemId: first!.id, piecesPerCarton: 20 }], container: 'MSCU1234567', cartons: 150, weightGrams: 1_800_000 });
    expect(again.data).toEqual({ updated: 0 });
    const a2 = (await data()).invoices.find((v) => v.id === a.id)!;
    expect(a2.unit).toMatchObject({ container: 'YMLU5432079', cartons: 150, weightGrams: 1_800_000 });
    expect(a2.packingList?.name).toBe('PL-CTNR01 v2.xlsx');
  });

  it('o perfil Embarques vê que a packing list foi registrada, sem o nome do arquivo', async () => {
    const { a } = await ship();
    const seen = (await data(who.embarques.cookie)).invoices.find((v) => v.id === a.id)!;
    expect(seen.packingList).toEqual({ name: '', at: '2026-11-17T12:00:00.000Z', by: 'Bia Editora' });
  });

  it('confere a invoice, os itens, as peças por caixa e o perfil', async () => {
    const { a, b, itemsOf } = await ship();
    const [alice] = itemsOf(b);
    const [first] = itemsOf(a);
    const wrong = await save(b.id, { fileName: 'PL.xlsx', items: [{ itemId: first!.id, piecesPerCarton: 20 }] });
    expect([wrong.status, wrong.data.error]).toEqual([400, 'Um dos itens não é deste container.']);
    const twice = await save(b.id, { fileName: 'PL.xlsx', items: [{ itemId: alice!.id, piecesPerCarton: 20 }, { itemId: alice!.id, piecesPerCarton: 30 }] });
    expect([twice.status, twice.data.error]).toEqual([400, 'O mesmo item apareceu duas vezes.']);
    expect((await save(b.id, { fileName: 'PL.xlsx', items: [{ itemId: alice!.id, piecesPerCarton: 0 }] })).status).toBe(400);
    expect((await save(b.id, { fileName: ' ', items: [] })).data.error).toBe('Informe o arquivo da packing list.');
    expect((await save('nao-existe', { fileName: 'PL.xlsx', items: [] })).status).toBe(404);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await save(b.id, { fileName: 'PL.xlsx', items: [{ itemId: alice!.id, piecesPerCarton: 20 }] }, w.cookie)).status).toBe(403);
    }
    // Nada mudou com as tentativas recusadas.
    expect(itemsOf(b, (await data()).items).map((i) => i.piecesPerCarton)).toEqual([null, null]);
  });
});
