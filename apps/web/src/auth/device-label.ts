/** Короткая подпись устройства без версий и технической строки user-agent. */
export function deviceLabel(agent: string | null): string {
  if (!agent) return 'Неизвестное устройство';
  const browser = /Edg(?:e|A|iOS)?\//.test(agent)
    ? 'Edge'
    : /(?:OPR|Opera)\//.test(agent)
      ? 'Opera'
      : /(?:Firefox|FxiOS)\//.test(agent)
        ? 'Firefox'
        : /(?:Chrome|CriOS)\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : 'Браузер';
  const platform =
    /iPad/.test(agent) || (/Macintosh/.test(agent) && /Mobile\//.test(agent))
      ? 'iPad'
      : /iPhone/.test(agent)
        ? 'iPhone'
        : /Android/.test(agent)
          ? 'Android'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Macintosh|Mac OS X/.test(agent)
              ? 'macOS'
              : /Linux/.test(agent)
                ? 'Linux'
                : null;
  return platform ? `${browser} на ${platform}` : `${browser} · неизвестное устройство`;
}
