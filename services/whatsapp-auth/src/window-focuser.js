/**
 * Native Windows Window Focuser for WhatsApp Web
 * Ensures WhatsApp Chrome window is brought to the absolute foreground before dispatching
 */
import { exec, spawn } from 'child_process';
import http from 'http';

export class WindowFocuser {
  /**
   * Brings WhatsApp window to the foreground on Windows
   * Uses both CDP (Chrome DevTools Protocol) and Win32 Native Desktop APIs
   */
  static async focusWhatsAppWindow(debuggingPort = 9224) {
    if (process.platform !== 'win32') return;

    try {
      // 1. CDP Window State Normal & Activate Target
      await this.activateViaCdp(debuggingPort).catch(() => {});

      // 2. Win32 Desktop Window Foregrounding
      await this.activateViaWin32(debuggingPort).catch(() => {});
    } catch (err) {
      console.warn(`[WindowFocuser] Window focus notice: ${err.message}`);
    }
  }

  static async activateViaCdp(port) {
    const ver = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    if (!ver || !ver.webSocketDebuggerUrl) return;

    const targets = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });

    const pageTarget = targets.find(t => t.type === 'page' && t.url && t.url.includes('web.whatsapp.com')) ||
                       targets.find(t => t.type === 'page');
    if (!pageTarget) return;

    const WebSocket = globalThis.WebSocket;
    if (!WebSocket) return;

    await new Promise((resolve) => {
      try {
        const ws = new WebSocket(ver.webSocketDebuggerUrl);
        const timeout = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve();
        }, 1200);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            id: 101,
            method: 'Target.activateTarget',
            params: { targetId: pageTarget.id }
          }));

          ws.send(JSON.stringify({
            id: 102,
            method: 'Browser.getWindowForTarget',
            params: { targetId: pageTarget.id }
          }));
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.id === 102 && data.result?.windowId) {
              ws.send(JSON.stringify({
                id: 103,
                method: 'Browser.setWindowBounds',
                params: {
                  windowId: data.result.windowId,
                  bounds: { windowState: 'normal' }
                }
              }));
            } else if (data.id === 103) {
              clearTimeout(timeout);
              try { ws.close(); } catch {}
              resolve();
            }
          } catch {
            clearTimeout(timeout);
            resolve();
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  static async activateViaWin32(port) {
    const pythonScript = `
import ctypes
from ctypes import wintypes
import sys

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

h_desk = user32.OpenDesktopW('default', 0, False, 0x0100 | 0x0040 | 0x0001 | 0x0002)
if not h_desk:
    sys.exit(0)

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
def callback(hwnd, lparam):
    length = user32.GetWindowTextLengthW(hwnd)
    if length > 0:
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        title = buff.value.lower()
        if 'web.whatsapp.com' in title or 'whatsapp' in title:
            fg_hwnd = user32.GetForegroundWindow()
            fg_thread = user32.GetWindowThreadProcessId(fg_hwnd, None)
            cur_thread = kernel32.GetCurrentThreadId()
            user32.AttachThreadInput(cur_thread, fg_thread, True)
            user32.ShowWindowAsync(hwnd, 9) # SW_RESTORE
            user32.ShowWindowAsync(hwnd, 5) # SW_SHOW
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
            user32.AttachThreadInput(cur_thread, fg_thread, False)
    return True

user32.EnumDesktopWindows(h_desk, WNDENUMPROC(callback), 0)
`;

    return new Promise((resolve) => {
      const child = spawn('python', ['-c', pythonScript], {
        windowsHide: true,
        stdio: 'ignore'
      });
      child.on('close', () => resolve());
      child.on('error', () => {
        exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "(New-Object -ComObject WScript.Shell).AppActivate(\'WhatsApp\')"', () => {
          resolve();
        });
      });
    });
  }
}
