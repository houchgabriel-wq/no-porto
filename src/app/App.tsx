import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { itemExportRows, productionExportColumns } from '../core/exportItems';
import type { HistoryRow } from '../core/history';
import { backupDue, backupFileName } from '../core/backup';
import { copySheets, DELIVERED_HEADER, PRODUCTION_HEADER, SHIPMENTS_HEADER } from '../core/fullCopy';
import type { Amount, SupplierSummary } from '../core/suppliers';
import { EMPTY_FILTERS, filterItems, sortItems, type ItemFilters, type ItemSort } from '../core/items';
import { can, ROLE_LABELS } from '../core/roles';
import { api, ApiError, setUnauthorizedHandler, type Me, type StockData } from './api';
import { Avatar, Brand, Dialog, FormError, hueStyle, setSupplierHues, STATUS_PREVIEW, useToast } from './components';
import { Dashboard } from './Dashboard';
import { downloadXlsx } from './download';
import { ForcedPasswordScreen, LoginScreen, PasswordForm, SetupScreen } from './Entry';
import { Icon, type IconName } from './icons';
import { BookingDialog, BookingsView, NewBookingDialog, PendingBadge, PendingBookingsNotice, useBookings } from './Bookings';
import { FullImportDialog } from './FullImport';
import { ImportDialog, type ImportSheet } from './ImportDialog';
import { UpdateSheetDialog } from './UpdateSheet';
import { ItemDialog, type ItemDialogState } from './ItemDialog';
import { useProduction } from './production';
import { ProductionView } from './Production';
import { HistoryView, type HistoryData } from './History';
import { ProductDialog } from './ProductDialog';
import { ArrivalDialog, OrderUploadDialog } from './Documents';
import { NewShipmentDialog } from './NewShipment';
import { ShipDialog } from './ShipDialog';
import { SupplierDialog, SuppliersView, type SuppliersData } from './Suppliers';
import { ShipmentDialog } from './ShipmentDialog';
import { ShipmentsView } from './Shipments';
import { ShipmentItemsView } from './ShipmentItems';
import { CurveDialog, StockView } from './StockForecast';
import { SalesView } from './Sales';
import { UpdateNotice } from './update';
import { UsersScreen } from './Users';

type Theme = 'sistema' | 'claro' | 'escuro';
const THEME_KEY = 'no-porto:tema';
const GROUP_KEY = 'no-porto:agrupar-po';
const BACKUP_KEY = 'no-porto:copia-completa';
const SHIPMENTS_MODE_KEY = 'no-porto:embarques-visao';

type ShipmentsMode = 'embarque' | 'item';

function readShipmentsMode(): ShipmentsMode {
  try {
    return localStorage.getItem(SHIPMENTS_MODE_KEY) === 'item' ? 'item' : 'embarque';
  } catch {
    return 'embarque';
  }
}

function saveShipmentsMode(mode: ShipmentsMode) {
  try {
    if (mode === 'item') localStorage.setItem(SHIPMENTS_MODE_KEY, mode);
    else localStorage.removeItem(SHIPMENTS_MODE_KEY);
  } catch {
    // Só não lembra a escolha.
  }
}

/** Dia da última cópia completa baixada neste navegador. */
function readLastBackup(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch {
    return null;
  }
}

function saveLastBackup(day: string) {
  try {
    localStorage.setItem(BACKUP_KEY, day);
  } catch {
    // Só não lembra a data.
  }
}

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

const VIEWS = ['painel', 'solicitacoes', 'producao', 'estoque', 'embarques', 'historico', 'fornecedores', 'usuarios'] as const;
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
      // O agente de cargas tem uma tela só, as próprias solicitações de embarque.
      if (can(state.user.role, 'request_bookings')) return <AgentShell user={state.user} onLogout={() => void logout()} />;
      // Vendas tem uma tela só, a lista dos produtos a caminho.
      if (!can(state.user.role, 'view_shipments')) return <SalesShell user={state.user} onLogout={() => void logout()} />;
      return <Shell user={state.user} onLogout={() => void logout()} />;
  }
}

function UserMenu({
  user,
  onPassword,
  onLogout,
  onBackup,
  onFullImport,
  onNoPrelo,
}: {
  user: Me;
  onPassword: () => void;
  onLogout: () => void;
  onBackup?: () => void;
  onFullImport?: () => void;
  /** Busca agora as aprovações do arquivo no No Prelo (admin). */
  onNoPrelo?: () => void;
}) {
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
          {onBackup && (
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onBackup();
              }}
            >
              <Icon name="arquivo" />
              Baixar cópia completa
            </button>
          )}
          {onFullImport && (
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onFullImport();
              }}
            >
              <Icon name="atualizar" />
              Carga completa da planilha
            </button>
          )}
          {onNoPrelo && (
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onNoPrelo();
              }}
            >
              <Icon name="livro" />
              Buscar aprovações no No Prelo
            </button>
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
          ? 'Para começar, faça a carga completa da planilha status_importações: as abas Produção, Embarques e Entregues entram de uma vez.'
          : onNew
            ? 'Cadastre o primeiro item, ou peça ao admin para fazer a carga da planilha.'
            : 'Os itens aparecem aqui assim que o admin fizer a carga da planilha.'}
      </p>
      {(onImport || onNew) && (
        <div className="vazio-acoes">
          {onImport && (
            <button type="button" className="btn primario" onClick={onImport}>
              <Icon name="arquivo" />
              Carga completa da planilha
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

const TABS: { view: View; label: string; icon: IconName }[] = [
  { view: 'painel', label: 'Painel', icon: 'inicio' },
  { view: 'solicitacoes', label: 'Solicitações', icon: 'container' },
  { view: 'embarques', label: 'Embarques', icon: 'navio' },
  { view: 'producao', label: 'Produção', icon: 'caixa' },
  // "Previsão de estoque" não cabe no topo dos notebooks com sete abas: na aba, "Estoque".
  { view: 'estoque', label: 'Estoque', icon: 'tendencia' },
  { view: 'historico', label: 'Histórico', icon: 'arquivo' },
  { view: 'fornecedores', label: 'Fornecedores', icon: 'pessoas' },
];

/** Perfis de uma tela só (Vendas e Agente de cargas): a aba, o menu do usuário e o conteúdo. */
function OneTabShell({ user, onLogout, tab, children }: { user: Me; onLogout: () => void; tab: { href: string; label: string; icon: IconName }; children: (showToast: (msg: string) => void) => ReactNode }) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [toast, showToast] = useToast();
  return (
    <div className="pagina">
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
          <a className="aba" href={tab.href} aria-current="page">
            <Icon name={tab.icon} />
            {tab.label}
          </a>
        </nav>
        <div className="acoes">
          <UserMenu user={user} onPassword={() => setChangingPassword(true)} onLogout={onLogout} />
        </div>
      </header>
      <main id="conteudo" tabIndex={-1}>
        {children(showToast)}
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

/** Tela do perfil Vendas: só a aba Embarques, em lista, com produto e chegada. */
function SalesShell({ user, onLogout }: { user: Me; onLogout: () => void }) {
  return (
    <OneTabShell user={user} onLogout={onLogout} tab={{ href: '#embarques', label: 'Embarques', icon: 'navio' }}>
      {() => <SalesView />}
    </OneTabShell>
  );
}

/** Tela do agente de cargas: só as próprias solicitações de embarque. */
function AgentShell({ user, onLogout }: { user: Me; onLogout: () => void }) {
  return (
    <OneTabShell user={user} onLogout={onLogout} tab={{ href: '#solicitacoes', label: 'Solicitações', icon: 'container' }}>
      {(showToast) => <AgentBookings user={user} onToast={showToast} />}
    </OneTabShell>
  );
}

function AgentBookings({ user, onToast }: { user: Me; onToast: (msg: string) => void }) {
  const bookings = useBookings(true);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!bookings.data) {
    return bookings.loadError ? (
      <div className="erro-carga">
        <FormError message={bookings.loadError} />
        <button className="btn" onClick={() => void bookings.reload()}>
          Tentar de novo
        </button>
      </div>
    ) : (
      <p className="carregando" role="status">
        Carregando as solicitações…
      </p>
    );
  }
  return (
    <>
      {bookings.loadError && (
        <p className="aviso alerta" role="status">
          <Icon name="alerta" />
          <span>Sem conexão com o servidor. A lista pode estar desatualizada.</span>
        </p>
      )}
      <BookingsView data={bookings.data} onOpen={setOpen} onNew={() => setCreating(true)} onToast={onToast} />
      <NewBookingDialog
        open={creating}
        data={bookings.data}
        onClose={() => setCreating(false)}
        onCreated={(request) => {
          bookings.put(request);
          setCreating(false);
          onToast('Solicitação enviada para aprovação. A resposta aparece aqui.');
        }}
      />
      <BookingDialog
        request={bookings.data.requests.find((r) => r.id === open) ?? null}
        data={bookings.data}
        me={user}
        onClose={() => setOpen(null)}
        onSaved={(request, msg) => {
          bookings.put(request);
          onToast(msg);
        }}
      />
    </>
  );
}

function Shell({ user, onLogout }: { user: Me; onLogout: () => void }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [changingPassword, setChangingPassword] = useState(false);
  const [toast, showToast] = useToast();
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<ItemSort>({ key: 'order', dir: -1 });
  const [grouped, setGrouped] = useState(readGrouped);
  const [dialog, setDialog] = useState<ItemDialogState>(null);
  const [importing, setImporting] = useState<ImportSheet | null>(null);
  const [updatingSheet, setUpdatingSheet] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shipping, setShipping] = useState<string[] | null>(null);
  const [shipment, setShipment] = useState<string | null>(null);
  const [upload, setUpload] = useState<'pedido' | 'embarque' | null>(null);
  const [arrival, setArrival] = useState<string[] | null>(null);
  const [fullImport, setFullImport] = useState(false);
  const [shipmentsMode, setShipmentsMode] = useState<ShipmentsMode>(readShipmentsMode);
  const [product, setProduct] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState(readLastBackup);
  const [backingUp, setBackingUp] = useState(false);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [suppliersData, setSuppliersData] = useState<SuppliersData | null>(null);
  const [supplier, setSupplier] = useState<SupplierSummary | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [stock, setStock] = useState<StockData | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [curveOpen, setCurveOpen] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const production = useProduction();
  // Solicitações de embarque: carregadas desde a entrada, para o painel e a aba avisarem das que aguardam.
  const seesBookings = can(user.role, 'view_bookings');
  const bookings = useBookings(seesBookings);
  const data = production.data;
  // Cores dos fornecedores, dos que têm mais itens para os que têm menos (antes de desenhar as telas).
  if (data) setSupplierHues(data.suppliers, data.items);
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

  const seesAll = can(user.role, 'view_all');
  // Fornecedores e Solicitações são só de admin e editor (decidido em 19/11/2026); o perfil Embarques tem
  // só as telas de embarques e do histórico.
  const seesSuppliers = can(user.role, 'view_suppliers');
  // Previsão de estoque: admin, editor, Consulta e leitor veem; admin e editor carregam a curva (20/11/2026).
  const seesStock = can(user.role, 'view_stock');
  const loadsStock = can(user.role, 'load_stock');
  const allowed = (v: View) =>
    v === 'solicitacoes'
      ? seesBookings
      : v === 'fornecedores'
        ? seesSuppliers
        : v === 'estoque'
          ? seesStock
          : seesAll || v === 'embarques' || (v === 'historico' && can(user.role, 'view_history'));
  const current: View = !allowed(view) ? (seesAll ? 'painel' : 'embarques') : view === 'usuarios' && !isAdmin ? 'painel' : view;
  const tabs = TABS.filter((t) => allowed(t.view));
  // No celular, as abas rolam de lado: a aba atual fica à vista.
  useEffect(() => {
    document.querySelector('.abas .aba[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  // O histórico é grande: só é carregado ao abrir a tela (e de novo a cada vez que ela é aberta).
  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory(await api.history());
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : 'Não foi possível carregar o histórico.');
    }
  }, []);
  useEffect(() => {
    if (current === 'historico') void loadHistory();
  }, [current, loadHistory]);

  // A previsão de estoque: a curva e o que o No Porto tem de cada título, ao abrir a aba.
  const loadStock = useCallback(async () => {
    setStockError(null);
    try {
      setStock(await api.stock());
    } catch (e) {
      setStockError(e instanceof ApiError ? e.message : 'Não foi possível carregar a previsão de estoque.');
    }
  }, []);
  useEffect(() => {
    if (current === 'estoque') void loadStock();
  }, [current, loadStock]);
  // O cartão do painel: só os números; some se não carregar.
  const [stockCard, setStockCard] = useState<{ today: string; curve: StockData['curve']; summary: Awaited<ReturnType<typeof api.stockSummary>>['summary'] } | null | undefined>(
    seesStock ? null : undefined,
  );
  const loadStockCard = useCallback(async () => {
    try {
      setStockCard(await api.stockSummary());
    } catch {
      setStockCard(undefined);
    }
  }, []);
  useEffect(() => {
    if (seesStock && current === 'painel') void loadStockCard();
  }, [seesStock, current, loadStockCard, data?.items.length]);

  // Resumo por fornecedor (somado no banco), para admin e editor: na tela Fornecedores e na situação do
  // fornecedor, na ficha da solicitação de embarque.
  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliersData(await api.suppliers());
    } catch {
      // A tela Fornecedores mostra o carregamento de novo na próxima vez.
    }
  }, []);
  useEffect(() => {
    if (seesSuppliers && (current === 'fornecedores' || current === 'solicitacoes')) void loadSuppliers();
  }, [seesSuppliers, current, loadSuppliers, data?.items.length]);
  // O "Recebido no ano" do painel, para todos que veem o painel (somado no banco).
  const [received, setReceived] = useState<{ year: string; amount: Amount } | null>(null);
  const seesReceived = seesAll && can(user.role, 'see_year_totals');
  useEffect(() => {
    if (!seesReceived || current !== 'painel') return;
    api
      .received()
      .then((r) => setReceived({ year: r.year, amount: r.amount }))
      .catch(() => {
        // O painel funciona sem o recebido no ano.
      });
  }, [seesReceived, current, data?.items.length]);
  const thisYear = data?.today.slice(0, 4) ?? String(new Date().getFullYear());

  async function exportSuppliers() {
    if (!suppliersData) return;
    setExporting(true);
    try {
      const { buildExport } = await import('./spreadsheet');
      const v = suppliersData.seeValues;
      type S = SupplierSummary;
      const y = (s: S) => s.byYear.find((x) => x.year === thisYear);
      const columns: { header: string; width: number; value: (s: S) => string | number | null; numFmt?: string }[] = [
        { header: 'Fornecedor', width: 18, value: (s) => s.name },
        { header: 'Em produção (itens)', width: 12, value: (s) => s.production.items, numFmt: '#,##0' },
        { header: 'Em produção (ex.)', width: 14, value: (s) => s.production.quantity, numFmt: '#,##0' },
        ...(v ? [{ header: 'Em produção ($)', width: 14, value: (s: S) => (s.production.valueCents ?? 0) / 100, numFmt: '#,##0.00' }] : []),
        { header: 'No mar (ex.)', width: 14, value: (s) => s.atSea.quantity, numFmt: '#,##0' },
        ...(v ? [{ header: 'No mar ($)', width: 14, value: (s: S) => (s.atSea.valueCents ?? 0) / 100, numFmt: '#,##0.00' }] : []),
        { header: `Recebido em ${thisYear} (ex.)`, width: 16, value: (s) => y(s)?.quantity ?? 0, numFmt: '#,##0' },
        ...(v ? [{ header: `Recebido em ${thisYear} ($)`, width: 16, value: (s: S) => (y(s)?.valueCents ?? 0) / 100, numFmt: '#,##0.00' }] : []),
        { header: 'Recebido desde 2023 (ex.)', width: 18, value: (s) => s.delivered.quantity, numFmt: '#,##0' },
        ...(v ? [{ header: 'Recebido desde 2023 ($)', width: 18, value: (s: S) => (s.delivered.valueCents ?? 0) / 100, numFmt: '#,##0.00' }] : []),
        { header: 'Última chegada', width: 14, value: (s) => (s.lastArrival ? s.lastArrival.split('-').reverse().join('/') : '') },
        { header: 'Observações', width: 40, value: (s) => s.notes },
      ];
      downloadXlsx(await buildExport('Fornecedores', columns, suppliersData.suppliers), `fornecedores-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

  async function exportHistory(rows: HistoryRow[]) {
    if (!data) return;
    setExporting(true);
    try {
      const names = new Map((history?.suppliers ?? data.suppliers).map((s) => [s.id, s.name]));
      const seeValues = history?.seeValues ?? false;
      const { buildExport } = await import('./spreadsheet');
      const columns: { header: string; width: number; value: (r: HistoryRow) => string | number | null; numFmt?: string }[] = [
        { header: 'Chegada', width: 12, value: (r) => (r.arrivedAt ? r.arrivedAt.split('-').reverse().join('/') : '') },
        { header: 'Fornecedor', width: 14, value: (r) => (r.item.supplierId ? (names.get(r.item.supplierId) ?? '') : '') },
        { header: 'Produto', width: 60, value: (r) => r.item.description },
        { header: 'ISBN', width: 16, value: (r) => r.item.isbn ?? '' },
        { header: 'Invoice', width: 18, value: (r) => r.invoice?.number ?? '' },
        { header: 'Ref. embarque', width: 18, value: (r) => r.invoice?.ref ?? '' },
        { header: 'BL', width: 18, value: (r) => r.invoice?.billNumber ?? '' },
        { header: 'Quantidade', width: 12, value: (r) => r.item.quantity, numFmt: '#,##0' },
        { header: 'pcs/ctn', width: 9, value: (r) => r.item.piecesPerCarton },
      ];
      if (seeValues) {
        columns.push({ header: '$ unitário', width: 12, value: (r) => (r.item.unitPriceMicros == null ? null : r.item.unitPriceMicros / 1_000_000), numFmt: '0.00#' });
        columns.push({ header: '$ total', width: 14, value: (r) => (r.item.totalCents == null ? null : r.item.totalCents / 100), numFmt: '#,##0.00' });
      }
      columns.push({ header: 'Observações', width: 50, value: (r) => [r.invoice?.notes, r.item.notes].filter(Boolean).join(' · ') });
      downloadXlsx(await buildExport('Histórico', columns, rows), `historico-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

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
      downloadXlsx(await buildExport('Produção', productionExportColumns(data.seeValues), rows), `producao-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

  const actions = (
    <>
      {canEdit && (
        <button type="button" className="btn" onClick={() => setUpload('pedido')}>
          <Icon name="arquivo" />
          <span className="rot">Novo pedido</span>
        </button>
      )}
      <button type="button" className="btn" onClick={() => void exportItems()} disabled={exporting}>
        <Icon name="arquivo" />
        <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
      </button>
      {canEdit && (
        <button type="button" className="btn" onClick={() => setUpdatingSheet(true)}>
          <Icon name="lapis" />
          <span className="rot">Atualizar pela planilha</span>
        </button>
      )}
      {canImport && (
        <button type="button" className="btn" onClick={() => setImporting('Produção')}>
          <Icon name="atualizar" />
          <span className="rot">Carga da planilha</span>
        </button>
      )}
    </>
  );
  /** Busca agora as aprovações do arquivo no No Prelo (a busca automática roda uma vez por dia, de manhã). */
  async function syncNoPrelo() {
    showToast('Buscando as aprovações no No Prelo…');
    try {
      const res = await production.write(() => api.syncNoPrelo());
      showToast(
        res.updated === 0
          ? `Nenhuma aprovação nova no No Prelo (${res.approvals} ${res.approvals === 1 ? 'lida' : 'lidas'}).`
          : `${res.updated} ${res.updated === 1 ? 'item recebeu' : 'itens receberam'} a aprovação do arquivo do No Prelo.`,
      );
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Não foi possível falar com o No Prelo.');
    }
  }

  /** Cópia completa (admin): as abas Produção, Embarques e Entregues no formato da planilha. */
  async function downloadFullCopy() {
    if (backingUp) return;
    setBackingUp(true);
    showToast('Gerando a cópia completa…');
    try {
      const all = await api.fullCopy();
      const sheets = copySheets(all);
      const { buildSheets } = await import('./spreadsheet');
      const buffer = await buildSheets([
        { name: 'Produção', header: PRODUCTION_HEADER, rows: sheets.production },
        { name: 'Embarques', header: SHIPMENTS_HEADER, rows: sheets.shipments },
        { name: 'Entregues', header: DELIVERED_HEADER, rows: sheets.delivered },
      ]);
      const today = data?.today ?? new Date().toISOString().slice(0, 10);
      downloadXlsx(buffer, backupFileName(today));
      saveLastBackup(today);
      setLastBackup(today);
      showToast(`Cópia baixada (${sheets.production.length} em produção, ${sheets.shipments.length} embarcados, ${sheets.delivered.length} entregues). Guarde fora do computador, por exemplo no Google Drive.`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Não foi possível gerar a cópia completa.');
    } finally {
      setBackingUp(false);
    }
  }

  async function exportShipments() {
    if (!data) return;
    setExporting(true);
    try {
      const sheets = copySheets({ ...data, items: data.items.filter((i) => i.status === 'embarcado') }, data.seeValues);
      const { buildSheets } = await import('./spreadsheet');
      downloadXlsx(await buildSheets([{ name: 'Embarques', header: SHIPMENTS_HEADER, rows: sheets.shipments }]), `embarques-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      showToast('Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  }

  const historyActions = canImport ? (
    <button type="button" className="btn" onClick={() => setImporting('Entregues')}>
      <Icon name="atualizar" />
      <span className="rot">Carga da aba Entregues</span>
    </button>
  ) : null;
  const shipmentActions = (
    <>
      {canEdit && (
        <>
          <button type="button" className="btn" onClick={() => setUpload('embarque')}>
            <Icon name="navio" />
            <span className="rot">Novo embarque</span>
          </button>
          <button type="button" className="btn" onClick={() => setArrival([])}>
            <Icon name="check" />
            <span className="rot">Registrar chegada</span>
          </button>
        </>
      )}
      <button type="button" className="btn" onClick={() => void exportShipments()} disabled={exporting}>
        <Icon name="arquivo" />
        <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
      </button>
      {canImport && (
        <button type="button" className="btn" onClick={() => setImporting('Embarques')}>
          <Icon name="atualizar" />
          <span className="rot">Carga da aba Embarques</span>
        </button>
      )}
    </>
  );

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
          {tabs.map((t) => (
            <a key={t.view} className="aba" href={`#${t.view}`} aria-current={current === t.view ? 'page' : undefined}>
              <Icon name={t.icon} />
              {t.label}
              {t.view === 'solicitacoes' && <PendingBadge data={bookings.data} />}
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
          <UserMenu
            user={user}
            onPassword={() => setChangingPassword(true)}
            onLogout={onLogout}
            onBackup={can(user.role, 'full_copy') ? () => void downloadFullCopy() : undefined}
            onFullImport={canImport ? () => setFullImport(true) : undefined}
            onNoPrelo={canImport ? () => void syncNoPrelo() : undefined}
          />
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {current === 'usuarios' ? (
          <UsersScreen me={user} />
        ) : current === 'solicitacoes' ? (
          bookings.data ? (
            <>
              {bookings.loadError && (
                <p className="aviso alerta" role="status">
                  <Icon name="alerta" />
                  <span>Sem conexão com o servidor. A lista pode estar desatualizada.</span>
                </p>
              )}
              <BookingsView data={bookings.data} onOpen={setBooking} onToast={showToast} />
            </>
          ) : bookings.loadError ? (
            <div className="erro-carga">
              <FormError message={bookings.loadError} />
              <button className="btn" onClick={() => void bookings.reload()}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <p className="carregando" role="status">
              Carregando as solicitações…
            </p>
          )
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
            {current === 'fornecedores' ? (
              suppliersData ? (
                <SuppliersView
                  data={suppliersData}
                  year={thisYear}
                  onOpen={setSupplier}
                  actions={
                    <button type="button" className="btn" onClick={() => void exportSuppliers()} disabled={exporting}>
                      <Icon name="arquivo" />
                      <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
                    </button>
                  }
                />
              ) : (
                <p className="carregando" role="status">
                  Carregando os fornecedores…
                </p>
              )
            ) : current === 'historico' ? (
              history ? (
                <HistoryView
                  history={history}
                  suppliers={history.suppliers}
                  onProduct={seesAll ? setProduct : undefined}
                  showYears={can(user.role, 'see_year_totals')}
                  onExport={(rows) => void exportHistory(rows)}
                  exporting={exporting}
                  actions={historyActions}
                />
              ) : historyError ? (
                <div className="erro-carga">
                  <FormError message={historyError} />
                  <button className="btn" onClick={() => void loadHistory()}>
                    Tentar de novo
                  </button>
                </div>
              ) : (
                <p className="carregando" role="status">
                  Carregando o histórico…
                </p>
              )
            ) : current === 'estoque' ? (
              stock ? (
                <StockView data={stock} onLoad={loadsStock ? () => setCurveOpen(true) : undefined} onProduct={seesAll ? setProduct : undefined} onToast={showToast} />
              ) : stockError ? (
                <div className="erro-carga">
                  <FormError message={stockError} />
                  <button className="btn" onClick={() => void loadStock()}>
                    Tentar de novo
                  </button>
                </div>
              ) : (
                <p className="carregando" role="status">
                  Carregando a previsão de estoque…
                </p>
              )
            ) : seesAll && data.items.length === 0 && data.invoices.length === 0 ? (
              <Welcome user={user} onImport={canImport ? () => setFullImport(true) : undefined} onNew={canEdit ? () => setDialog({ mode: 'new' }) : undefined} />
            ) : current === 'painel' ? (
              <>
              {bookings.data && <PendingBookingsNotice data={bookings.data} />}
              {canImport && backupDue(lastBackup, data.today) && (
                <div className="lembrete-copia" role="status">
                  <Icon name="arquivo" />
                  <span>
                    {lastBackup ? 'Faz mais de um mês que a cópia completa foi baixada neste navegador.' : 'A cópia completa ainda não foi baixada neste navegador.'} Baixe e guarde fora
                    do computador, por exemplo no Google Drive.
                  </span>
                  <button type="button" className="btn primario" onClick={() => void downloadFullCopy()} disabled={backingUp}>
                    {backingUp ? 'Gerando…' : 'Baixar agora'}
                  </button>
                </div>
              )}
              <Dashboard
                data={data}
                onSupplier={(id) => goToProduction({ supplierId: id })}
                onOrder={(id) => goToProduction({ orderId: id })}
                onShipment={setShipment}
                onProduct={setProduct}
                received={received}
                stock={stockCard}
              />
              </>
            ) : current === 'embarques' ? (
              <>
                <div className="seg visao-troca" role="group" aria-label="Visão dos embarques">
                  {(
                    [
                      ['embarque', 'Por embarque', 'navio'],
                      ['item', 'Por item', 'tabela'],
                    ] as const
                  ).map(([mode, label, icon]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={shipmentsMode === mode}
                      onClick={() => {
                        setShipmentsMode(mode);
                        saveShipmentsMode(mode);
                      }}
                    >
                      <Icon name={icon} />
                      {label}
                    </button>
                  ))}
                </div>
                {shipmentsMode === 'item' ? (
                  <ShipmentItemsView data={data} onOpen={(item) => setDialog({ mode: 'edit', item })} actions={shipmentActions} />
                ) : (
                  <ShipmentsView data={data} onOpen={setShipment} actions={shipmentActions} />
                )}
              </>
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

      {data && (
        <ItemDialog state={dialog} me={user} data={data} production={production} onClose={() => setDialog(null)} onToast={showToast} onProduct={seesAll ? setProduct : undefined} />
      )}
      {canImport && (
        <ImportDialog
          sheet={importing}
          production={production}
          onClose={() => {
            if (importing === 'Entregues' && current === 'historico') void loadHistory();
            setImporting(null);
          }}
          onToast={showToast}
        />
      )}
      {canEdit && <UpdateSheetDialog open={updatingSheet} production={production} onClose={() => setUpdatingSheet(false)} onToast={showToast} />}
      {loadsStock && (
        <CurveDialog
          open={curveOpen}
          today={stock?.today ?? data?.today ?? new Date().toISOString().slice(0, 10)}
          onClose={() => setCurveOpen(false)}
          onLoaded={(r) => {
            setCurveOpen(false);
            showToast(`Curva com o estoque de ${r.stockDate.split('-').reverse().join('/')} carregada: ${r.rowCount.toLocaleString('pt-BR')} títulos.`);
            void loadStock();
            void loadStockCard();
          }}
        />
      )}
      {canImport && data && (
        <FullImportDialog
          open={fullImport}
          hasData={data.suppliers.length > 0}
          production={production}
          backingUp={backingUp}
          onBackup={() => void downloadFullCopy()}
          onClose={() => {
            setFullImport(false);
            if (current === 'historico') void loadHistory();
            void loadSuppliers();
          }}
          onToast={showToast}
        />
      )}
      {data && <ProductDialog productId={product} suppliers={data.suppliers} onClose={() => setProduct(null)} />}
      <SupplierDialog
        supplier={supplier}
        all={suppliersData?.suppliers ?? []}
        me={user}
        seeValues={suppliersData?.seeValues ?? false}
        onClose={() => setSupplier(null)}
        onSaved={(msg) => {
          showToast(msg);
          void loadSuppliers();
          void production.reload();
        }}
        onProduction={(id) => {
          setSupplier(null);
          goToProduction({ supplierId: id });
        }}
      />
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
      {data && canEdit && (
        <>
          <OrderUploadDialog
            open={upload === 'pedido'}
            data={data}
            production={production}
            onClose={() => setUpload(null)}
            onDone={(msg, orderId) => {
              showToast(msg);
              goToProduction({ orderId });
            }}
          />
          <NewShipmentDialog open={upload === 'embarque'} data={data} production={production} onClose={() => setUpload(null)} onDone={showToast} />
          <ArrivalDialog open={arrival !== null} initial={arrival ?? []} data={data} production={production} onClose={() => setArrival(null)} onDone={showToast} />
        </>
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
      {bookings.data && (
        <BookingDialog
          request={bookings.data.requests.find((r) => r.id === booking) ?? null}
          data={bookings.data}
          me={user}
          context={{ production: data, suppliers: suppliersData?.suppliers ?? null }}
          onClose={() => setBooking(null)}
          onSaved={(request, msg) => {
            bookings.put(request);
            showToast(msg);
          }}
          onProduction={
            seesAll
              ? (id) => {
                  setBooking(null);
                  goToProduction({ supplierId: id });
                }
              : undefined
          }
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
