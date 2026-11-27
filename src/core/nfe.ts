// A nota fiscal do container e a nota master do embarque (pedido do Gabriel em 27/11/2026): o PDF (o DANFE) e o
// XML da NF-e ficam guardados com o embarque e vão inteiros para o No Estoque. Quando o BL tem mais de um
// container, sai uma nota de cada container (as "filhotes") e uma master, com o embarque todo. Aqui: a leitura
// do XML (a chave de acesso, o número, a série, o dia da emissão e se a Sefaz autorizou), a chave impressa no
// DANFE e as conferências entre as notas do mesmo embarque. Só texto: nada de banco nem de navegador.

import { formatQuantity } from './money';

/** A chave de acesso da NF-e: 44 dígitos, o último o dígito verificador (módulo 11, pesos de 2 a 9). */
export function validNfeKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(key[i]) * weight;
  const rest = sum % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(key[43]);
}

/** O número da nota, que está na chave (do 26º ao 34º dígito), sem os zeros à esquerda. */
export function keyNumber(key: string): string {
  return String(Number(key.slice(25, 34)));
}

/** A série da nota, que está na chave (do 23º ao 25º dígito), sem os zeros à esquerda. */
export function keySeries(key: string): string {
  return String(Number(key.slice(22, 25)));
}

/** A situação do XML: autorizada pela Sefaz, sem o protocolo, não autorizada (denegada) ou de homologação (teste). */
export type NfeStatus = 'autorizada' | 'sem_protocolo' | 'nao_autorizada' | 'homologacao';
export const NFE_STATUSES = ['autorizada', 'sem_protocolo', 'nao_autorizada', 'homologacao'] as const satisfies readonly NfeStatus[];

/** O aviso de cada situação que não é a nota autorizada. */
export const NFE_STATUS_WARNINGS: Record<Exclude<NfeStatus, 'autorizada'>, string> = {
  sem_protocolo: 'O XML não tem a autorização da Sefaz (o protocolo). Confira se é o XML final da nota, o que vem depois da autorização.',
  nao_autorizada: 'A Sefaz não autorizou esta nota. Confira o XML.',
  homologacao: 'O XML é de homologação, o ambiente de teste da Sefaz: não vale como nota.',
};

/** O que o No Porto lê do XML da NF-e. */
export interface NfeRead {
  key: string;
  number: string;
  series: string;
  /** O dia da emissão (AAAA-MM-DD), como o emitente escreveu. */
  issuedAt: string | null;
  status: NfeStatus;
}

export type NfeReading = { ok: true; nfe: NfeRead } | { ok: false; error: string };

/** Os caracteres escritos como entidade no XML (&amp;, &#233;...). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, e: string) => {
    const lower = e.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** O nome da tag com o prefixo opcional do namespace (`<nfe:nNF>`). */
const open = (name: string) => `<(?:[\\w.-]+:)?${name}(?=[\\s>/])[^>]*>`;
const close = (name: string) => `</(?:[\\w.-]+:)?${name}\\s*>`;

/** O texto da primeira tag com este nome; null quando não há. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`${open(name)}([^<]*)${close(name)}`).exec(xml);
  return m ? decodeEntities(m[1]!).trim() : null;
}

/** O conteúdo do primeiro grupo com este nome; vazio quando não há. */
function group(xml: string, name: string): string {
  const m = new RegExp(`${open(name)}([\\s\\S]*?)${close(name)}`).exec(xml);
  return m?.[1] ?? '';
}

/** O que o arquivo é, quando não é a NF-e: para a mensagem dizer o que foi anexado no lugar. */
function otherDocument(xml: string): string {
  if (new RegExp(open('(?:cteProc|CTe|infCte)')).test(xml)) return 'Este XML é de um CT-e (o conhecimento de transporte), não da nota fiscal.';
  if (new RegExp(open('(?:procEventoNFe|evento|infEvento)')).test(xml)) return 'Este XML é de um evento da nota (cancelamento ou carta de correção), não da própria nota.';
  if (/<(?:[\w.-]+:)?(?:CompNfse|Nfse|InfNfse)[\s>]/.test(xml)) return 'Este XML é de uma nota de serviço (NFS-e), não da NF-e.';
  return 'Este XML não é de uma NF-e.';
}

/**
 * Lê o XML da NF-e: o da nota autorizada (nfeProc, com o protocolo da Sefaz) ou só a nota (NFe). A chave vem do
 * atributo Id do infNFe e precisa conferir com o dígito verificador e com a do protocolo; o número e a série vêm da
 * nota (ou, sem as tags, da chave).
 */
export function readNfe(text: string): NfeReading {
  const xml = text.replace(/^﻿/, '').trim();
  if (!xml.startsWith('<')) return { ok: false, error: 'O arquivo não é um XML.' };
  const id = new RegExp(`<(?:[\\w.-]+:)?infNFe\\b[^>]*?\\bId\\s*=\\s*["']NFe(\\d{44})["']`).exec(xml);
  if (!id) {
    if (new RegExp(open('infNFe')).test(xml)) return { ok: false, error: 'O XML da NF-e não traz a chave de acesso.' };
    return { ok: false, error: otherDocument(xml) };
  }
  const key = id[1]!;
  if (!validNfeKey(key)) return { ok: false, error: 'A chave de acesso do XML não confere (o dígito verificador está errado). O arquivo pode estar danificado.' };
  const ide = group(xml, 'ide');
  const prot = group(xml, 'infProt');
  const protKey = tag(prot, 'chNFe');
  if (protKey && protKey !== key) return { ok: false, error: 'O XML tem duas chaves diferentes, a da nota e a do protocolo da Sefaz. Confira o arquivo.' };
  const number = tag(ide, 'nNF');
  const series = tag(ide, 'serie');
  const issued = (tag(ide, 'dhEmi') ?? tag(ide, 'dEmi') ?? '').slice(0, 10);
  const cStat = tag(prot, 'cStat');
  const status: NfeStatus =
    tag(ide, 'tpAmb') === '2' ? 'homologacao' : !protKey && !cStat ? 'sem_protocolo' : cStat === '100' || cStat === '150' ? 'autorizada' : 'nao_autorizada';
  return {
    ok: true,
    nfe: {
      key,
      number: number && /^\d{1,9}$/.test(number) ? String(Number(number)) : keyNumber(key),
      series: series && /^\d{1,3}$/.test(series) ? String(Number(series)) : keySeries(key),
      issuedAt: /^\d{4}-\d{2}-\d{2}$/.test(issued) ? issued : null,
      status,
    },
  };
}

/**
 * A chave de acesso impressa no DANFE (o PDF da nota), no texto que o pdf.js tira dele: 44 dígitos, em grupos de 4
 * ou juntos, com o dígito verificador certo. Quando o DANFE cita outra nota (a master, nos dados adicionais), vale a
 * primeira chave depois de "Chave de acesso". Null quando não dá para saber (PDF escaneado, sem a chave).
 */
export function danfeKey(text: string): string | null {
  const found: { key: string; at: number }[] = [];
  for (const m of text.matchAll(/(?<!\d)\d{4}(?:[ . ]?\d{4}){10}(?!\d)/g)) {
    const key = m[0].replace(/\D/g, '');
    if (validNfeKey(key) && !found.some((f) => f.key === key)) found.push({ key, at: m.index });
  }
  if (found.length <= 1) return found[0]?.key ?? null;
  const label = /chave\s+de\s+acesso/i.exec(text);
  return (label ? found.find((f) => f.at > label.index)?.key : undefined) ?? null;
}

/** Um arquivo da nota guardado: o nome, o tamanho e a chave de acesso (a do XML, ou a lida no PDF; null sem ela). */
export interface FiscalFile {
  name: string;
  size: number;
  key: string | null;
}

/** O XML guardado, com o que foi lido dele. */
export interface FiscalXml extends FiscalFile {
  key: string;
  number: string;
  series: string;
  issuedAt: string | null;
  status: NfeStatus;
}

/** A nota fiscal (do container, ou a master do BL): o PDF, o DANFE, e o XML. */
export interface FiscalNote {
  pdf?: FiscalFile;
  xml?: FiscalXml;
}

/** A chave da nota: a do XML ou, sem ele, a lida no PDF. */
export function noteKey(note: FiscalNote | undefined): string | null {
  return note?.xml?.key ?? note?.pdf?.key ?? null;
}

/** "NF 12.345, série 1": pelo XML ou, sem ele, pela chave lida no PDF; null quando não se sabe. */
export function noteName(note: FiscalNote | undefined): string | null {
  const key = noteKey(note);
  if (!key) return null;
  const number = note?.xml?.number ?? keyNumber(key);
  const series = note?.xml?.series ?? keySeries(key);
  return `NF ${formatQuantity(Number(number))}, série ${series}`;
}

/** O número da nota pela chave, para as mensagens: "12.345". */
const shortName = (key: string) => formatQuantity(Number(keyNumber(key)));

/** "a, b e c". */
function listPt(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

/**
 * As conferências das notas de um embarque: o PDF e o XML de notas diferentes, a mesma nota em dois containers e a
 * master anexada como nota de um container. Cada container vem com o nome que a ficha mostra ("container
 * YMLU5432079", ou "container da invoice 2026-47B" sem a unidade). Devolve os avisos, na ordem: a master, os
 * containers e as repetidas.
 */
export function fiscalProblems(master: FiscalNote | undefined, containers: readonly { label: string; note: FiscalNote | undefined }[]): string[] {
  const problems: string[] = [];
  const mismatch = (note: FiscalNote | undefined) => {
    const pdf = note?.pdf?.key;
    const xml = note?.xml?.key;
    return pdf && xml && pdf !== xml ? `o PDF é da nota ${shortName(pdf)} e o XML, da ${shortName(xml)}` : null;
  };
  const m = mismatch(master);
  if (m) problems.push(`Na nota master, ${m}. Confira os arquivos.`);
  for (const c of containers) {
    const wrong = mismatch(c.note);
    if (wrong) problems.push(`Na nota do ${c.label}, ${wrong}. Confira os arquivos.`);
  }
  const masterKey = noteKey(master);
  const byKey = new Map<string, string[]>();
  for (const c of containers) {
    const key = noteKey(c.note);
    if (!key) continue;
    if (key === masterKey) problems.push(`A nota do ${c.label} é a master (${shortName(key)}), com o embarque todo. Cada container tem a sua nota.`);
    else byKey.set(key, [...(byKey.get(key) ?? []), c.label]);
  }
  for (const [key, labels] of byKey) {
    if (labels.length > 1) problems.push(`A nota ${shortName(key)} está anexada ${listPt(labels.map((l) => `no ${l}`))}. Cada container tem a sua nota.`);
  }
  return problems;
}
