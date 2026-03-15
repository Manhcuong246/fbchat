import type { JSX } from 'solid-js';
import { convState } from '../../stores/conversationStore';

interface Props {
  sidebar: JSX.Element;
  chat: JSX.Element;
}

export const AppLayout = (props: Props) => {
  const hasSelection = () => !!convState.selectedId;
  return (
    <div class="app-layout" classList={{ 'app-layout--mobile-chat': hasSelection() }}>
      <aside class="app-sidebar">
        {props.sidebar}
      </aside>
      <main class="app-chat">
        {props.chat}
      </main>
    </div>
  );
};
