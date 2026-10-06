import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchInvitations, fetchMembers, fetchProfile } from './api.ts';
import { useHousehold } from './HouseholdContext.tsx';

const MEMBERS = 'members';
const PROFILE = 'my-profile';
const INVITATIONS = 'invitations';

/** Состав своего дома, включая бывших участников. Без дома запрос не идёт. */
export function useMembers() {
  const { householdId } = useHousehold();
  return useQuery({
    queryKey: [MEMBERS, householdId],
    queryFn: ({ signal }) => fetchMembers(householdId ?? '', signal),
    enabled: householdId !== null,
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: [PROFILE],
    queryFn: ({ signal }) => fetchProfile(signal),
  });
}

/** Действующие непринятые приглашения: их видит только администратор. */
export function useInvitations(enabled: boolean) {
  const { householdId } = useHousehold();
  return useQuery({
    queryKey: [INVITATIONS, householdId],
    queryFn: ({ signal }) => fetchInvitations(householdId ?? '', signal),
    enabled: enabled && householdId !== null,
  });
}

/** Что перечитать после изменения: состав, профиль, приглашения. */
export function useRefresh() {
  const client = useQueryClient();
  return {
    members: () => client.invalidateQueries({ queryKey: [MEMBERS] }),
    profile: () => client.invalidateQueries({ queryKey: [PROFILE] }),
    invitations: () => client.invalidateQueries({ queryKey: [INVITATIONS] }),
  };
}
