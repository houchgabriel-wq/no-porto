// Envio de arquivos guardados no banco (o BL e, desde 27/11/2026, a invoice, a packing list e a nota fiscal de
// cada container): o conteúdo vai em base64, dentro do JSON, como os outros pedidos.

/** Tamanho máximo de um arquivo guardado. */
export const MAX_FILE_BYTES = 5_000_000;

/** O arquivo (ou o conteúdo montado no navegador) em base64. */
export async function toBase64(file: Blob): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error(`Não foi possível ler ${file instanceof File ? file.name : 'o arquivo'}.`);
  }
  // Em pedaços, porque String.fromCharCode com milhões de argumentos estoura a pilha.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** O tipo da invoice ou da packing list pelo nome do arquivo (o navegador nem sempre informa); null se não serve. */
export function sheetContentType(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'pdf') return 'application/pdf';
  return null;
}

/** O tamanho do arquivo para ler: "120 KB" ou "1,4 MB". */
export function fileSizeText(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
