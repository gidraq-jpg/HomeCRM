# D6a. CI Studio: первое скрытое push-уведомление

Свежий исполнитель gpt-6-luna, задача сначала диагностики узкого e2e. Собственный managed worktree от `7544510181204a63681d696ca9571c1d36f8ee0b`, ветка `fix/studio-worker-push-ci`. Root — лид, source не пишет.

PR59 CI38664226523: check SUCCESS, Linux505 passed/1 skipped/2 failed. Radar D5 прошёл. Здесь только `[w360] notifications-worker.e2e.ts:231`, режим скрывать текст/тишина консоли: первое expect.poll shown.length ожидает1, получает0. Остальной отказ shopping-offline ведёт отдельный D6b. Артефакт11940694018 содержит только screens, historicaltrace не загружен.

1. Прочитать AGENTS, NOTIF-6/7 и существующие connectWorker/push/shown/worker lifecycle. Сначала --list ровно1 и один baseline упавшего w360 в своём Linux/PG контуре, fake family.
2. Если PASS, проверить конкретную гипотезу управляемым порядком worker activation/ready/dispatch/notification mock, а не серией повторов. Фиксировать worker URL/state/момент установки observer и реальный исход push без секретов. Реальный source-дефект или общий ресурсный отказ не называть flaky по одному PASS. Исторический порядок без trace не утверждать.
3. Test-only delta после доказательства допустима только в notifications-worker.e2e.ts и своих диагностических docs; сохранить приватный payload/title/body/tag/data и console assertions. Не расширять timeout, не добавлять sleep/retries, skip/catch-ignore, не удалять проверки. Если нужен source/serviceworker/общий fixture — предложить root точную delta ДО правки; общие worker/offline файлы могут пересекаться с D6b, изменения сериализует root.
4. После принятой поправки только этот сценарий360/412, типы/Biome/encoding/diff-check. Полные check/visual/push пока HOLD. Без runtime delta образ770/6e6142 не пересобирать.
5. Коммит с фактическим требованием PRD и tracked sanitized evidence `docs/screenshots/UI-3/d6a-worker-ci.md`, копия брифа; отчёт до15строк с exactSHA/path/причиной/ограничением. Root примет только blocker delta.
6. Этот исполнитель также назначен доставляющим **после** root acceptance обоих D6a/D6b: объединить принятые непересекающиеся commits в своей ветке, один normalhook/push в существующую branch `fix/studio-radar-identity-ci` PR59 без force. Сейчас не начинать доставку. Не создавать отдельный PR. Только один локальный fullcheck, свой PG с фактическим max_locks_per_transaction512 и randomport; явный cleanup своего контура.

Рабочие homecrm/E:\HomeCRM-data/8300/8301/8309/owner drafts/чужие worktree не трогать, env/секреты/cookies не выводить. Полный reviewer/root context не нужен, все факты в брифах и отчётах. Параллельно только D6a и D6b, их e2e-файлы не пересекаются.
