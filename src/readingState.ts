export type Fit = 'page' | 'width';
export type Position = { page: number; fit: Fit; zoom: number };
export type ReadingState = { version: 1; preferences: { fit: Fit; zoom: number; collapsed: boolean }; books: Record<string, Position> };
export const MAX_BOOKS = 100;
export const boundBooks = (books: Record<string, Position>): Record<string, Position> => Object.fromEntries(Object.entries(books).filter(([id]) => id.length <= 4096).slice(-MAX_BOOKS));
export const STORAGE_KEY = 'lele.reading.v1';
export const STORAGE_NOTICE = 'Não foi possível recuperar ou salvar suas preferências de leitura. Você pode continuar lendo; o progresso pode não ser salvo.';
export const defaults = (): ReadingState => ({ version: 1, preferences: { fit: 'page', zoom: 100, collapsed: false }, books: Object.create(null) });
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const view = (value: unknown): boolean => object(value) && (value.fit === 'page' || value.fit === 'width') && typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom >= 25 && value.zoom <= 300;
export function loadReadingState(): { state: ReadingState; notice: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { state: defaults(), notice: '' };
    if (raw.length > 1_000_000) throw new Error('Reading state too large');
    const data: unknown = JSON.parse(raw);
    if (!object(data) || data.version !== 1 || !object(data.preferences) || !view(data.preferences) || typeof data.preferences.collapsed !== 'boolean' || !object(data.books)) throw new Error('Invalid reading state');
    for (const [id, position] of Object.entries(data.books)) {
      if (!id || !object(position) || !view(position) || !Number.isSafeInteger(position.page) || (position.page as number) < 0) throw new Error('Invalid reading position');
    }
    const state = data as ReadingState;
    return { state: { ...state, books: boundBooks(state.books) }, notice: '' };
  } catch { return { state: defaults(), notice: STORAGE_NOTICE }; }
}
export function saveReadingState(state: ReadingState): string {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, books: boundBooks(state.books) })); return ''; }
  catch { return STORAGE_NOTICE; }
}
