import { createSignal, Show } from 'solid-js';
import type { ConversationData } from '../../types/conversation';
import { formatLastSeen } from '../../utils/timeUtils';
import { ReadTracker } from '../../services/readTracker';
import { Avatar } from '../shared/Avatar';
import { IconMail } from '../shared/Icons';

export interface Props {
  data: ConversationData;
  index?: number;
  isSelected: boolean;
  onClick: () => void;
}

export const ConversationItem = (props: Props) => {
  const [hover, setHover] = createSignal(false);

  const hasUnread = () =>
    ReadTracker.getDisplayCount(props.data.id, props.data.latestMessageId, props.data.unreadCount) > 0;

  return (
    <div
      class="conversation-item"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => e.key === 'Enter' && props.onClick()}
      style={{
        display: 'flex',
        'align-items': 'center',
        padding: '8px 20px',
        gap: '12px',
        height: '72px',
        'box-sizing': 'border-box',
        cursor: 'pointer',
        transition: 'background 150ms ease',
        background: props.isSelected ? '#3390ec' : hasUnread() ? '#f0f0f0' : hover() ? '#f1f3f4' : 'transparent',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', 'flex-shrink': '0' }}>
        <Avatar name={props.data.participant.name} size={54} avatarUrl={props.data.participant.avatarUrl} psid={props.data.participant.id} />
        <Show when={props.data.pageId}>
          <div style={{
            position: 'absolute', bottom: '-2px', right: '-2px',
            width: '20px', height: '20px', 'border-radius': '50%',
            background: props.data.pageColor ?? '#3390ec',
            border: '2px solid white', display: 'flex', 'align-items': 'center',
            'justify-content': 'center', overflow: 'hidden',
          }}>
            <Show when={props.data.pageAvatarUrl} fallback={<span style={{ 'font-size': '8px', color: 'white', 'font-weight': '700' }}>{props.data.pageName?.substring(0, 1).toUpperCase() ?? 'P'}</span>}>
              <img src={props.data.pageAvatarUrl} style={{ width: '100%', height: '100%', 'object-fit': 'cover' }} alt="" />
            </Show>
          </div>
        </Show>
      </div>

      <div style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '2px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '8px' }}>
          <span style={{ 'font-size': '15px', 'font-weight': '500', color: props.isSelected ? '#ffffff' : hasUnread() ? '#616161' : '#000000', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'text-align': 'left', flex: '1', 'min-width': '0' }}>
            {props.data.participant.name}
          </span>
          <span style={{ 'font-size': '12px', color: props.isSelected ? 'rgba(255,255,255,0.7)' : hasUnread() ? '#9e9e9e' : '#3390ec', 'white-space': 'nowrap', 'flex-shrink': '0' }}>
            {formatLastSeen(props.data.lastMessageTime)}
          </span>
        </div>

        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '8px' }}>
          <span style={{ 'font-size': '13px', color: props.isSelected ? 'rgba(255,255,255,0.7)' : hasUnread() ? '#9e9e9e' : '#707579', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', flex: '1', 'min-width': '0', 'text-align': 'left' }}>
            {props.data.lastMessage || '\u00A0'}
          </span>
          <Show when={hasUnread()}>
            <span style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: props.isSelected ? 'rgba(255,255,255,0.9)' : '#f57c00', 'flex-shrink': '0' }}>
              <IconMail size={18} />
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
};
