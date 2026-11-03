export interface PasskeyListItem {
  credentialId: string;
  name: string;
  deviceType: string | null;
  browser: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyListData {
  items: PasskeyListItem[];
}
