import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
const css = readFileSync('src/styles.css', 'utf8');
const applyStyles = () => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return style;
};
afterEach(cleanup);
it('mantém texto legível e alvos de navegação com 44px', () => {
  const style = applyStyles();
  render(<><div className="page-control"><input aria-label="Página" /></div><div className="navigation-controls"><button>→</button></div><div className="segmented"><button>Largura</button></div><span className="book-title">Livro</span></>);
  expect(getComputedStyle(document.documentElement).fontSize).toBe('16px');
  expect(getComputedStyle(screen.getByLabelText('Página')).fontSize).toBe('16px');
  expect(getComputedStyle(screen.getByText('Livro')).fontSize).toBe('15px');
  expect(getComputedStyle(screen.getByText('Largura')).fontSize).toBe('16px');
  const arrow = getComputedStyle(screen.getByText('→'));
  expect(arrow.fontSize).toBe('30px');
  expect(arrow.minWidth).toBe('44px');
  expect(arrow.minHeight).toBe('44px');
  style.remove();
});
