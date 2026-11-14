/**
 * Fail-visible boot.
 *
 * The game is a WebGL2 app wrapped in an Android WebView. When boot fails there
 * the user gets a black screen and no clue why — which is exactly what happened
 * with 1.0.1 on Samsung devices. Every failure path now paints a readable card
 * instead of leaving an empty page.
 *
 * Deliberately dependency-free and written to plain ES5-safe JS: this module is
 * imported first, so it must not rely on anything the game itself provides (no
 * CSS class names, no THREE, no UI instance).
 */

/**
 * Thrown when boot cannot continue but the reason has already been shown to the
 * player. Carrying a marker lets the guard (and the build check) tell a handled
 * failure apart from an unexpected one. This is a real Error so stack/message
 * handling stays normal.
 */
export class BootAbort extends Error {
  constructor(cause) {
    super('boot aborted: ' + (cause && cause.message ? cause.message : String(cause)));
    this.name = 'BootAbort';
    this.__bootAborted = true;
    this.cause = cause;
  }
}

let shown = false;

/** Cheap capability probe used before constructing the renderer. */
export function probeWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, reason: 'WebGL 2 is not available' };
    // a context that creates but cannot compile is just as fatal
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
    gl.compileShader(vs);
    const okCompile = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
    gl.deleteShader(vs);
    if (!okCompile) return { ok: false, reason: 'WebGL 2 shaders will not compile' };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'WebGL 2 threw: ' + (e && e.message ? e.message : String(e)) };
  }
}

/**
 * Paint a readable error card. Safe to call repeatedly; later calls replace the
 * text so the most specific message wins.
 *
 * @param {string} title   one-line heading
 * @param {string} detail  explanation / remediation
 * @param {string} [code]  raw error text for support
 */
export function showFatal(title, detail, code) {
  shown = true;
  const text = { title, detail, code };
  try {
    window.__bootError = text;
  } catch {
    /* ignore */
  }

  const paint = () => {
    let el = document.getElementById('boot-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'boot-error';
      // inline styles: the stylesheet may be the thing that failed to load
      el.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:min(6vw,40px)', 'box-sizing:border-box',
        'background:radial-gradient(120% 120% at 50% 0%,#152844,#070a11 62%,#03050a)',
        'color:#e8ecf5', 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'text-align:left', 'overflow:auto', '-webkit-user-select:text', 'user-select:text',
      ].join(';'));
      el.innerHTML = [
        '<div style="max-width:620px;width:100%">',
        '<div style="font-size:13px;letter-spacing:.34em;color:#ffc247;font-weight:700;margin-bottom:14px">LOS SANTOS</div>',
        '<div id="be-title" style="font-size:20px;font-weight:700;line-height:1.3;margin-bottom:10px"></div>',
        '<div id="be-detail" style="font-size:14px;line-height:1.6;opacity:.82;white-space:pre-wrap"></div>',
        '<div id="be-code" style="display:none;margin-top:16px;padding:11px 13px;border-radius:8px;background:#0006;border:1px solid #ffffff1f;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;color:#9fb0c8;white-space:pre-wrap;word-break:break-word"></div>',
        '<button id="be-retry" style="margin-top:20px;padding:11px 20px;border-radius:9px;border:0;cursor:pointer;font:inherit;font-size:13px;font-weight:700;letter-spacing:.14em;background:linear-gradient(135deg,#ffc247,#ff7a45);color:#10131a">TRY AGAIN</button>',
        '</div>',
      ].join('');
      document.body.appendChild(el);
      const retry = el.querySelector('#be-retry');
      if (retry) retry.addEventListener('click', () => location.reload());
    }
    const t = el.querySelector('#be-title');
    const d = el.querySelector('#be-detail');
    const c = el.querySelector('#be-code');
    if (t) t.textContent = text.title;
    if (d) d.textContent = text.detail;
    if (c) {
      if (text.code) {
        c.style.display = 'block';
        c.textContent = String(text.code).slice(0, 900);
      } else {
        c.style.display = 'none';
      }
    }
    // The loading overlay sits at z-index 50 and would fight the card.
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
  };

  if (document.body) paint();
  else document.addEventListener('DOMContentLoaded', paint, { once: true });
}

export function hasShownFatal() {
  return shown;
}

/** Turn any throwable into a short human string. */
export function describe(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.stack || err.message || String(err);
}

/**
 * Translate a low-level failure into advice a player can act on.
 * Returns { title, detail }.
 */
export function humanize(err) {
  const raw = describe(err);
  const low = raw.toLowerCase();

  if (low.includes('webgl') || low.includes('context')) {
    return {
      title: 'This device could not start 3D graphics',
      detail: 'Los Santos needs WebGL 2. Try closing other apps and reopening, '
        + 'or enable hardware acceleration / disable battery saver for this app.',
    };
  }
  if (low.includes('out of memory') || low.includes('allocation failed') || low.includes('outofmemory')) {
    return {
      title: 'Ran out of memory while loading the city',
      detail: 'Close other apps to free RAM, then reopen Los Santos. '
        + 'If it keeps happening, lower the Graphics setting on the menu.',
    };
  }
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')) {
    return {
      title: 'A game file could not be loaded',
      detail: 'The bundled assets are missing or unreadable. Reinstall the app, '
        + 'or re-download the APK if you side-loaded it.',
    };
  }
  if (low.includes('invalid url') || low.includes('syntaxerror') || low.includes('unexpected token')) {
    return {
      title: 'The game bundle is damaged',
      detail: 'A script failed to parse or referenced a bad URL, so the game could not '
        + 'start. Reinstall Los Santos. If you are a developer, re-run `npm run build` '
        + 'and `npm run check:html`.',
    };
  }
  if (low.includes('module') || low.includes('import') || low.includes('mime')) {
    return {
      title: 'A game script failed to load',
      detail: 'The app could not execute its JavaScript bundle. '
        + 'Update "Android System WebView" and "Chrome" from the Play Store, then reopen.',
    };
  }
  return {
    title: 'Los Santos could not start',
    detail: 'Something failed during start-up. Try reopening the app; '
      + 'if it persists, update Android System WebView and Chrome.',
  };
}
