import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { clampPage } from './navigation';
import { boundBooks, loadReadingState, saveReadingState, type Fit } from './readingState';
import './styles.css';

type ComicSummary = { id: string; title: string };
type ComicInfo = ComicSummary & { pages: { index: number; name: string }[] };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  const [initial] = useState(loadReadingState);
  const saved = useRef(initial.state);
  const activeDocument = useRef<ComicInfo | null>(null);
  const [notice, setNotice] = useState(initial.notice);
  const [collapsed, setCollapsed] = useState(initial.state.preferences.collapsed);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenBusy = useRef(false);
  const fullscreenValue = useRef(false);
  const [library, setLibrary] = useState<ComicSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [comic, setComic] = useState<ComicInfo | null>(null);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [image, setImage] = useState<{ url: string; comic: ComicInfo; page: number } | null>(null);
  const [fit, setFit] = useState<Fit>(initial.state.preferences.fit);
  const [zoom, setZoom] = useState(initial.state.preferences.zoom);
  const generation = useRef(0);
  // All document mutations and reads share a queue: the Rust side owns one active document.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(operation, operation);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenBusy.current) return;
    fullscreenBusy.current = true;
    const enabled = !fullscreenValue.current;
    try {
      await invoke('set_fullscreen', { enabled });
      fullscreenValue.current = enabled;
      setFullscreen(enabled);
    } catch (e) { setNotice(`Não foi possível alterar a tela cheia: ${message(e)}`); }
    finally { fullscreenBusy.current = false; }
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.repeat && (event.key === 'F11' || (event.key === 'Escape' && fullscreenValue.current))) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [toggleFullscreen]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError('');
    try { setLibrary(await invoke<ComicSummary[]>('list_library')); }
    catch (e) { setLibraryError(message(e)); }
    finally { setLibraryLoading(false); }
  }, []);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const open = useCallback(async (id?: string) => {
    const token = ++generation.current;
    activeDocument.current = null;
    setBusy(true); setComic(null); setPage(0); setError('');
    try {
      const result = await enqueue(() => id === undefined
        ? invoke<ComicInfo | null>('pick_comic')
        : invoke<ComicInfo>('open_comic', { id }));
      if (token !== generation.current) return;
      activeDocument.current = result;
      const position = result && Object.hasOwn(saved.current.books, result.id) ? saved.current.books[result.id] : null;
      setPage(position && result ? clampPage(position.page, result.pages.length) : 0);
      setFit(position?.fit ?? saved.current.preferences.fit);
      setZoom(position?.zoom ?? saved.current.preferences.zoom);
      setComic(result);
      setLibraryId(result ? id ?? null : null);
    } catch (e) { if (token === generation.current) setError(message(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }, [enqueue]);

  useEffect(() => {
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const register = (subscription: Promise<UnlistenFn>) => {
      void subscription.then(stop => {
        if (disposed) stop(); else stops.push(stop);
      }).catch(e => { if (!disposed) setNotice(`Arrastar arquivos indisponível: ${message(e)}`); });
    };
    register(listen<{ id: string }>('comic-dropped', event => {
      if (!disposed && typeof event.payload?.id === 'string' && event.payload.id) void open(event.payload.id);
    }));
    register(listen<string>('comic-drop-error', event => {
      if (!disposed && typeof event.payload === 'string') setNotice(event.payload);
    }));
    return () => { disposed = true; stops.forEach(stop => stop()); };
  }, [open]);

  const close = async () => {
    const token = ++generation.current;
    activeDocument.current = null;
    setComic(null); setPage(0); setBusy(true); setError('');
    try { await enqueue(() => invoke('close_comic')); }
    catch (e) { if (token === generation.current) setError(message(e)); }
    finally { if (token === generation.current) setBusy(false); }
  };

  useEffect(() => {
    if (!comic || !comic.pages.length) { setLoading(false); return; }
    let canceled = false;
    let url: string | undefined;
    const token = generation.current;
    setLoading(true); setError('');
    void enqueue(async () => {
      if (canceled || token !== generation.current) return;
      const bytes = await invoke<ArrayBuffer>('read_page', { index: comic.pages[page].index, documentId: comic.id });
      if (canceled || token !== generation.current) return;
      url = URL.createObjectURL(new Blob([bytes]));
      setImage({ url, comic, page });
    }).catch(e => {
      if (!canceled && token === generation.current) setError(message(e));
    }).finally(() => {
      if (!canceled && token === generation.current) setLoading(false);
    });
    return () => { canceled = true; if (url) URL.revokeObjectURL(url); };
  }, [comic, page, retry, enqueue]);

  useEffect(() => {
    const next = { ...saved.current, preferences: { fit, zoom, collapsed } };
    if (comic && comic === activeDocument.current && comic.pages.length) {
      // Move the active canonical id to the end before evicting old books.
      const others = Object.fromEntries(Object.entries(next.books).filter(([id]) => id !== comic.id));
      next.books = boundBooks({ ...others, [comic.id]: { page, fit, zoom } });
    }
    saved.current = next;
    const warning = saveReadingState(next);
    if (warning) setNotice(warning);
  }, [comic, page, fit, zoom, collapsed]);

  const count = comic?.pages.length ?? 0;
  const navigate = useCallback((target: number) => setPage(clampPage(target, count)), [count]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!comic || busy || event.altKey || event.ctrlKey || event.metaKey ||
        (target instanceof Element && target.closest('input, select, textarea, button, [contenteditable]:not([contenteditable="false"])'))) return;
      const targets: Record<string, number> = { ArrowLeft: page - 1, ArrowRight: page + 1, Home: 0, End: count - 1 };
      if (event.key in targets) { event.preventDefault(); navigate(targets[event.key]); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [comic, busy, page, count, navigate]);

  const visibleImage = image?.comic === comic && image.page === page && !loading && !error ? image : null;
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside id="library-sidebar" className="sidebar" hidden={collapsed}>
      <a className="brand" href="#" aria-label="Lelê, início"><span className="brand-mark">lê</span><span>lelê<span className="brand-dot">.</span><small>SEU TEMPO DE LER</small></span></a>
      <button className="open-button" disabled={busy} onClick={() => void open()}><span aria-hidden="true">＋</span> Abrir quadrinho <span className="file-tag">ARQUIVO</span></button>
      <div className="section-heading"><h2>Biblioteca</h2><button className="icon-button" aria-label="Atualizar biblioteca" disabled={libraryLoading} onClick={() => void refreshLibrary()}>↻</button></div>
      <p className="library-caption">Seus quadrinhos, um por vez.</p>
      <nav className="library" aria-label="Quadrinhos disponíveis">
        {libraryLoading && <p className="muted" role="status">Carregando biblioteca…</p>}
        {libraryError && <div className="library-error" role="alert">{libraryError}<button onClick={() => void refreshLibrary()}>Tentar novamente</button></div>}
        {!libraryLoading && !libraryError && !library.length && <p className="muted">Nenhum quadrinho na biblioteca. Abra um arquivo para começar.</p>}
        {library.map((item, index) => <button key={item.id} className={`library-item ${!!comic && libraryId === item.id ? 'active' : ''}`} disabled={busy} aria-label={`Ler ${item.title}`} aria-current={!!comic && libraryId === item.id ? 'true' : undefined} onClick={() => void open(item.id)}>
          <span className="book-spine" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="book-title">{item.title}<small>{!!comic && libraryId === item.id ? 'LENDO AGORA' : 'QUADRINHO LOCAL'}</small></span><span className="book-arrow" aria-hidden="true">↗</span>
        </button>)}
      </nav>
      <div className="sidebar-bottom"><span className="local-dot"/> Local. Simples. Seu.<small>Uma página de cada vez.</small></div>
    </aside>
    <main className="reader">
      <header className="reader-header"><div className="header-actions"><button aria-label={collapsed ? 'Mostrar biblioteca' : 'Ocultar biblioteca'} aria-expanded={!collapsed} aria-controls="library-sidebar" onClick={() => setCollapsed(value => !value)}>☰</button><button aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-pressed={fullscreen} title="Tela cheia (F11)" onClick={() => void toggleFullscreen()}>⛶</button></div><div className="reader-title"><p className="eyebrow">ESPAÇO DE LEITURA</p><h1>{comic?.title ?? 'A próxima história espera.'}</h1></div>{comic && <button className="text-button" disabled={busy} onClick={() => void close()}>Fechar <span aria-hidden="true">×</span></button>}</header>
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="toolbar" aria-label="Controles de leitura">
        <div className="navigation-controls"><button aria-label="Primeira página" title="Primeira página (Home)" disabled={!count || page === 0 || busy} onClick={() => navigate(0)}>⇤</button><button aria-label="Página anterior" title="Anterior (←)" disabled={!count || page === 0 || busy} onClick={() => navigate(page - 1)}>←</button><label className="page-control"><span>Página</span><input aria-label="Página atual" type="number" min="1" max={Math.max(1, count)} disabled={!count || busy} value={count ? page + 1 : 0} onChange={event => { if (event.target.value !== '') navigate(Number(event.target.value) - 1); }}/><span>de {count}</span></label><button aria-label="Próxima página" title="Próxima (→)" disabled={!count || page === count - 1 || busy} onClick={() => navigate(page + 1)}>→</button><button aria-label="Última página" title="Última página (End)" disabled={!count || page === count - 1 || busy} onClick={() => navigate(count - 1)}>⇥</button></div>
        <div className="view-controls"><div className="segmented"><button aria-pressed={fit === 'page'} onClick={() => { setFit('page'); setZoom(100); }}>Página inteira</button><button aria-pressed={fit === 'width'} onClick={() => { setFit('width'); setZoom(100); }}>Largura</button></div><span className="divider"/><button aria-label="Diminuir zoom" disabled={zoom <= 25} onClick={() => setZoom(z => Math.max(25, z - 25))}>−</button><button className="zoom-value" aria-label="Redefinir zoom" onClick={() => setZoom(100)}>{zoom}%</button><button aria-label="Aumentar zoom" disabled={zoom >= 300} onClick={() => setZoom(z => Math.min(300, z + 25))}>＋</button></div>
      </section>
      <div className={`canvas fit-${fit}`} aria-busy={loading || busy}>
        {error ? <div className="empty-state error-state" role="alert"><span className="empty-symbol">!</span><h2>Não foi possível continuar</h2><p>{error}</p><button className="primary-button" onClick={() => comic ? setRetry(r => r + 1) : void open()}>Tentar novamente</button></div>
          : busy || loading ? <div className="loading-state" role="status"><span className="spinner"/>{busy ? 'Abrindo sua história…' : 'Carregando página…'}</div>
          : comic && !count ? <div className="empty-state"><h2>Nenhuma página encontrada</h2><p>Este arquivo não contém imagens compatíveis.</p></div>
          : !comic ? <div className="empty-state"><div className="empty-art" aria-hidden="true"><span/><span/><span>lê.</span></div><p className="eyebrow">DESACELERE. VIRE A PÁGINA.</p><h2>Boas histórias merecem<br/>um lugar tranquilo.</h2><p>Escolha um quadrinho na biblioteca<br/>ou abra um arquivo do seu computador.</p><button className="primary-button" disabled={busy} onClick={() => void open()}>Abrir meu quadrinho <span aria-hidden="true">↗</span></button><small>CBR · arquivos RAR</small></div>
          : visibleImage && <img className="comic-page" style={fit === 'page' ? { height: `${zoom}%` } : { width: `${zoom}%` }} src={visibleImage.url} alt={`Página ${page + 1}: ${comic.pages[page].name}`} onError={() => setError('Não foi possível exibir a imagem desta página.')} />}
      </div>
      <footer className="reader-footer"><span><span className="status-dot"/>{comic ? `${count} páginas · arquivo local` : 'Pronto para uma boa história'}</span><span className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> navegar <span>·</span> <kbd>Home</kbd><kbd>End</kbd> início / fim</span></footer>
      <div className="progress-track" role="progressbar" aria-label="Progresso da leitura" aria-valuemin={0} aria-valuemax={Math.max(1, count)} aria-valuenow={count ? page + 1 : 0}><span style={{ width: `${count ? ((page + 1) / count) * 100 : 0}%` }}/></div>
    </main>
  </div>;
}
