// Chatwoot live-chat bootstrap.
//
// This was an inline <script> in index.html, allow-listed in the CSP by a
// single sha256 over the block's source. The build reformats the inline block,
// so its deployed hash drifts from the source-computed one, firing inline-block
// CSP violations and blocking the flip from Report-Only to enforcing. As a
// module loaded via the app bundle it is covered by `script-src 'self'` with no
// hash to drift. The SDK itself loads from support.orangeway.app, which is
// already allow-listed in script-src (see public/_headers).
const BASE_URL = "https://support.orangeway.app";

// websiteToken is public by design: equivalent to a Google Analytics property
// ID, embedded in every page to identify this site to the Chatwoot widget. Not
// a secret.
const WEBSITE_TOKEN = "kSi4hwVaBkUfr7zhmVdhCwHq";

declare global {
  interface Window {
    chatwootSDK?: {
      run: (opts: { websiteToken: string; baseUrl: string }) => void;
    };
  }
}

export function initChatwoot(): void {
  const script = document.createElement("script");
  script.src = `${BASE_URL}/packs/js/sdk.js`;
  script.defer = true;
  script.async = true;
  script.onload = () => {
    window.chatwootSDK?.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
  };
  const first = document.getElementsByTagName("script")[0];
  first?.parentNode?.insertBefore(script, first);
}
