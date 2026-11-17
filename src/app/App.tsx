import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { itemExportRows } from '../core/exportItems';
import { EMPTY_FILTERS, filterItems, sortItems, type ItemFilters, type ItemSort } from '../core/items';
import { can, ROLE_LABELS } from '../core/roles';
import { api, ApiError, setUnauthorizedHandler, type Me } from './api';
import { Avatar, Brand, Dialog, FormError, hueStyle, STATUS_PREVIEW, useToast } from './components';
import { Dashboard } from './Dashboard';
import { downloadXlsx } from './download';
import { ForcedPasswordScreen, LoginScreen, PasswordForm, SetupScreen } from './Entry';
import { Icon } from './icons';
import { ImportDialog, type ImportSheet } from './ImportDialog';
import { ItemDialog, type ItemDialogState } from './ItemDialog';
import { useProduction } from './production';
import { ProductionView } from './Production';
import { ShipDialog } from './ShipDialog';
import { ShipmentDialog } from './ShipmentDialog';
import { ShipmentsView } from './Shipments';
import { UpdateNotice } from './update';
import { UsersScreen } from './Users';

type Theme = 'sistema' | 'claro' | 'escuro';
const THEME_KEY = 'no-porto:tema';
const GROUP_KEY = 'no-porto:agrupar-po';

function readGrouped(): boolean {
  try {
    return localStorage.getItem(GROUP_KEY) === '1';
  } catch {
    return false;
  }
}

function saveGrouped(on: boolean) {
  try {
    if (on) localStorage.setItem(GROUP_KEY, '1');
    else localStorage.removeItem(GROUP_KEY);
  } catch {
    // Só não lembra a escolha.
  }
}

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

const VIEWS = ['painel', 'producao', 'embarques', 'usuarios'] as const;
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

/** Início enquanto não há itens: explica o caminho dos itens e como começar. */
function Welcome({ user, onImport, onNew }: { user: Me; onImport?: () => void; onNew?: () => void }) {
  return (
    <section className="vazio" aria-labelledby="boas-vindas">
      <h2 id="boas-vindas">Olá, {user.name.split(' ')[0]}. Ainda não há itens em produção.</h2>
      <p>
        O No Porto acompanha cada item desde a PO no fornecedor até a chegada à editora, com os embarques, as invoices e os pagamentos no
        caminho.{' '}
        {onImport
          ? 'Para começar, faça a carga da aba Produção da planilha status_importações.'
          : onNew
            ? 'Cadastre o primeiro item, ou peça ao admin para fazer a carga da planilha.'
            : 'Os itens aparecem aqui assim que o admin fizer a carga da planilha.'}
      </p>
      {(onImport || onNew) && (
        <div className="vazio-acoes">
          {onImport && (
            <button type="button" className="btn primario" onClick={onImport}>
              <Icon name="arquivo" />
              Carga da planilha
            </button>
          )}
          {onNew && (
            <button type="button" className={onImport ? 'btn' : 'btn primario'} onClick={onNew}>
              <Icon name="mais" />
              Novo item
            </button>
          )}
        </div>
      )}
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

const TABS: { view: View; label: string; icon: 'inicio' | 'caixa' | 'navio' }[] = [
  { view: 'painel', label: 'Painel', icon: 'inicio' },
  { view: 'producao', label: 'Produção', icon: 'caixa' },
  { view: 'embarques', label: 'Embarques', icon: 'navio' },
];

function Shell({ user, onLogout }: { user: Me; onLogout: () => void }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [changingPassword, setChangingPassword] = useState(false);
  const [toast, showToast] = useToast();
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<ItemSort>({ key: 'order', dir: -1 });
  const [grouped, setGrouped] = useState(readGrouped);
  const [dialog, setDialog] = useState<ItemDialogState>(null);
  const [importing, setImporting] = useState<ImportSheet | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shipping, setShipping] = useState<string[] | null>(null);
  const [shipment, setShipment] = useState<string | null>(null);
  const production = useProduction();
  const data = production.data;
  // A tela Produção só mostra o que está em produção; as outras telas usam tudo.
  const productionData = useMemo(() => (data ? { ...data, items: data.items.filter((i) => i.status === 'producao') } : null), [data]);
  // Itens marcados que já não estão em produção (embarcados por outra pessoa) saem da marcação.
  useEffect(() => {
    if (!productionData || selected.size === 0) return;
    const still = new Set([...selected].filter((id) => productionData.items.some((i) => i.id === id)));
    if (still.size !== selected.size) setSelected(still);
  }, [productionData, selected]);
  const isAdmin = can(user.role, 'manage_users');
  const canEdit = can(user.role, 'edit');
  const canImport = can(user.role, 'import');

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const current: View = view === 'usuarios' && !isAdmin ? 'painel' : view;

  function goToProduction(f: Partial<ItemFilters>) {
    setFilters({ ...EMPTY_FILTERS, ...f });
    location.hash = 'producao';
  }

  async function exportItems() {
    if (!data) return;
    setExporting(true);
    try {
      const shown = sortItems(filterItems(productionData!.items, filters, data.orders, data.suppliers), sort, data.orders, data.suppliers);
      const rows = itemExportRows(shown, data.orders, data.suppliers, data.seeValues);
      const { buildExport } = await import('./spreadsheet');
      type Row = (typeof rows)[number];
      const columns: { header: string; width: number; value: (r: Row) => string | number | null; numFmt?: string }[] = [
        { header: 'PO', width: 10, value: (r) => r.po },
        { header: 'Fornecedor', width: 14, value: (r) => r.supplier },
        { header: 'Produto', width: 60, value: (r) => r.description },
        { header: 'ISBN', width: 16, value: (r) => r.isbn },
        { header: 'Quantidade', width: 12, value: (r) => r.quantity, numFmt: '#,##0' },
        { header: 'pcs/ctn', width: 9, value: (r) => r.piecesPerCarton },
      ];
      if (data.seeValues) {
        columns.push({ header: '$ unitário', width: 12, value: (r) => r.unitPrice ?? null, numFmt: '0.00#' });
        columns.push({ header: '$ total', width: 14, value: (r) => r.total ?? null, numFmt: '#,##0.00' });
      }
      columns.push({ header: 'Observações', width: 40, value: (r) => r.notes });
      downloadXlsx(await buildExport('Produção', columns, rows), `producao-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

  const actions = (
    <>
      <button type="button" className="btn" onClick={() => void exportItems()} disabled={exporting}>
        <Icon name="arquivo" />
        <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
      </button>
      {canImport && (
        <button type="button" className="btn" onClick={() => setImporting('Produção')}>
          <Icon name="atualizar" />
          <span className="rot">Carga da planilha</span>
        </button>
      )}
    </>
  );
  const shipmentActions = canImport ? (
    <button type="button" className="btn" onClick={() => setImporting('Embarques')}>
      <Icon name="atualizar" />
      <span className="rot">Carga da aba Embarques</span>
    </button>
  ) : null;

  return (
    <div className="pagina">
      {/* Não muda o endereço: as visões usam o trecho depois do # (#producao, #usuarios). */}
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
          {TABS.map((t) => (
            <a key={t.view} className="aba" href={`#${t.view}`} aria-current={current === t.view ? 'page' : undefined}>
              <Icon name={t.icon} />
              {t.label}
            </a>
          ))}
        </nav>
        <div className="acoes">
          {canEdit && current !== 'usuarios' && data && (
            <button className="btn primario" onClick={() => setDialog({ mode: 'new' })} aria-label="Novo item">
              <Icon name="mais" />
              <span className="rot">Novo item</span>
            </button>
          )}
          <UserMenu user={user} onPassword={() => setChangingPassword(true)} onLogout={onLogout} />
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {current === 'usuarios' ? (
          <UsersScreen me={user} />
        ) : !data ? (
          production.loadError ? (
            <div className="erro-carga">
              <FormError message={production.loadError} />
              <button className="btn" onClick={() => void production.reload()}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <p className="carregando" role="status">
              Carregando a produção…
            </p>
          )
        ) : (
          <>
            {production.loadError && (
              <p className="aviso alerta" role="status">
                <Icon name="alerta" />
                <span>Sem conexão com o servidor. Os dados podem estar desatualizados.</span>
              </p>
            )}
            {data.items.length === 0 && data.invoices.length === 0 ? (
              <Welcome user={user} onImport={canImport ? () => setImporting('Produção') : undefined} onNew={canEdit ? () => setDialog({ mode: 'new' }) : undefined} />
            ) : current === 'painel' ? (
              <Dashboard
                data={data}
                onSupplier={(id) => goToProduction({ supplierId: id })}
                onOrder={(id) => goToProduction({ orderId: id })}
                onShipment={setShipment}
              />
            ) : current === 'embarques' ? (
              <ShipmentsView data={data} onOpen={setShipment} actions={shipmentActions} />
            ) : (
              <ProductionView
                data={productionData!}
                filters={filters}
                onFilters={setFilters}
                sort={sort}
                onSort={setSort}
                grouped={grouped}
                onGrouped={(g) => {
                  setGrouped(g);
                  saveGrouped(g);
                }}
                onOpen={(item) => setDialog({ mode: 'edit', item })}
                actions={actions}
                selection={canEdit ? { ids: selected, onChange: setSelected, onShip: () => setShipping([...selected]) } : undefined}
              />
            )}
          </>
        )}
      </main>

      {data && <ItemDialog state={dialog} me={user} data={data} production={production} onClose={() => setDialog(null)} onToast={showToast} />}
      {canImport && <ImportDialog sheet={importing} production={production} onClose={() => setImporting(null)} onToast={showToast} />}
      {data && canEdit && (
        <ShipDialog
          items={shipping ? data.items.filter((i) => shipping.includes(i.id)) : null}
          data={data}
          production={production}
          onClose={() => setShipping(null)}
          onDone={(msg) => {
            setSelected(new Set());
            showToast(msg);
          }}
        />
      )}
      {data && (
        <ShipmentDialog
          unitKey={shipment}
          me={user}
          data={data}
          production={production}
          onClose={() => setShipment(null)}
          onToast={showToast}
          onOpenItem={(item) => setDialog({ mode: 'edit', item })}
        />
      )}
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
