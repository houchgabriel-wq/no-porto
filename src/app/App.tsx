import { useCallback, useEffect, useRef, useState } from 'react';
import { can, ROLE_LABELS } from '../core/roles';
import { api, ApiError, setUnauthorizedHandler, type Me } from './api';
import { Avatar, Brand, Dialog, FormError, hueStyle, STATUS_PREVIEW, useToast } from './components';
import { ForcedPasswordScreen, LoginScreen, PasswordForm, SetupScreen } from './Entry';
import { Icon } from './icons';
import { UpdateNotice } from './update';
import { UsersScreen } from './Users';

type Theme = 'sistema' | 'claro' | 'escuro';
const THEME_KEY = 'no-porto:tema';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'claro' || t === 'escuro') return t;
  } catch {
    // Sem acesso ao armazenamento do navegador: segue o sistema.
  }
  return 'sistema';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'sistema') delete root.dataset.theme;
  else root.dataset.theme = theme === 'escuro' ? 'dark' : 'light';
  try {
    if (theme === 'sistema') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Só não lembra a escolha.
  }
}

const VIEWS = ['painel', 'usuarios'] as const;
type View = (typeof VIEWS)[number];

function viewFromHash(): View {
  const v = location.hash.slice(1);
  return (VIEWS as readonly string[]).includes(v) ? (v as View) : 'painel';
}

type State =
  | { kind: 'carregando' }
  | { kind: 'erro'; message: string }
  | { kind: 'setup'; configured: boolean }
  | { kind: 'login' }
  | { kind: 'logado'; user: Me };

export function App() {
  const [state, setState] = useState<State>({ kind: 'carregando' });

  const boot = useCallback(async () => {
    setState({ kind: 'carregando' });
    try {
      const setup = await api.setupStatus();
      if (setup.available) return setState({ kind: 'setup', configured: setup.configured });
      try {
        setState({ kind: 'logado', user: (await api.me()).user });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setState({ kind: 'login' });
        else throw e;
      }
    } catch (e) {
      setState({ kind: 'erro', message: e instanceof ApiError ? e.message : 'Não foi possível carregar.' });
    }
  }, []);

  useEffect(() => {
    applyTheme(readTheme());
    setUnauthorizedHandler(() => setState({ kind: 'login' }));
    void boot();
  }, [boot]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ kind: 'login' });
    }
  }, []);

  switch (state.kind) {
    case 'carregando':
      return <div className="carregando" role="status">Carregando…</div>;
    case 'erro':
      return (
        <main className="entrada">
          <div className="entrada-cartao">
            <div className="entrada-corpo">
              <Brand />
              <FormError message={state.message} />
              <button className="btn primario" onClick={() => void boot()}>
                Tentar de novo
              </button>
            </div>
          </div>
        </main>
      );
    case 'setup':
      return <SetupScreen configured={state.configured} onDone={(user) => setState({ kind: 'logado', user })} />;
    case 'login':
      return <LoginScreen onLogin={(user) => setState({ kind: 'logado', user })} />;
    case 'logado':
      if (state.user.mustChangePassword) {
        return (
          <ForcedPasswordScreen
            user={state.user}
            onDone={(user) => setState({ kind: 'logado', user })}
            onLogout={() => void logout()}
          />
        );
      }
      return <Shell user={state.user} onLogout={() => void logout()} />;
  }
}

function UserMenu({ user, onPassword, onLogout }: { user: Me; onPassword: () => void; onLogout: () => void }) {
  const isAdmin = can(user.role, 'manage_users');
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function chooseTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  return (
    <div className="menu" ref={ref}>
      <button
        ref={buttonRef}
        className="menu-botao"
        aria-expanded={open}
        aria-controls="menu-usuario"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar id={user.id} name={user.name} small />
        {/* O nome lido pelo leitor de tela contém o texto visível ("Menu de Gabriel"). */}
        <span className="so-leitor">Menu de </span>
        <span className="nome">{user.name.split(' ')[0]}</span>
        <span className="so-leitor nome-celular">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="menu-lista" id="menu-usuario">
          <div className="menu-quem">
            <b>{user.name}</b>
            <span>
              {user.email} · {ROLE_LABELS[user.role]}
            </span>
          </div>
          <div className="menu-tema" role="group" aria-label="Tema">
            {(['sistema', 'claro', 'escuro'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => chooseTheme(t)}>
                {t === 'sistema' ? 'Automático' : t === 'claro' ? 'Claro' : 'Escuro'}
              </button>
            ))}
          </div>
          {isAdmin && (
            <a className="menu-item" href="#usuarios" onClick={() => setOpen(false)}>
              <Icon name="pessoas" />
              Usuários
            </a>
          )}
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onPassword();
            }}
          >
            <Icon name="chave" />
            Trocar senha
          </button>
          <button className="menu-item" onClick={onLogout}>
            <Icon name="sair" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

/** Início enquanto não há POs: explica o caminho dos itens e o que vem a seguir. */
function Welcome({ user }: { user: Me }) {
  return (
    <section className="vazio" aria-labelledby="boas-vindas">
      <h2 id="boas-vindas">Olá, {user.name.split(' ')[0]}. Ainda não há pedidos cadastrados.</h2>
      <p>
        O No Porto acompanha cada item desde a PO no fornecedor até a chegada à editora, com os embarques, as invoices e os pagamentos no
        caminho. A carga da planilha de importação chega nas próximas versões.
      </p>
      <h3>O caminho de cada item</h3>
      <ol className="caminho">
        {STATUS_PREVIEW.map((s, i) => (
          <li key={s.name} className="h" style={hueStyle(s.hue)}>
            <b>{i + 1}</b>
            {s.name}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Shell({ user, onLogout }: { user: Me; onLogout: () => void }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [changingPassword, setChangingPassword] = useState(false);
  const [toast, showToast] = useToast();
  const isAdmin = can(user.role, 'manage_users');

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const current: View = view === 'usuarios' && !isAdmin ? 'painel' : view;

  return (
    <div className="pagina">
      {/* Não muda o endereço: as visões usam o trecho depois do # (#usuarios). */}
      <a
        className="pular"
        href="#conteudo"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('conteudo')?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <header className="topo">
        <Brand />
        <nav className="abas" aria-label="Visões">
          <a className="aba" href="#painel" aria-current={current === 'painel' ? 'page' : undefined}>
            <Icon name="inicio" />
            Painel
          </a>
        </nav>
        <div className="acoes">
          <UserMenu user={user} onPassword={() => setChangingPassword(true)} onLogout={onLogout} />
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {current === 'usuarios' ? <UsersScreen me={user} /> : <Welcome user={user} />}
      </main>

      <Dialog title="Trocar senha" open={changingPassword} onClose={() => setChangingPassword(false)}>
        <div className="dlg-corpo">
          <PasswordForm
            askCurrent
            onDone={() => {
              setChangingPassword(false);
              showToast('Senha trocada. As outras sessões foram encerradas.');
            }}
          />
        </div>
      </Dialog>
      {toast}
      <UpdateNotice />
    </div>
  );
}
