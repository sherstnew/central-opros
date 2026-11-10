import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NavLink,
  Routes,
  Route,
  useSearchParams,
  useLocation,
  Link,
} from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  MapPin,
  Monitor,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  Plus,
  X,
  Bell,
  RefreshCw,
  Radio,
  BriefcaseBusiness,
  Settings2,
  LayoutList,
  Archive,
  LogOut,
  CalendarDays,
  Info,
  Download,
  ExternalLink,
  Trash2,
  UserRound,
  ShieldCheck,
  LoaderCircle,
  Search,
  CheckCircle2,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  moscowDay,
  stageNames,
  type AppData,
  type Offer,
  type Profile,
  type Stage,
  type Feedback,
  type AccountChannel,
} from "../shared/model";
import { registerSW } from "virtual:pwa-register";

const money = (n: number | null, currency = "RUB") =>
  n === null
    ? "Не указано"
    : `${new Intl.NumberFormat("ru-RU").format(n)} ${currency === "RUB" ? "₽" : currency}`;
const prettyDay = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(`${day}T12:00:00+03:00`));
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
const I = ({
  icon: Icon,
  size = 20,
  ...props
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) => <Icon size={size} strokeWidth={1.8} aria-hidden="true" {...props} />;
type Toast = { text: string; action?: () => void; label?: string };
type Notify = (text: string, action?: () => void, label?: string) => void;

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea,select,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <I icon={X} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Empty({
  icon = Search,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <I icon={icon} size={28} />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);
  const queryClient = useQueryClient(),
    [toast, setToast] = useState<Toast | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [update, setUpdate] = useState<null | (() => void)>(null);
  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: () => api<{ authenticated: boolean; demo: boolean }>("/auth"),
    retry: false,
  });
  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api<AppData>("/state"),
    enabled: auth.data?.authenticated === true,
    refetchInterval: 15000,
    retry: false,
  });
  useEffect(() => {
    if (state.error instanceof ApiError && state.error.status === 401)
      void auth.refetch();
  }, [state.error]);
  const notify: Notify = (text, action, label = "Отменить") =>
    setToast({ text, action, label });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 12000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sw = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (registration) {
          void registration.update().catch(() => {});
          timer = setInterval(
            () => {
              if (navigator.onLine) void registration.update().catch(() => {});
            },
            60 * 60 * 1000,
          );
        }
      },
      onNeedRefresh() {
        setUpdate(() => () => void sw(true));
      },
    });
    return () => clearInterval(timer);
  }, []);
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["state"] });
  }
  if (auth.isPending)
    return (
      <div className="boot">
        <img src="/icon.svg" width="54" alt="" />
        <p>Загрузка…</p>
      </div>
    );
  if (auth.isError)
    return (
      <div className="boot">
        <I icon={WifiOff} size={36} />
        <h2>Сервер недоступен</h2>
        <button className="primary" onClick={() => auth.refetch()}>
          Попробовать снова
        </button>
      </div>
    );
  if (!auth.data?.authenticated)
    return <Login onLogin={() => auth.refetch()} />;
  if (state.isPending || !state.data)
    return (
      <div className="boot">
        <I icon={state.isError ? WifiOff : LoaderCircle} size={32} />
        <p>
          {state.isError ? "Не удалось загрузить данные" : "Загрузка ленты…"}
        </p>
        {state.isError && (
          <button className="primary" onClick={() => state.refetch()}>
            Повторить
          </button>
        )}
      </div>
    );
  const data = state.data,
    work = data.offers.filter(
      (o) => !["new", "hidden", "cancelled", "paid"].includes(o.stage),
    ).length;
  const count = data.offers.filter(
    (o) => o.stage === "new" && o.match !== "no",
  ).length;
  const nav = [
    { to: "/", icon: LayoutList, label: "Лента", count },
    { to: "/work", icon: BriefcaseBusiness, label: "В работе", count: work },
    { to: "/settings", icon: Settings2, label: "Настройки", count: 0 },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="Отклик — на главную">
          <img src="/icon.svg" alt="" />
          <span>Отклик</span>
        </Link>
        <nav className="main-nav" aria-label="Основная навигация">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}>
              <I icon={n.icon} />
              <span>{n.label}</span>
              {n.count > 0 && <b>{n.count}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-context">
          <Link to="/settings?tab=sources">
            <Radio size={16} />
            <span>Источники</span>
            <b>{data.sources.filter((s) => s.enabled).length}</b>
          </Link>
          <Link to="/settings?tab=notifications">
            <Clock3 size={16} />
            <span>Сбор {data.settings.collectionTime} МСК</span>
          </Link>
        </div>
        <Link className="archive-link" to="/hidden">
          <I icon={Archive} size={18} />
          Скрытые предложения
        </Link>
        <div className="sidebar-bottom">
          <div className="avatar">{data.profile.name?.[0] || "Я"}</div>
          <div>
            <strong>{data.profile.name || "Мой профиль"}</strong>
            {(data.demo || data.profile.city) && (
              <span>{data.demo ? "Деморежим" : data.profile.city}</span>
            )}
          </div>
          <Link to="/settings" aria-label="Открыть профиль">
            <I icon={ChevronRight} size={18} />
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <img src="/icon.svg" alt="" />
            Отклик
          </div>
          <div className="topbar-right">
            {data.demo && (
              <span className="demo-badge">
                <span />
                Деморежим
              </span>
            )}
            <Link
              to="/settings?tab=notifications"
              className="icon-button notification-button"
              aria-label="Настроить уведомления"
            >
              <I icon={Bell} />
            </Link>
            <Link
              className="top-avatar"
              to="/settings"
              aria-label="Мой профиль"
            >
              {data.profile.name?.[0] || "Я"}
            </Link>
          </div>
        </header>
        {!online && (
          <div className="connection-banner">
            <I icon={WifiOff} size={16} />
            Нет подключения. Для изменений нужен интернет.
          </div>
        )}
        {update && (
          <div className="connection-banner">
            Доступна новая версия{" "}
            <button onClick={update}>Обновить приложение</button>
          </div>
        )}
        {state.isError && (
          <div className="connection-banner">
            Данные не обновились.{" "}
            <button onClick={() => state.refetch()}>Повторить</button>
          </div>
        )}
        <Routes>
          <Route
            path="/"
            element={<Feed data={data} refresh={refresh} notify={notify} />}
          />
          <Route
            path="/work"
            element={<Work data={data} refresh={refresh} notify={notify} />}
          />
          <Route
            path="/hidden"
            element={<Hidden data={data} refresh={refresh} notify={notify} />}
          />
          <Route
            path="/settings"
            element={
              <Settings
                data={data}
                refresh={refresh}
                notify={notify}
                logout={async () => {
                  await api("/logout", "POST");
                  queryClient.clear();
                  await auth.refetch();
                }}
              />
            }
          />
          <Route
            path="*"
            element={
              <Empty title="Такой страницы нет">
                <Link to="/">Вернуться в ленту</Link>
              </Empty>
            }
          />
        </Routes>
      </div>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <span>
              <I icon={n.icon} size={22} />
              {n.count > 0 && <b>{n.count}</b>}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <I icon={CheckCircle2} size={20} />
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.();
                setToast(null);
              }}
            >
              {toast.label}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Закрыть сообщение"
          >
            <I icon={X} size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth", "POST", { password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/icon.svg" alt="" />
          <span>Отклик</span>
        </div>
        <h1>Вход</h1>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Входим…" : "Войти"}
          <I icon={ArrowUpRight} size={18} />
        </button>
      </form>
    </div>
  );
}

type Common = { data: AppData; refresh: () => Promise<void>; notify: Notify };
function Feed({ data, refresh, notify }: Common) {
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useSearchParams(),
    [filter, setFilter] = useState("all"),
    [format, setFormat] = useState("all"),
    [reject, setReject] = useState<Offer | null>(null),
    [details, setDetails] = useState<Offer | null>(null),
    [busy, setBusy] = useState(false);
  const day = params.get("day") || moscowDay(),
    digest = data.digests
      .filter((d) => d.day === day)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0],
    all = data.offers
      .filter((o) => o.stage === "new" && o.match !== "no" && o.day === day)
      .sort((a, b) => b.score - a.score);
  const offers = all.filter(
    (o) =>
      (filter === "all" || o.match === filter) &&
      (format === "all" || o.format === format),
  );
  const days = [
    ...new Set([
      moscowDay(),
      ...data.digests.map((d) => d.day),
      ...data.offers.map((o) => o.day),
    ]),
  ]
    .sort()
    .reverse();
  async function accept(offer: Offer) {
    setBusy(true);
    try {
      await api(`/offers/${offer.id}`, "PATCH", { stage: "saved" });
      await refresh();
      notify("Предложение в работе", () => {
        void api(`/offers/${offer.id}`, "PATCH", { stage: "new" })
          .then(refresh)
          .catch((e) => notify(e.message));
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page feed-page">
      <div className="page-heading">
        <div>
          <div className="date-line">{prettyDay(day)}</div>
          <h1>Лента</h1>
        </div>
        <button
          className="secondary collect-button"
          onClick={() => setCollectionOpen(true)}
          aria-label="Ручной сбор каналов"
        >
          <I icon={RefreshCw} size={17} />
          <span>Собрать</span>
        </button>
      </div>
      {data.jobs.some(
        (j) =>
          j.kind === "collect" && ["pending", "running"].includes(j.status),
      ) && (
        <div className="collection-inline running">
          <LoaderCircle size={16} />
          <span>
            {data.jobs.some(
              (j) => j.kind === "collect" && j.status === "running",
            )
              ? "Идёт сбор каналов"
              : "Сбор в очереди"}
          </span>
          <button className="text-link" onClick={() => setCollectionOpen(true)}>
            Состояние
          </button>
        </div>
      )}
      <div className="feed-layout">
        <section className="feed-column" aria-label="Предложения">
          <div
            className={`digest-card ${digest?.status === "failed" ? "digest-error" : ""}`}
          >
            <div>
              <div className="digest-title">
                <h2>
                  {digest?.status === "running"
                    ? "Собираем подборку"
                    : digest?.status === "failed"
                      ? "Сбор не завершён"
                      : digest?.mode === "manual"
                        ? `Ручной сбор · ${digest.lookbackDays} дн.`
                        : "Сводка"}
                </h2>
                <span>
                  {digest?.finishedAt
                    ? `Обновлено в ${time(digest.finishedAt)}`
                    : `Сбор в ${data.settings.collectionTime} МСК`}
                </span>
              </div>
              <p className={expanded ? "digest-expanded" : ""}>
                {digest?.summary ||
                  "Добавь каналы и заполни анкету. Здесь появятся подходящие тебе предложения."}
              </p>
              {(digest?.summary.length || 0) > 140 && (
                <button
                  className="digest-expand"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? "Свернуть" : "Читать целиком"}
                  <ChevronDown size={13} />
                </button>
              )}
              {digest?.errors.length ? (
                <details className="digest-errors">
                  <summary>Что требует внимания</summary>
                  {digest.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </details>
              ) : null}
            </div>
          </div>
          <div className="feed-controls">
            <div className="segment" aria-label="Соответствие">
              {[
                { id: "all", text: "Все", count: all.length },
                {
                  id: "yes",
                  text: "Подходят",
                  count: all.filter((o) => o.match === "yes").length,
                },
                {
                  id: "maybe",
                  text: "Уточнить",
                  count: all.filter((o) => o.match === "maybe").length,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  className={filter === f.id ? "active" : ""}
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                >
                  {f.text}
                  <span>{f.count}</span>
                </button>
              ))}
            </div>
            <label className="select-compact">
              <I icon={SlidersHorizontal} size={16} />
              <select
                aria-label="Формат исследования"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="all">Все форматы</option>
                <option value="online">Онлайн</option>
                <option value="offline">Очно</option>
              </select>
            </label>
          </div>
          <div className="day-divider">
            <span>
              {day === moscowDay() ? "Новые сегодня" : prettyDay(day)}
            </span>
            <span />
            <select
              aria-label="Дата подборки"
              value={day}
              onChange={(e) => setParams({ day: e.target.value })}
            >
              {days.map((d) => (
                <option value={d} key={d}>
                  {d === moscowDay() ? "Сегодня" : prettyDay(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="offer-list">
            {offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                onAccept={() => accept(o)}
                onReject={() => setReject(o)}
                onDetails={() => setDetails(o)}
                disabled={busy}
              />
            ))}
            {!offers.length && (
              <Empty
                icon={all.length ? SlidersHorizontal : CheckCheck}
                title={
                  all.length
                    ? "С такими условиями пока нет опросов"
                    : data.offers.some((o) => o.day === day)
                      ? "На сегодня всё разобрано"
                      : "Пока без новых предложений"
                }
              >
                <p>
                  {all.length
                    ? "Попробуй другой формат или открой все предложения."
                    : "Вернись к следующей подборке или проверь источники."}
                </p>
                <Link className="text-link" to="/settings?tab=sources">
                  Настроить источники
                  <I icon={ChevronRight} size={16} />
                </Link>
              </Empty>
            )}
          </div>
          {offers.length > 0 && (
            <div className="feed-end">
              <CheckCheck size={19} />
              <span>Все новые опросы за этот день</span>
            </div>
          )}
        </section>
      </div>
      {reject && (
        <RejectModal
          offer={reject}
          onClose={() => setReject(null)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {details && <Details offer={details} onClose={() => setDetails(null)} />}
      {collectionOpen && (
        <CollectionModal
          data={data}
          refresh={refresh}
          notify={notify}
          onClose={() => setCollectionOpen(false)}
        />
      )}
    </main>
  );
}

function CollectionModal({
  data,
  refresh,
  notify,
  onClose,
}: Common & { onClose: () => void }) {
  const [days, setDays] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = data.jobs.find(
    (j) => j.kind === "collect" && ["pending", "running"].includes(j.status),
  );
  const latest = data.jobs
    .filter((j) => j.kind === "collect" && j.window?.mode === "manual")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  async function start(resumeJobId?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/collect", "POST", {
        lookbackDays: days,
        ...(resumeJobId ? { resumeJobId } : {}),
      });
      await refresh();
      if (result.demo) {
        notify("Деморежим: сбор каналов не запускается.");
        return;
      }
      notify(resumeJobId ? "Сбор продолжен" : "Сбор поставлен в очередь");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Сбор каналов" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <p className="modal-description">
          Проверить сообщения из включённых источников за выбранный период.
        </p>
        <div className="range-presets">
          {[1, 3, 7, 30].map((n) => (
            <button
              type="button"
              className={days === n ? "selected" : ""}
              aria-pressed={days === n}
              key={n}
              onClick={() => setDays(n)}
            >
              {n === 1 ? "Сутки" : `${n} дн.`}
            </button>
          ))}
        </div>
        <label>
          Количество дней
          <input
            type="number"
            min={1}
            max={30}
            step={1}
            required
            value={days}
            onChange={(e) =>
              setDays(e.target.value === "" ? 0 : Number(e.target.value))
            }
          />
        </label>
        <p className="helper">
          Ночной сбор в {data.settings.collectionTime} МСК всегда проверяет
          только последние 24 часа.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full-width" disabled={busy || !!active}>
          {busy ? "Запуск…" : active ? "Сбор уже запущен" : "Начать сбор"}
        </button>
      </form>
      {(active || latest) && (
        <div className="collection-status">
          <h3>{active ? "Текущий запуск" : "Последний ручной запуск"}</h3>
          <p>
            {(active || latest)?.status === "pending"
              ? "В очереди"
              : (active || latest)?.status === "running"
                ? "Обрабатываются сообщения"
                : latest?.incomplete
                  ? "Сбор не завершён полностью"
                  : "Сбор завершён"}
          </p>
          <p>Период: {(active || latest)?.window?.lookbackDays || 1} дн.</p>
          {latest?.error && !active && <p>{latest.error}</p>}
          {latest?.incomplete && !active && (
            <button
              className="text-link"
              disabled={busy}
              onClick={() => start(latest.id)}
            >
              Продолжить незавершённый сбор
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function OfferCard({
  offer: o,
  onAccept,
  onReject,
  onDetails,
  disabled = false,
  children,
}: {
  offer: Offer;
  onAccept?: () => void;
  onReject?: () => void;
  onDetails: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className="offer-card">
      <div className="offer-top">
        <span className="category-name">{o.category || "Исследование"}</span>
        <span
          className={`format-badge ${o.format === "offline" ? "offline" : ""}`}
        >
          <I icon={o.format === "offline" ? MapPin : Monitor} size={13} />
          {o.format === "online"
            ? "Онлайн"
            : o.format === "offline"
              ? "Очно"
              : "Формат уточняется"}
        </span>
      </div>
      <div className="offer-headline">
        <h2>
          <button onClick={onDetails}>{o.title}</button>
        </h2>
        <div className="reward">
          {money(o.reward, o.currency)}
          <span>вознаграждение</span>
        </div>
      </div>
      <p className="offer-summary">{o.summary}</p>
      <div className="offer-meta">
        <span>
          <I icon={CalendarDays} size={16} />
          {o.dateLabel || "Дата уточняется"}
        </span>
        {o.duration && (
          <span>
            <I icon={Clock3} size={16} />
            {o.duration} мин
          </span>
        )}
        {o.format === "offline" && (
          <span>
            <I icon={MapPin} size={16} />
            {o.city || "Место уточняется"}
          </span>
        )}
      </div>
      <div className={`match-note ${o.match === "maybe" ? "uncertain" : ""}`}>
        <I icon={o.match === "maybe" ? Info : CheckCircle2} size={17} />
        <span>
          {o.match === "maybe"
            ? o.questions[0] || "Нужно уточнить условия участия"
            : o.reasons.slice(0, 2).join(" · ") ||
              "Соответствует указанным требованиям"}
        </span>
      </div>
      <div className="offer-footer">
        <button className="source-link" onClick={onDetails}>
          <I icon={MessageCircle} size={15} />
          <span>
            {o.sources[0]?.name || "Источник"}
            {o.sources.length > 1 ? ` +${o.sources.length - 1}` : ""}
          </span>
        </button>
        {onAccept && (
          <div className="offer-actions">
            <button
              className="hide-button"
              aria-label="Скрыть"
              onClick={onReject}
              disabled={disabled}
            >
              <I icon={X} size={17} />
              <span>Скрыть</span>
            </button>
            <button
              className="primary accept-button"
              onClick={onAccept}
              disabled={disabled}
            >
              <I icon={Plus} size={17} />В работу
            </button>
          </div>
        )}
      </div>
      {children}
    </article>
  );
}

function RejectModal({
  offer,
  onClose,
  refresh,
  notify,
}: {
  offer: Offer;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [reason, setReason] = useState(""),
    [permanent, setPermanent] = useState(false),
    [rule, setRule] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api("/feedback", "POST", {
        offerId: offer.id,
        reason,
        permanent,
        rule,
      });
      await refresh();
      onClose();
      notify("Предложение скрыто", () => {
        void (async () => {
          await api(`/feedback/${result.id}`, "DELETE");
          await api(`/offers/${offer.id}`, "PATCH", { stage: "new" });
          await refresh();
        })().catch((e) => notify(e.message));
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Скрыть опрос" onClose={onClose}>
      <p className="modal-description">
        Причина необязательна. Она будет учитываться при следующем подборе.
      </p>
      <form onSubmit={submit}>
        <div className="reason-chips">
          {[
            "Мало платят",
            "Неинтересная тема",
            "Не могу в это время",
            "Не подхожу по условиям",
            "Не хочу очно",
          ].map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => setReason(r)}
              className={reason === r ? "selected" : ""}
            >
              {r}
            </button>
          ))}
        </div>
        <label>
          Причина
          <textarea
            rows={3}
            maxLength={1500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Или напиши своими словами…"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          <span>Больше не показывать по этому условию</span>
        </label>
        {permanent && (
          <label>
            Постоянное условие исключения
            <input
              required
              minLength={3}
              maxLength={300}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              placeholder="Например: очные опросы дольше двух часов"
            />
            <small>
              Будет применяться как запрет. Разовые причины лучше оставить без
              этого флажка.
            </small>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Оставить в ленте
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Скрываем…" : "Скрыть предложение"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function safeLink(url: string | null) {
  try {
    const parsed = new URL(url || "");
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
function Details({ offer: o, onClose }: { offer: Offer; onClose: () => void }) {
  return (
    <Modal title="Об исследовании" onClose={onClose} wide>
      <div className="details-reward">{money(o.reward, o.currency)}</div>
      <h3 className="details-title">{o.title}</h3>
      <p>{o.summary}</p>
      <div className="details-meta">
        <span>
          <CalendarDays size={17} />
          {o.dateLabel || "Дата уточняется"}
        </span>
        <span>
          <Clock3 size={17} />
          {o.duration ? `${o.duration} минут` : "Длительность уточняется"}
        </span>
      </div>
      <h3>Кого приглашают</h3>
      <ul className="requirements">
        {o.requirements.map((r, i) => (
          <li key={i}>
            <Check size={16} />
            {r}
          </li>
        ))}
      </ul>
      {o.reasons.length > 0 && (
        <>
          <h3>Почему подходит</h3>
          <p>{o.reasons.join(". ")}</p>
        </>
      )}
      {o.questions.length > 0 && (
        <div className="notice warning">
          <Info size={18} />
          <span>{o.questions.join(" ")}</span>
        </div>
      )}
      {safeLink(o.applyUrl) && (
        <a
          className="primary full-width"
          href={safeLink(o.applyUrl)!}
          target="_blank"
          rel="noreferrer"
        >
          Открыть запись
          <I icon={ExternalLink} size={17} />
        </a>
      )}
      <h3>Исходные сообщения</h3>
      {o.sources.map((s, i) => (
        <details className="original-message" key={s.messageId}>
          <summary>
            {s.name}
            {i > 0 ? " · повторная публикация" : ""}
          </summary>
          <p>{s.text}</p>
          {safeLink(s.url) && (
            <a
              className="text-link"
              href={safeLink(s.url)!}
              target="_blank"
              rel="noreferrer"
            >
              Открыть в Telegram
              <ExternalLink size={14} />
            </a>
          )}
        </details>
      ))}
    </Modal>
  );
}

function Work({ data, refresh, notify }: Common) {
  const [filter, setFilter] = useState("active"),
    [editing, setEditing] = useState<Offer | null>(null),
    [details, setDetails] = useState<Offer | null>(null),
    [busy, setBusy] = useState(false);
  const offers = data.offers
    .filter((o) => !["new", "hidden"].includes(o.stage))
    .filter(
      (o) =>
        filter === "all" ||
        (filter === "active"
          ? !["paid", "cancelled"].includes(o.stage)
          : o.stage === filter),
    );
  async function stage(o: Offer, value: Stage) {
    setBusy(true);
    try {
      await api(`/offers/${o.id}`, "PATCH", { stage: value });
      await refresh();
      notify(`Этап: ${stageNames[value]}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>В работе</h1>
        </div>
        <div className="earned">
          <span>Получено</span>
          <strong>
            {money(
              data.offers
                .filter((o) => o.stage === "paid")
                .reduce((sum, o) => sum + (o.actualReward || 0), 0),
            )}
          </strong>
        </div>
      </div>
      <div className="work-layout">
        <div>
          <div className="segment work-segment">
            {[
              { id: "active", text: "Активные" },
              { id: "paid", text: "Оплаченные" },
              { id: "all", text: "Все" },
            ].map((f) => (
              <button
                className={filter === f.id ? "active" : ""}
                key={f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.text}
              </button>
            ))}
          </div>
          <div className="offer-list">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} onDetails={() => setDetails(o)}>
                <div className="work-controls">
                  <label>
                    Этап
                    <select
                      value={o.stage}
                      disabled={busy}
                      onChange={(e) => stage(o, e.target.value as Stage)}
                    >
                      {(
                        [
                          "saved",
                          "applied",
                          "booked",
                          "completed",
                          "paid",
                          "cancelled",
                        ] as Stage[]
                      ).map((s) => (
                        <option value={s} key={s}>
                          {stageNames[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary" onClick={() => setEditing(o)}>
                    Заметка и дата
                  </button>
                </div>
                {o.participationDate && (
                  <p className="work-note">
                    <CalendarDays size={15} />
                    {new Date(o.participationDate).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                    })}{" "}
                    МСК
                  </p>
                )}
                {o.note && <p className="work-note">{o.note}</p>}
              </OfferCard>
            ))}
            {!offers.length && (
              <Empty icon={BriefcaseBusiness} title="Нет активных опросов">
                <p>
                  Добавь интересное предложение из ленты — дальше можно
                  отслеживать этапы и оплату.
                </p>
                <Link to="/" className="primary">
                  Открыть ленту
                </Link>
              </Empty>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <EditWork
          offer={editing}
          refresh={refresh}
          notify={notify}
          onClose={() => setEditing(null)}
        />
      )}
      {details && <Details offer={details} onClose={() => setDetails(null)} />}
    </main>
  );
}
function EditWork({
  offer,
  onClose,
  refresh,
  notify,
}: {
  offer: Offer;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [note, setNote] = useState(offer.note),
    [date, setDate] = useState(
      offer.participationDate
        ? new Date(new Date(offer.participationDate).getTime() + 3 * 3600000)
            .toISOString()
            .slice(0, 16)
        : "",
    ),
    [amount, setAmount] = useState(offer.actualReward?.toString() || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/offers/${offer.id}`, "PATCH", {
        note,
        participationDate: date
          ? new Date(`${date}:00+03:00`).toISOString()
          : null,
        actualReward: amount === "" ? null : Number(amount),
      });
      await refresh();
      onClose();
      notify("Изменения сохранены");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Детали участия" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Дата и время по Москве
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Получено, ₽
          <input
            type="number"
            min="0"
            max="10000000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Фактическая сумма после оплаты"
          />
        </label>
        <label>
          Заметка
          <textarea
            maxLength={5000}
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Контакт организатора, адрес или что подготовить"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary full-width" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}
function Hidden({ data, refresh, notify }: Common) {
  const [busy, setBusy] = useState("");
  async function restore(o: Offer) {
    setBusy(o.id);
    try {
      await api(`/offers/${o.id}`, "PATCH", { stage: "new" });
      await refresh();
      notify(
        "Предложение возвращено в ленту. Причина отказа сохранена в настройках.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <main className="page narrow">
      <div className="page-heading">
        <div>
          <h1>Скрытые предложения</h1>
        </div>
      </div>
      {data.offers
        .filter((o) => o.stage === "hidden")
        .map((o) => (
          <div className="settings-row" key={o.id}>
            <div>
              <strong>{o.title}</strong>
              <p>
                {data.feedback
                  .filter((f) => f.offerId === o.id)
                  .map((f) => f.reason || "Без причины")
                  .join(". ")}
              </p>
            </div>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => restore(o)}
            >
              Вернуть
            </button>
          </div>
        ))}
      {!data.offers.some((o) => o.stage === "hidden") && (
        <Empty icon={Archive} title="Пока ничего не скрыто">
          <p>Здесь будут предложения, которые ты уберёшь из ленты.</p>
        </Empty>
      )}
    </main>
  );
}

function Settings({
  data,
  refresh,
  notify,
  logout,
}: Common & { logout: () => Promise<void> }) {
  const [params, setParams] = useSearchParams(),
    tab = params.get("tab") || "profile";
  const tabs = [
    { id: "profile", text: "Обо мне", icon: UserRound },
    { id: "sources", text: "Источники", icon: Radio },
    { id: "preferences", text: "Предпочтения", icon: SlidersHorizontal },
    { id: "connections", text: "Подключения", icon: ShieldCheck },
    { id: "notifications", text: "Уведомления", icon: Bell },
  ];
  return (
    <main className="page settings-page">
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
        </div>
      </div>
      <div
        className="settings-tabs"
        role="navigation"
        aria-label="Разделы настроек"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setParams({ tab: t.id })}
          >
            <I icon={t.icon} size={17} />
            {t.text}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {tab === "profile" ? (
          <ProfileForm
            key="profile"
            data={data}
            refresh={refresh}
            notify={notify}
          />
        ) : tab === "sources" ? (
          <Sources data={data} refresh={refresh} notify={notify} />
        ) : tab === "preferences" ? (
          <Preferences data={data} refresh={refresh} notify={notify} />
        ) : tab === "connections" ? (
          <Connections data={data} refresh={refresh} notify={notify} />
        ) : tab === "notifications" ? (
          <Notifications data={data} refresh={refresh} notify={notify} />
        ) : (
          <p>Выбери раздел настроек.</p>
        )}
      </div>
      <div className="settings-foot">
        <Link to="/hidden">
          <Archive size={17} />
          Скрытые предложения
        </Link>
        {!data.demo && (
          <button onClick={() => logout().catch((e) => notify(e.message))}>
            <LogOut size={17} />
            Выйти
          </button>
        )}
      </div>
    </main>
  );
}
function ProfileForm({ data, refresh, notify }: Common) {
  const [form, setForm] = useState<Profile>(data.profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: keyof Profile, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/profile", "PUT", form);
      await refresh();
      notify("Анкета сохранена. Учтём её при следующем подборе.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="profile-form">
      <div className="section-intro">
        <div>
          <h2>Анкета</h2>
          <p>Данные для проверки требований к участникам.</p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Имя
          <input
            value={form.name}
            maxLength={80}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Имя"
            autoComplete="given-name"
          />
        </label>
        <label>
          Город
          <input
            value={form.city}
            maxLength={100}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Например, Москва"
            autoComplete="address-level2"
          />
        </label>
        <label>
          Дата рождения
          <input
            type="date"
            value={form.birthDate}
            max={moscowDay()}
            onChange={(e) => set("birthDate", e.target.value)}
          />
        </label>
        <label>
          Пол
          <select
            value={form.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="">Не указан</option>
            <option>Мужской</option>
            <option>Женский</option>
            <option>Другой</option>
          </select>
        </label>
        <label>
          Занятость
          <input
            maxLength={200}
            value={form.employment}
            onChange={(e) => set("employment", e.target.value)}
            placeholder="Работаю, учусь, в поиске…"
          />
        </label>
        <label>
          Профессия
          <input
            maxLength={200}
            value={form.profession}
            onChange={(e) => set("profession", e.target.value)}
            placeholder="Чем занимаешься"
          />
        </label>
      </div>
      <label>
        Семья и дети
        <input
          maxLength={500}
          value={form.family}
          onChange={(e) => set("family", e.target.value)}
          placeholder="Если это важно для подбора"
        />
      </label>
      <label>
        Что ещё стоит знать
        <textarea
          maxLength={3000}
          rows={4}
          value={form.about}
          onChange={(e) => set("about", e.target.value)}
          placeholder="Какими сервисами пользуешься, есть ли автомобиль, питомцы, увлечения…"
        />
      </label>
      <div className="form-section">
        <h3>Условия участия</h3>
        <div className="form-grid three">
          <label>
            Формат
            <select
              value={form.format}
              onChange={(e) => set("format", e.target.value)}
            >
              <option value="any">Любой</option>
              <option value="online">Предпочитаю онлайн</option>
              <option value="offline">Предпочитаю очно</option>
            </select>
          </label>
          <label>
            Желаемая оплата от, ₽
            <input
              type="number"
              min="0"
              max="1000000"
              value={form.minReward || ""}
              onChange={(e) => set("minReward", Number(e.target.value))}
              placeholder="Без предпочтений"
            />
          </label>
          <label>
            Длительность до, мин
            <input
              type="number"
              min="0"
              max="10080"
              value={form.maxDuration || ""}
              onChange={(e) => set("maxDuration", Number(e.target.value))}
              placeholder="Без предпочтений"
            />
          </label>
        </div>
        <p className="helper">
          Это пожелания: интересные предложения за их пределами тоже могут
          появиться.
        </p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-footer">
        <span>Анкета передаётся ИИ для персонального подбора.</span>
        <button className="primary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить анкету"}
          <Check size={17} />
        </button>
      </div>
    </form>
  );
}
function Sources({ data, refresh, notify }: Common) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [handle, setHandle] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState<SourceLike | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/sources", "POST", { handle: handle.replace(/^@/, ""), name });
      setHandle("");
      setName("");
      await refresh();
      notify("Канал добавлен");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      await api(path, method, body);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Источники</h2>
          <p>Чаты и каналы подключённого Telegram-аккаунта.</p>
        </div>
      </div>
      <div className="source-picker-action">
        <button
          className="secondary"
          onClick={() => setPickerOpen(true)}
          disabled={!data.telegram.connected}
        >
          <Plus size={16} />
          Выбрать из Telegram
        </button>
        {!data.telegram.connected && (
          <Link className="text-link" to="/settings?tab=connections">
            Подключить Telegram
          </Link>
        )}
      </div>
      {data.demo && (
        <div className="notice">
          <Info size={18} />
          <span>
            Каналы ниже вымышлены. Добавленные здесь данные деморежима сбросятся
            при перезапуске сервера.
          </span>
        </div>
      )}
      <div className="source-settings-list">
        {data.sources.map((s) => (
          <div className="settings-row" key={s.id}>
            <span className="source-avatar color-0">{s.name[0]}</span>
            <div className="source-info">
              <strong>{s.name}</strong>
              <span>
                {s.handle
                  ? `@${s.handle}`
                  : s.telegramType === "chat"
                    ? "Группа"
                    : s.telegramType === "user"
                      ? "Личный чат"
                      : "Без публичной ссылки"}
              </span>
              <small className={s.error ? "error" : ""}>
                {s.error ||
                  (s.lastSuccess
                    ? `Проверен ${new Date(s.lastSuccess).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
                    : "Будет проверен при следующем сборе")}
              </small>
            </div>
            <button
              className={`toggle ${s.enabled ? "on" : ""}`}
              role="switch"
              aria-checked={s.enabled}
              aria-label={`Сбор из ${s.name}`}
              disabled={busy}
              onClick={() =>
                action(`/sources/${s.id}`, "PATCH", { enabled: !s.enabled })
              }
            >
              <span />
            </button>
            <button
              className="icon-button"
              aria-label={`Удалить ${s.name}`}
              onClick={() => setRemove(s)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <form className="add-source" onSubmit={add}>
        <h3>Добавить канал</h3>
        <div className="form-grid">
          <label>
            Ссылка или имя канала
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              required
              placeholder="t.me/channel или @channel"
            />
          </label>
          <label>
            Название для себя
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Необязательно"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          <Plus size={17} />
          Добавить источник
        </button>
        <p className="helper">
          Канал без публичной ссылки добавляется кнопкой «Выбрать из Telegram».
        </p>
      </form>
      {pickerOpen && (
        <AccountChannelPicker
          data={data}
          refresh={refresh}
          notify={notify}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {remove && (
        <Modal title="Удалить источник?" onClose={() => setRemove(null)}>
          <p>
            Новые сообщения из «{remove.name}» больше не будут собираться.
            Сохранённые предложения останутся.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setRemove(null)}>
              Оставить
            </button>
            <button
              className="primary"
              onClick={async () => {
                await action(`/sources/${remove.id}`, "DELETE");
                setRemove(null);
              }}
              disabled={busy}
            >
              Удалить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
type SourceLike = { id: string; name: string };
function AccountChannelPicker({
  data,
  refresh,
  notify,
  onClose,
}: Common & { onClose: () => void }) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const channels = useQuery({
    queryKey: ["telegram-channels"],
    queryFn: () => api<{ channels: AccountChannel[] }>("/telegram/channels"),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const alreadyAdded = (channel: AccountChannel) =>
    data.sources.some(
      (s) =>
        (s.telegramId === channel.id.replace(/^(chat|user):/, "") &&
          (s.telegramType || "channel") ===
            (channel.kind === "group"
              ? "chat"
              : channel.kind === "user"
                ? "user"
                : "channel")) ||
        (!!channel.username &&
          s.handle.toLowerCase() === channel.username.toLowerCase()),
    );
  const term = search.trim().replace(/^@/, "").toLocaleLowerCase("ru");
  const visible = (channels.data?.channels || []).filter((c) =>
    `${c.name} ${c.username || ""}`.toLocaleLowerCase("ru").includes(term),
  );
  async function add() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/sources/from-telegram", "POST", {
        ids: [...selected],
      });
      await refresh();
      onClose();
      notify(`Добавлено источников: ${result.added}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Чаты и каналы Telegram" onClose={onClose} wide>
      <input
        className="channel-search"
        type="search"
        aria-label="Поиск каналов"
        placeholder="Название или @имя канала"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {channels.isPending ? (
        <p className="helper" role="status">
          Загрузка каналов…
        </p>
      ) : channels.isError ? (
        <div className="channel-load-error">
          <p className="error" role="alert">
            {channels.error.message}
          </p>
          <button className="secondary" onClick={() => channels.refetch()}>
            Повторить загрузку
          </button>
        </div>
      ) : (
        <>
          <div className="channel-list">
            {visible.map((channel) => {
              const added = alreadyAdded(channel);
              return (
                <label
                  className={`channel-option ${added ? "already-added" : ""}`}
                  key={channel.id}
                >
                  <input
                    type="checkbox"
                    checked={added || selected.has(channel.id)}
                    disabled={added || busy}
                    onChange={(e) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (e.target.checked) next.add(channel.id);
                        else next.delete(channel.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>{channel.name}</strong>
                    <small>
                      {channel.username
                        ? `@${channel.username}`
                        : channel.kind === "group" ||
                            channel.kind === "supergroup"
                          ? "Группа"
                          : channel.kind === "user"
                            ? "Личный чат"
                            : "Без публичной ссылки"}
                    </small>
                  </span>
                  {added && <small>Добавлен</small>}
                </label>
              );
            })}
            {!visible.length && (
              <p className="helper">
                {search
                  ? "Ничего не найдено."
                  : "В этом аккаунте нет доступных чатов."}
              </p>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => channels.refetch()}
              disabled={busy || channels.isFetching}
            >
              Обновить список
            </button>
            <button
              className="primary"
              disabled={busy || !selected.size}
              onClick={add}
            >
              {busy
                ? "Добавление…"
                : `Добавить${selected.size ? ` (${selected.size})` : ""}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
function Preferences({ data, refresh, notify }: Common) {
  const [editing, setEditing] = useState<Feedback | null>(null),
    [busy, setBusy] = useState(false);
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/feedback/${id}`, "DELETE");
      await refresh();
      notify("Причина больше не учитывается");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>История отказов</h2>
          <p>Причины отказов и постоянные исключения.</p>
        </div>
      </div>
      <div className="notice">
        <Info size={18} />
        <span>
          Обычная причина — пожелание, а не запрет. Только явно подтверждённые
          постоянные условия исключают предложения.
        </span>
      </div>
      {data.feedback.length === 0 ? (
        <Empty icon={SlidersHorizontal} title="Причин отказов пока нет">
          <p>
            Скрой предложение с причиной — она появится здесь. Анкету можно
            изменить в разделе «Обо мне».
          </p>
        </Empty>
      ) : (
        data.feedback
          .slice()
          .reverse()
          .map((f) => (
            <div className="feedback-row" key={f.id}>
              <div>
                <span className={`feedback-label ${f.permanent ? "hard" : ""}`}>
                  {f.permanent
                    ? "Постоянное исключение"
                    : "Мягкое предпочтение"}
                </span>
                <h3>
                  {f.permanent ? f.rule : f.reason || "Причина не указана"}
                </h3>
                <p>{f.title}</p>
                <small>{prettyDay(f.createdAt.slice(0, 10))}</small>
              </div>
              <div className="feedback-actions">
                <button className="text-link" onClick={() => setEditing(f)}>
                  Изменить
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  onClick={() => remove(f.id)}
                  aria-label="Удалить причину"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
      )}
      {editing && (
        <EditFeedback
          item={editing}
          onClose={() => setEditing(null)}
          refresh={refresh}
          notify={notify}
        />
      )}
    </>
  );
}
function EditFeedback({
  item,
  onClose,
  refresh,
  notify,
}: {
  item: Feedback;
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [reason, setReason] = useState(item.reason),
    [rule, setRule] = useState(item.rule),
    [permanent, setPermanent] = useState(item.permanent),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Изменить предпочтение" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`/feedback/${item.id}`, "PATCH", {
              reason,
              rule,
              permanent,
            });
            await refresh();
            onClose();
            notify("Предпочтение сохранено");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Причина
          <textarea
            rows={3}
            maxLength={1500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          Постоянное исключение
        </label>
        {permanent && (
          <label>
            Условие
            <input
              required
              minLength={3}
              maxLength={300}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary full-width" disabled={busy}>
          Сохранить
        </button>
      </form>
    </Modal>
  );
}

function Connections({ data, refresh, notify }: Common) {
  const [phone, setPhone] = useState(""),
    [value, setValue] = useState(""),
    [flow, setFlow] = useState<{
      id: string;
      status: string;
      error?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [disconnect, setDisconnect] = useState(false);
  useEffect(() => {
    if (!flow || ["connected", "error"].includes(flow.status)) return;
    const timer = setInterval(
      () =>
        void api(`/telegram/flow/${flow.id}`)
          .then((result) => {
            setFlow(result);
            if (result.status === "connected") {
              void refresh();
              notify("Telegram подключён");
            }
          })
          .catch((e) => setError(e.message)),
      1500,
    );
    return () => clearInterval(timer);
  }, [flow?.id, flow?.status]);
  async function begin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/telegram/start", "POST", { phone });
      setFlow(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function credential(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/telegram/flow/${flow!.id}`, "POST", { value });
      setValue("");
      setFlow({ ...flow!, status: "connecting" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function testAI() {
    setBusy(true);
    try {
      await api("/ai/test", "POST");
      notify("ИИ подключён, структурированные ответы работают");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Подключения</h2>
          <p>Состояние Telegram и ИИ.</p>
        </div>
      </div>
      <section className="integration">
        <div className="integration-header">
          <span className="integration-icon telegram">
            <MessageCircle size={24} />
          </span>
          <div>
            <h3>Telegram</h3>
            <p>Чтение выбранных каналов</p>
          </div>
          <span
            className={`status-badge ${data.telegram.connected ? "connected" : ""}`}
          >
            {data.telegram.connected ? "Подключён" : "Не подключён"}
          </span>
        </div>
        {!data.telegram.configured ? (
          <div className="notice">
            <Info size={18} />
            <span>
              Сначала задай TELEGRAM_API_ID и TELEGRAM_API_HASH на сервере.
              После этого здесь появится вход по номеру.
            </span>
          </div>
        ) : data.telegram.connected ? (
          <>
            <p className="helper">
              Сессия активна. Сообщения собираются только из добавленных
              источников.
            </p>
            <button className="secondary" onClick={() => setDisconnect(true)}>
              Отключить аккаунт
            </button>
          </>
        ) : (
          <>
            {!flow || ["error", "connected"].includes(flow.status) ? (
              <form onSubmit={begin}>
                <label>
                  Номер Telegram
                  <input
                    type="tel"
                    autoComplete="tel"
                    placeholder="+79991234567"
                    pattern="\+[1-9][0-9]{7,14}"
                    value={phone}
                    required
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Получить код
                </button>
              </form>
            ) : flow.status === "connecting" ? (
              <p className="connecting">
                <LoaderCircle size={18} />
                Подключаемся к Telegram…
              </p>
            ) : (
              <form onSubmit={credential}>
                <label>
                  {flow.status === "password"
                    ? "Пароль двухэтапной аутентификации"
                    : "Код из Telegram"}
                  <input
                    type={flow.status === "password" ? "password" : "text"}
                    autoComplete={
                      flow.status === "password" ? "off" : "one-time-code"
                    }
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Продолжить
                </button>
              </form>
            )}
            {(error || flow?.error) && (
              <p className="error" role="alert">
                {error || flow?.error}
              </p>
            )}
          </>
        )}
      </section>
      <section className="integration">
        <div className="integration-header">
          <span className="integration-icon ai">
            <Sparkles size={24} />
          </span>
          <div>
            <h3>ИИ через ProxyAPI</h3>
            <p>Разбор объявлений и подбор</p>
          </div>
          <span
            className={`status-badge ${data.ai.configured ? "connected" : ""}`}
          >
            {data.ai.configured ? "Настроен" : "Не настроен"}
          </span>
        </div>
        {data.ai.configured ? (
          <>
            <p className="helper">Модель: {data.ai.model}</p>
            <button className="secondary" onClick={testAI} disabled={busy}>
              Проверить подключение
            </button>
          </>
        ) : (
          <p className="helper">
            Задай PROXYAPI_KEY и AI_MODEL в серверном окружении. Ключ не
            попадает в браузер.
          </p>
        )}
      </section>
      <section className="integration future-integration">
        <div className="integration-header">
          <span className="integration-icon calendar">
            <CalendarDays size={24} />
          </span>
          <div>
            <h3>Яндекс Календарь</h3>
            <p>Проверка занятости по iCal</p>
          </div>
          <span className="status-badge">Следующий этап</span>
        </div>
        <p className="helper">
          Будем предупреждать, если опрос пересекается с событием. Предложения с
          конфликтом останутся в ленте.
        </p>
      </section>
      {disconnect && (
        <Modal title="Отключить Telegram?" onClose={() => setDisconnect(false)}>
          <p>
            Ночной сбор остановится до повторного подключения. Сохранённые
            предложения останутся.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDisconnect(false)}>
              Оставить
            </button>
            <button
              className="primary"
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/telegram", "DELETE");
                  await refresh();
                  setDisconnect(false);
                  notify("Telegram отключён");
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Отключить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Notifications({ data, refresh, notify }: Common) {
  const [settings, setSettings] = useState(data.settings),
    [busy, setBusy] = useState(false),
    [subscribed, setSubscribed] = useState(false),
    [install, setInstall] = useState<any>(null),
    [error, setError] = useState("");
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  useEffect(() => {
    if (supported)
      void navigator.serviceWorker.ready
        .then((r) => r.pushManager.getSubscription())
        .then((s) => setSubscribed(!!s));
    const listener = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", listener);
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  async function push() {
    setBusy(true);
    setError("");
    try {
      if (!supported)
        throw new Error(
          "Установи приложение на главный экран или открой браузер с поддержкой уведомлений",
        );
      if (!data.push.configured)
        throw new Error("На сервере не настроены VAPID-ключи");
      const registration = await navigator.serviceWorker.ready;
      if (subscribed) {
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await api("/push", "DELETE", { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setSubscribed(false);
        notify("Уведомления выключены");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error(
            "Уведомления не разрешены. Измени разрешение в настройках браузера.",
          );
        const raw = atob(
          data.push.publicKey.replace(/-/g, "+").replace(/_/g, "/"),
        );
        const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await api("/push", "POST", sub.toJSON());
        setSubscribed(true);
        notify("Ежедневные уведомления включены");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-intro">
        <div>
          <h2>Расписание</h2>
          <p>Время сбора и уведомления по Москве.</p>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/settings", "PUT", settings);
            await refresh();
            notify("Расписание сохранено");
          } catch (e) {
            notify((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Начало сбора, МСК
            <input
              type="time"
              required
              value={settings.collectionTime}
              onChange={(e) =>
                setSettings((s) => ({ ...s, collectionTime: e.target.value }))
              }
            />
          </label>
          <label>
            Ежедневная сводка, МСК
            <input
              type="time"
              required
              value={settings.notificationTime}
              onChange={(e) =>
                setSettings((s) => ({ ...s, notificationTime: e.target.value }))
              }
            />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          Сохранить расписание
        </button>
      </form>
      <section className="notification-section">
        <div>
          <h3>Ежедневное push-уведомление</h3>
          <p>Откроет подборку нужного дня.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={push}>
          <Bell size={17} />
          {subscribed ? "Выключить" : "Включить"}
        </button>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data.push.configured && (
        <p className="helper">
          Для доставки нужны VAPID-ключи и HTTPS. В локальном деморежиме
          отправка не настроена.
        </p>
      )}
      <section className="install-panel">
        <span className="install-icon">
          <Download size={26} />
        </span>
        <div>
          <h3>Отклик на главном экране</h3>
          <p></p>
          {install ? (
            <button
              className="primary"
              onClick={async () => {
                await install.prompt();
                const result = await install.userChoice;
                if (result.outcome === "accepted") setInstall(null);
              }}
            >
              Установить приложение
            </button>
          ) : (
            <>
              <p>
                <b>iPhone:</b> в Safari нажми «Поделиться» → «На экран Домой».
                Затем открой приложение и включи уведомления.
              </p>
              <p>
                <b>Android:</b> в меню браузера выбери «Установить приложение»
                или «Добавить на главный экран».
              </p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
