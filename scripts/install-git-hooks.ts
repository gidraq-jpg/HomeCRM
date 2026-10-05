// Подключает ловушки git из .githooks: перед `git push` запускается `pnpm check`.
// Вызывается автоматически из `pnpm install` (скрипт prepare).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.git')) {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
}
// Без .git (сборка образа Docker, распакованный архив) ловушки не нужны.
