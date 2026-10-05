// Страница проверки связи (план, задача 0.2). Без зависимостей и сборки.
const KB = 1024;
const MB = 1024 * KB;
const DOWNLOADS = [
  { size: 16 * KB, label: '16 КБ', timeoutMs: 30_000 },
  { size: 256 * KB, label: '256 КБ', timeoutMs: 30_000 },
  { size: MB, label: '1 МБ', timeoutMs: 45_000 },
  { size: 5 * MB, label: '5 МБ', timeoutMs: 90_000 },
];
const UPLOAD = { size: MB, label: 'Отправка 1 МБ', timeoutMs: 60_000 };
const PING_COUNT = 10;
const KEYS = {
  label: 'probe.label',
  network: 'probe.network',
  subscriptionId: 'probe.subscriptionId',
  pending: 'probe.pending',
};

const $ = (selector) => document.querySelector(selector);
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
let vapidKey = null;

// --- Хранение на телефоне ---------------------------------------------------

function load(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим или запрет хранилища: просто не запоминаем
  }
}

function pendingResults() {
  try {
    const items = JSON.parse(load(KEYS.pending, '[]'));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// --- Сеть -------------------------------------------------------------------

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function deadline(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

const errorText = (error, signal) =>
  signal.aborted ? 'таймаут' : String(error?.message ?? error ?? 'ошибка');

// --- Замеры -----------------------------------------------------------------

async function measurePing() {
  const times = [];
  for (let i = 0; i < PING_COUNT; i += 1) {
    const started = performance.now();
    const response = await fetch(`api/ping?i=${i}`, { cache: 'no-store' });
    await response.arrayBuffer();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const at = (q) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))]);
  return {
    median: at(0.5),
    p90: at(0.9),
    min: Math.round(times[0]),
    max: Math.round(times.at(-1)),
  };
}

async function measureDownload({ size, timeoutMs }) {
  const started = performance.now();
  const limit = deadline(timeoutMs);
  let received = 0;
  try {
    const response = await fetch(`api/blob?size=${size}&t=${Date.now()}`, {
      cache: 'no-store',
      signal: limit.signal,
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
    const ms = Math.round(performance.now() - started);
    return { size, ok: received === size, received, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { size, ok: false, received, ms, error: errorText(error, limit.signal) };
  } finally {
    limit.clear();
  }
}

async function measureUpload({ size, timeoutMs }) {
  // Случайные байты не сжимаются — как фотографии.
  const body = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65_536) {
    crypto.getRandomValues(body.subarray(offset, offset + 65_536));
  }
  const started = performance.now();
  const limit = deadline(timeoutMs);
  try {
    const response = await fetch('api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
      cache: 'no-store',
      signal: limit.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const answer = await response.json();
    return { size, ok: answer.bytes === size, ms: Math.round(performance.now() - started) };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { size, ok: false, ms, error: errorText(error, limit.signal) };
  } finally {
    limit.clear();
  }
}

function navigationTiming() {
  const [nav] = performance.getEntriesByType('navigation');
  if (!nav) return null;
  const span = (from, to) => (from > 0 && to >= from ? Math.round(to - from) : null);
  return {
    protocol: nav.nextHopProtocol || null,
    dnsMs: span(nav.domainLookupStart, nav.domainLookupEnd),
    connectMs: span(nav.connectStart, nav.connectEnd),
    tlsMs: span(nav.secureConnectionStart, nav.connectEnd),
    ttfbMs: span(nav.requestStart, nav.responseStart),
    htmlMs: Math.round(nav.responseEnd),
  };
}

function connectionInfo() {
  const connection = navigator.connection;
  if (!connection) return null;
  return {
    type: connection.type ?? null,
    effectiveType: connection.effectiveType ?? null,
    downlink: connection.downlink ?? null,
    rtt: connection.rtt ?? null,
  };
}

// --- Интерфейс --------------------------------------------------------------

const duration = (ms) => (ms < 1000 ? `${ms} мс` : `${decimal.format(ms / 1000)} с`);

function describe(name, result) {
  if (result.ok) return `✓ ${name} — ${duration(result.ms)}`;
  const got =
    result.received === undefined ? '' : `, получено ${decimal.format(result.received / KB)} КБ`;
  return `✗ ${name} — ${result.error ?? 'ошибка'}${got}`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderNetworks(networks) {
  const fieldset = $('#network');
  const saved = load(KEYS.network);
  for (const { id, label } of networks) {
    const option = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'network';
    input.value = id;
    input.checked = id === saved;
    option.append(input, document.createTextNode(label));
    fieldset.append(option);
  }
}

const selectedNetwork = () => document.querySelector('input[name="network"]:checked')?.value;
const currentLabel = () => $('#label').value.trim();
const setPushStatus = (text) => {
  $('#push-status').textContent = text;
};
const setPushButtons = (enabled) => {
  for (const button of document.querySelectorAll('[data-delay]')) button.disabled = !enabled;
};

async function flushPending() {
  const queue = pendingResults();
  const left = [];
  for (const item of queue) {
    try {
      await postJson('api/result', item);
    } catch {
      left.push(item);
    }
  }
  save(KEYS.pending, JSON.stringify(left.slice(-20)));
  return left.length;
}

async function run() {
  const network = selectedNetwork();
  if (!network) {
    $('#summary').textContent = 'Выберите, через что телефон сейчас в интернете.';
    return;
  }
  save(KEYS.label, currentLabel());
  save(KEYS.network, network);

  const button = $('#run');
  button.disabled = true;
  $('#summary').textContent = 'Идёт проверка, около минуты. Не закрывайте страницу.';
  const steps = $('#steps');
  steps.replaceChildren();
  const step = (text) => {
    const item = document.createElement('li');
    item.textContent = `… ${text}`;
    steps.append(item);
    return item;
  };

  const result = {
    label: currentLabel(),
    network,
    host: location.host,
    clientTime: Date.now(),
    connection: connectionInfo(),
    nav: navigationTiming(),
    downloads: [],
  };

  const pingStep = step('Задержка');
  try {
    result.ping = await measurePing();
    pingStep.textContent = `✓ Задержка — ${result.ping.median} мс`;
  } catch (error) {
    result.ping = { error: String(error?.message ?? error) };
    pingStep.textContent = '✗ Задержка — сервер не ответил';
  }

  for (const download of DOWNLOADS) {
    const item = step(`Загрузка ${download.label}`);
    const measured = await measureDownload(download);
    result.downloads.push(measured);
    item.textContent = describe(`Загрузка ${download.label}`, measured);
  }

  const uploadStep = step(UPLOAD.label);
  result.upload = await measureUpload(UPLOAD);
  uploadStep.textContent = describe(UPLOAD.label, result.upload);

  const queue = pendingResults();
  queue.push(result);
  save(KEYS.pending, JSON.stringify(queue));
  const left = await flushPending();
  $('#summary').textContent =
    left === 0
      ? 'Готово, результат отправлен. Спасибо!'
      : 'Результат сохранён на телефоне и отправится, когда сервер снова будет доступен.';
  button.disabled = false;
}

// --- Push -------------------------------------------------------------------

function base64UrlToBytes(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function subscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setPushStatus('Этот браузер не поддерживает уведомления. Откройте страницу в Chrome.');
    return;
  }
  if (!vapidKey) {
    setPushStatus('На сервере ещё не настроены ключи уведомлений.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setPushStatus('Уведомления не разрешены. Разрешите их в настройках сайта и нажмите ещё раз.');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidKey),
      }));
    const { id } = await postJson('api/subscribe', {
      label: currentLabel(),
      subscription: subscription.toJSON(),
    });
    save(KEYS.subscriptionId, id);
    setPushButtons(true);
    setPushStatus('Уведомления включены. Теперь попросите прислать тестовое.');
  } catch (error) {
    setPushStatus(`Не получилось включить: ${error?.message ?? error}`);
  }
}

async function requestPush(delaySec) {
  const id = load(KEYS.subscriptionId);
  if (!id) {
    setPushStatus('Сначала включите уведомления.');
    return;
  }
  try {
    await postJson('api/push-test', { id, delaySec });
    const minutes = delaySec / 60;
    setPushStatus(
      delaySec === 0
        ? 'Отправили. Уведомление должно прийти в течение нескольких секунд.'
        : `Пришлём через ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}. Заблокируйте экран и отложите телефон.`,
    );
  } catch (error) {
    setPushStatus(`Не получилось: ${error?.message ?? error}`);
  }
}

// --- Запуск -----------------------------------------------------------------

async function start() {
  $('#label').value = load(KEYS.label, '');
  $('#run').addEventListener('click', run);
  $('#subscribe').addEventListener('click', subscribe);
  for (const button of document.querySelectorAll('[data-delay]')) {
    button.addEventListener('click', () => requestPush(Number(button.dataset.delay)));
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => undefined);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'push' && typeof event.data.latencySec === 'number') {
        setPushStatus(`Уведомление пришло через ${decimal.format(event.data.latencySec)} с.`);
      }
    });
  }
  const granted = 'Notification' in window && Notification.permission === 'granted';
  if (granted && load(KEYS.subscriptionId)) setPushButtons(true);

  try {
    const sentBefore = Date.now();
    const info = await getJson('api/info');
    const skewSec = Math.round((Date.now() - sentBefore) / 2 + sentBefore - info.serverTime) / 1000;
    vapidKey = info.vapidPublicKey;
    renderNetworks(info.networks);
    $('#info').textContent =
      `Сервер: ${location.host}. Часы телефона расходятся с сервером на ${decimal.format(skewSec)} с.`;
    const left = await flushPending();
    if (left > 0) $('#summary').textContent = `Не отправлено замеров: ${left}.`;
  } catch {
    $('#info').textContent = 'Сервер не отвечает. Проверьте интернет и обновите страницу.';
  }
}

start();
