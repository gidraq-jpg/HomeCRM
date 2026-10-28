import { describe, expect, it } from 'vitest';
import { cloudFailureReason, rcloneOptions, rcloneRemoteName, rcloneRemoteType } from './restic.ts';

const CONFIG = [
  '[yadisk]',
  'type = yandex',
  'token = {"access_token":"fictional"}',
  '',
  '[yadisk-webdav]',
  'type = webdav',
  'url = https://webdav.yandex.ru',
  'vendor = other',
  'user = test-family',
  'pass = fictional-obscured',
  '',
].join('\n');

describe('подключение rclone для облака (ADR-0047)', () => {
  it('тип берётся из своей секции, остальные строки не нужны', () => {
    expect(rcloneRemoteType(CONFIG, 'yadisk')).toBe('yandex');
    expect(rcloneRemoteType(CONFIG, 'yadisk-webdav')).toBe('webdav');
    expect(rcloneRemoteType(CONFIG.replaceAll('\n', '\r\n'), 'yadisk-webdav')).toBe('webdav');
    expect(rcloneRemoteType(CONFIG, 'missing')).toBeUndefined();
  });

  it('имя подключения — из адреса хранилища', () => {
    expect(rcloneRemoteName('rclone:yadisk-webdav:HomeCRM-backups')).toBe('yadisk-webdav');
    expect(rcloneRemoteName('/backups/restic')).toBeUndefined();
  });

  it('--yandex-hard-delete только для REST API Яндекса, WebDAV — без него', () => {
    expect(rcloneOptions('yandex')).toEqual([
      '-o',
      'rclone.args=serve restic --stdio --yandex-hard-delete',
    ]);
    expect(rcloneOptions('webdav')).toEqual(['-o', 'rclone.args=serve restic --stdio']);
    expect(rcloneOptions(undefined)).toEqual(['-o', 'rclone.args=serve restic --stdio']);
  });
});

describe('причина сбоя облака без вывода программ', () => {
  it.each([
    ['CRITICAL: read metadata failed: 401 Unauthorized: 401 Unauthorized', 'HTTP 401'],
    ['ERROR : [401 - UnauthorizedError] Unauthorized', 'HTTP 401'],
    ['Fatal: [410 - DiskResourceGoneError] Resource is no longer available', 'HTTP 410'],
    ["ERROR : couldn't list files: 410 Gone", 'HTTP 410'],
    ['ERROR : 507 Insufficient Storage', 'HTTP 507'],
    ['dial tcp: lookup webdav.yandex.ru: no such host', 'network error'],
    ['Propfind "https://webdav.yandex.ru/": dial tcp 1.2.3.4:443: i/o timeout', 'network error'],
  ])('%s → %s', (output, reason) => {
    expect(cloudFailureReason(output)).toMatch(new RegExp(`^${reason}`));
  });

  it('незнакомый вывод и числа в именах файлов не дают причины', () => {
    expect(
      cloudFailureReason('Fatal: unable to open config file: 0401-report.txt'),
    ).toBeUndefined();
    expect(cloudFailureReason('')).toBeUndefined();
  });

  it('причина — только своя фраза: адрес и имя файла из вывода не попадают', () => {
    const reason = cloudFailureReason('ERROR : /HomeCRM-backups/secret-name: 401 Unauthorized');
    expect(reason).toBe('HTTP 401: login or app password rejected');
  });
});
