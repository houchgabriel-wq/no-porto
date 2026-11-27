import { describe, expect, it } from 'vitest';
import { fiscalKindOf, prepareFiscalFiles } from './fiscalFile';

const K1 = '35261212345678000195550010000123451000123459';
const XML = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe${K1}"><ide><serie>1</serie><nNF>12345</nNF><tpAmb>1</tpAmb></ide></infNFe></NFe><protNFe><infProt><chNFe>${K1}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const file = (name: string, content: string, type = '') => new File([content], name, { type });
/** Na tela, o pdf.js lê a chave do DANFE; aqui, a chave vem do nome do arquivo, e o PDF "quebrado" não abre. */
const readKey = async (f: File) => {
  if (f.name.includes('quebrado')) throw new Error('PDF que não abre');
  return f.name.includes('12345') ? K1 : null;
};
const prepare = (files: File[]) => prepareFiscalFiles(files, readKey);

describe('arquivos da nota escolhidos no navegador', () => {
  it('reconhece o PDF e o XML pela extensão ou pelo tipo', () => {
    expect(fiscalKindOf({ name: 'DANFE 12345.PDF', type: '' })).toBe('pdf');
    expect(fiscalKindOf({ name: '3526...-nfe.xml', type: '' })).toBe('xml');
    expect(fiscalKindOf({ name: 'nota', type: 'text/xml' })).toBe('xml');
    expect(fiscalKindOf({ name: 'nota.zip', type: 'application/zip' })).toBeNull();
  });

  it('o XML vai lido, com a chave, antes do PDF', async () => {
    const out = await prepare([file('DANFE 12345.pdf', '%PDF-1.4'), file('nfe.xml', XML, 'text/xml')]);
    expect('uploads' in out && out.uploads.map((u) => [u.kind, u.name, u.contentType, u.key])).toEqual([
      ['xml', 'nfe.xml', 'application/xml', K1],
      ['pdf', 'DANFE 12345.pdf', 'application/pdf', K1],
    ]);
    // O PDF sem texto ou que não abre vai sem a chave: o servidor confere o arquivo.
    for (const name of ['escaneado.pdf', 'quebrado.pdf']) {
      const one = await prepare([file(name, '%PDF-1.4')]);
      expect('uploads' in one && one.uploads.map((u) => [u.name, u.key])).toEqual([[name, null]]);
    }
  });

  it('recusa o que não serve, com a explicação', async () => {
    expect(await prepare([file('a.pdf', '%PDF'), file('b.pdf', '%PDF')])).toEqual({ error: 'Escolha um PDF e um XML: vieram dois arquivos em PDF.' });
    expect(await prepare([file('a.xml', XML), file('b.xml', XML), file('c.pdf', '%PDF')])).toEqual({ error: 'Escolha no máximo dois arquivos: o PDF da nota e o XML.' });
    expect(await prepare([file('nota.zip', 'PK')])).toEqual({ error: 'Envie o PDF da nota (o DANFE) e o XML (o arquivo .xml).' });
    expect(await prepare([file('cte.xml', '<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe1"/></CTe></cteProc>')])).toEqual({
      error: 'Este XML é de um CT-e (o conhecimento de transporte), não da nota fiscal. (cte.xml)',
    });
    expect(await prepare([])).toEqual({ uploads: [] });
  });
});
