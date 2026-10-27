export function pdfMessages(code: string | null): string[] {
  if (!code) return [];
  const errors: Record<string, string> = {
    AI_PDF_ENCRYPTED: 'PDF защищён паролем. Заполните поля вручную или загрузите копию без пароля.',
    AI_PDF_BROKEN:
      'Не удалось прочитать PDF: файл повреждён или не поддерживается. Заполните поля вручную или загрузите другую копию.',
    AI_PDF_TIMEOUT:
      'Разбор PDF занял больше 20 секунд. Заполните поля вручную или загрузите меньше страниц.',
    AI_FILE_MANUAL: 'Этот файл не поддерживается. Заполните поля вручную.',
  };
  if (errors[code]) return [errors[code]];
  if (!/^AI_PDF_PARTIAL(?:_\d+)*(?:_TEXT)?$/.test(code)) return [];
  return [
    ...[...new Set(code.match(/\d+/g) ?? [])].map(
      (pages) => `Разобраны первые 5 страниц из ${pages}. Остальные страницы проверьте вручную.`,
    ),
    ...(code.endsWith('_TEXT')
      ? ['Разобраны первые 20 000 символов текста PDF. Остальное проверьте вручную.']
      : []),
  ];
}
