export type AuthProvider = "github" | "google" | "local";

export interface UserProfile {
  id: string;
  username: string;
  login?: string;
  name: string;
  email: string;
  avatarUrl?: string;
  provider: AuthProvider;
  bio?: string;
  reposCount?: number;
  location?: string;
  company?: string;
  createdAt: string;
}

export interface AuthSession {
  user: UserProfile;
  token?: string;
  provider: AuthProvider;
  syncEnabled: boolean;
  lastSyncedAt?: string;
}

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}
