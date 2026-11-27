import { describe, expect, it } from 'vitest';
import { danfeKey, fiscalProblems, keyNumber, keySeries, noteKey, noteName, readNfe, validNfeKey, type FiscalNote, type FiscalXml } from './nfe';

// Chaves com o dígito verificador certo: SP, dezembro de 2026, modelo 55, série 1, notas 12.345, 12.346 e 12.300
// (a master), e a 77 da série 2.
const K1 = '35261212345678000195550010000123451000123459';
const K2 = '35261212345678000195550010000123461000123464';
const MASTER = '35261212345678000195550010000123001000123007';
const K77 = '35261212345678000195550020000000771000000773';

interface XmlOptions {
  key?: string;
  number?: string | null;
  series?: string | null;
  issued?: string;
  environment?: string;
  /** O protocolo da Sefaz: a situação (cStat) e a chave; null sem o protocolo (só a nota). */
  protocol?: { cStat: string; key?: string } | null;
  prefix?: string;
}

/** O XML de uma NF-e de importação como o ERP gera (o nfeProc, com a nota e o protocolo). */
function nfeXml({ key = K1, number = '12345', series = '1', issued = '<dhEmi>2026-12-05T10:31:00-03:00</dhEmi>', environment = '1', protocol = { cStat: '100' }, prefix = '' }: XmlOptions = {}) {
  const t = (name: string, body: string) => `<${prefix}${name}>${body}</${prefix}${name}>`;
  const ide = [
    t('cUF', '35'),
    t('cNF', '00012345'),
    t('natOp', 'COMPRA PARA COMERCIALIZACAO - IMPORTACAO'),
    t('mod', '55'),
    series === null ? '' : t('serie', series),
    number === null ? '' : t('nNF', number),
    issued,
    t('tpNF', '0'),
    t('idDest', '3'),
    t('tpAmb', environment),
  ].join('');
  const nota = `<${prefix}NFe xmlns="http://www.portalfiscal.inf.br/nfe"><${prefix}infNFe versao="4.00" Id="NFe${key}">${t('ide', ide)}${t('emit', t('CNPJ', '12345678000195') + t('xNome', 'EDITORA ON LINE LTDA'))}${t(
    'dest',
    t('idEstrangeiro', '') + t('xNome', 'MIYI PRINTING &amp; PACKAGING CO.'),
  )}${t('infAdic', t('infCpl', 'Container YMLU5432079. DI 26/1234567-8. Ref. NF-e 3526 1212 3456 7800 0195 5500 1000 0123 0010 0012 3007'))}</${prefix}infNFe><Signature>assinatura</Signature></${prefix}NFe>`;
  if (protocol === null) return `<?xml version="1.0" encoding="UTF-8"?>${nota}`;
  const prot = t('protNFe', t('infProt', t('tpAmb', environment) + t('chNFe', protocol.key ?? key) + t('nProt', '135260000123456') + t('cStat', protocol.cStat) + t('xMotivo', 'Autorizado o uso da NF-e')));
  return `<?xml version="1.0" encoding="UTF-8"?><${prefix}nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nota}${prot}</${prefix}nfeProc>`;
}

describe('chave de acesso da NF-e', () => {
  it('confere o dígito verificador e tira o número e a série da chave', () => {
    for (const key of [K1, K2, MASTER, K77]) expect(validNfeKey(key)).toBe(true);
    expect(validNfeKey(`${K1.slice(0, 43)}0`)).toBe(false);
    expect(validNfeKey(K1.slice(1))).toBe(false);
    expect(validNfeKey(`${K1.slice(0, 43)}x`)).toBe(false);
    expect([keyNumber(K1), keySeries(K1)]).toEqual(['12345', '1']);
    expect([keyNumber(K77), keySeries(K77)]).toEqual(['77', '2']);
  });
});

describe('leitura do XML da NF-e', () => {
  it('lê a nota autorizada: a chave, o número, a série, o dia da emissão e a situação', () => {
    expect(readNfe(nfeXml())).toEqual({ ok: true, nfe: { key: K1, number: '12345', series: '1', issuedAt: '2026-12-05', status: 'autorizada' } });
    // Com a marca do UTF-8 (BOM) no começo e a autorização fora do prazo (150), também.
    expect(readNfe(`﻿${nfeXml({ key: K77, number: '77', series: '2', protocol: { cStat: '150' } })}`)).toMatchObject({ ok: true, nfe: { key: K77, number: '77', series: '2', status: 'autorizada' } });
  });

  it('a situação: sem o protocolo, de homologação e não autorizada', () => {
    expect(readNfe(nfeXml({ protocol: null }))).toMatchObject({ ok: true, nfe: { key: K1, status: 'sem_protocolo' } });
    expect(readNfe(nfeXml({ environment: '2' }))).toMatchObject({ ok: true, nfe: { status: 'homologacao' } });
    // Denegada (110): o protocolo existe, mas não é a autorização.
    expect(readNfe(nfeXml({ protocol: { cStat: '110' } }))).toMatchObject({ ok: true, nfe: { status: 'nao_autorizada' } });
  });

  it('aceita as tags com prefixo, o layout antigo (dEmi) e, sem as tags, o número e a série da chave', () => {
    expect(readNfe(nfeXml({ prefix: 'nfe:' }))).toMatchObject({ ok: true, nfe: { key: K1, number: '12345', series: '1', issuedAt: '2026-12-05' } });
    expect(readNfe(nfeXml({ issued: '<dEmi>2010-05-14</dEmi>' }))).toMatchObject({ ok: true, nfe: { issuedAt: '2010-05-14' } });
    expect(readNfe(nfeXml({ number: null, series: null, issued: '' }))).toMatchObject({ ok: true, nfe: { number: '12345', series: '1', issuedAt: null } });
    // Zeros à esquerda saem.
    expect(readNfe(nfeXml({ number: '000012345', series: '001' }))).toMatchObject({ ok: true, nfe: { number: '12345', series: '1' } });
  });

  it('recusa o que não é o XML da NF-e, dizendo o que é', () => {
    expect(readNfe('PK\u0003\u0004 planilha')).toEqual({ ok: false, error: 'O arquivo não é um XML.' });
    expect(readNfe('<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe3526"/></CTe></cteProc>')).toEqual({
      ok: false,
      error: 'Este XML é de um CT-e (o conhecimento de transporte), não da nota fiscal.',
    });
    expect(readNfe(`<?xml version="1.0"?><procEventoNFe><evento><infEvento Id="ID110111${K1}01"><chNFe>${K1}</chNFe></infEvento></evento></procEventoNFe>`)).toEqual({
      ok: false,
      error: 'Este XML é de um evento da nota (cancelamento ou carta de correção), não da própria nota.',
    });
    expect(readNfe('<?xml version="1.0"?><CompNfse><Nfse><InfNfse/></Nfse></CompNfse>')).toEqual({ ok: false, error: 'Este XML é de uma nota de serviço (NFS-e), não da NF-e.' });
    expect(readNfe('<?xml version="1.0"?><pedido><numero>1</numero></pedido>')).toEqual({ ok: false, error: 'Este XML não é de uma NF-e.' });
    expect(readNfe('<NFe><infNFe versao="4.00"><ide/></infNFe></NFe>')).toEqual({ ok: false, error: 'O XML da NF-e não traz a chave de acesso.' });
  });

  it('recusa a chave com o dígito errado e a nota com a chave diferente da do protocolo', () => {
    expect(readNfe(nfeXml({ key: `${K1.slice(0, 43)}0` }))).toEqual({
      ok: false,
      error: 'A chave de acesso do XML não confere (o dígito verificador está errado). O arquivo pode estar danificado.',
    });
    expect(readNfe(nfeXml({ protocol: { cStat: '100', key: K2 } }))).toEqual({
      ok: false,
      error: 'O XML tem duas chaves diferentes, a da nota e a do protocolo da Sefaz. Confira o arquivo.',
    });
  });
});

describe('chave impressa no DANFE', () => {
  it('acha a chave em grupos de 4 ou junta; com o dígito errado, não', () => {
    expect(danfeKey('DANFE\nCHAVE DE ACESSO\n3526 1212 3456 7800 0195 5500 1000 0123 4510 0012 3459\nConsulta de autenticidade')).toBe(K1);
    expect(danfeKey(`Chave de acesso ${K1} Protocolo de autorização 135260000123456 05/12/2026`)).toBe(K1);
    expect(danfeKey('3526.1212.3456.7800.0195.5500.1000.0123.4510.0012.3459')).toBe(K1);
    expect(danfeKey('CHAVE DE ACESSO 3526 1212 3456 7800 0195 5500 1000 0123 4510 0012 3450')).toBeNull();
    expect(danfeKey('DANFE escaneado, sem texto')).toBeNull();
  });

  it('com outra nota citada (a master, nos dados adicionais), vale a que vem depois de "Chave de acesso"', () => {
    const k1 = '3526 1212 3456 7800 0195 5500 1000 0123 4510 0012 3459';
    const master = '3526 1212 3456 7800 0195 5500 1000 0123 0010 0012 3007';
    expect(danfeKey(`CHAVE DE ACESSO ${k1} ... DADOS ADICIONAIS Ref. NF-e master ${master}`)).toBe(K1);
    expect(danfeKey(`Ref. NF-e ${master} CHAVE DE ACESSO ${k1}`)).toBe(K1);
    // Duas chaves e nenhum rótulo: não dá para saber qual é a da nota.
    expect(danfeKey(`${k1} ${master}`)).toBeNull();
  });
});

const xml = (key: string, over: Partial<FiscalXml> = {}): FiscalXml => ({ name: `${key}-nfe.xml`, size: 40_000, key, number: keyNumber(key), series: keySeries(key), issuedAt: '2026-12-05', status: 'autorizada', ...over });
const pdf = (key: string | null) => ({ name: 'DANFE.pdf', size: 120_000, key });

describe('nota de cada container e a master', () => {
  it('o nome e a chave da nota: pelo XML ou, sem ele, pela chave lida no PDF', () => {
    expect(noteName({ xml: xml(K1), pdf: pdf(K1) })).toBe('NF 12.345, série 1');
    expect(noteName({ pdf: pdf(K77) })).toBe('NF 77, série 2');
    expect(noteKey({ pdf: pdf(K77) })).toBe(K77);
    expect(noteName({ pdf: pdf(null) })).toBeNull();
    expect(noteName(undefined)).toBeNull();
  });

  it('sem avisos quando cada container tem a sua nota e o PDF é do mesmo XML', () => {
    const containers = [
      { label: 'container YMLU5432079', note: { xml: xml(K1), pdf: pdf(K1) } },
      { label: 'container YMLU5449045', note: { xml: xml(K2), pdf: pdf(null) } },
      { label: 'container da invoice 108', note: undefined },
    ];
    expect(fiscalProblems({ xml: xml(MASTER), pdf: pdf(MASTER) }, containers)).toEqual([]);
  });

  it('avisa do PDF de outra nota, da master num container e da mesma nota em dois containers', () => {
    const notes: FiscalNote[] = [{ xml: xml(K1), pdf: pdf(K2) }, { xml: xml(MASTER) }, { xml: xml(K2) }, { pdf: pdf(K2) }];
    const containers = notes.map((note, n) => ({ label: `container ${['YMLU5432079', 'YMLU5449045', 'YMLU5449046', 'YMLU5449047'][n]}`, note }));
    expect(fiscalProblems({ xml: xml(MASTER), pdf: pdf(K1) }, containers)).toEqual([
      'Na nota master, o PDF é da nota 12.345 e o XML, da 12.300. Confira os arquivos.',
      'Na nota do container YMLU5432079, o PDF é da nota 12.346 e o XML, da 12.345. Confira os arquivos.',
      'A nota do container YMLU5449045 é a master (12.300), com o embarque todo. Cada container tem a sua nota.',
      'A nota 12.346 está anexada no container YMLU5449046 e no container YMLU5449047. Cada container tem a sua nota.',
    ]);
  });
});
