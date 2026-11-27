import { beforeEach, describe, expect, it } from 'vitest';
import { arrivalsSince, fiscalFileContent } from './noEstoque';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
/** O dia dos testes (o testApp está em 17/11/2026). */
const NOW = new Date('2026-11-17T12:00:00Z');
const arrivals = (since: string) => arrivalsSince(app.env, since, NOW);

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const item = (over: object) => ({ description: 'Livro', isbn: null, supplier: 'Miyi', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '', ...over });

async function create(over: object): Promise<string> {
  const res = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item(over) });
  expect(res.status).toBe(201);
  return res.data.item.id as string;
}

async function ship(itemIds: string[], newInvoice: object): Promise<string> {
  const res = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: itemIds.map((itemId) => ({ itemId, quantity: 1000 })), newInvoice } });
  expect(res.status).toBe(201);
  return res.data.invoiceId as string;
}

const billId = async () => (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.bills[0].id as string;

describe('porta do No Estoque', () => {
  it('manda as invoices que chegaram a partir do dia, com a previsão, os itens e sem valores', async () => {
    const a = await create({ description: 'Coleção 101 Palavras', isbn: '978-65-5547-866-2', piecesPerCarton: 20 });
    const b = await create({ description: 'Ágape', isbn: '9788543230139', piecesPerCarton: 40 });
    const invoiceId = await ship([a, b], { number: '2026-47B', ref: '2026-10-13 (2)', bill: 'ROECHN26101769', eta: '2026-11-26' });
    // A caminho (a previsão é 26/11): ainda não vai.
    expect(await arrivals('2026-11-01')).toEqual([]);
    await app.call('PATCH', `/api/bills/${await billId()}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-17' } });
    const out = await arrivals('2026-11-01');
    expect(out).toEqual([
      {
        id: invoiceId,
        arrivedAt: '2026-11-17',
        eta: '2026-11-26',
        supplier: 'Miyi',
        invoice: '2026-47B',
        ref: '2026-10-13 (2)',
        bill: 'ROECHN26101769',
        container: '',
        containerKind: '',
        cartons: null,
        weightGrams: null,
        volumeLiters: null,
        items: [
          { barcode: '9786555478662', title: 'Coleção 101 Palavras', quantity: 1000, piecesPerCarton: 20 },
          { barcode: '9788543230139', title: 'Ágape', quantity: 1000, piecesPerCarton: 40 },
        ],
        fiscalNote: null,
        masterFiscalNote: null,
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/price|micros|cents|500000/i);
    // Antes do dia pedido, não vai; desmarcar a chegada (com a previsão no futuro) tira da lista.
    expect(await arrivals('2026-11-18')).toEqual([]);
    await app.call('PATCH', `/api/bills/${await billId()}`, { cookie: who.editor.cookie, body: { arrivedAt: null } });
    expect(await arrivals('2026-11-01')).toEqual([]);
  });

  it('manda o container em liberação (previsão no passado, sem chegada), com a unidade, as caixas, o peso e o volume', async () => {
    const a = await create({ description: 'Coleção 101 Palavras', isbn: '978-65-5547-866-2', piecesPerCarton: 20 });
    const invoiceId = await ship([a], { number: '2026-50C', ref: '', bill: 'ROECHN26110001', eta: '2026-11-10' });
    await app.env.DB.prepare('UPDATE invoices SET container = ?, container_kind = ?, container_cartons = ?, container_weight_grams = ?, container_volume_liters = ? WHERE id = ?')
      .bind('YMLU5432079', '40NOR', 2497, 24_430_000, 57_840, invoiceId)
      .run();
    // Em liberação vai sempre, qualquer que seja o dia pedido.
    const [arrival] = await arrivals('2026-11-17');
    expect(arrival).toMatchObject({ id: invoiceId, arrivedAt: null, eta: '2026-11-10', container: 'YMLU5432079', containerKind: '40NOR', cartons: 2497, weightGrams: 24_430_000, volumeLiters: 57_840 });
    expect(arrival!.items).toEqual([{ barcode: '9786555478662', title: 'Coleção 101 Palavras', quantity: 1000, piecesPerCarton: 20 }]);
    // Registrada a chegada (antes do dia pedido), sai; a partir do dia pedido, continua, com o dia.
    await app.call('PATCH', `/api/bills/${await billId()}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-16' } });
    expect(await arrivals('2026-11-17')).toEqual([]);
    expect((await arrivals('2026-11-16'))[0]).toMatchObject({ id: invoiceId, arrivedAt: '2026-11-16' });
  });

  it('a invoice sem BL vale pela própria chegada; o item excluído não vai', async () => {
    const a = await create({ description: 'Ecobag' });
    const b = await create({ description: 'Excluído' });
    const invoiceId = await ship([a, b], { number: '108', ref: '', bill: null, eta: '2026-11-21' });
    await app.call('PATCH', `/api/invoices/${invoiceId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-20' } });
    await app.env.DB.prepare('UPDATE order_items SET deleted_at = ? WHERE id = ?').bind('2026-11-20T10:00:00Z', b).run();
    const [arrival] = await arrivals('2026-11-20');
    expect(arrival).toMatchObject({ id: invoiceId, invoice: '108', bill: null, arrivedAt: '2026-11-20', items: [{ barcode: null, title: 'Ecobag', quantity: 1000, piecesPerCarton: null }] });
  });

  it('manda a nota do container e a master do BL; o PDF e o XML inteiros vêm por fiscalFile', async () => {
    // As notas 12.345 (do container) e 12.300 (a master), com o dígito verificador certo.
    const K1 = '35261212345678000195550010000123451000123459';
    const MASTER = '35261212345678000195550010000123001000123007';
    const xml = (key: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe${key}"><ide><serie>1</serie><nNF>${Number(key.slice(25, 34))}</nNF><dhEmi>2026-12-05T10:31:00-03:00</dhEmi><tpAmb>1</tpAmb></ide><total><ICMSTot><vNF>254300.10</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const put = (path: string, body: object) => app.call('PUT', path, { cookie: who.editor.cookie, body });
    const a = await create({ description: 'Coleção 101 Palavras', isbn: '978-65-5547-866-2', piecesPerCarton: 20 });
    const b = await create({ description: 'Ágape', isbn: '9788543230139', piecesPerCarton: 40 });
    const first = await ship([a], { number: '57-1', ref: '', bill: 'YMJAW240104510', eta: '2026-11-10' });
    const second = await ship([b], { number: '57-2', ref: '', bill: 'YMJAW240104510', eta: '2026-11-10' });
    const bill = await billId();
    expect((await put(`/api/invoices/${first}/fiscal/xml`, { name: 'nfe-12345.xml', contentType: 'application/xml', data: Buffer.from(xml(K1)).toString('base64') })).status).toBe(201);
    expect((await put(`/api/invoices/${first}/fiscal/pdf`, { name: 'DANFE 12345.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.7 danfe').toString('base64'), key: K1 })).status).toBe(201);
    expect((await put(`/api/bills/${bill}/fiscal/xml`, { name: 'nfe-master.xml', contentType: 'text/xml', data: Buffer.from(xml(MASTER)).toString('base64') })).status).toBe(201);

    // Em liberação (a previsão era 10/11): os dois containers vão, cada um com a sua nota e a mesma master.
    const out = await arrivals('2026-11-17');
    const byId = new Map(out.map((x) => [x.id, x]));
    const own = byId.get(first)!.fiscalNote!;
    expect(own).toEqual({
      key: K1,
      number: '12345',
      series: '1',
      issuedAt: '2026-12-05',
      pdf: { id: expect.any(String), name: 'DANFE 12345.pdf', contentType: 'application/pdf', size: 14 },
      xml: { id: expect.any(String), name: 'nfe-12345.xml', contentType: 'application/xml', size: Buffer.byteLength(xml(K1)) },
    });
    const master = byId.get(first)!.masterFiscalNote!;
    expect(master).toMatchObject({ key: MASTER, number: '12300', pdf: null, xml: { name: 'nfe-master.xml', contentType: 'application/xml' } });
    expect(byId.get(second)!.fiscalNote).toBeNull();
    expect(byId.get(second)!.masterFiscalNote).toEqual(master);

    // O arquivo inteiro, como foi anexado (os valores da nota vão junto: o No Estoque lê tudo).
    const file = (await fiscalFileContent(app.env, own.xml!.id))!;
    expect({ ...file, data: new TextDecoder().decode(file.data) }).toEqual({ ...own.xml, data: xml(K1) });
    expect(new TextDecoder().decode((await fiscalFileContent(app.env, own.pdf!.id))!.data)).toBe('%PDF-1.7 danfe');
    // Trocado o XML, o id muda e o antigo não existe mais.
    await put(`/api/invoices/${first}/fiscal/xml`, { name: 'nfe-12345 v2.xml', contentType: 'application/xml', data: Buffer.from(xml(K1)).toString('base64') });
    expect(await fiscalFileContent(app.env, own.xml!.id)).toBeNull();
    expect((await arrivals('2026-11-17')).find((x) => x.id === first)!.fiscalNote!.xml!.name).toBe('nfe-12345 v2.xml');
  });

  it('recusa dia em outro formato', async () => {
    await expect(arrivals('20/11/2026')).rejects.toThrow('Dia inválido');
  });
});
