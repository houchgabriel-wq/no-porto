// Arquivos de cada container (27/11/2026): a invoice e a packing list ficam guardadas para baixar depois.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let invoiceId: string;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEXT = 'PK conteúdo da invoice de teste';
const DATA = Buffer.from(TEXT).toString('base64');

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  const created = await app.call('POST', '/api/items', {
    cookie: who.editor.cookie,
    body: { description: 'Coleção Alice', isbn: null, supplier: 'Claire', orderCode: 'PO-036', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '' },
  });
  const shipped = await app.call('POST', '/api/ship', {
    cookie: who.editor.cookie,
    body: { lines: [{ itemId: created.data.item.id, quantity: 1000 }], newInvoice: { number: '126082125-3', ref: '', bill: 'ROECHN1', eta: '2026-12-10' } },
  });
  invoiceId = shipped.data.invoiceId;
});

const url = (kind: string, id = invoiceId) => `/api/invoices/${id}/documents/${kind}`;
const put = (kind: string, body: object, cookie = who.editor.cookie, id = invoiceId) => app.call('PUT', url(kind, id), { cookie, body });
const documentsOf = async (cookie = who.admin.cookie) => ((await app.call('GET', '/api/data', { cookie })).data.invoices as { id: string; documents?: unknown }[]).find((v) => v.id === invoiceId)!.documents;

describe('arquivos do container', () => {
  it('guarda a invoice e a packing list, baixa, substitui e tira', async () => {
    expect(await documentsOf()).toBeUndefined();
    expect((await put('invoice', { name: 'CI-CTNR01.xlsx', contentType: XLSX, data: DATA })).status).toBe(201);
    expect((await put('packing', { name: 'PL-CTNR01.xls', contentType: 'application/vnd.ms-excel', data: btoa('xls') })).status).toBe(201);
    expect(await documentsOf()).toEqual({ invoice: { name: 'CI-CTNR01.xlsx', size: Buffer.byteLength(TEXT) }, packing: { name: 'PL-CTNR01.xls', size: 3 } });

    const got = await app.raw('GET', url('invoice'), { cookie: who.consulta.cookie });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe(XLSX);
    expect(got.headers.get('content-disposition')).toContain("filename*=UTF-8''CI-CTNR01.xlsx");
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe(TEXT);

    // Anexar de novo substitui.
    await put('invoice', { name: 'CI-CTNR01 v2.pdf', contentType: 'application/pdf', data: btoa('pdf!') });
    expect(await documentsOf()).toMatchObject({ invoice: { name: 'CI-CTNR01 v2.pdf', size: 4 } });
    expect((await app.call('DELETE', url('packing'), { cookie: who.editor.cookie })).status).toBe(200);
    expect(await documentsOf()).toEqual({ invoice: { name: 'CI-CTNR01 v2.pdf', size: 4 } });
    expect((await app.raw('GET', url('packing'), { cookie: who.admin.cookie })).status).toBe(404);
  });

  it('excluir a invoice leva os arquivos junto', async () => {
    await put('invoice', { name: 'CI.xlsx', contentType: XLSX, data: DATA });
    await put('packing', { name: 'PL.xlsx', contentType: XLSX, data: DATA });
    expect((await app.call('DELETE', `/api/invoices/${invoiceId}`, { cookie: who.admin.cookie })).status).toBe(200);
    const left = await app.env.DB.prepare('SELECT (SELECT COUNT(*) FROM invoice_documents) AS docs, (SELECT COUNT(*) FROM invoice_document_parts) AS parts').first();
    expect(left).toEqual({ docs: 0, parts: 0 });
  });

  it('recusa tipo errado, arquivo grande e invoice que não existe', async () => {
    const exe = await put('invoice', { name: 'x.exe', contentType: 'application/x-msdownload', data: DATA });
    expect([exe.status, exe.data.error]).toEqual([400, 'Envie o arquivo em Excel (.xlsx ou .xls) ou PDF.']);
    // Um byte a mais que 5 MB (o pedido ainda cabe no limite do corpo).
    const big = await put('packing', { name: 'g.xlsx', contentType: XLSX, data: 'A'.repeat(6_666_668) });
    expect([big.status, big.data.error]).toEqual([413, 'O arquivo da packing list pode ter no máximo 5 MB.']);
    expect((await put('invoice', { name: 'a.xlsx', contentType: XLSX, data: DATA }, who.editor.cookie, 'nao-existe')).status).toBe(404);
    expect((await app.call('PUT', `/api/invoices/${invoiceId}/documents/outro`, { cookie: who.editor.cookie, body: { name: 'a.xlsx', contentType: XLSX, data: DATA } })).status).toBe(404);
  });

  it('registrar a packing list pela ficha guarda o arquivo na mesma gravação', async () => {
    const items = ((await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.items as { id: string; invoiceId: string | null; piecesPerCarton: number | null }[]).filter(
      (i) => i.invoiceId === invoiceId,
    );
    const register = (body: object) =>
      app.call('POST', `/api/invoices/${invoiceId}/packing-list`, {
        cookie: who.editor.cookie,
        body: { fileName: 'PL-CTNR01.xlsx', items: [{ itemId: items[0]!.id, piecesPerCarton: 20 }], container: null, cartons: null, weightGrams: null, ...body },
      });
    expect((await register({ document: { contentType: XLSX, data: DATA } })).data).toEqual({ updated: 1 });
    expect(await documentsOf()).toEqual({ packing: { name: 'PL-CTNR01.xlsx', size: Buffer.byteLength(TEXT) } });
    expect(new TextDecoder().decode(await (await app.raw('GET', url('packing'), { cookie: who.admin.cookie })).arrayBuffer())).toBe(TEXT);

    // Arquivo que não serve: nada é gravado, nem as peças por caixa.
    const v2 = { fileName: 'PL-CTNR01 v2.xlsx', items: [{ itemId: items[0]!.id, piecesPerCarton: 30 }] };
    const bad = await register({ ...v2, document: { contentType: 'text/plain', data: DATA } });
    expect([bad.status, bad.data.error]).toEqual([400, 'Envie o arquivo em Excel (.xlsx ou .xls) ou PDF.']);
    const big = await register({ ...v2, document: { contentType: XLSX, data: 'A'.repeat(6_666_668) } });
    expect([big.status, big.data.error]).toEqual([413, 'O arquivo da packing list pode ter no máximo 5 MB.']);
    const after = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    expect(after.items.find((i: { id: string }) => i.id === items[0]!.id).piecesPerCarton).toBe(20);
    expect(after.invoices.find((v: { id: string }) => v.id === invoiceId).packingList.name).toBe('PL-CTNR01.xlsx');

    // Registrar outra packing list sem o arquivo tira o que estava guardado, que era o da anterior.
    expect((await register(v2)).status).toBe(200);
    expect(await documentsOf()).toBeUndefined();
  });

  it('só admin e editor guardam; quem não vê valores não baixa nem recebe a lista', async () => {
    await put('invoice', { name: 'CI.xlsx', contentType: XLSX, data: DATA });
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await put('invoice', { name: 'b.xlsx', contentType: XLSX, data: DATA }, w.cookie)).status).toBe(403);
      expect((await app.call('DELETE', url('invoice'), { cookie: w.cookie })).status).toBe(403);
    }
    for (const w of [who.leitor, who.embarques, who.vendas, who.agente]) expect((await app.raw('GET', url('invoice'), { cookie: w.cookie })).status).toBe(403);
    expect(await documentsOf(who.consulta.cookie)).toEqual({ invoice: { name: 'CI.xlsx', size: Buffer.byteLength(TEXT) } });
    for (const w of [who.leitor, who.embarques]) expect(await documentsOf(w.cookie)).toBeUndefined();
  });
});
