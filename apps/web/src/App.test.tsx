import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('рисует заглушку с аудиториями из общего пакета', () => {
    const html = renderToString(<App />);
    expect(html).toContain('HomeCRM');
    expect(html).toContain('Вся семья, Взрослые');
  });
});
