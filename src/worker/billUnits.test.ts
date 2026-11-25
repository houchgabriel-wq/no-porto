// Unidades do BL (25/11/2026): o Novo embarque grava a unidade (o container) de cada invoice, e a ficha
// grava as unidades lidas do PDF do BL.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let claire: string;

const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 1000, piecesPerCarton: 20, unitPriceMicros: 1_750_000, notes: '', ...over });
const U1 = { container: 'YMLU5432079', seal: 'YMAX802369', kind: '40NOR', cartons: 2497, weightGrams: 24_430_000, volumeLiters: 57_840 };
const U2 = { container: 'YMLU5468929', seal: 'YMAX802240', kind: '40NOR', cartons: 2944, weightGrams: 25_040_000, volumeLiters: 56_230 };

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-036', supplier: 'Claire', orderedAt: '2026-10-01', items: [line({ quantity: 6000 })] } });
  claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers[0].id;
});

const invoices = async (cookie = who.admin.cookie) =>
  ((await app.call('GET', '/api/data', { cookie })).data.invoices as { id: string; number: string; billId: string; notes: string; unit: unknown }[]).sort((a, b) => a.number.localeCompare(b.number));

async function ship() {
  const res = await app.call('POST', '/api/shipments', {
    cookie: who.editor.cookie,
    body: {
      bill: 'ROECHN26112871',
      eta: '2026-12-28',
      invoices: [
        { supplierId: claire, number: '126082125-3', ref: '', container: 'YMLU5432079', unit: U1, lines: [line({ quantity: 3000 })] },
        // Sem a unidade do BL: o container digitado vai para o campo, sem lacre nem medidas.
        { supplierId: claire, number: '126082125-4', ref: '', container: 'ymlu 5468929', lines: [line({ quantity: 3000 })] },
      ],
    },
  });
  expect(res.status).toBe(201);
  return res.data.billId as string;
}

describe('unidades do BL', () => {
  it('o Novo embarque grava a unidade de cada invoice, e não mais nas observações', async () => {
    await ship();
    const list = await invoices();
    expect(list.map((v) => [v.number, v.unit, v.notes])).toEqual([
      ['126082125-3', U1, ''],
      ['126082125-4', { container: 'YMLU5468929', seal: '', kind: '', cartons: null, weightGrams: null, volumeLiters: null }, ''],
    ]);
    // Quem vê os embarques sem valores também vê a unidade (não é valor nem fornecedor).
    expect((await invoices(who.embarques.cookie)).map((v) => v.unit)).toEqual([U1, expect.objectContaining({ container: 'YMLU5468929' })]);
  });

  it('a ficha grava as unidades lidas do BL, uma por invoice', async () => {
    const billId = await ship();
    const [a, b] = await invoices();
    const save = (units: object[], cookie = who.editor.cookie) => app.call('POST', `/api/bills/${billId}/units`, { cookie, body: { units } });
    // Trocar as duas de uma vez pode; a mesma unidade em duas invoices, não.
    expect((await save([{ invoiceId: a!.id, unit: U2 }, { invoiceId: b!.id, unit: U1 }])).data).toEqual({ updated: 2 });
    expect((await invoices()).map((v) => v.unit)).toEqual([U2, U1]);
    const twice = await save([{ invoiceId: a!.id, unit: U1 }]);
    expect([twice.status, twice.data.error]).toEqual([400, 'A mesma unidade ficou em duas invoices. Confira.']);
    // Tirar a unidade.
    expect((await save([{ invoiceId: b!.id, unit: null }])).status).toBe(200);
    expect((await invoices()).map((v) => v.unit)).toEqual([U2, null]);
  });

  it('confere o BL, as invoices e o perfil', async () => {
    const billId = await ship();
    const [a] = await invoices();
    // Uma invoice de outro embarque.
    await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: 'OUTRO', eta: null, invoices: [{ supplierId: claire, number: 'X1', lines: [line({ quantity: 10 })] }] } });
    const other = (await invoices()).find((v) => v.number === 'X1')!;
    const wrong = await app.call('POST', `/api/bills/${billId}/units`, { cookie: who.editor.cookie, body: { units: [{ invoiceId: other.id, unit: U2 }] } });
    expect([wrong.status, wrong.data.error]).toEqual([400, 'Uma das invoices não é deste BL.']);
    expect((await app.call('POST', '/api/bills/nao-existe/units', { cookie: who.editor.cookie, body: { units: [{ invoiceId: a!.id, unit: U2 }] } })).status).toBe(404);
    const bad = await app.call('POST', `/api/bills/${billId}/units`, { cookie: who.editor.cookie, body: { units: [{ invoiceId: a!.id, unit: { ...U2, container: ' ' } }] } });
    expect([bad.status, bad.data.error]).toEqual([400, 'Informe o número do container.']);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await app.call('POST', `/api/bills/${billId}/units`, { cookie: w.cookie, body: { units: [{ invoiceId: a!.id, unit: U2 }] } })).status).toBe(403);
    }
  });
});
