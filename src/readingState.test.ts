import { beforeEach, expect, it } from 'vitest';
import { defaults, loadReadingState, saveReadingState, STORAGE_KEY } from './readingState';
beforeEach(() => localStorage.clear());
it('limita o histórico aos 100 documentos mais recentes', () => {
  const state = defaults();
  for (let i = 0; i < 110; i++) state.books[`book-${i}`] = { page: i, fit: 'page', zoom: 100 };
  expect(saveReadingState(state)).toBe('');
  const loaded = loadReadingState().state;
  expect(Object.keys(loaded.books)).toHaveLength(100);
  expect(Object.hasOwn(loaded.books, 'book-0')).toBe(false);
  expect(loaded.books['book-109'].page).toBe(109);
});
it.each([
  { version: 2 },
  { ...defaults(), preferences: { fit: 'other', zoom: 100, collapsed: false } },
  { ...defaults(), books: { book: { page: -1, fit: 'page', zoom: 100 } } },
  { ...defaults(), books: { book: { page: 0, fit: 'page', zoom: 999 } } },
  { ...defaults(), books: [] },
])('rejeita esquema inválido com aviso e valores seguros: %j', value => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  const loaded = loadReadingState();
  expect(loaded.notice).not.toBe('');
  expect(loaded.state).toEqual(defaults());
});
