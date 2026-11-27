// O embarque que já saiu da tela de embarques (27/11/2026): no Histórico e na ficha do produto, a invoice e o BL
// abrem a ficha do embarque, com os arquivos, mesmo depois dos 60 dias. A rota traz o embarque inteiro, com os
// mesmos cortes de /api/data.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let first: string;
let second: string;
let loose: string;

const K1 = '35261212345678000195550010000123451000123459';
const nfe = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe${K1}"><ide><serie>1</serie><nNF>12345</nNF><dhEmi>2026-08-18T09:00:00-03:00</dhEmi><tpAmb>1</tpAmb></ide></infNFe></NFe><protNFe><infProt><chNFe>${K1}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const item = (description: string) => ({ description, isbn: null, supplier: 'Miyi', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: 20, unitPriceMicros: 500_000, notes: 'Não estava na produção da Miyi' });

async function ship(description: string, number: string, bill: string | null): Promise<string> {
  const created = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item(description) });
  const shipped = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: created.data.item.id, quantity: 1000 }], newInvoice: { number, ref: '', bill, eta: '2026-08-15' } } });
  expect(shipped.status).toBe(201);
  return shipped.data.invoiceId as string;
}

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // O BL com dois containers e a invoice sem BL chegaram em agosto: mais de 60 dias antes de 17/11/2026.
  first = await ship('Coleção Alice', '57-1', 'YMJAW240104510');
  second = await ship('Ágape', '57-2', 'YMJAW240104510');
  loose = await ship('Ecobag', '108', null);
  const put = (path: string, body: object) => app.call('PUT', path, { cookie: who.editor.cookie, body });
  expect((await put(`/api/invoices/${first}/documents/invoice`, { name: 'CI-57-1.xlsx', contentType: 'application/vnd.ms-excel', data: btoa('xls') })).status).toBe(201);
  expect((await put(`/api/invoices/${first}/fiscal/xml`, { name: 'nfe-12345.xml', contentType: 'application/xml', data: Buffer.from(nfe).toString('base64') })).status).toBe(201);
  await app.call('POST', `/api/invoices/${first}/payments`, { cookie: who.admin.cookie, body: { paidAt: '2026-08-25', amountCents: 50_000, exchangeRateE4: 54_321, notes: '' } });
  for (const id of [first, second, loose]) expect((await app.call('PATCH', `/api/invoices/${id}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-08-20' } })).status).toBe(200);
});

const shipment = (key: string, cookie = who.admin.cookie) => app.call('GET', `/api/shipments/${encodeURIComponent(key)}`, { cookie });
const historyInvoices = async () => (await app.call('GET', '/api/history', { cookie: who.admin.cookie })).data.invoices as { id: string; billId: string | null; billNumber: string | null }[];

describe('embarque antigo pela chave', () => {
  it('o BL inteiro, com os itens, os pagamentos e os arquivos, depois dos 60 dias da tela de embarques', async () => {
    expect((await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.invoices).toEqual([]);
    // O Histórico manda o id do BL, para abrir o embarque.
    const billId = (await historyInvoices()).find((v) => v.id === first)!.billId!;
    expect(billId).toEqual(expect.any(String));
    const res = await shipment(`bl:${billId}`);
    expect(res.status).toBe(200);
    const d = res.data;
    expect(d.bills).toEqual([{ id: billId, number: 'YMJAW240104510', eta: '2026-08-15', arrivedAt: null, notes: '', document: null }]);
    expect(d.invoices.map((v: { id: string; arrivedAt: string }) => [v.id, v.arrivedAt])).toEqual([
      [first, '2026-08-20'],
      [second, '2026-08-20'],
    ]);
    expect(d.invoices[0]).toMatchObject({ documents: { invoice: { name: 'CI-57-1.xlsx', size: 3 } }, fiscal: { xml: { key: K1, number: '12345', issuedAt: '2026-08-18', status: 'autorizada' } } });
    expect(d.items.map((i: { description: string; status: string; unitPriceMicros: number }) => [i.description, i.status, i.unitPriceMicros])).toEqual([
      ['Coleção Alice', 'entregue', 500_000],
      ['Ágape', 'entregue', 500_000],
    ]);
    expect(d.payments).toEqual([{ id: expect.any(String), invoiceId: first, paidAt: '2026-08-25', amountCents: 50_000, exchangeRateE4: 54_321, notes: '' }]);
    expect(d.orders.map((o: { code: string }) => o.code)).toEqual(['PO-063']);
    expect(d.suppliers.map((s: { name: string }) => s.name)).toEqual(['Miyi']);
    // A Consulta vê igual.
    expect((await shipment(`bl:${billId}`, who.consulta.cookie)).data).toEqual(d);
  });

  it('a invoice sem BL abre pela própria chave; a do BL, só pela do BL', async () => {
    const d = (await shipment(`inv:${loose}`)).data;
    expect([d.bills, d.invoices.map((v: { number: string }) => v.number), d.items.map((i: { description: string }) => i.description)]).toEqual([[], ['108'], ['Ecobag']]);
    for (const key of [`inv:${first}`, 'bl:nao-existe', `x:${loose}`, loose]) {
      const res = await shipment(key);
      expect([res.status, res.data.error]).toEqual([404, 'Embarque não encontrado.']);
    }
  });

  it('o leitor recebe sem valores, pagamentos e arquivos; Embarques, Vendas e o Agente são recusados', async () => {
    const billId = (await historyInvoices()).find((v) => v.id === first)!.billId!;
    const forReader = (await shipment(`bl:${billId}`, who.leitor.cookie)).data;
    expect(forReader.invoices).toHaveLength(2);
    expect(forReader.payments).toEqual([]);
    expect(forReader.items.some((i: object) => 'unitPriceMicros' in i || 'totalCents' in i)).toBe(false);
    expect(JSON.stringify(forReader)).not.toMatch(/documents|fiscal|500000|54321|CI-57-1/);
    // O leitor vê os fornecedores, como em /api/data.
    expect(forReader.suppliers.map((s: { name: string }) => s.name)).toEqual(['Miyi']);
    for (const w of [who.embarques, who.vendas, who.agente]) {
      const res = await shipment(`bl:${billId}`, w.cookie);
      expect([res.status, res.data.error]).toEqual([403, 'Seu perfil não abre a ficha deste embarque.']);
    }
  });

  it('registrar a nota de um embarque antigo também vale (as rotas dos arquivos não dependem da tela)', async () => {
    const billId = (await historyInvoices()).find((v) => v.id === first)!.billId!;
    const pdf = await app.call('PUT', `/api/bills/${billId}/fiscal/pdf`, { cookie: who.editor.cookie, body: { name: 'DANFE master.pdf', contentType: 'application/pdf', data: btoa('%PDF-1.4'), key: null } });
    expect(pdf.status).toBe(201);
    expect((await shipment(`bl:${billId}`)).data.bills[0].fiscal).toEqual({ pdf: { name: 'DANFE master.pdf', size: 8, key: null } });
  });
});
