import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import App from './App';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
const api = vi.mocked(invoke);
const comic = { id: 'one', title: 'Quadrinho real', pages: [{ index: 0, name: '01.png' }, { index: 1, name: '02.png' }, { index: 2, name: '03.png' }] };
beforeEach(() => {
 localStorage.clear();
 vi.mocked(listen).mockReset().mockImplementation(async () => vi.fn<() => void>());
 api.mockImplementation(async (command) => {
  if (command === 'list_library') return [{ id: comic.id, title: comic.title }];
  if (command === 'open_comic') return comic;
  if (command === 'read_page') return new ArrayBuffer(8);
  return null;
 });
 vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('leitor conectado ao backend', () => {
 it('restaura posição e preferências pelo id canônico sem sobrescrever na abertura', async () => {
  api.mockImplementation(async command => {
   if (command === 'list_library') return [{ id: 'alias', title: comic.title }];
   if (command === 'open_comic') return { ...comic, id: 'C:\\Comics\\real.cbr' };
   if (command === 'read_page') return new ArrayBuffer(8);
   return null;
  });
  const first = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
  fireEvent.keyDown(window, { key: 'End' });
  fireEvent.click(screen.getByRole('button', { name: 'Largura' }));
  fireEvent.click(screen.getByLabelText('Aumentar zoom'));
  await screen.findByAltText('Página 3: 03.png');
  first.unmount();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 3: 03.png');
  expect(screen.getByRole('button', { name: 'Largura' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Redefinir zoom').textContent).toBe('125%');
 });
 it('alterna tela cheia por F11 e botão usando IPC, sem ocultar biblioteca automaticamente', async () => {
  render(<App />);
  const libraryToggle = screen.getByRole('button', { name: 'Ocultar biblioteca' });
  fireEvent.keyDown(window, { key: 'F11' });
  await waitFor(() => expect(api).toHaveBeenCalledWith('set_fullscreen', { enabled: true }));
  await screen.findByRole('button', { name: 'Sair da tela cheia' });
  expect(libraryToggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Sair da tela cheia' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('set_fullscreen', { enabled: false }));
  fireEvent.click(libraryToggle);
  expect(screen.getByRole('button', { name: 'Mostrar biblioteca' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('navigation', { name: 'Quadrinhos disponíveis' })).toBeNull();
 });
 it('sai da tela cheia com Escape e ignora Escape fora dela', async () => {
  render(<App />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(api).not.toHaveBeenCalledWith('set_fullscreen', expect.anything());
  fireEvent.keyDown(window, { key: 'F11' });
  await screen.findByRole('button', { name: 'Sair da tela cheia' });
  fireEvent.keyDown(window, { key: 'Escape' });
  await screen.findByRole('button', { name: 'Tela cheia' });
  expect(api).toHaveBeenCalledWith('set_fullscreen', { enabled: false });
 });
 it('avisa sobre armazenamento corrompido sem impedir leitura', async () => {
  localStorage.setItem('lele.reading.v1', '{broken');
  render(<App />);
  expect(screen.getByText(/Não foi possível recuperar ou salvar/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
 });
 it('avisa quando localStorage está indisponível e continua lendo', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Access denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  render(<App />);
  expect(screen.getByText(/Não foi possível recuperar ou salvar/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
 });
 it('abre drops nativos na fila, mostra erro não fatal e remove listeners', async () => {
  const stopDrop = vi.fn();
  const stopError = vi.fn();
  vi.mocked(listen).mockImplementation(async event => event === 'comic-dropped' ? stopDrop : stopError);
  const app = render(<App />);
  await waitFor(() => expect(listen).toHaveBeenCalledWith('comic-dropped', expect.any(Function)));
  const dropped = vi.mocked(listen).mock.calls.find(([name]) => name === 'comic-dropped')![1] as EventCallback<{ id: string }>;
  const dropError = vi.mocked(listen).mock.calls.find(([name]) => name === 'comic-drop-error')![1] as EventCallback<string>;
  act(() => dropped({ event: 'comic-dropped', id: 1, payload: { id: 'trusted-native-id' } }));
  await screen.findByAltText('Página 1: 01.png');
  expect(api).toHaveBeenCalledWith('open_comic', { id: 'trusted-native-id' });
  act(() => dropError({ event: 'comic-drop-error', id: 2, payload: 'Escolha somente um arquivo CBR.' }));
  expect(screen.getByText('Escolha somente um arquivo CBR.')).toBeTruthy();
  expect(screen.getByAltText('Página 1: 01.png')).toBeTruthy();
  app.unmount();
  expect(stopDrop).toHaveBeenCalledTimes(1);
  expect(stopError).toHaveBeenCalledTimes(1);
 });
 it('remove listeners cuja inscrição termina após desmontar', async () => {
  const finish: ((stop: () => void) => void)[] = [];
  vi.mocked(listen).mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  const app = render(<App />);
  app.unmount();
  const stop = vi.fn();
  await act(async () => finish.forEach(resolve => resolve(stop)));
  expect(stop).toHaveBeenCalledTimes(2);
 });
 it('não grava página no documento de uma abertura obsoleta e serializa drops', async () => {
  const key = 'lele.reading.v1';
  localStorage.setItem(key, JSON.stringify({ version: 1, preferences: { fit: 'page', zoom: 100, collapsed: false }, books: {
   first: { page: 2, fit: 'page', zoom: 100 }, second: { page: 1, fit: 'width', zoom: 150 },
  } }));
  let finishFirst!: (value: typeof comic) => void;
  api.mockImplementation(async (command, args) => {
   if (command === 'list_library') return [];
   if (command === 'open_comic') {
    const id = (args as { id: string }).id;
    if (id === 'first') return new Promise(resolve => { finishFirst = resolve; });
    return { ...comic, id };
   }
   if (command === 'read_page') return new ArrayBuffer(8);
   return null;
  });
  render(<App />);
  const dropped = vi.mocked(listen).mock.calls.find(([name]) => name === 'comic-dropped')![1] as EventCallback<{ id: string }>;
  act(() => dropped({ event: 'comic-dropped', id: 1, payload: { id: 'first' } }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('open_comic', { id: 'first' }));
  act(() => dropped({ event: 'comic-dropped', id: 2, payload: { id: 'second' } }));
  expect(api).not.toHaveBeenCalledWith('open_comic', { id: 'second' });
  await act(async () => finishFirst({ ...comic, id: 'first' }));
  await screen.findByAltText('Página 2: 02.png');
  expect(api).toHaveBeenCalledWith('read_page', { index: 1, documentId: 'second' });
  expect(api).not.toHaveBeenCalledWith('read_page', { index: 2, documentId: 'first' });
  expect(JSON.parse(localStorage.getItem(key)!).books).toEqual({ first: { page: 2, fit: 'page', zoom: 100 }, second: { page: 1, fit: 'width', zoom: 150 } });
 });
 it('anuncia apenas o formato realmente implementado', async () => {
  render(<App />);
  await screen.findByRole('button', { name: /Ler Quadrinho real/ });
  expect(screen.queryByText(/CBZ|PDF/)).toBeNull();
  expect(screen.getByText('CBR · arquivos RAR')).toBeTruthy();
 });
 it('abre pelo id e limita setas, Home e End; ignora campos de edição', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
  expect(api).toHaveBeenCalledWith('open_comic', { id: 'one' });
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(screen.getByLabelText('Página atual').getAttribute('value')).toBe('1');
  fireEvent.keyDown(window, { key: 'End' });
  await screen.findByAltText('Página 3: 03.png');
  fireEvent.keyDown(screen.getByLabelText('Página atual'), { key: 'Home' });
  expect((screen.getByLabelText('Página atual') as HTMLInputElement).value).toBe('3');
  fireEvent.keyDown(window, { key: 'Home' });
  await screen.findByAltText('Página 1: 01.png');
 });
 it('preserva seleção da biblioteca quando o backend retorna um id canônico', async () => {
  api.mockImplementation(async command => {
   if (command === 'list_library') return [{ id: 'sample.cbz', title: comic.title }];
   if (command === 'open_comic') return { ...comic, id: 'C:\\Comics\\sample.cbz' };
   if (command === 'read_page') return new ArrayBuffer(8);
   return null;
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
  expect(api).toHaveBeenCalledWith('read_page', { index: 0, documentId: 'C:\\Comics\\sample.cbz' });
  expect(screen.getByRole('button', { name: /Ler Quadrinho real/ }).getAttribute('aria-current')).toBe('true');
 });
 it('descarta bytes de páginas antigas e revoga URLs ao trocar e fechar', async () => {
  let finishRead!: (bytes: ArrayBuffer) => void;
  let reads = 0;
  api.mockImplementation(async command => {
   if (command === 'list_library') return [{ id: comic.id, title: comic.title }];
   if (command === 'open_comic') return comic;
   if (command === 'read_page') {
    reads++;
    if (reads === 2) return new Promise<ArrayBuffer>(resolve => { finishRead = resolve; });
    return new ArrayBuffer(8);
   }
   return null;
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(reads).toBe(2));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: 'End' });
  await act(async () => { finishRead(new ArrayBuffer(8)); });
  await screen.findByAltText('Página 3: 03.png');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  expect(screen.queryByAltText('Página 2: 02.png')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Fechar/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('close_comic'));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
 });
 it('limpa a imagem antes de abrir outro arquivo e usa o seletor nativo', async () => {
  let finishPick!: (value: typeof comic | null) => void;
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Ler Quadrinho real/ }));
  await screen.findByAltText('Página 1: 01.png');
  api.mockImplementation(async command => {
   if (command === 'pick_comic') return new Promise<typeof comic | null>(resolve => { finishPick = resolve; });
   return new ArrayBuffer(8);
  });
  fireEvent.click(screen.getByRole('button', { name: /Abrir quadrinho/ }));
  expect(screen.queryByRole('img')).toBeNull();
  await waitFor(() => expect(api).toHaveBeenCalledWith('pick_comic'));
  await act(async () => { finishPick({ ...comic, id: 'external' }); });
  await screen.findByAltText('Página 1: 01.png');
  expect(api).toHaveBeenCalledWith('read_page', { index: 0, documentId: 'external' });
 });
 it('exibe erro real de biblioteca sem criar quadrinhos fictícios', async () => {
  api.mockRejectedValue(new Error('Backend indisponível'));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Backend indisponível'));
 });
});
