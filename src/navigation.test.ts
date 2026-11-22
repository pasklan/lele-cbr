import { describe, expect, it } from 'vitest';
import { clampPage } from './navigation';
describe('limites de navegação', () => {
 it('mantém páginas dentro dos limites inclusive em uma biblioteca vazia', () => {
 expect(clampPage(-1, 5)).toBe(0);
 expect(clampPage(5, 5)).toBe(4);
 expect(clampPage(3, 5)).toBe(3);
 expect(clampPage(1, 0)).toBe(0);
 });
});
