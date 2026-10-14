/** Отдельная сборка прототипа 0.5 не включает визуальную систему рабочего entry. */
export function isStudio(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.design === 'studio';
}
