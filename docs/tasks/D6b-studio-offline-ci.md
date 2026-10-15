# D6b. CI Studio: очередь после настоящей offline перезагрузки

Свежий исполнитель, наследуемая сильная модель: данные/фото/outbox/receipt требуют осторожности. Собственный managed worktree от `7544510181204a63681d696ca9571c1d36f8ee0b`, ветка `fix/studio-offline-shell-ci`.

PR59 CI38664226523: check SUCCESS, Linux505 passed/1 skipped/2 failed. Здесь только `[w412] shopping-offline.e2e.ts:418` «настоящие два фото, lost ACK multipart, batch и точный receipt.parent». После offline Save/2blobs/check/reload helperqueue:103 не находит h1 Очередь изменений за обычные5000мс. По исходному тесту это первыйqueue перед lostACK multipart. Другой push-отказ ведёт D6a. Radar D5 прошёл. Runtime code с770 не менялся; это не доказывает причину отказа.

1. Прочитать AGENTS, DATA/OFFLINE/receipt контракты в PRD и docs/shopping-offline-ui.md, этот тест/shell/queue и offline AuthRoot/SW/snapshot startup. --list ровно1, baseline один w412 в своём Linux/PG, fake family.
2. При PASS — управляемая конкретная гипотеза reload/controller/cache/IDB/session hydration/route; снять реальный URL/H1/identity/queuedrows и фазы, без чувствительных данных. Не гонять зелёный сценарий сериями. Исторический CI без trace не реконструирован.
3. Узкая test-only синхронизация после доказательства допустима в своём e2e-файле и docs. Настоящие offline/reload/2фото/lostACK/unknown→confirmed/stableid/frozenbody/exactreceiptparent/rollback должны сохраниться. Никаких sleep/retries/timeouts/skip/ослабления assertions, не превращать offline в online для обхода. App/source/worker/sharedfixture менять только после предложения root delta и его acceptance; сервер/БД/RLS/access/контракт409/deploy/политики/зависимости не менять.
4. После принятой поправки только сценарий360/412, types/Biome/encoding/diff-check и test:changed если source разрешён. Никакого полного localvisual/check/push: общую доставку сделает D6a после приёмки обеих задач. Новый build только если runtime source действительно менялся; иначе переиспользуется770/6e6142.
5. Коммит с фактическим PRD требованием, tracked sanitized evidence `docs/screenshots/UI-3/d6b-offline-ci.md`, копия брифа, короткий exactSHA/path/report. Полный контур удалить после завершения target, свой tmpfsPG/randomport, никаких постоянных портов.

Root — лид, код не пишет. Параллельно максимум D6a и D6b, e2e-файлы раздельны. Shared SW/offline source root сериализует. Не трогать рабочие homecrm/8300/8301/8309/E:\HomeCRM-data, owner drafts и чужие worktree. Никаких dumps env/auth headers/cookies даже fake family.
