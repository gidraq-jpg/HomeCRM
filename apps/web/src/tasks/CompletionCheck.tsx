/** Штрих нужен для прорисовки выполнения через stroke-dashoffset. */
export function CompletionCheck() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden
    >
      <polyline points="4 12 9 17 20 6" />
    </svg>
  );
}
