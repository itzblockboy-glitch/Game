/**
 * HUD + menus. Everything is DOM over the canvas so the WebGL loop stays untouched.
 */
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.panels = {};
    this.toastQueue = [];
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="hud-top-left">
          <div class="location"><span id="loc-name">LOS SANTOS</span><small id="loc-sub">VINEWOOD · 10:30</small></div>
        </div>

        <div class="hud-top-right">
          <div class="pill" id="net-pill"><span class="dot"></span><span id="net-label">offline</span></div>
          <div class="pill small" id="fps-pill">-- fps</div>
          <div class="pill small" id="room-pill">ROOM —</div>
        </div>

        <div class="hud-bottom-right">
          <div class="minimap-wrap">
            <canvas id="minimap" width="200" height="200"></canvas>
            <div class="compass">N</div>
            <div class="clock" id="game-clock">10:30</div>
          </div>
          <div class="data-meter" id="data-meter">
            <div class="dm-row"><span>NET</span><b id="dm-rate">0 kb/s</b></div>
            <div class="dm-row"><span>CACHE</span><b id="dm-saved">0%</b></div>
            <div class="dm-row tiny"><span>assets</span><b id="dm-total">0 MB</b></div>
            <div class="dm-bar"><i id="dm-fill"></i></div>
            <div class="dm-row tiny"><span>ping</span><b id="dm-ping">--</b></div>
            <div class="dm-row tiny"><span>voice</span><b id="dm-voice">off</b></div>
            <div class="dm-row tiny"><span>tris</span><b id="dm-tris">0</b></div>
          </div>
        </div>

        <div class="hud-bottom-left">
          <div class="vitals">
            <div class="bar hp"><i id="hp-fill"></i><span id="hp-num">100</span></div>
            <div class="bar ar"><i id="ar-fill"></i><span id="ar-num">0</span></div>
          </div>
        </div>

        <div class="weapon-wheel hidden" id="weapon-wheel">
          <div class="ww-title">WEAPONS</div>
          <div class="ww-list">
            <div class="ww-item" data-w="fists"><b>1</b><span>Fists</span></div>
            <div class="ww-item" data-w="weapon_g17_handgun"><b>2</b><span>G17</span></div>
            <div class="ww-item" data-w="weapon_pp19_vityaz"><b>3</b><span>Vityaz</span></div>
            <div class="ww-item" data-w="weapon_akmn_rifle"><b>4</b><span>AKMN</span></div>
          </div>
        </div>

        <div class="crosshair" id="crosshair"><i></i><i></i><i></i><i></i></div>
        <div class="amy" id="amy"></div>

        <div class="speedo hidden" id="speedo">
          <div class="sp-num" id="sp-num">0</div>
          <div class="sp-unit">km/h</div>
          <div class="sp-name" id="sp-name">VEHICLE</div>
          <div class="sp-hint" id="sp-hint">[F] exit</div>
        </div>

        <div class="vehicle-hud hidden" id="veh-hud">
          <div class="vh-name" id="vh-name">Police Cruiser</div>
          <div class="vh-hint" id="vh-hint">W/S throttle · A/D steer · Space handbrake · R siren</div>
        </div>

        <div class="chat-log" id="chat-log"></div>
        <div class="chat-input hidden" id="chat-input-wrap">
          <span>Say:</span><input id="chat-input" maxlength="140" autocomplete="off" />
        </div>

        <div class="subtitle" id="subtitle"></div>
        <div class="toasts" id="toasts"></div>
        <div class="voice-peers" id="voice-peers"></div>
        <div class="prompt hidden" id="prompt"></div>

        <div class="touch" id="touch">
          <div class="stick" id="stick"><div class="knob" id="knob"></div></div>
          <div class="btns">
            <button class="tbtn" data-act="attack">FIRE</button>
            <button class="tbtn" data-act="jump">JUMP</button>
            <button class="tbtn" data-act="interact">USE</button>
            <button class="tbtn" data-act="sprint">RUN</button>
            <button class="tbtn" data-act="aim">AIM</button>
            <button class="tbtn" data-act="voice">MIC</button>
          </div>
        </div>

        <div class="top-actions">
          <button class="ghost" id="btn-menu">MENU</button>
          <button class="ghost" id="btn-assets">ASSETS</button>
          <button class="ghost" id="btn-photo">PHOTO</button>
        </div>
      </div>

      <div id="loading" class="overlay">
        <div class="load-inner">
          <div class="logo">LOS <span>SANTOS</span></div>
          <div class="logo-sub">STREETS · SUNSET · SIXTY FPS</div>
          <div class="load-bar"><i id="load-fill"></i></div>
          <div class="load-text" id="load-text">Booting engine…</div>
          <div class="load-tips" id="load-tip">Tip: press H for the full control list</div>
        </div>
      </div>

      <div id="menu" class="overlay hidden">
        <div class="menu-card">
          <div class="logo small">LOS <span>SANTOS</span></div>
          <div class="menu-grid">
            <label>Player name <input id="input-name" maxlength="16" placeholder="Rider" /></label>
            <label>Room code <input id="input-room" maxlength="8" placeholder="PUBLIC" /></label>
            <div class="menu-row">
              <button id="btn-play" class="primary">PLAY SOLO</button>
              <button id="btn-multi" class="accent">PLAY WITH FRIENDS</button>
            </div>
            <div class="menu-row">
              <button id="btn-voice" class="ghost wide">🎙 VOICE CHAT: OFF</button>
            </div>
            <div class="menu-settings">
              <label class="slider">Graphics
                <input type="range" id="set-quality" min="0" max="2" value="1" step="1" />
                <span id="quality-label">Balanced</span>
              </label>
              <label class="check"><input type="checkbox" id="set-datasaver" checked /> Ultra Data Saver (mobile)</label>
              <label class="check"><input type="checkbox" id="set-ptt" /> Push-to-talk (hold V)</label>
              <label class="check"><input type="checkbox" id="set-shadows" checked /> Soft shadows</label>
            </div>
            <div class="menu-links">
              <button class="link" id="btn-share">Copy invite link</button>
              <button class="link" id="btn-hub">Sketchfab Asset Hub</button>
              <button class="link" id="btn-controls">Controls</button>
              <button class="link" id="btn-map">Stunt Map</button>
            </div>
            <p class="tiny-note">28 GLB assets · Opus voice @16 kbps · binary netcode @15 Hz</p>
          </div>
        </div>
      </div>

      <div id="controls" class="overlay hidden">
        <div class="menu-card wide-card">
          <h2>Controls</h2>
          <div class="cols">
            <div>
              <h3>On foot</h3>
              <p><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint</p>
              <p><kbd>Space</kbd> jump · <kbd>Mouse</kbd> look</p>
              <p><kbd>Left click</kbd> punch / shoot</p>
              <p><kbd>Right click</kbd> aim · <kbd>R</kbd> reload</p>
              <p><kbd>1-4</kbd> fists · G17 · Vityaz · AKMN</p>
              <p><kbd>Q</kbd> weapon wheel · <kbd>H</kbd> help</p>
              <p><kbd>F</kbd> enter / exit vehicle</p>
              <p><kbd>V</kbd> push-to-talk (voice)</p>
            </div>
            <div>
              <h3>Driving</h3>
              <p><kbd>W</kbd>/<kbd>S</kbd> throttle · brake</p>
              <p><kbd>A</kbd>/<kbd>D</kbd> steer</p>
              <p><kbd>Space</kbd> handbrake drift</p>
              <p><kbd>Shift</kbd> boost · <kbd>R</kbd> siren</p>
              <h3>Flight</h3>
              <p><kbd>W</kbd> throttle · <kbd>S</kbd> idle</p>
              <p><kbd>A</kbd>/<kbd>D</kbd> bank · <kbd>↑</kbd>/<kbd>↓</kbd> climb</p>
              <p><kbd>C</kbd> cockpit view (KA350)</p>
              <h3>Menus</h3>
              <p><kbd>Esc</kbd> pause · <kbd>P</kbd> photo mode</p>
              <p><kbd>T</kbd> cyclic time of day</p>
            </div>
          </div>
          <button class="primary" id="btn-controls-close">Got it</button>
        </div>
      </div>

      <div id="hub" class="overlay hidden">
        <div class="menu-card wide-card">
          <h2>Sketchfab Asset Hub <span class="tag">28 links mapped</span></h2>
          <p class="hub-note">Every element in the game is a separate <code>.glb</code>. Drop a downloaded
          Sketchfab <code>.glb</code> onto a card to hot-swap it live, or paste a direct model URL.</p>
          <div class="drop-zone" id="drop-zone">Drop a .glb here — or click to pick a file</div>
          <input type="file" id="file-glb" accept=".glb" class="hidden" />
          <div class="hub-grid" id="hub-grid"></div>
          <button class="primary" id="btn-hub-close">Close</button>
        </div>
      </div>

      <div id="pause" class="overlay hidden">
        <div class="menu-card">
          <div class="logo small">PAUSED</div>
          <div class="menu-row"><button id="btn-resume" class="primary">RESUME</button></div>
          <div class="menu-row"><button id="btn-pause-hub" class="ghost wide">Asset Hub</button></div>
          <div class="menu-row"><button id="btn-pause-menu" class="ghost wide">Back to menu</button></div>
          <p class="tiny-note" id="pause-stats"></p>
        </div>
      </div>

      <div id="photo-frame" class="photo-frame hidden"></div>
    `;

    const $ = (id) => this.root.querySelector(`#${id}`);
    this.el = {
      hud: $('hud'),
      minimap: $('minimap'),
      locName: $('loc-name'),
      locSub: $('loc-sub'),
      netPill: $('net-pill'),
      netLabel: $('net-label'),
      fpsPill: $('fps-pill'),
      roomPill: $('room-pill'),
      dmRate: $('dm-rate'),
      dmSaved: $('dm-saved'),
      dmFill: $('dm-fill'),
      dmPing: $('dm-ping'),
      dmVoice: $('dm-voice'),
      dmTris: $('dm-tris'),
      dmTotal: $('dm-total'),
      hpFill: $('hp-fill'),
      hpNum: $('hp-num'),
      arFill: $('ar-fill'),
      arNum: $('ar-num'),
      crosshair: $('crosshair'),
      amy: $('amy'),
      speedo: $('speedo'),
      spNum: $('sp-num'),
      spName: $('sp-name'),
      spHint: $('sp-hint'),
      vehHud: $('veh-hud'),
      vhName: $('vh-name'),
      vhHint: $('vh-hint'),
      chatLog: $('chat-log'),
      chatWrap: $('chat-input-wrap'),
      chatInput: $('chat-input'),
      toasts: $('toasts'),
      voicePeers: $('voice-peers'),
      prompt: $('prompt'),
      touch: $('touch'),
      stick: $('stick'),
      knob: $('knob'),
      loading: $('loading'),
      loadFill: $('load-fill'),
      loadText: $('load-text'),
      menu: $('menu'),
      controls: $('controls'),
      hub: $('hub'),
      hubGrid: $('hub-grid'),
      pause: $('pause'),
      pauseStats: $('pause-stats'),
      photoFrame: $('photo-frame'),
      weaponWheel: $('weapon-wheel'),
      gameClock: $('game-clock'),
      subtitle: $('subtitle'),
      inputName: $('input-name'),
      inputRoom: $('input-room'),
      btnVoice: $('btn-voice'),
      loadTip: $('load-tip'),
      qualityLabel: $('quality-label'),
      qualitySlider: $('set-quality'),
      fileGlb: $('file-glb'),
      dropZone: $('drop-zone'),
    };
  }

  // ------------------------------------------------------------ loading
  setLoading(pct, text) {
    if (this.el.loadFill) this.el.loadFill.style.width = `${Math.round(pct * 100)}%`;
    if (text && this.el.loadText) this.el.loadText.textContent = text;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
    setTimeout(() => this.el.loading.remove(), 700);
  }

  showMenu(show = true) {
    this.el.menu.classList.toggle('hidden', !show);
    this.el.hud.classList.toggle('hidden', show || this.el.hud.dataset.ready !== '1');
  }

  showHUD(show = true) {
    this.el.hud.classList.toggle('hidden', !show);
    if (show) this.el.hud.dataset.ready = '1';
  }

  togglePause(show, statsText = '') {
    this.el.pause.classList.toggle('hidden', !show);
    if (show && statsText) this.el.pauseStats.textContent = statsText;
  }

  toggleControls(show) {
    this.el.controls.classList.toggle('hidden', !show);
  }

  toggleHub(show) {
    this.el.hub.classList.toggle('hidden', !show);
  }

  setCrosshairVisible(v) {
    this.el.crosshair.style.opacity = v ? '1' : '0';
  }

  setWeaponWheel(show) {
    this.el.weaponWheel.classList.toggle('hidden', !show);
  }

  highlightWeapon(id) {
    for (const item of this.el.weaponWheel.querySelectorAll('.ww-item')) {
      item.classList.toggle('active', item.dataset.w === id);
    }
  }

  // ------------------------------------------------------------ HUD values
  setVitals(hp, armor) {
    this.el.hpFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    this.el.hpNum.textContent = Math.round(hp);
    this.el.arFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    this.el.arNum.textContent = Math.round(armor);
  }

  setAmmo(text) {
    this.el.amy.textContent = text || '';
  }

  setSpeed(kmh, name, hint) {
    this.el.spNum.textContent = Math.round(kmh);
    if (name !== undefined) this.el.spName.textContent = name;
    if (hint !== undefined) this.el.spHint.textContent = hint;
  }

  showSpeedo(show) {
    this.el.speedo.classList.toggle('hidden', !show);
    this.el.vehHud.classList.toggle('hidden', !show);
  }

  setVehicleHUd(name, hint) {
    this.el.vhName.textContent = name;
    this.el.vhHint.textContent = hint;
  }

  setTime(str) {
    this.el.gameClock.textContent = str;
  }

  setLocation(name, sub) {
    if (name) this.el.locName.textContent = name;
    if (sub) this.el.locSub.textContent = sub;
  }

  setNet({ connected, latency, players, room }) {
    if (connected !== undefined) {
      this.el.netPill.classList.toggle('online', !!connected);
      this.el.netLabel.textContent = connected ? `${Math.max(1, players ?? 1)} online` : 'solo';
    } else if (players !== undefined && this.el.netPill.classList.contains('online')) {
      this.el.netLabel.textContent = `${Math.max(1, players)} online`;
    }
    if (room) this.el.roomPill.textContent = `ROOM ${room}`;
    if (latency !== undefined) this.el.dmPing.textContent = `${latency} ms`;
  }

  setDataSaver({ rateKbps, savedPct, tris, voice, totalKb }) {
    if (rateKbps !== undefined) this.el.dmRate.textContent = `${rateKbps.toFixed(1)} kb/s`;
    if (totalKb !== undefined && this.el.dmTotal) this.el.dmTotal.textContent = `${(totalKb / 1024).toFixed(1)} MB`;
    if (savedPct !== undefined) {
      this.el.dmSaved.textContent = `${Math.round(savedPct)}%`;
      this.el.dmFill.style.width = `${Math.min(100, savedPct)}%`;
    }
    if (tris !== undefined) this.el.dmTris.textContent = `${(tris / 1000).toFixed(0)}k`;
    if (voice !== undefined) this.el.dmVoice.textContent = voice;
  }

  setFps(fps) {
    this.el.fpsPill.textContent = `${Math.round(fps)} fps`;
    this.el.fpsPill.style.color = fps > 52 ? '#7CFC9A' : fps > 34 ? '#ffd166' : '#ff6b6b';
  }

  // ------------------------------------------------------------ chat / toasts
  chat(from, text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<b>${escapeHTML(from)}</b> ${escapeHTML(text)}`;
    this.el.chatLog.appendChild(line);
    while (this.el.chatLog.children.length > 7) this.el.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 12000);
  }

  systemChat(text) {
    const line = document.createElement('div');
    line.className = 'chat-line sys';
    line.textContent = text;
    this.el.chatLog.appendChild(line);
    while (this.el.chatLog.children.length > 7) this.el.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 9000);
  }

  openChat() {
    this.el.chatWrap.classList.remove('hidden');
    this.el.chatInput.focus();
  }

  closeChat() {
    this.el.chatWrap.classList.add('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.blur();
  }

  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 400);
    }, 2600);
  }

  subtitle(text, ms = 2600) {
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('in');
    clearTimeout(this._subT);
    this._subT = setTimeout(() => this.el.subtitle.classList.remove('in'), ms);
  }

  setPrompt(text) {
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.textContent = text;
  }

  setVoicePeers(list) {
    this.el.voicePeers.innerHTML = list
      .map(
        (p) =>
          `<div class="vp ${p.speaking ? 'speaking' : ''}"><span class="vp-dot"></span>${escapeHTML(p.name)}${
            p.muted ? ' 🔇' : ''
          }</div>`
      )
      .join('');
  }

  // ------------------------------------------------------------ minimap
  drawMinimap(player, vehicles, others, world) {
    const cv = this.el.minimap;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const RANGE = 190;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    // rotate so player faces up
    ctx.rotate(-player.yaw);
    const s = W / (RANGE * 2);
    const px = -player.x * s;
    const pz = -player.z * s;

    // water / land
    ctx.fillStyle = '#0d3550';
    ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.fillStyle = '#2b3b2c';
    ctx.fillRect(-W * 0.5 - 40 * s + px, -H, W * 1.4, H * 2);

    // roads
    const GRID = 110;
    ctx.strokeStyle = 'rgba(200,205,215,0.28)';
    ctx.lineWidth = Math.max(1.5, 22 * s);
    const range = RANGE;
    const minGX = Math.floor((player.x - range) / GRID);
    const maxGX = Math.ceil((player.x + range) / GRID);
    for (let i = minGX; i <= maxGX; i++) {
      const gx = (i * GRID - player.x) * s;
      ctx.beginPath();
      ctx.moveTo(gx, -H);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    const minGZ = Math.floor((player.z - range) / GRID);
    const maxGZ = Math.ceil((player.z + range) / GRID);
    for (let i = minGZ; i <= maxGZ; i++) {
      const gz = (i * GRID - player.z) * s;
      ctx.beginPath();
      ctx.moveTo(-H, gz);
      ctx.lineTo(H, gz);
      ctx.stroke();
    }

    // buildings
    if (world?.colliders?.length) {
      ctx.fillStyle = 'rgba(120,130,145,0.55)';
      for (const c of world.colliders) {
        if (Math.abs(c.x - player.x) > range + 40 || Math.abs(c.z - player.z) > range + 40) continue;
        const x = (c.x - player.x) * s;
        const z = (c.z - player.z) * s;
        const w = Math.max(1.4, c.w * 2 * s);
        const d = Math.max(1.4, c.d * 2 * s);
        ctx.fillRect(x - w / 2, z - d / 2, w, d);
      }
    }

    // vehicles
    ctx.fillStyle = '#79d5ff';
    for (const v of vehicles) {
      const x = (v.position.x - player.x) * s;
      const z = (v.position.z - player.z) * s;
      if (Math.hypot(x, z) > W * 0.52) continue;
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(-v.yaw);
      ctx.fillRect(-2, -3.4, 4, 7);
      ctx.restore();
    }
    // other players
    ctx.fillStyle = '#ffb347';
    for (const o of others) {
      const x = (o.x - player.x) * s;
      const z = (o.z - player.z) * s;
      if (Math.hypot(x, z) > W * 0.52) continue;
      ctx.beginPath();
      ctx.arc(x, z, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // player arrow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  buildHubCards(models, onSwap, onSelect) {
    this.el.hubGrid.innerHTML = models
      .map(
        (m) => `
      <div class="hub-card" data-id="${m.id}">
        <div class="hc-top"><span class="hc-kind ${m.kind}">${m.kind}</span><span class="hc-size">${(
          m.bytes / 1024
        ).toFixed(0)} KB</span></div>
        <div class="hc-title">${escapeHTML(m.title || m.id)}</div>
        <div class="hc-file">${m.file}</div>
        ${m.sketchfab ? `<a class="hc-link" href="${m.sketchfab}" target="_blank" rel="noopener">Sketchfab ↗</a>` : ''}
        <label class="hc-swap">swap <input type="file" accept=".glb" data-id="${m.id}" /></label>
      </div>`
      )
      .join('');
    this.el.hubGrid.querySelectorAll('input[type=file]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) onSwap(input.dataset.id, await file.arrayBuffer());
      });
    });
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
