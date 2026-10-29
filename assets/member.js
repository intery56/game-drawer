/* 게임 서랍 — 회원번호 발급 + 게임 저장 동기화
 *
 * 게임 페이지:  <script src="../assets/member.js" data-game="게임-id"></script>
 *   게임이 원래 쓰던 localStorage 저장을 그대로 두고, 바뀐 내용을 회원번호별로 서버에 올린다.
 *   다른 기기에서 접속하면 서버의 저장을 받아와 게임을 다시 연다.
 * 홈 페이지:   <script src="assets/member.js"></script>  → window.GameSite 로 회원 정보·이어하기 제공
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var GAME = (script && script.dataset.game) || null;
  var HOME = (script && script.dataset.home) || '../index.html';
  var CFG = window.GAME_SITE_CONFIG || {};
  var P = '__site:';
  var K = {
    member: P + 'member', code: P + 'code',
    keys: function (g) { return P + 'keys:' + g; },
    sync: function (g) { return P + 'sync:' + g; },
    dirty: function (g) { return P + 'dirty:' + g; },
    reload: function (g) { return P + 'reload:' + g; }
  };

  var proto = Storage.prototype, oSet = proto.setItem, oGet = proto.getItem, oRem = proto.removeItem, oClear = proto.clear, oKey = proto.key;
  var ls = null; try { ls = window.localStorage; } catch (e) {}
  var raw = {
    get: function (k) { try { return ls ? oGet.call(ls, k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (ls) oSet.call(ls, k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { if (ls) oRem.call(ls, k); } catch (e) {} },
    keys: function () { var a = []; try { for (var i = 0; i < ls.length; i++) a.push(oKey.call(ls, i)); } catch (e) {} return a; }
  };
  function jget(k, d) { try { var v = raw.get(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function isSys(k) { return k.indexOf(P) === 0 || k.indexOf('sb-') === 0 || k.indexOf('supabase') === 0; }

  /* ---------- 상태 ---------- */
  var listeners = [];
  var status = { state: 'starting', member: jget(K.member, null), code: jget(K.code, null), error: null };
  function setStatus(p) {
    for (var k in p) status[k] = p[k];
    listeners.forEach(function (f) { try { f(status); } catch (e) {} });
    renderBadge();
  }

  /* ---------- 서버 연결 ---------- */
  var configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  var sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-game-site-auth' }
      });
    } catch (e) { sb = null; }
  }

  async function ensureSession() {
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) return s.data.session;
    var r = await sb.auth.signInAnonymously();
    if (r.error) throw r.error;
    return r.data.session;
  }
  async function ensureMember() {
    await ensureSession();
    var r = await sb.rpc('register_member');
    if (r.error) throw r.error;
    var no = Number(r.data.member_no);
    var prev = jget(K.member, null);
    raw.set(K.member, JSON.stringify(no));
    if (r.data.code) raw.set(K.code, JSON.stringify(r.data.code));
    setStatus({ member: no, code: jget(K.code, null) });
    return { no: no, changed: prev !== null && prev !== no };
  }

  /* ---------- 게임 페이지: 저장 감시 ---------- */
  var tracked = new Set(GAME ? jget(K.keys(GAME), []) : []);
  var wasDirty = GAME ? raw.get(K.dirty(GAME)) === '1' : false;   // 게임이 시작되기 전 상태
  var ready = false, suspended = false, member = null, timer = null, pushing = null, again = false, retryT = null;

  function saveTracked() { raw.set(K.keys(GAME), JSON.stringify(Array.from(tracked))); }
  function markDirty() { raw.set(K.dirty(GAME), '1'); if (ready) { setStatus({ state: 'saving' }); schedulePush(1500); } }

  if (GAME && ls) {
    proto.setItem = function (k, v) {
      if (this === ls) {
        k = String(k);
        if (!isSys(k)) {
          if (suspended) return;               // 서버 저장으로 교체하는 중에는 게임의 쓰기를 막음
          var r = oSet.call(this, k, v);
          if (!tracked.has(k)) { tracked.add(k); saveTracked(); }
          markDirty();
          return r;
        }
      }
      return oSet.call(this, k, v);
    };
    proto.removeItem = function (k) {
      if (this === ls) {
        k = String(k);
        if (!isSys(k)) { if (suspended) return; var r = oRem.call(this, k); if (tracked.has(k)) markDirty(); return r; }
      }
      return oRem.call(this, k);
    };
    proto.clear = function () {
      if (this !== ls) return oClear.call(this);
      if (suspended) return;
      raw.keys().forEach(function (k) { if (!isSys(k)) raw.del(k); });
      markDirty();
    };
  }

  function collect() {
    var d = {};
    tracked.forEach(function (k) { var v = raw.get(k); if (v != null) d[k] = v; });
    return d;
  }
  function applyRemote(data) {
    var changed = false;
    data = data || {};
    Object.keys(data).forEach(function (k) {
      if (isSys(k)) return;
      tracked.add(k);
      if (raw.get(k) !== data[k]) { raw.set(k, data[k]); changed = true; }
    });
    tracked.forEach(function (k) { if (!(k in data) && raw.get(k) != null) { raw.del(k); changed = true; } });
    saveTracked();
    raw.del(K.dirty(GAME));
    return changed;
  }
  function schedulePush(ms) { clearTimeout(timer); timer = setTimeout(push, ms); }

  function push() {
    if (!sb || member == null) return Promise.resolve();
    if (pushing) { again = true; return pushing; }
    clearTimeout(timer); clearTimeout(retryT);
    setStatus({ state: 'saving' });
    pushing = (async function () {
      try {
        raw.del(K.dirty(GAME));
        var r = await sb.from('game_saves')
          .upsert({ member_no: member, game: GAME, data: collect() }, { onConflict: 'member_no,game' })
          .select('updated_at').single();
        if (r.error) throw r.error;
        raw.set(K.sync(GAME), r.data.updated_at);
        setStatus({ state: raw.get(K.dirty(GAME)) === '1' ? 'saving' : 'saved', error: null, savedAt: Date.now() });
      } catch (e) {
        raw.set(K.dirty(GAME), '1');
        setStatus({ state: 'offline', error: String((e && e.message) || e) });
        retryT = setTimeout(push, 20000);
      } finally {
        pushing = null;
        if (again) { again = false; push(); }
      }
    })();
    return pushing;
  }

  async function startGameSync() {
    var m = await ensureMember();
    member = m.no;
    if (m.changed) { wasDirty = false; raw.del(K.sync(GAME)); }   // 다른 회원번호의 기록이면 서버 것을 따름
    var q = await sb.from('game_saves').select('data,updated_at').eq('member_no', member).eq('game', GAME).maybeSingle();
    if (q.error) throw q.error;
    var row = q.data;
    if (row && !wasDirty && row.updated_at !== raw.get(K.sync(GAME))) {
      suspended = true;
      var changed = applyRemote(row.data);
      raw.set(K.sync(GAME), row.updated_at);
      var last = 0; try { last = +sessionStorage.getItem(K.reload(GAME)) || 0; } catch (e) {}
      if (changed && Date.now() - last > 15000) {
        try { sessionStorage.setItem(K.reload(GAME), String(Date.now())); } catch (e) {}
        setStatus({ state: 'loading' });
        location.reload();
        return;
      }
      suspended = false;
    }
    ready = true;
    if (wasDirty || raw.get(K.dirty(GAME)) === '1' || (!row && tracked.size)) await push();
    else setStatus({ state: 'saved', error: null });
  }

  function flush() { if (ready && raw.get(K.dirty(GAME)) === '1') push(); }

  /* ---------- 시작 ---------- */
  var started;
  if (!configured) { started = Promise.resolve(); setStatus({ state: 'local' }); }
  else if (!sb) { started = Promise.resolve(); setStatus({ state: 'offline', error: '저장 서버 라이브러리를 불러오지 못했습니다' }); }
  else if (GAME) {
    started = startGameSync().catch(function (e) {
      ready = true; suspended = false;
      raw.set(K.dirty(GAME), '1');
      setStatus({ state: 'offline', error: String((e && e.message) || e) });
      retryT = setTimeout(function () { startGameSync().catch(function () {}); }, 20000);
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
  } else {
    started = ensureMember().then(function () { setStatus({ state: 'saved', error: null }); })
      .catch(function (e) { setStatus({ state: 'offline', error: String((e && e.message) || e) }); });
  }

  /* ---------- 다른 기기에서 이어하기 (홈) ---------- */
  async function link(no, code) {
    if (!sb) throw new Error('저장 서버가 연결되지 않았습니다');
    no = Number(String(no).replace(/\D/g, ''));
    code = String(code || '').trim().toUpperCase();
    if (!no || !code) throw new Error('회원번호와 이어하기 코드를 모두 입력하세요');
    await ensureSession();
    var r = await sb.rpc('link_member', { p_no: no, p_code: code });
    if (r.error) {
      var msg = r.error.message || '';
      if (msg.indexOf('too_many_attempts') >= 0) throw new Error('시도가 너무 많습니다. 1시간 뒤에 다시 해 주세요');
      if (msg.indexOf('invalid_code') >= 0) throw new Error('회원번호 또는 이어하기 코드가 맞지 않습니다');
      throw new Error('연결하지 못했습니다: ' + msg);
    }
    // 이 기기에 있던 다른 회원의 게임 기록을 지워, 다음에 게임을 열면 서버 기록을 받아오게 함
    raw.keys().forEach(function (k) {
      if (k.indexOf(P + 'keys:') === 0) {
        var g = k.slice((P + 'keys:').length);
        (jget(k, []) || []).forEach(function (gk) { raw.del(gk); });
        raw.del(k); raw.del(K.sync(g)); raw.del(K.dirty(g));
      }
    });
    raw.set(K.member, JSON.stringify(no));
    raw.set(K.code, JSON.stringify(code));
    setStatus({ member: no, code: code, state: 'saved', error: null });
    return no;
  }

  window.GameSite = {
    get status() { return status; },
    configured: configured,
    ready: function () { return started; },
    onStatus: function (f) { listeners.push(f); try { f(status); } catch (e) {} },
    link: link,
    flush: flush,
    savedGames: async function () {   // [{game, updated_at}] — 홈에서 '이어하기' 표시용
      if (!sb) return [];
      await started;
      if (status.member == null) return [];
      var r = await sb.from('game_saves').select('game,updated_at').eq('member_no', status.member);
      return r.error ? [] : (r.data || []);
    }
  };

  /* ---------- 게임 화면 모서리 표시 ---------- */
  var badgeRoot = null;
  var LABEL = { starting: '연결 중', loading: '기록 불러오는 중', saving: '저장 중', saved: '저장됨', offline: '오프라인 · 이 기기에 보관 중', local: '이 기기에만 저장' };
  function renderBadge() {
    if (!GAME || !badgeRoot) return;
    var no = status.member != null ? 'No.' + status.member : '';
    var dot = { saved: '#3bb273', saving: '#e0a526', loading: '#e0a526', starting: '#9aa0b4', offline: '#d9534f', local: '#9aa0b4' }[status.state] || '#9aa0b4';
    badgeRoot.querySelector('.no').textContent = no;
    badgeRoot.querySelector('.st').textContent = LABEL[status.state] || '';
    badgeRoot.querySelector('.dot').style.background = dot;
    badgeRoot.querySelector('.pill').title = status.error || '';
  }
  function mountBadge() {
    if (!GAME || badgeRoot) return;
    var host = document.createElement('div');
    host.setAttribute('data-game-site-badge', '');
    host.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483000;pointer-events:none';
    var sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = '<style>' +
      '.pill{pointer-events:auto;margin:0 0 calc(8px + env(safe-area-inset-bottom,0px)) calc(8px + env(safe-area-inset-left,0px));display:inline-flex;align-items:center;gap:7px;' +
      'font:600 11.5px/1 "IBM Plex Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;color:#eef0f8;background:rgba(22,25,40,.82);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:999px;padding:6px 10px 6px 6px;box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
      'a{color:inherit;text-decoration:none;background:rgba(255,255,255,.14);border-radius:999px;padding:4px 8px}a:hover{background:rgba(255,255,255,.24)}' +
      'a:focus-visible{outline:2px solid #8a99ff;outline-offset:2px}.dot{width:7px;height:7px;border-radius:50%;display:inline-block}' +
      '.no{font-variant-numeric:tabular-nums;opacity:.85}.pill.min .no,.pill.min .st{display:none}.tg{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px}' +
      '</style><div class="pill"><a href="' + HOME + '" aria-label="게임 서랍으로">← 서랍</a>' +
      '<button class="tg" type="button" aria-label="저장 상태 접기/펴기"><span class="dot"></span><span class="no"></span><span class="st"></span></button></div>';
    sh.querySelector('.tg').addEventListener('click', function () {
      var p = sh.querySelector('.pill'); p.classList.toggle('min');
      try { sessionStorage.setItem(P + 'badge-min', p.classList.contains('min') ? '1' : ''); } catch (e) {}
    });
    try { if (sessionStorage.getItem(P + 'badge-min') === '1') sh.querySelector('.pill').classList.add('min'); } catch (e) {}
    document.body.appendChild(host);
    badgeRoot = sh;
    renderBadge();
  }
  if (GAME) {
    if (document.body) mountBadge();
    else document.addEventListener('DOMContentLoaded', mountBadge);
  }
})();
