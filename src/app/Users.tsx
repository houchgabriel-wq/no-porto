// Tela de usuários, só para o admin (SPEC.md, seções 4 e 7). O servidor confere o perfil de novo.

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ROLE_LABELS, ROLES, type Role } from '../core/roles';
import { api, ApiError, type Me, type UserSummary } from './api';
import { Avatar, Dialog, FormError, formatDateTime, useToast } from './components';
import { Icon, type IconName } from './icons';

const ROLE_HINTS: Record<Role, string> = {
  admin: 'Tudo, inclusive usuários, carga de planilha e exclusões',
  editor: 'Cadastra e altera POs, embarques e pagamentos; vê valores',
  consulta: 'Vê tudo, com preços e valores, mas não altera nada',
  leitor: 'Vê tudo, sem preços e valores, e não altera nada',
  embarques: 'Vê os produtos embarcados e o histórico, sem preços e valores',
  vendas: 'Vê só a lista dos produtos a caminho, com a previsão de chegada',
};

const ROLE_ICONS: Record<Role, IconName> = {
  admin: 'escudo',
  editor: 'lapis',
  consulta: 'tabela',
  leitor: 'olho',
  embarques: 'navio',
  vendas: 'estrela',
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Erro inesperado. Tente de novo.';
}

function Status({ user }: { user: UserSummary }) {
  if (!user.active)
    return (
      <span className="pilula">
        <Icon name="pausa" />
        Desativado
      </span>
    );
  if (user.mustChangePassword)
    return (
      <span className="pilula alerta">
        <Icon name="chave" />
        Senha temporária
      </span>
    );
  return (
    <span className="pilula ok">
      <Icon name="check" />
      Ativo
    </span>
  );
}

function RoleChoice({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="opcoes">
      <legend>Perfil</legend>
      {ROLES.map((r) => (
        <label key={r}>
          <input
            type="radio"
            name={name}
            value={r}
            checked={value === r}
            onChange={() => onChange(r)}
            disabled={disabled}
          />
          <b>{ROLE_LABELS[r]}</b>
          <span>{ROLE_HINTS[r]}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Field({ label, value, onChange, type = 'text', autoFocus }: { label: string; value: string; onChange: (v: string) => void; type?: string; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div className="grupo">
      <label className="rotulo" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="campo" type={type} value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus} autoComplete="off" />
    </div>
  );
}

/** Mostra a senha temporária uma única vez, para o admin repassar à pessoa. */
function TempPassword({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <div className="dlg-corpo">
        <p>
          Repasse esta senha temporária a <b>{name}</b>. No primeiro acesso, o sistema pede que a pessoa escolha a
          própria senha.
        </p>
        <div className="senha-temp">
          <code>{password}</code>
          <button type="button" className="btn" onClick={copy}>
            <Icon name={copied ? 'check' : 'copiar'} />
            {copied ? 'Copiada' : 'Copiar'}
          </button>
        </div>
        <p className="aviso alerta">
          <Icon name="alerta" />
          <span>Ela não aparece de novo. Se perder, gere outra em Redefinir senha.</span>
        </p>
      </div>
      <div className="dlg-pe">
        <button type="button" className="btn primario" onClick={onClose} autoFocus>
          Pronto
        </button>
      </div>
    </>
  );
}

function NewUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setRole('editor');
      setError(null);
      setCreated(null);
      setBusy(false);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createUser({ name, email, role });
      setCreated({ name: res.user.name, password: res.tempPassword });
      onCreated();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={created ? 'Usuário criado' : 'Novo usuário'} open={open} onClose={onClose}>
      {created ? (
        <TempPassword name={created.name} password={created.password} onClose={onClose} />
      ) : (
        <form onSubmit={submit}>
          <div className="dlg-corpo">
            <Field label="Nome" value={name} onChange={setName} autoFocus />
            <Field label="E-mail" type="email" value={email} onChange={setEmail} />
            <RoleChoice value={role} onChange={setRole} />
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primario" disabled={busy}>
              {busy ? 'Criando…' : 'Criar e gerar senha'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditUserDialog({
  user,
  me,
  onClose,
  onChanged,
}: {
  user: UserSummary | null;
  me: Me;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setError(null);
      setTemp(null);
      setBusy(false);
      setConfirmReset(false);
    }
  }, [user]);

  const self = user?.id === me.id;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const changes: Parameters<typeof api.updateUser>[1] = {};
    if (name !== user!.name) changes.name = name;
    if (email !== user!.email) changes.email = email;
    if (role !== user!.role) changes.role = role;
    if (Object.keys(changes).length === 0) return onClose();
    void run(async () => {
      await api.updateUser(user!.id, changes);
      onClose();
      return 'Alterações salvas.';
    });
  }

  function toggleActive() {
    void run(async () => {
      await api.updateUser(user!.id, { active: !user!.active });
      onClose();
      return user!.active ? `${user!.name} foi desativado.` : `${user!.name} foi reativado.`;
    });
  }

  function reset() {
    void run(async () => {
      const res = await api.resetPassword(user!.id);
      setTemp(res.tempPassword);
      return 'Nova senha temporária gerada.';
    });
  }

  if (!user) return <Dialog title="Editar usuário" open={false} onClose={onClose} />;

  return (
    <Dialog title={temp ? 'Nova senha temporária' : 'Editar usuário'} open onClose={onClose}>
      {temp ? (
        <TempPassword name={user.name} password={temp} onClose={onClose} />
      ) : (
        <form onSubmit={save}>
          <div className="dlg-corpo">
            <Field label="Nome" value={name} onChange={setName} />
            <Field label="E-mail" type="email" value={email} onChange={setEmail} />
            <RoleChoice value={role} onChange={setRole} disabled={self} />
            {self && <p className="dica">Você não pode mudar o próprio perfil nem desativar a própria conta.</p>}
            {confirmReset && (
              <div className="aviso alerta" role="group" aria-label="Confirmar redefinição">
                <Icon name="alerta" />
                <div className="confirmar">
                  <span>
                    A senha atual de {user.name} deixa de valer e as sessões abertas são encerradas.
                  </span>
                  <span className="confirmar-botoes">
                    <button type="button" className="btn" onClick={reset} disabled={busy}>
                      Gerar nova senha
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                      Cancelar
                    </button>
                  </span>
                </div>
              </div>
            )}
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            {!self && (
              <div className="esq">
                <button type="button" className="btn" onClick={() => setConfirmReset(true)} disabled={busy || confirmReset}>
                  <Icon name="chave" />
                  Redefinir senha
                </button>
                <button type="button" className={`btn${user.active ? ' perigo' : ''}`} onClick={toggleActive} disabled={busy}>
                  {user.active ? 'Desativar' : 'Reativar'}
                </button>
              </div>
            )}
            <button type="submit" className="btn primario" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function UsersScreen({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setUsers((await api.users()).users);
      setLoadError(null);
    } catch (err) {
      setLoadError(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = users?.filter((u) => u.active).length ?? 0;

  return (
    <section aria-labelledby="titulo-usuarios">
      <div className="secao-topo">
        <div>
          <h2 id="titulo-usuarios">Usuários</h2>
          {users && (
            <p>
              {active} {active === 1 ? 'conta ativa' : 'contas ativas'}
              {users.length > active && `, ${users.length - active} desativada${users.length - active === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
        <button className="btn primario" onClick={() => setCreating(true)}>
          <Icon name="mais" />
          Novo usuário
        </button>
      </div>

      <FormError message={loadError} />
      {!users && !loadError && (
        <p className="mudo" role="status">
          Carregando…
        </p>
      )}

      {users && (
        <div className="bloco">
          <ul className="usuarios">
            <li className="usuario cabeca" aria-hidden="true">
              <span>Nome</span>
              <span>Perfil</span>
              <span>Situação</span>
              <span>Último acesso</span>
              <span />
            </li>
            {users.map((u) => (
              <li key={u.id} className={`usuario${u.active ? '' : ' inativo'}`}>
                <div className="quem">
                  <Avatar id={u.id} name={u.name} faded={!u.active} />
                  <div>
                    <b>
                      {u.name}
                      {u.id === me.id && <span className="voce">você</span>}
                    </b>
                    <span className="quem-email">{u.email}</span>
                  </div>
                </div>
                <div className="col-perfil">
                  <span className={`perfil ${u.role}`}>
                    <Icon name={ROLE_ICONS[u.role]} />
                    {ROLE_LABELS[u.role]}
                  </span>
                </div>
                <div className="col-situacao">
                  <Status user={u} />
                </div>
                <div className="col-acesso mudo">
                  <span className="rotulo-celular">Último acesso: </span>
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca entrou'}
                </div>
                <div className="col-acoes">
                  <button className="btn" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}>
                    <Icon name="lapis" />
                    <span className="rot">Editar</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <NewUserDialog open={creating} onClose={() => setCreating(false)} onCreated={() => void load()} />
      <EditUserDialog
        user={editing}
        me={me}
        onClose={() => setEditing(null)}
        onChanged={(msg) => {
          showToast(msg);
          void load();
        }}
      />
      {toast}
    </section>
  );
}
