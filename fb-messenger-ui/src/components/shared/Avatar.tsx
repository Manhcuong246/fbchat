import { Show } from 'solid-js';
import { getAvatarGradient, getAvatarInitials } from '../../utils/avatarUtils';

export const Avatar = (props: { name: string; size?: number; avatarUrl?: string | null }) => {
  const size = () => props.size ?? 48;

  return (
    <div
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        'min-width': `${size()}px`,
        'min-height': `${size()}px`,
        'border-radius': '50%',
        background: getAvatarGradient(props.name),
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        color: 'white',
        'font-size': `${Math.floor(size() * 0.38)}px`,
        'font-weight': '600',
        'flex-shrink': '0',
        'user-select': 'none',
        overflow: 'hidden',
      }}
    >
      <Show when={props.avatarUrl} fallback={getAvatarInitials(props.name)}>
        <img
          src={props.avatarUrl!}
          alt={props.name}
          style={{ width: '100%', height: '100%', 'object-fit': 'cover' }}
        />
      </Show>
    </div>
  );
};
