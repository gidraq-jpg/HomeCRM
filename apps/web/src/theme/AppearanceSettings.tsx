import { useId, useState } from 'react';
import { Section } from '../ui/Page.tsx';
import { readTheme, setTheme, THEME_HINTS, THEME_LABELS, THEMES, type ThemeId } from './theme.ts';

/** «Оформление»: тема хранится на устройстве и применяется сразу (UI-11). */
export function AppearanceSettings() {
  const name = useId();
  const [theme, setCurrent] = useState<ThemeId>(() => readTheme());
  return (
    <Section title="Оформление">
      <fieldset className="choice-group">
        <legend className="choice-group__legend">Цветовая тема на этом устройстве</legend>
        {THEMES.map((id) => (
          <label className="choice" key={id}>
            <input
              type="radio"
              name={name}
              value={id}
              checked={theme === id}
              onChange={() => {
                setTheme(id);
                setCurrent(id);
              }}
            />
            <span className="choice__body">
              <span className="choice__title">{THEME_LABELS[id]}</span>
              <span className="choice__hint">{THEME_HINTS[id]}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Section>
  );
}
