export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed: boolean;
  lastActiveAt: number;
}

export interface BrowserDownload {
  id: string;
  tabId: string | null;
  filename: string;
  url: string;
  path: string | null;
  state: string;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
}

export interface BrowserHostEvent {
  kind: string;
  tabId?: string | null;
  webContentsId?: number;
  url?: string;
  title?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  faviconUrl?: string | null;
  requestedUrl?: string;
  reason?: string;
  download?: BrowserDownload;
  payload?: Record<string, unknown>;
}

export interface BrowserWebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getWebContentsId(): number;
  focus(): void;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  setZoomFactor(factor: number): void;
}
