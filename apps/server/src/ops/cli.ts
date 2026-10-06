// Команды эксплуатации внутри контейнера (ADR-0021). Запуск: node apps/server/src/ops/cli.ts <команда>
//
//   migrate                          роли, база, копия перед миграцией и миграции
//   backup [--kind daily|pre-migration]
//   scheduler                        расписание копий (контейнер backup)
//   check-repositories               целостность хранилищ restic
//   restore [--from local|cloud] [--snapshot <id>] [--check] [--migrate]
//   snapshots [--from local|cloud]   список копий в хранилище (что реально там лежит)
//   cloud-check                      создаёт и читает хранилище на Google Диске
import { checkRepositories, runBackup } from './backup.ts';
import { loadOpsEnv } from './env.ts';
import { runMigrate } from './migrate.ts';
import { createLog, errorMessage, OpsError } from './process.ts';
import { ensureRepo, repoByName, resticFor } from './restic.ts';
import { runRestore } from './restore.ts';
import { runScheduler } from './scheduler.ts';

const log = createLog();

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const env = loadOpsEnv();
  switch (command) {
    case 'migrate':
      await runMigrate({ env, log });
      return 0;
    case 'backup': {
      const kind = option(args, '--kind') ?? 'daily';
      if (kind !== 'daily' && kind !== 'pre-migration') throw new OpsError(`Unknown kind: ${kind}`);
      return (await runBackup({ env, kind, log })).ok ? 0 : 1;
    }
    case 'scheduler':
      return await runScheduler(env, log);
    case 'check-repositories':
      return (await checkRepositories(env, log)) ? 0 : 1;
    case 'restore': {
      const from = option(args, '--from') ?? 'local';
      if (from !== 'local' && from !== 'cloud') throw new OpsError(`Unknown repository: ${from}`);
      const report = await runRestore({
        env,
        log,
        from,
        snapshot: option(args, '--snapshot') ?? 'latest',
        check: args.includes('--check'),
        migrate: args.includes('--migrate'),
      });
      return report.ok ? 0 : 1;
    }
    case 'snapshots': {
      const from = option(args, '--from') ?? 'local';
      if (from !== 'local' && from !== 'cloud') throw new OpsError(`Unknown repository: ${from}`);
      const restic = await resticFor(env, repoByName(env, from));
      const { stdout } = await restic(['snapshots', '--json', '--host', env.BACKUP_HOST]);
      const list = JSON.parse(stdout || '[]') as Array<{
        short_id: string;
        time: string;
        tags?: string[];
      }>;
      for (const snapshot of list) {
        console.log(
          `snapshot ${snapshot.short_id}  ${snapshot.time}  ${(snapshot.tags ?? []).join(',')}`,
        );
      }
      console.log(`total ${list.length}`);
      return 0;
    }
    case 'cloud-check': {
      // Проверка подключения Google Диска: хранилище создаётся и читается.
      const restic = await resticFor(env, repoByName(env, 'cloud'));
      const created = await ensureRepo(restic);
      await restic(['snapshots', '--json']);
      log.info(created ? 'cloud repository created' : 'cloud repository is reachable');
      return 0;
    }
    default:
      console.error(
        'Usage: cli.ts migrate | backup | scheduler | check-repositories | restore | snapshots | cloud-check',
      );
      return 2;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  log.error('command failed', { error: errorMessage(error) });
  process.exitCode = 1;
}
