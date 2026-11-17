// Telas antes de entrar no sistema: primeiro acesso, entrar e definir senha (SPEC.md, seção 7).

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../core/accounts';
import { api, ApiError, type Me } from './api';
import { Brand, FormError, hueStyle, PasswordInput, STATUS_PREVIEW } from './components';

function EntryCard({ children }: { children: ReactNode }) {
  return (
    <main className="entrada">
      <div className="entrada-cartao">
        <div className="entrada-esteira" aria-hidden="true">
          {STATUS_PREVIEW.map((s) => (
            <span key={s.name} className="h" style={hueStyle(s.hue)} />
          ))}
        </div>
        <div className="entrada-corpo">
          <Brand />
          {children}
        </div>
      </div>
    </main>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="grupo">
      <label className="rotulo" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        className="campo"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        required
        aria-describedby={props.hint ? `${id}-dica` : undefined}
      />
      {props.hint && (
        <span id={`${id}-dica`} className="dica">
          {props.hint}
        </span>
      )}
    </div>
  );
}

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Erro inesperado. Tente de novo.';
}

const PASSWORD_HINT = `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres. Uma frase curta funciona bem.`;

export function LoginScreen({ onLogin }: { onLogin: (user: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin((await api.login(email, password)).user);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <EntryCard>
      <h2>Entrar</h2>
      <form className="form" onSubmit={submit}>
        <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
        <PasswordInput label="Senha" value={password} onChange={setPassword} autoComplete="current-password" />
        <FormError message={error} />
        <button className="btn primario largo" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="dica">Esqueceu a senha? Peça a um administrador para gerar uma nova.</p>
      </form>
    </EntryCard>
  );
}

export function SetupScreen({ configured, onDone }: { configured: boolean; onDone: (user: Me) => void }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      onDone((await api.setup({ token, name, email, password })).user);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <EntryCard>
        <h2>Falta o código de instalação</h2>
        <p className="intro">
          Para criar o primeiro administrador, cadastre o segredo <b>SETUP_TOKEN</b> no painel do Cloudflare
          (Worker → Configurações → Variáveis e segredos) e recarregue esta página.
        </p>
      </EntryCard>
    );
  }

  return (
    <EntryCard>
      <h2>Primeiro acesso</h2>
      <p className="intro">Crie a conta de administrador. Depois disso, as outras contas são criadas por você.</p>
      <form className="form" onSubmit={submit}>
        <TextField
          label="Código de instalação"
          value={token}
          onChange={setToken}
          autoComplete="off"
          autoFocus
          hint="O valor do segredo SETUP_TOKEN cadastrado no Cloudflare."
        />
        <TextField label="Seu nome" value={name} onChange={setName} autoComplete="name" />
        <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <PasswordInput
          label="Senha"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={PASSWORD_HINT}
        />
        <FormError message={error} />
        <button className="btn primario largo" type="submit" disabled={busy}>
          {busy ? 'Criando…' : 'Criar administrador'}
        </button>
      </form>
    </EntryCard>
  );
}

/** Formulário de nova senha, usado na troca obrigatória e no "Trocar senha" do menu. */
export function PasswordForm({
  askCurrent,
  onDone,
  submitLabel = 'Salvar senha',
  footer,
}: {
  askCurrent: boolean;
  onDone: (user: Me) => void;
  submitLabel?: string;
  footer?: ReactNode;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('As duas senhas não são iguais.');
    setBusy(true);
    setError(null);
    try {
      onDone((await api.changePassword(password, askCurrent ? current : undefined)).user);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {askCurrent && (
        <PasswordInput label="Senha atual" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      )}
      <PasswordInput
        label="Nova senha"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        autoFocus={!askCurrent}
      />
      <PasswordInput
        label="Repita a nova senha"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        invalid={confirm.length > 0 && confirm !== password}
      />
      <FormError message={error} />
      <button className="btn primario largo" type="submit" disabled={busy}>
        {busy ? 'Salvando…' : submitLabel}
      </button>
      {footer}
    </form>
  );
}

export function ForcedPasswordScreen({ user, onDone, onLogout }: { user: Me; onDone: (user: Me) => void; onLogout: () => void }) {
  return (
    <EntryCard>
      <h2>Defina sua senha</h2>
      <p className="intro">
        Olá, {user.name.split(' ')[0]}. Você entrou com uma senha temporária. Escolha a sua para continuar.
      </p>
      <PasswordForm
        askCurrent={false}
        onDone={onDone}
        submitLabel="Salvar e continuar"
        footer={
          <button type="button" className="btn-texto" onClick={onLogout}>
            Sair
          </button>
        }
      />
    </EntryCard>
  );
}
