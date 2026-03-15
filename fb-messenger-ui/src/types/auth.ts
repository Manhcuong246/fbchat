export interface UserInfo {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface PageInfo {
  id: string;
  name: string;
  avatarUrl?: string;
  accessToken: string;
  category?: string;
  color?: string;
}

export interface AuthState {
  userToken?: string;
  userInfo?: UserInfo;
  availablePages: PageInfo[];
  selectedPages: PageInfo[];
  step: 'input_token' | 'select_pages' | 'ready';
  loading: boolean;
  error?: string;
}
