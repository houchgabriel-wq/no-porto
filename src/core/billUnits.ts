// Unidades do BL (pedido do Gabriel em 25/11/2026): o transporte do porto até o estoque é agendado por
// unidade, isto é, por container. O BL traz uma linha por unidade, com o container, o lacre, o tipo, as
// caixas, o peso bruto e a cubagem: "YMLU5432079/YMAX802369/40NOR/2497CARTONS/24430.000KGS/57.840CBM",
// no HBL do 57º embarque da Miyi. A packing list de cada container traz as caixas e o peso (e, na da
// Miyi, o próprio número do container). Aqui: ler as unidades do texto do BL e ligar cada uma ao
// container do embarque, pelo número do container ou, sem ele, pelas caixas e pelo peso.

import { parseQuantity, type DocumentLine } from './documents';
import { parseScaled } from './money';

/** A unidade de um container, como no BL. Guardada na invoice do container. */
export interface BillUnit {
  /** Número do container (ISO 6346: quatro letras e sete dígitos, como YMLU5432079). */
  container: string;
  /** Lacre. */
  seal: string;
  /** Tipo, como está no BL (40NOR, 40HC, 20GP). */
  kind: string;
  cartons: number | null;
  /** Peso bruto, em gramas. */
  weightGrams: number | null;
  /** Cubagem, em litros (m³ × 1000). */
  volumeLiters: number | null;
}

/**
 * Uma unidade por linha: container/lacre/tipo/caixas/peso/cubagem. Aceita espaços em volta das barras e
 * os nomes comuns das embalagens (CARTONS, CTNS, PKGS, PACKAGES, PALLETS).
 */
const UNIT_LINE =
  /\b([A-Z]{4})\s?(\d{7})\s*\/\s*([^/\n]{1,25}?)\s*\/\s*([^/\n]{1,12}?)\s*\/\s*([\d.,]+)\s*(?:CARTONS?|CTNS?|PKGS?|PACKAGES?|PALLETS?|PLTS?|BOXES)\s*\/\s*([\d.,]+)\s*KGS?\s*\/\s*([\d.,]+)\s*(?:CBM|M3)\b/gi;

/** As unidades escritas no texto do BL, sem repetir o mesmo container. */
export function readBillUnits(text: string): BillUnit[] {
  const units: BillUnit[] = [];
  for (const m of text.matchAll(UNIT_LINE)) {
    const container = `${m[1]!.toUpperCase()}${m[2]}`;
    if (units.some((u) => u.container === container)) continue;
    units.push({
      container,
      seal: m[3]!.trim().toUpperCase(),
      kind: m[4]!.trim().toUpperCase(),
      cartons: parseQuantity(m[5]),
      weightGrams: parseScaled(m[6]!, 3, { round: true }),
      volumeLiters: parseScaled(m[7]!, 3, { round: true }),
    });
  }
  return units;
}

/** O número do container escrito pela pessoa ou pela packing list, sem espaços e em maiúsculas. */
export function normalizeContainer(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

/** As caixas e o peso bruto de uma packing list: a soma das linhas, quando todas trazem. */
export function packingTotals(lines: readonly Pick<DocumentLine, 'quantity' | 'piecesPerCarton' | 'cartons' | 'grossWeightGrams'>[]): { cartons: number | null; weightGrams: number | null } {
  if (lines.length === 0) return { cartons: null, weightGrams: null };
  const cartons = lines.every((l) => typeof l.cartons === 'number' && l.cartons > 0) ? lines.reduce((n, l) => n + l.cartons!, 0) : cartonsOf(lines);
  const weightGrams = lines.every((l) => typeof l.grossWeightGrams === 'number' && l.grossWeightGrams > 0) ? lines.reduce((n, l) => n + l.grossWeightGrams!, 0) : null;
  return { cartons, weightGrams };
}

/**
 * As caixas de um container pelos itens: a quantidade dividida pelas peças por caixa, arredondando para
 * cima (a caixa de sobra conta). null se algum item não tem as peças por caixa. Serve para os embarques
 * já cadastrados, que não guardaram a packing list.
 */
export function cartonsOf(items: readonly { quantity: number; piecesPerCarton: number | null }[]): number | null {
  if (items.length === 0 || items.some((i) => !i.piecesPerCarton)) return null;
  return items.reduce((n, i) => n + Math.ceil(i.quantity / i.piecesPerCarton!), 0);
}

/** O peso confere: até 0,5% de diferença, ou 1 kg (o BL arredonda). */
function weightClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1000, Math.round(Math.max(a, b) * 0.005));
}

/** Um container do embarque, para ligar à unidade do BL. */
export interface UnitCandidate {
  key: string;
  /** O número do container que a packing list (ou a pessoa) informou. */
  container: string | null;
  cartons: number | null;
  weightGrams: number | null;
}

export interface UnitMatch {
  unit: BillUnit;
  /** Ligado pelo número do container ou pelas caixas e pelo peso. */
  by: 'container' | 'medidas';
}

function fits(c: UnitCandidate, u: BillUnit): boolean {
  const comparable = (c.cartons !== null && u.cartons !== null) || (c.weightGrams !== null && u.weightGrams !== null);
  const cartonsOk = c.cartons === null || u.cartons === null || c.cartons === u.cartons;
  const weightOk = c.weightGrams === null || u.weightGrams === null || weightClose(c.weightGrams, u.weightGrams);
  return comparable && cartonsOk && weightOk;
}

/**
 * Liga cada container à sua unidade do BL. Primeiro pelo número do container; depois, para os que não
 * têm número, pelas caixas e pelo peso, só quando uma única unidade serve. Um container que informa um
 * número que não está no BL não é ligado pelas medidas (algo está errado, e a pessoa confere). Cada
 * unidade vai para um container só.
 */
export function matchUnits(candidates: readonly UnitCandidate[], units: readonly BillUnit[]): Map<string, UnitMatch> {
  const result = new Map<string, UnitMatch>();
  const used = new Set<string>();
  for (const c of candidates) {
    if (!c.container) continue;
    const unit = units.find((u) => u.container === normalizeContainer(c.container!) && !used.has(u.container));
    if (unit) {
      result.set(c.key, { unit, by: 'container' });
      used.add(unit.container);
    }
  }
  for (const c of candidates) {
    if (result.has(c.key) || c.container) continue;
    const options = units.filter((u) => !used.has(u.container) && fits(c, u));
    // A unidade também precisa servir a um container só, senão a escolha fica com a pessoa.
    const rivals = options.length === 1 ? candidates.filter((o) => o.key !== c.key && !result.has(o.key) && !o.container && fits(o, options[0]!)) : [];
    if (options.length === 1 && rivals.length === 0) {
      result.set(c.key, { unit: options[0]!, by: 'medidas' });
      used.add(options[0]!.container);
    }
  }
  return result;
}

/** A diferença entre a packing list e a unidade do BL, para a pessoa conferir; null se batem. */
export function unitDifference(c: Pick<UnitCandidate, 'cartons' | 'weightGrams'>, u: BillUnit): string | null {
  const cartons = c.cartons !== null && u.cartons !== null && c.cartons !== u.cartons;
  const weight = c.weightGrams !== null && u.weightGrams !== null && !weightClose(c.weightGrams, u.weightGrams);
  if (!cartons && !weight) return null;
  const mine = [c.cartons !== null ? caixas(c.cartons) : null, c.weightGrams !== null ? formatWeight(c.weightGrams) : null].filter(Boolean).join(' e ');
  const theirs = [u.cartons !== null ? caixas(u.cartons) : null, u.weightGrams !== null ? formatWeight(u.weightGrams) : null].filter(Boolean).join(' e ');
  return `A packing list tem ${mine}; o BL, ${theirs}. Confira.`;
}

const caixas = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'caixa' : 'caixas'}`;

/** Peso em quilos: "24.430 kg", "24.430,5 kg". */
export function formatWeight(grams: number): string {
  return `${(grams / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;
}

/** Cubagem: "57,84 m³". */
export function formatVolume(liters: number): string {
  return `${(liters / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³`;
}

/** A unidade numa linha: "YMLU5432079 · lacre YMAX802369 · 40NOR · 2.497 caixas · 24.430 kg · 57,84 m³". */
export function unitSummary(u: BillUnit): string {
  return [
    u.container,
    u.seal ? `lacre ${u.seal}` : null,
    u.kind || null,
    u.cartons !== null ? caixas(u.cartons) : null,
    u.weightGrams !== null ? formatWeight(u.weightGrams) : null,
    u.volumeLiters !== null ? formatVolume(u.volumeLiters) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
