/**
 * OAuth Auto-Fill Engine
 *
 * Automates GitHub / Google OAuth login inside Electron BrowserWindow
 * by injecting DOM operations via webContents.executeJavaScript().
 *
 * Ported from github-account-switcher browser extension.
 */

import { createHmac } from 'crypto'
import type { WebContents } from 'electron'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthCredentials {
  username: string
  password: string
  totpSecret?: string
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — Node.js crypto version
// ---------------------------------------------------------------------------

function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  encoded = encoded.replace(/[\s=-]+/g, '').toUpperCase()
  let bits = ''
  for (const ch of encoded) {
    const val = alphabet.indexOf(ch)
    if (val === -1) throw new Error(`Invalid base32 character: ${ch}`)
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  }
  return bytes
}

function generateTOTP(secret: string, period = 30): string {
  const keyBytes = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / period)

  const counterBuf = Buffer.alloc(8)
  let tmp = counter
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = tmp & 0xff
    tmp = Math.floor(tmp / 256)
  }
  const hmac = createHmac('sha1', keyBytes).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STEP_TIMEOUT = 20_000 // 20s per step

/** Delay helper */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Execute JS in webContents and return the result.
 * Wraps executeJavaScript with a timeout.
 */
async function exec(wc: WebContents, code: string, timeout = 5000): Promise<unknown> {
  return Promise.race([
    wc.executeJavaScript(code),
    new Promise((_, reject) => setTimeout(() => reject(new Error('exec timeout')), timeout))
  ])
}

// ---------------------------------------------------------------------------
// Injected DOM helpers (stringified, run inside the page context)
// ---------------------------------------------------------------------------

const INJECT_SET_NATIVE_VALUE = `
function __setNativeValue(el, value) {
  el.focus();
  var proto = Object.getPrototypeOf(el);
  var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
`

// ---------------------------------------------------------------------------
// GitHub Auto-Fill
// ---------------------------------------------------------------------------

const GH_TOTP_SELECTORS = [
  'input[name="app_totp"]',
  'input[name="otp"]',
  'input[name="sms_otp"]',
  'input#totp',
  'input#otp',
  'input[autocomplete="one-time-code"]',
  'input[type="text"][maxlength="6"]',
  'input[type="text"][inputmode="numeric"]',
  'input[type="number"][maxlength="6"]'
]

async function githubFillLogin(wc: WebContents, creds: OAuthCredentials): Promise<boolean> {
  const hasLogin = await exec(wc, `!!document.querySelector('#login_field')`)
  if (!hasLogin) return false

  await delay(800)
  await exec(wc, `
    ${INJECT_SET_NATIVE_VALUE}
    __setNativeValue(document.querySelector('#login_field'), ${JSON.stringify(creds.username)});
    __setNativeValue(document.querySelector('#password'), ${JSON.stringify(creds.password)});
  `)
  await delay(500)
  await exec(wc, `
    var btn = document.querySelector('input[type="submit"][name="commit"]')
      || document.querySelector('button[type="submit"]');
    if (btn) btn.click();
    else { var f = document.querySelector('form[action="/session"]'); if (f) f.submit(); }
  `)
  return true
}

async function githubFill2FA(wc: WebContents, totpSecret: string): Promise<boolean> {
  const selectorList = JSON.stringify(GH_TOTP_SELECTORS)
  const has2FA = await exec(wc, `
    (function() {
      var url = location.href;
      if (url.includes('/sessions/two-factor') || url.includes('/two_factor') || url.includes('/2fa')) return true;
      var sels = ${selectorList};
      for (var i = 0; i < sels.length; i++) { if (document.querySelector(sels[i])) return true; }
      return false;
    })()
  `)
  if (!has2FA) return false

  // 等待 2FA 页面完全就绪，避免过早填值触发空值 verify
  await delay(2000)
  const code = generateTOTP(totpSecret)

  await exec(wc, `
    ${INJECT_SET_NATIVE_VALUE}
    var sels = ${selectorList};
    var input = null;
    for (var i = 0; i < sels.length; i++) { input = document.querySelector(sels[i]); if (input) break; }
    if (input) __setNativeValue(input, ${JSON.stringify(code)});
  `)
  await delay(500)
  await exec(wc, `
    var submitted = false;
    var btnSels = ['button[type="submit"]', 'input[type="submit"]', 'button.btn-primary', 'button[data-signin-label]'];
    for (var i = 0; i < btnSels.length; i++) {
      var b = document.querySelector(btnSels[i]);
      if (b) { b.click(); submitted = true; break; }
    }
    if (!submitted) { var f = document.querySelector('form'); if (f) f.submit(); }
  `)
  return true
}

// ---------------------------------------------------------------------------
// Google Auto-Fill
// ---------------------------------------------------------------------------

async function googleFillEmail(wc: WebContents, email: string): Promise<boolean> {
  const debugInfo = await exec(wc, `
    JSON.stringify({
      url: location.href,
      hasEmailInput: !!document.querySelector('input[type="email"]'),
      hasPasswordInput: !!document.querySelector('input[type="password"]'),
      allInputTypes: Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, name: i.name, id: i.id })).slice(0, 15),
      bodyText: document.body?.innerText?.substring(0, 300) || ''
    })
  `)
  console.log('🔍 [autofill-debug] googleFillEmail check:', debugInfo)

  const hasEmail = await exec(wc, `
    (function() {
      var emailInput = document.querySelector('input[type="email"]') || document.querySelector('#identifierId');
      if (!emailInput) return false;
      // 排除隐藏的 password 字段（Google v3 登录页在邮箱步骤有 hiddenPassword）
      var visiblePwd = document.querySelector('input[type="password"]:not([name="hiddenPassword"])');
      return !visiblePwd;
    })()
  `)
  console.log('🔍 [autofill-debug] googleFillEmail hasEmail:', hasEmail)
  if (!hasEmail) return false

  await delay(800)
  await exec(wc, `
    ${INJECT_SET_NATIVE_VALUE}
    __setNativeValue(document.querySelector('input[type="email"]'), ${JSON.stringify(email)});
  `)
  await delay(500)
  await exec(wc, `
    var btn = document.querySelector('#identifierNext button')
      || document.querySelector('#identifierNext')
      || document.querySelector('button[type="button"]');
    if (btn) btn.click();
  `)
  return true
}

async function googleFillPassword(wc: WebContents, password: string): Promise<boolean> {
  const debugInfo = await exec(wc, `
    JSON.stringify({
      url: location.href,
      hasPasswordInput: !!document.querySelector('input[type="password"]'),
      allInputTypes: Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, name: i.name, id: i.id })).slice(0, 15)
    })
  `)
  console.log('🔍 [autofill-debug] googleFillPassword check:', debugInfo)

  const hasPwd = await exec(wc, `
    (function() {
      // 排除 Google 邮箱步骤的 hiddenPassword
      var pwd = document.querySelector('input[type="password"]:not([name="hiddenPassword"])');
      if (!pwd) return false;
      // 确认可见（offsetParent !== null 或 getComputedStyle 检查）
      var style = window.getComputedStyle(pwd);
      return style.display !== 'none' && style.visibility !== 'hidden' && pwd.offsetParent !== null;
    })()
  `)
  console.log('🔍 [autofill-debug] googleFillPassword hasPwd:', hasPwd)
  if (!hasPwd) return false

  await delay(800)
  await exec(wc, `
    ${INJECT_SET_NATIVE_VALUE}
    __setNativeValue(document.querySelector('input[type="password"]:not([name="hiddenPassword"])'), ${JSON.stringify(password)});
  `)
  await delay(500)
  await exec(wc, `
    var btn = document.querySelector('#passwordNext button')
      || document.querySelector('#passwordNext')
      || document.querySelector('button[type="button"]');
    if (btn) btn.click();
  `)
  return true
}

async function googleFill2FA(wc: WebContents, totpSecret: string): Promise<boolean> {
  const debugInfo = await exec(wc, `
    JSON.stringify({
      url: location.href,
      hasTelPin: !!document.querySelector('input[type="tel"][name="Pin"]'),
      hasTotpPin: !!document.querySelector('input[type="tel"]#totpPin'),
      hasTotpName: !!document.querySelector('input[name="totpPin"]'),
      hasTelAria: !!document.querySelector('input[type="tel"][aria-label]'),
      hasPassword: !!document.querySelector('input[type="password"]'),
      allInputTypes: Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, name: i.name, id: i.id })).slice(0, 15)
    })
  `)
  console.log('🔍 [autofill-debug] googleFill2FA check:', debugInfo)

  const has2FA = await exec(wc, `
    (function() {
      // v3: input[type="tel"][name="Pin"]
      // v2: input[type="tel"]#totpPin / input[name="totpPin"] / input[type="tel"][aria-label]
      var input = document.querySelector('input[type="tel"][name="Pin"]')
        || document.querySelector('input[type="tel"]#totpPin')
        || document.querySelector('input[name="totpPin"]')
        || document.querySelector('input[type="tel"][aria-label]');
      if (!input) return false;
      var visiblePwd = document.querySelector('input[type="password"]:not([name="hiddenPassword"])');
      return !visiblePwd;
    })()
  `)
  if (!has2FA) return false

  // 等待 2FA 页面完全就绪，避免过早填值触发空值 verify
  await delay(2000)
  const code = generateTOTP(totpSecret)

  await exec(wc, `
    ${INJECT_SET_NATIVE_VALUE}
    var input = document.querySelector('input[type="tel"][name="Pin"]')
      || document.querySelector('input[type="tel"]#totpPin')
      || document.querySelector('input[name="totpPin"]')
      || document.querySelector('input[type="tel"]');
    if (input) __setNativeValue(input, ${JSON.stringify(code)});
  `)
  await delay(500)
  await exec(wc, `
    var btn = document.querySelector('#totpNext button')
      || document.querySelector('#totpNext')
      || document.querySelector('button[jsname]')
      || document.querySelector('button[type="button"]');
    if (btn) btn.click();
  `)
  return true
}

// ---------------------------------------------------------------------------
// Main entry — startAutoFill
// ---------------------------------------------------------------------------

/**
 * Start auto-fill on an OAuth BrowserWindow's webContents.
 *
 * Listens to `did-navigate` + `dom-ready` to detect page transitions,
 * then runs the appropriate fill step. Each step has a 20s timeout.
 * On failure the window stays open so the user can complete manually.
 */
export function startAutoFill(
  webContents: WebContents,
  provider: 'Github' | 'Google',
  credentials: OAuthCredentials
): void {
  let loginDone = false
  let twofaDone = false
  let destroyed = false

  const log = (msg: string) => console.log(`[oauth-autofill][${provider}] ${msg}`)

  webContents.on('destroyed', () => {
    destroyed = true
  })

  const handlePage = async (): Promise<void> => {
    if (destroyed) return

    const currentUrl = await exec(webContents, 'location.href').catch(() => 'unknown')
    log(`🔍 [autofill-debug] handlePage called | url=${currentUrl} | loginDone=${loginDone} | twofaDone=${twofaDone}`)

    try {
      if (provider === 'Github') {
        // Step 1: Login
        if (!loginDone) {
          const filled = await withTimeout(githubFillLogin(webContents, credentials), STEP_TIMEOUT)
          if (filled) {
            loginDone = true
            log('login filled & submitted')
            return
          }
        }
        // Step 2: 2FA
        if (loginDone && !twofaDone && credentials.totpSecret) {
          const filled = await withTimeout(githubFill2FA(webContents, credentials.totpSecret), STEP_TIMEOUT)
          if (filled) {
            twofaDone = true
            log('2FA filled & submitted')
            return
          }
          // Retry once after 1500ms
          await delay(1500)
          if (destroyed) return
          const retried = await withTimeout(githubFill2FA(webContents, credentials.totpSecret), STEP_TIMEOUT)
          if (retried) {
            twofaDone = true
            log('2FA filled on retry')
          }
        }
      } else {
        // Google: email → password → 2FA (sequential steps across navigations)
        if (!loginDone) {
          const emailFilled = await withTimeout(googleFillEmail(webContents, credentials.username), STEP_TIMEOUT)
          if (emailFilled) {
            log('email filled & submitted')
            return // wait for next navigation to fill password
          }
          const pwdFilled = await withTimeout(googleFillPassword(webContents, credentials.password), STEP_TIMEOUT)
          if (pwdFilled) {
            loginDone = true
            log('password filled & submitted')
            return
          }
        }
        if (loginDone && !twofaDone && credentials.totpSecret) {
          const filled = await withTimeout(googleFill2FA(webContents, credentials.totpSecret), STEP_TIMEOUT)
          if (filled) {
            twofaDone = true
            log('2FA filled & submitted')
            return
          }
          await delay(1500)
          if (destroyed) return
          const retried = await withTimeout(googleFill2FA(webContents, credentials.totpSecret), STEP_TIMEOUT)
          if (retried) {
            twofaDone = true
            log('2FA filled on retry')
          }
        }
      }
    } catch (err) {
      log(`error: ${err}`)
      // Don't close window — let user complete manually
    }
  }

  // Listen for page transitions
  webContents.on('did-navigate', (_event, url) => {
    log(`🔍 [autofill-debug] did-navigate: ${url}`)
    // Longer delay for 2FA pages to fully render before attempting fill
    setTimeout(() => handlePage(), 1200)
  })
  webContents.on('dom-ready', () => {
    const url = webContents.getURL()
    log(`🔍 [autofill-debug] dom-ready: ${url}`)
    setTimeout(() => handlePage(), 1200)
  })
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('step timeout')), ms))
  ])
}
