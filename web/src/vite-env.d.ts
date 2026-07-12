/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;
  interface Window {
    __ENV__?: { API_URL?: string };
  }
}

export {};
