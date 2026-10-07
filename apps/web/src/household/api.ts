import { ROLES, type Role } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// Состав дома, профиль и приглашения — docs/household-api.md. Ответы проверяются схемами:
// сервер мог измениться, а экран не должен ломаться на неожиданной форме.

export const Member = z.object({
  accountId: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  isAdult: z.boolean(),
  formerMember: z.boolean(),
  leftAt: z.string().nullable(),
  /** Файл фото профиля (ADR-0026); у бывшего участника сервер его не отдаёт. */
  photoFileId: z.string().nullable(),
  /** `YYYY-MM-DD` или `null`. */
  birthDate: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Member = z.infer<typeof Member>;

export const Profile = z.object({
  displayName: z.string(),
  photoFileId: z.string().nullable(),
  birthDate: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Profile = z.infer<typeof Profile>;

export interface ProfileChange {
  displayName?: string;
  birthDate?: string | null;
  phone?: string | null;
}

export const Invitation = z.object({
  id: z.string(),
  role: z.enum(ROLES),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof Invitation>;

/** Ссылка, которую сервер показывает один раз: приглашение или сброс пароля. */
export const IssuedLink = z.object({ url: z.string(), expiresAt: z.string() });
export type IssuedLink = z.infer<typeof IssuedLink>;

const house = (householdId: string) => `households/${householdId}`;

export function fetchMembers(householdId: string, signal?: AbortSignal) {
  return apiRequest('GET', `${house(householdId)}/members`, z.array(Member), undefined, signal);
}

/** Своего профиля может не быть: сервер тогда отвечает пустым телом. */
export function fetchProfile(signal?: AbortSignal) {
  return apiRequest('GET', 'me/profile', Profile.nullable(), undefined, signal);
}

export function saveProfile(change: ProfileChange) {
  return apiRequest('PATCH', 'me/profile', z.unknown(), change);
}

export function fetchInvitations(householdId: string, signal?: AbortSignal) {
  return apiRequest(
    'GET',
    `${house(householdId)}/invitations`,
    z.array(Invitation),
    undefined,
    signal,
  );
}

export function createInvitation(householdId: string, role: Role) {
  return apiRequest('POST', 'invitations', IssuedLink, { householdId, role });
}

export function revokeInvitation(id: string) {
  return apiRequest('POST', `invitations/${id}/revoke`, z.unknown(), {});
}

export function changeRole(householdId: string, accountId: string, role: Role) {
  return apiRequest('PATCH', `${house(householdId)}/members/${accountId}/role`, z.unknown(), {
    role,
  });
}

export function excludeMember(householdId: string, accountId: string) {
  return apiRequest('POST', `${house(householdId)}/members/${accountId}/exclude`, z.unknown(), {});
}

export function leaveHousehold(householdId: string) {
  return apiRequest('POST', `${house(householdId)}/leave`, z.unknown(), {});
}

export function issueResetLink(householdId: string, accountId: string) {
  return apiRequest(
    'POST',
    `${house(householdId)}/members/${accountId}/password-reset`,
    IssuedLink,
    {},
  );
}
