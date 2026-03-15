import { AppLayout } from './AppLayout';
import { Sidebar } from '../sidebar/Sidebar';
import { ChatWindow } from '../chat/ChatWindow';

export default function MainApp() {
  return <AppLayout sidebar={<Sidebar />} chat={<ChatWindow />} />;
}
