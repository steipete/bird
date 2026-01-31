import { ProxyAgent, setGlobalDispatcher } from 'undici';

export function installGlobalProxy(): void {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    try {
      const dispatcher = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(dispatcher);
    } catch (error) {
      console.warn(`[bird] Failed to set proxy agent for ${proxyUrl}:`, error);
    }
  }
}
