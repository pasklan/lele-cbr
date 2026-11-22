import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const api = vi.mocked(invoke);
const comic = { id: 'one', title: 'Quadrinho real', pages: [{ index: 0, name: '01.png' }, { index: 1, name: '02.png' }, { index: 2, name: '03.png' }] };
beforeEach(() => {
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
