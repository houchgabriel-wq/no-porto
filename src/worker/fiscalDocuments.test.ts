// A nota fiscal do embarque (27/11/2026): o PDF e o XML da nota de cada container e da nota master do BL, guardados
// para baixar e para o No Estoque. O XML é lido no servidor; o PDF chega com a chave que o navegador leu.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let first: string;
let second: string;
let billId: string;

// Chaves com o dígito verificador certo: as notas 12.345 e 12.346 (os containers) e a 12.300 (a master).
const K1 = '35261212345678000195550010000123451000123459';
const K2 = '35261212345678000195550010000123461000123464';
const MASTER = '35261212345678000195550010000123001000123007';

/** O XML da NF-e autorizada, como o ERP gera. */
const nfe = (key: string, cStat = '100') =>
  `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe versao="4.00" Id="NFe${key}"><ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${Number(key.slice(25, 34))}</nNF><dhEmi>2026-12-05T10:31:00-03:00</dhEmi><tpNF>0</tpNF><tpAmb>1</tpAmb></ide><emit><xNome>EDITORA ON LINE LTDA</xNome></emit><total><ICMSTot><vNF>254300.10</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>${cStat}</cStat></infProt></protNFe></nfeProc>`;
const base64 = (s: string) => Buffer.from(s).toString('base64');
const PDF = '%PDF-1.7\n% DANFE de teste\n';

const item = (description: string) => ({ description, isbn: null, supplier: 'Miyi', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '' });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // Um BL com dois containers: as invoices 57-1 e 57-2.
  const ship = async (description: string, number: string) => {
    const created = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item(description) });
    const shipped = await app.call('POST', '/api/ship', {
      cookie: who.editor.cookie,
      body: { lines: [{ itemId: created.data.item.id, quantity: 1000 }], newInvoice: { number, ref: '', bill: 'YMJAW240104510', eta: '2026-12-10' } },
    });
    expect(shipped.status).toBe(201);
    return shipped.data.invoiceId as string;
  };
  first = await ship('Coleção Alice', '57-1');
  second = await ship('Ágape', '57-2');
  billId = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.bills[0].id;
});

const url = (owner: string, kind: string, id: string) => `/api/${owner}/${id}/fiscal/${kind}`;
const putXml = (owner: string, id: string, xml: string, cookie = who.editor.cookie, name = 'nfe.xml', contentType = 'application/xml') =>
  app.call('PUT', url(owner, 'xml', id), { cookie, body: { name, contentType, data: base64(xml) } });
const putPdf = (owner: string, id: string, key: string | null, cookie = who.editor.cookie, name = 'DANFE.pdf', data = base64(PDF)) =>
  app.call('PUT', url(owner, 'pdf', id), { cookie, body: { name, contentType: 'application/pdf', data, key } });
const data = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/data', { cookie })).data;
const fiscalOf = async (id: string, cookie = who.admin.cookie) => ((await data(cookie)).invoices as { id: string; fiscal?: unknown }[]).find((v) => v.id === id)!.fiscal;
const xmlView = (key: string, name = 'nfe.xml') => ({ name, size: Buffer.byteLength(nfe(key)), key, number: String(Number(key.slice(25, 34))), series: '1', issuedAt: '2026-12-05', status: 'autorizada' });

describe('nota fiscal do container', () => {
  it('guarda o PDF e o XML, lê o XML, baixa, substitui e tira', async () => {
    expect(await fiscalOf(first)).toBeUndefined();
    const xml = await putXml('invoices', first, nfe(K1), who.editor.cookie, '35261212345678000195550010000123451000123459-nfe.xml', 'text/xml');
    expect(xml.status).toBe(201);
    expect(xml.data.document).toEqual({ ...xmlView(K1, '35261212345678000195550010000123451000123459-nfe.xml') });
    expect((await putPdf('invoices', first, K1)).status).toBe(201);
    expect(await fiscalOf(first)).toEqual({ pdf: { name: 'DANFE.pdf', size: Buffer.byteLength(PDF), key: K1 }, xml: xmlView(K1, '35261212345678000195550010000123451000123459-nfe.xml') });
    expect(await fiscalOf(second)).toBeUndefined();

    // Baixar: o XML guardado como application/xml, o PDF como veio.
    const gotXml = await app.raw('GET', url('invoices', 'xml', first), { cookie: who.consulta.cookie });
    expect(gotXml.status).toBe(200);
    expect(gotXml.headers.get('content-type')).toBe('application/xml');
    expect(gotXml.headers.get('content-disposition')).toContain("filename*=UTF-8''35261212345678000195550010000123451000123459-nfe.xml");
    expect(await gotXml.text()).toBe(nfe(K1));
    const gotPdf = await app.raw('GET', url('invoices', 'pdf', first), { cookie: who.admin.cookie });
    expect([gotPdf.headers.get('content-type'), await gotPdf.text()]).toEqual(['application/pdf', PDF]);

    // Anexar de novo substitui; o PDF sem a chave (escaneado) fica sem ela.
    await putXml('invoices', first, nfe(K2), who.editor.cookie, 'nova.xml');
    await putPdf('invoices', first, null, who.editor.cookie, 'escaneado.pdf');
    expect(await fiscalOf(first)).toEqual({ pdf: { name: 'escaneado.pdf', size: Buffer.byteLength(PDF), key: null }, xml: xmlView(K2, 'nova.xml') });
    expect((await app.call('DELETE', url('invoices', 'pdf', first), { cookie: who.editor.cookie })).status).toBe(200);
    expect(await fiscalOf(first)).toEqual({ xml: xmlView(K2, 'nova.xml') });
    const gone = await app.raw('GET', url('invoices', 'pdf', first), { cookie: who.admin.cookie });
    expect([gone.status, ((await gone.json()) as { error: string }).error]).toEqual([404, 'Este container não tem o PDF da nota fiscal.']);
    const left = await app.env.DB.prepare('SELECT (SELECT COUNT(*) FROM fiscal_documents) AS docs, (SELECT COUNT(*) FROM fiscal_document_parts) AS parts').first();
    expect(left).toEqual({ docs: 1, parts: 1 });
  });

  it('o XML que não é da NF-e, o PDF que não é PDF, a chave errada, o arquivo grande e o que não existe são recusados', async () => {
    const cte = await putXml('invoices', first, '<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe1"/></CTe></cteProc>');
    expect([cte.status, cte.data.error]).toEqual([400, 'Este XML é de um CT-e (o conhecimento de transporte), não da nota fiscal.']);
    const broken = await putXml('invoices', first, nfe(`${K1.slice(0, 43)}0`));
    expect([broken.status, broken.data.error]).toEqual([400, 'A chave de acesso do XML não confere (o dígito verificador está errado). O arquivo pode estar danificado.']);
    const pdfAsXml = await putXml('invoices', first, nfe(K1), who.editor.cookie, 'nfe.pdf', 'application/pdf');
    expect([pdfAsXml.status, pdfAsXml.data.error]).toEqual([400, 'Envie o XML da nota (o arquivo .xml).']);
    const notPdf = await putPdf('invoices', first, null, who.editor.cookie, 'DANFE.pdf', base64(nfe(K1)));
    expect([notPdf.status, notPdf.data.error]).toEqual([400, 'Envie a nota fiscal em PDF.']);
    const badKey = await putPdf('invoices', first, `${K1.slice(0, 43)}0`);
    expect([badKey.status, badKey.data.error]).toEqual([400, 'A chave de acesso lida no PDF não confere.']);
    // Um byte a mais que 5 MB (o pedido ainda cabe no limite do corpo).
    const big = await putPdf('invoices', first, null, who.editor.cookie, 'g.pdf', 'A'.repeat(6_666_668));
    expect([big.status, big.data.error]).toEqual([413, 'O PDF da nota fiscal pode ter no máximo 5 MB.']);
    expect((await putXml('invoices', 'nao-existe', nfe(K1))).data.error).toBe('Invoice não encontrada.');
    expect((await putXml('bills', 'nao-existe', nfe(MASTER))).data.error).toBe('BL não encontrado.');
    expect((await app.call('PUT', `/api/invoices/${first}/fiscal/danfe`, { cookie: who.editor.cookie, body: {} })).status).toBe(404);
    expect(await fiscalOf(first)).toBeUndefined();
  });

  it('a nota sem a autorização da Sefaz entra, com a situação, para a ficha avisar', async () => {
    expect((await putXml('invoices', first, nfe(K1, '110'))).data.document.status).toBe('nao_autorizada');
    expect(await fiscalOf(first)).toMatchObject({ xml: { key: K1, status: 'nao_autorizada' } });
  });
});

describe('nota master do BL', () => {
  it('guarda o PDF e o XML da master no BL, separados das notas dos containers', async () => {
    expect((await putXml('bills', billId, nfe(MASTER), who.editor.cookie, 'master.xml')).status).toBe(201);
    expect((await putPdf('bills', billId, MASTER, who.editor.cookie, 'DANFE master.pdf')).status).toBe(201);
    await putXml('invoices', first, nfe(K1));
    const d = await data();
    expect(d.bills[0].fiscal).toEqual({ pdf: { name: 'DANFE master.pdf', size: Buffer.byteLength(PDF), key: MASTER }, xml: xmlView(MASTER, 'master.xml') });
    expect(d.invoices.find((v: { id: string }) => v.id === first).fiscal).toEqual({ xml: xmlView(K1) });
    expect(await (await app.raw('GET', url('bills', 'xml', billId), { cookie: who.consulta.cookie })).text()).toBe(nfe(MASTER));
    const none = await app.raw('GET', url('bills', 'pdf', 'outro'), { cookie: who.admin.cookie });
    expect(((await none.json()) as { error: string }).error).toBe('Este BL não tem o PDF da nota master.');
  });

  it('excluir o container leva a nota dele; excluir o embarque leva a master e as notas dos containers', async () => {
    await putXml('invoices', first, nfe(K1));
    await putPdf('invoices', second, K2);
    await putXml('bills', billId, nfe(MASTER));
    const count = async () => (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM fiscal_documents').first<{ n: number }>())!.n;
    expect((await app.call('DELETE', `/api/invoices/${first}`, { cookie: who.admin.cookie })).status).toBe(200);
    expect(await count()).toBe(2);
    expect((await app.call('DELETE', `/api/bills/${billId}`, { cookie: who.admin.cookie })).status).toBe(200);
    const left = await app.env.DB.prepare('SELECT (SELECT COUNT(*) FROM fiscal_documents) AS docs, (SELECT COUNT(*) FROM fiscal_document_parts) AS parts').first();
    expect(left).toEqual({ docs: 0, parts: 0 });
  });

  it('excluir o último container leva o BL e a master junto; começar do zero apaga as notas', async () => {
    await putXml('bills', billId, nfe(MASTER));
    expect((await app.call('DELETE', `/api/invoices/${first}`, { cookie: who.admin.cookie })).status).toBe(200);
    expect((await app.call('DELETE', `/api/invoices/${second}`, { cookie: who.admin.cookie })).data.billRemoved).toBe(true);
    expect((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM fiscal_documents').first<{ n: number }>())!.n).toBe(0);

    const fresh = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item('Meditações') });
    const shipped = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: fresh.data.item.id, quantity: 1000 }], newInvoice: { number: '58-1', ref: '', bill: 'BL58', eta: null } } });
    await putXml('invoices', shipped.data.invoiceId, nfe(K1));
    expect((await app.call('POST', '/api/reset', { cookie: who.admin.cookie, body: { confirm: 'APAGAR' } })).status).toBe(200);
    expect((await app.env.DB.prepare('SELECT (SELECT COUNT(*) FROM fiscal_documents) + (SELECT COUNT(*) FROM fiscal_document_parts) AS n').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('quem anexa e quem baixa a nota fiscal', () => {
  it('só admin e editor guardam e tiram; quem não vê valores não baixa nem recebe os nomes', async () => {
    await putXml('invoices', first, nfe(K1));
    await putXml('bills', billId, nfe(MASTER));
    expect((await putXml('invoices', first, nfe(K1), who.admin.cookie)).status).toBe(201);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      for (const [owner, id] of [
        ['invoices', first],
        ['bills', billId],
      ] as const) {
        expect((await putXml(owner, id, nfe(K2), w.cookie)).status).toBe(403);
        expect((await putPdf(owner, id, null, w.cookie)).status).toBe(403);
        expect((await app.call('DELETE', url(owner, 'xml', id), { cookie: w.cookie })).status).toBe(403);
      }
    }
    for (const w of [who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await app.raw('GET', url('invoices', 'xml', first), { cookie: w.cookie })).status).toBe(403);
      expect((await app.raw('GET', url('bills', 'xml', billId), { cookie: w.cookie })).status).toBe(403);
    }
    expect(await fiscalOf(first, who.consulta.cookie)).toEqual({ xml: xmlView(K1) });
    expect((await data(who.consulta.cookie)).bills[0].fiscal).toEqual({ xml: xmlView(MASTER) });
    for (const w of [who.leitor, who.embarques]) {
      const d = await data(w.cookie);
      expect(JSON.stringify(d)).not.toMatch(/fiscal|nfe\.xml|3526121234/);
    }
  });
});
