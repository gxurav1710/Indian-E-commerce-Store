import http from 'node:http';
import { GmailPoller } from './gmail-poller.js';
import { GmailBrowserAutomator } from './browser-automator.js';

export class GmailObserverServer {
  /**
   * @param {{
   *   poller?: GmailPoller,
   *   apiBaseUrl?: string,
   *   receivingAccountId?: string
   * }} options
   */
  constructor(options = {}) {
    this.poller = options.poller || new GmailPoller(options);
    this.automator = new GmailBrowserAutomator({ gmailPoller: this.poller });
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }

      // GET /health
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'UP',
          service: 'gmail-observer',
          isRunning: this.poller.isRunning,
          lastPollAt: this.poller.lastPollAt,
          observedCount: this.poller.observedCount
        }));
        return;
      }

      // POST /stop
      if (pathname === '/stop' && method === 'POST') {
        this.poller.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Gmail poller stopped' }));
        return;
      }

      // GET /oauth/url
      if (pathname === '/oauth/url') {
        let clientId = '';
        const apiBase = (this.poller.apiBaseUrl && !this.poller.apiBaseUrl.includes('gauravtesting.online')) ? this.poller.apiBaseUrl : `http://127.0.0.1:${process.env.PAYMENT_API_PORT || 6100}`;
        try {
          const credRes = await fetch(`${apiBase}/api/v1/admin/gmail/credentials`);
          if (credRes.ok) {
            const credData = await credRes.json();
            clientId = credData.clientId || credData.gmailConfig?.clientId || '';
          }
        } catch {}

        if (!clientId || clientId.startsWith('demo-')) {
          clientId = (this.poller.credentials?.clientId && !this.poller.credentials.clientId.startsWith('demo-'))
            ? this.poller.credentials.clientId
            : (process.env.GMAIL_CLIENT_ID && !process.env.GMAIL_CLIENT_ID.startsWith('demo-') ? process.env.GMAIL_CLIENT_ID : '');
        }

        const finalRedirectUri = 'https://pay-gmail.gauravtesting.online/oauth/callback';
        const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email');
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(finalRedirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&include_granted_scopes=true`;

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ authUrl, redirectUri: finalRedirectUri }));
        return;
      }

      // GET /oauth/callback (Google OAuth redirect authorization exchange)
      if (pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Google OAuth Authorization Error</h1><p>${error}</p>`);
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Missing Authorization Code</h1><p>No code returned from Google.</p>`);
          return;
        }

        try {
          let clientId = '';
          let clientSecret = '';
          const apiBase = (this.poller.apiBaseUrl && !this.poller.apiBaseUrl.includes('gauravtesting.online')) ? this.poller.apiBaseUrl : `http://127.0.0.1:${process.env.PAYMENT_API_PORT || 6100}`;

          try {
            const credRes = await fetch(`${apiBase}/api/v1/admin/gmail/credentials`);
            if (credRes.ok) {
              const credData = await credRes.json();
              clientId = credData.clientId || credData.gmailConfig?.clientId || '';
              clientSecret = credData.clientSecret || credData.gmailConfig?.clientSecret || '';
            }
          } catch (e) {
            console.warn('[Gmail Observer] Failed to fetch credentials from Payment API:', e.message);
          }

          if (!clientId || clientId.startsWith('demo-')) {
            clientId = (this.poller.credentials?.clientId && !this.poller.credentials.clientId.startsWith('demo-'))
              ? this.poller.credentials.clientId
              : (process.env.GMAIL_CLIENT_ID && !process.env.GMAIL_CLIENT_ID.startsWith('demo-') ? process.env.GMAIL_CLIENT_ID : '');
          }

          if (!clientSecret || clientSecret.startsWith('demo-')) {
            clientSecret = (this.poller.credentials?.clientSecret && !this.poller.credentials.clientSecret.startsWith('demo-'))
              ? this.poller.credentials.clientSecret
              : (process.env.GMAIL_CLIENT_SECRET && !process.env.GMAIL_CLIENT_SECRET.startsWith('demo-') ? process.env.GMAIL_CLIENT_SECRET : '');
          }

          const redirectUri = 'https://pay-gmail.gauravtesting.online/oauth/callback';
          console.log(`[Gmail Observer] Exchanging OAuth code for tokens with Client ID: ${clientId.substring(0, 15)}... and Redirect URI: ${redirectUri}`);

          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code'
            }).toString()
          });

          const tokenData = await tokenRes.json();
          if (!tokenRes.ok) {
            throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
          }

          let userEmail = 'Connected Account';
          let messagesTotal = 0;
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
              signal: AbortSignal.timeout(5000)
            });
            if (userRes.ok) {
              const userInfo = await userRes.json();
              userEmail = userInfo.email || userEmail;
            }
          } catch {}

          try {
            const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
              signal: AbortSignal.timeout(5000)
            });
            if (profileRes.ok) {
              const prof = await profileRes.json();
              if (prof.emailAddress) userEmail = prof.emailAddress;
              if (prof.messagesTotal !== undefined) messagesTotal = prof.messagesTotal;
            }
          } catch {}

          const nowIso = new Date().toISOString();
          // Persist credentials to Payment API
          try {
            await fetch(`${apiBase}/api/v1/admin/gmail/credentials`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                clientSecret,
                refreshToken: tokenData.refresh_token,
                accessToken: tokenData.access_token,
                connectedEmail: userEmail,
                lastTestedAt: nowIso,
                lastSuccessfulFetch: nowIso,
                messagesTotal,
                status: 'CONNECTED'
              })
            });
          } catch (e) {
            console.error('[Gmail Observer] Failed to persist credentials to payment-api:', e.message);
          }

          this.poller.setCredentials({
            clientId,
            clientSecret,
            refreshToken: tokenData.refresh_token,
            accessToken: tokenData.access_token,
            connectedEmail: userEmail
          });
          this.poller.start();

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>YOUPI PG — Google Connected</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                * { box-sizing: border-box; }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                  background: #090d16;
                  color: #f8fafc;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  padding: 1.5rem;
                }
                .card {
                  background: #111827;
                  border: 1px solid #1f2937;
                  border-radius: 1.25rem;
                  padding: 2.5rem 2rem;
                  text-align: center;
                  max-width: 440px;
                  width: 100%;
                  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);
                }
                .icon-badge {
                  width: 64px;
                  height: 64px;
                  border-radius: 50%;
                  background: rgba(16, 185, 129, 0.15);
                  border: 2px solid #10b981;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 1.25rem auto;
                  font-size: 2rem;
                }
                h1 {
                  font-size: 1.4rem;
                  font-weight: 700;
                  color: #ffffff;
                  margin: 0 0 0.5rem 0;
                }
                p {
                  color: #9ca3af;
                  font-size: 0.9rem;
                  line-height: 1.5;
                  margin: 0 0 1.25rem 0;
                }
                .email-box {
                  background: #1f2937;
                  border: 1px solid #374151;
                  padding: 0.6rem 1rem;
                  border-radius: 0.5rem;
                  font-family: monospace;
                  font-size: 0.95rem;
                  color: #38bdf8;
                  display: inline-block;
                  margin-bottom: 1.25rem;
                  word-break: break-all;
                }
                .status-text {
                  font-size: 0.8rem;
                  color: #10b981;
                  font-weight: 600;
                  margin-bottom: 1.5rem;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 0.4rem;
                }
                .btn {
                  background: #2563eb;
                  color: #ffffff;
                  border: none;
                  padding: 0.75rem 1.5rem;
                  border-radius: 0.5rem;
                  font-size: 0.9rem;
                  font-weight: 600;
                  cursor: pointer;
                  width: 100%;
                  transition: background 0.15s;
                }
                .btn:hover { background: #1d4ed8; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon-badge">✅</div>
                <h1>Google Account Connected</h1>
                <p>Your Gmail account has been successfully authorized for real-time UPI payment verification.</p>
                <div class="email-box">${userEmail}</div>
                <div class="status-text">
                  <span>●</span> Background Payment Observer Active
                </div>
                <button class="btn" onclick="finishAndClose()">Return to Admin Dashboard</button>
              </div>
              <script>
                const payload = {
                  type: 'GMAIL_OAUTH_SUCCESS',
                  email: ${JSON.stringify(userEmail)},
                  messagesTotal: ${JSON.stringify(messagesTotal)},
                  timestamp: Date.now()
                };
                try { localStorage.setItem('youpi_gmail_oauth_result', JSON.stringify(payload)); } catch(e) {}
                try { if (window.opener) window.opener.postMessage(payload, '*'); } catch(e) {}
                function finishAndClose() {
                  try { if (window.opener && window.opener.fetchGmailCredentials) window.opener.fetchGmailCredentials(); } catch(e) {}
                  window.close();
                }
                setTimeout(finishAndClose, 1800);
              </script>
            </body>
            </html>
          `);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>OAuth Error</title></head>
            <body style="font-family:sans-serif; background:#090d16; color:#f8fafc; padding:2rem; text-align:center;">
              <h2 style="color:#ef4444;">Google Authorization Failed</h2>
              <p style="color:#94a3b8;">${err.message}</p>
              <button onclick="window.close()" style="background:#3b82f6; color:#fff; border:none; padding:0.6rem 1.2rem; border-radius:0.4rem; cursor:pointer;">Close Window</button>
            </body>
            </html>
          `);
        }
        return;
      }

      // GET /api/browser/status
      if (pathname === '/api/browser/status') {
        // Auto-ensure connection if currently idle/standby
        if (this.automator.mode === 'STANDBY' && !this.automator.isEnsuring) {
          this.automator.autoEnsureConnection().catch(() => {});
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(this.automator.getStatus()));
        return;
      }

      // POST /api/browser/auto-ensure
      if (pathname === '/api/browser/auto-ensure' && method === 'POST') {
        try {
          const result = await this.automator.autoEnsureConnection();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /api/browser/launch-login
      if (pathname === '/api/browser/launch-login' && req.method === 'POST') {
        try {
          const result = this.automator.launchLoginWindow();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /api/sweep (Active sweep trigger during 30-second verification window)
      if (pathname === '/api/sweep' && req.method === 'POST') {
        try {
          await Promise.allSettled([
            this.automator.pollInboxEmails().catch(() => {}),
            this.poller.pollCycle().catch(() => {})
          ]);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ swept: true, source: 'GMAIL', count: this.poller.observedCount + this.automator.emailsObserved }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // POST /process-email (Direct email ingestion / test injection)
      if (pathname === '/process-email' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const emailData = JSON.parse(body);
            const result = await this.poller.processEmail(emailData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Gmail Observer Route Not Found');
    });
  }
}
