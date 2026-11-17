import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, Mark } from './icons';

/** As três situações de um item, para a faixa colorida das telas de entrada. */
export const STATUS_PREVIEW = [
  { name: 'Em produção', hue: 32 },
  { name: 'Embarcado', hue: 200 },
  { name: 'Entregue', hue: 150 },
];

export function hueStyle(hue: number): CSSProperties {
  return { '--h': String(hue) } as CSSProperties;
}

export function Brand({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="marca">
      <span className="marca-selo">
        <Mark />
      </span>
      <h1>
        No Porto
        {subtitle && <small>Impressão e importação no Grupo On Line</small>}
      </h1>
    </div>
  );
}

/** Matiz estável a partir do id, para cada pessoa (e cada fornecedor) ter sempre a mesma cor. */
export function hueFor(id: string): number {
  // FNV-1a: espalha bem mesmo quando os ids diferem só em poucos caracteres.
  let h = 0x811c9dc5;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0) % 360;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ id, name, small, faded }: { id: string; name: string; small?: boolean; faded?: boolean }) {
  return (
    <span
      className={`avatar h${small ? ' pequeno' : ''}${faded ? ' apagado' : ''}`}
      style={hueStyle(hueFor(id))}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  // A região existe sempre, para o leitor de tela anunciar quando a mensagem aparece.
  return (
    <div role="alert" aria-live="assertive">
      {message && (
        <p className="aviso critico">
          <Icon name="alerta" />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}

export function PasswordInput({ label, value, onChange, autoComplete, hint, autoFocus, invalid }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="grupo">
      <label className="rotulo" htmlFor={id}>
        {label}
      </label>
      <div className="senha-campo">
        <input
          id={id}
          className="campo"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-dica` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Esconder senha' : 'Mostrar senha'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'olhoFechado' : 'olho'} />
        </button>
      </div>
      {hint && (
        <span id={`${id}-dica`} className="dica">
          {hint}
        </span>
      )}
    </div>
  );
}

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** Janela mais larga, para conteúdo com várias colunas (como a tela de etapas). */
  wide?: boolean;
  /** Classe extra da janela, para um formato próprio (como a capa ampliada). */
  className?: string;
}

/** Diálogo nativo: prende o foco, fecha com Esc e devolve o foco a quem abriu. */
export function Dialog({ title, open, onClose, children, wide, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={[wide && 'largo', className].filter(Boolean).join(' ') || undefined}
      aria-labelledby={titleId}
      onClose={(e) => {
        // Um diálogo aberto dentro de outro (a capa ampliada na ficha) não fecha o de fora.
        if (e.target === ref.current) onClose();
      }}
      onClick={(e) => {
        // Clique no fundo escurecido fecha.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dlg-topo">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="fechar" onClick={onClose} aria-label="Fechar">
              <Icon name="fechar" />
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

/** Aviso curto no rodapé, que some sozinho. */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  const node = (
    <div aria-live="polite" role="status">
      {msg && <div id="toast">{msg}</div>}
    </div>
  );
  return [node, setMsg];
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso)).replace(/\./g, '');
}

/** Altura mínima da área ajustada à janela, para não ficar espremida em telas baixas. */
const FIT_MIN = 320;
/** Folga entre a área e o fim da janela. */
const FIT_GAP = 16;

/**
 * Faz a área (o quadro do Kanban, a tabela) ir do ponto em que começa até o fim da janela e rolar por
 * dentro, para a barra de rolagem lateral ficar sempre à vista, e não lá no fim da página.
 */
export function useFitToWindow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxHeight = `${Math.max(FIT_MIN, Math.floor(window.innerHeight - top - FIT_GAP))}px`;
    };
    fit();
    // O que fica acima da área muda de altura (filtros que quebram linha, avisos): recalcula.
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);
  return ref;
}
