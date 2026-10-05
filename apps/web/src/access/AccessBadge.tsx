import { House, Lock, Users } from '@phosphor-icons/react';
import type { ComponentType } from 'react';
import { VISIBILITY_HINTS, VISIBILITY_LABELS, type Visibility } from './visibility.ts';

// Значки доступа — PRD, раздел 7.4: замок — «Только я», два человека — «Взрослые»,
// дом — «Вся семья». В списке — значок, в карточке — значок с подписью (SPACE-6).

type IconComponent = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

export const VISIBILITY_ICONS: Readonly<Record<Visibility, IconComponent>> = {
  personal: Lock,
  adults: Users,
  household: House,
};

interface AccessBadgeProps {
  visibility: Visibility;
  /** Подпись рядом со значком; в списках её нет. */
  showLabel?: boolean;
}

export function AccessBadge({ visibility, showLabel = false }: AccessBadgeProps) {
  const Icon = VISIBILITY_ICONS[visibility];
  const label = VISIBILITY_LABELS[visibility];

  if (showLabel) {
    return (
      <span className={`access-badge access-badge--${visibility} access-badge--labeled`}>
        <Icon size={18} aria-hidden />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={`access-badge access-badge--${visibility}`}
      role="img"
      aria-label={`Кто видит: ${label}`}
    >
      <Icon size={18} aria-hidden />
    </span>
  );
}

/** Подпись для карточки: значок, название значения и пояснение. */
export function AccessCaption({ visibility }: { visibility: Visibility }) {
  return (
    <div className="access-caption">
      <AccessBadge visibility={visibility} showLabel />
      <p>{VISIBILITY_HINTS[visibility]}</p>
    </div>
  );
}
