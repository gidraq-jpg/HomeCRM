import { type ComponentType, lazy, useState } from 'react';

/**
 * Раздел приложения, который грузится отдельной частью сборки (D53c). Пока часть не загружена,
 * экран показывает запасной вид `Suspense`; после загрузки — в том числе предзагрузки
 * `preloadSections` — новые экраны рисуются сразу, без лишнего круга `Suspense`. Это важно для
 * переходов: снимок нового экрана снимается синхронно внутри `flushSync`.
 */
export function lazySection<M extends Record<string, unknown>>(load: () => Promise<M>) {
  let module: M | undefined;
  let pending: Promise<M> | undefined;
  const preload = () => {
    pending ??= load().then(
      (loaded) => {
        module = loaded;
        return loaded;
      },
      (error: unknown) => {
        // Сбой сети не запоминается: следующий переход попробует снова.
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return {
    preload,
    screen<K extends keyof M & string>(name: K): M[K] {
      const Lazy = lazy(async () => ({ default: (await preload())[name] as ComponentType }));
      function Screen(props: object) {
        // Вид выбирается один раз на экземпляр: смена посреди жизни пересоздала бы экран.
        const [Loaded] = useState(() => module?.[name] as ComponentType | undefined);
        return Loaded ? <Loaded {...props} /> : <Lazy {...props} />;
      }
      Screen.displayName = name;
      return Screen as M[K];
    },
  };
}
