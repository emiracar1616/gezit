import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  updateProfile, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser
} from 'firebase/auth';
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where,
  writeBatch, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { App as CapApp } from '@capacitor/app';
import { esc, money, parseAmount, computeStats, settlements } from './logic.js';
import './style.css';

/* ---------- Durum ---------- */
const S = {
  booting: true, user: null, ready: false, loadError: '',
  trips: [], exps: {}, names: {},
  view: null, lastTrip: null, armed: {},
  editing: null, pendingForm: null, formSig: '',
  found: null, searchMsg: '', busy: {},
  authMode: 'login', registering: false,
  online: navigator.onLine !== false
};
let tripsUnsub = null;
const expUnsubs = {};
const MAX_TRIPS_LIVE = 40;

/* ---------- Yardımcılar ---------- */
const $ = (id) => document.getElementById(id);
const myId = () => (S.user ? S.user.uid : null);
const rawName = (id) => (S.names[id] && S.names[id].name) || '';
const nameOf = (id) => (rawName(id) || 'Biri') + (id === myId() ? ' (sen)' : '');
const shortName = (id) => (id === myId() ? 'Sen' : (rawName(id) || 'Biri'));

function setMsg(id, text, ok) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('ok', !!ok);
}

function errText(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return 'Bu işlem için yetkin yok. (Firestore güvenlik kuralları yüklenmemiş olabilir.)';
  if (c === 'unavailable' || c === 'deadline-exceeded') return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
  if (c === 'resource-exhausted') return 'Kullanım sınırı doldu, biraz bekleyip tekrar dene.';
  return 'Kaydedilemedi. Bağlantını kontrol edip tekrar dene.';
}

function authErr(e) {
  switch (e && e.code) {
    case 'auth/invalid-email': return 'E-posta adresi geçersiz.';
    case 'auth/missing-password': return 'Şifreni yaz.';
    case 'auth/email-already-in-use': return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.';
    case 'auth/weak-password': return 'Şifre en az 6 karakter olmalı.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials': return 'E-posta ya da şifre hatalı.';
    case 'auth/too-many-requests': return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
    case 'auth/network-request-failed': return 'İnternet bağlantısı yok ya da sunucuya ulaşılamıyor.';
    case 'auth/operation-not-allowed': return 'E-posta/şifre girişi Firebase konsolunda etkin değil (Authentication > Sign-in method).';
    case 'auth/requires-recent-login': return 'Güvenlik için çıkış yapıp yeniden giriş yaptıktan sonra tekrar dene.';
    default: return 'İşlem tamamlanamadı. Bağlantını kontrol edip tekrar dene.';
  }
}

/* ---------- Hesaplama (saf fonksiyonlar logic.js içinde) ---------- */
const tripExps = (t) => S.exps[t.id] || [];
const stats = (t) => computeStats(t.memberIds || [], tripExps(t));

function curTrip() {
  if (!S.view) return null;
  return S.trips.find((t) => t.id === S.view) || null;
}

function usedInExpenses(t, id) {
  return tripExps(t).some((e) => e.payerId === id || (e.amongIds || []).indexOf(id) !== -1);
}

/* İki dokunuşla onay: ilk dokunuş "Emin misin?" gösterir, 3,5 sn içinde ikincisi işlemi yapar */
function confirmArm(key) {
  if (S.armed[key]) {
    clearTimeout(S.armed[key]);
    delete S.armed[key];
    return true;
  }
  S.armed[key] = setTimeout(() => { delete S.armed[key]; renderAll(); }, 3500);
  renderAll();
  return false;
}

/* ---------- İsim çözme ---------- */
function ensureNames(ids) {
  ids.forEach((id) => {
    if (!id || id in S.names) return;
    S.names[id] = { name: '' };
    getDoc(doc(db, 'users', id)).then((s) => {
      if (s.exists()) {
        S.names[id] = { name: s.data().name || '' };
        renderAll();
      }
    }).catch(() => {});
  });
}

function collectIds() {
  const ids = [myId()];
  if (S.found) ids.push(S.found.id);
  S.trips.forEach((t) => {
    (t.memberIds || []).forEach((i) => ids.push(i));
    tripExps(t).forEach((e) => {
      ids.push(e.payerId);
      (e.amongIds || []).forEach((i) => ids.push(i));
    });
  });
  return ids;
}

/* ---------- Çizim ---------- */
let renderPending = false;
function renderAll() {
  if (renderPending) return;
  renderPending = true;
  Promise.resolve().then(() => { renderPending = false; doRender(); });
}

function show(id, on) { $(id).hidden = !on; }

function doRender() {
  const notice = $('notice');
  const banner = $('banner');

  const bannerText = !S.online
    ? 'İnternet bağlantısı yok. Yaptığın değişiklikler bağlantı gelince kaydedilir.'
    : (S.loadError || '');
  banner.hidden = !bannerText;
  banner.textContent = bannerText;

  const loading = (text) => {
    notice.hidden = false;
    notice.innerHTML = '<p class="muted">' + esc(text) + '</p>';
    show('screenAuth', false); show('screenList', false); show('screenTrip', false);
  };

  if (S.booting) { $('whoami').textContent = ''; loading('Yükleniyor…'); return; }

  if (!S.user) {
    notice.hidden = true;
    $('whoami').textContent = '';
    show('screenAuth', true); show('screenList', false); show('screenTrip', false);
    renderAuth();
    return;
  }

  show('screenAuth', false);
  ensureNames(collectIds());
  $('whoami').textContent = 'Giriş yapan: ' + (rawName(myId()) || S.user.email || '');

  if (!S.ready) { loading('Gezilerin yükleniyor…'); return; }
  notice.hidden = true;

  const t = curTrip();
  show('screenList', !t);
  show('screenTrip', !!t);
  $('createTripBtn').disabled = !!S.busy.create;
  if (t) renderTrip(t); else renderList();
}

function renderAuth() {
  const reg = S.authMode === 'register';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.authMode));
  show('nameRow', reg);
  $('authBtn').textContent = S.busy.auth ? 'Lütfen bekle…' : (reg ? 'Kayıt ol' : 'Giriş yap');
  $('authBtn').disabled = !!S.busy.auth;
  $('authPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  show('resetBtn', !reg);
}

function renderList() {
  const box = $('tripList');
  $('acctEmail').textContent = S.user.email || '';
  if (!S.trips.length) {
    box.innerHTML = '<div class="empty">Henüz gezin yok. Yukarıdan ilk gezini oluştur ya da bir arkadaşının seni eklemesini bekle.</div>';
    return;
  }
  const uid = myId();
  const trips = S.trips.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  box.innerHTML = '<ul class="tripul">' + trips.map((t) => {
    const st = stats(t);
    const net = st.net[uid] || 0;
    const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero';
    const txt = net > 0 ? money(net, t.currency) + ' alacaklı'
      : net < 0 ? money(net, t.currency) + ' borçlu'
        : (st.total ? 'Hesabın kapalı' : 'Harcama yok');
    return '<li><button type="button" class="tripcard" data-open="' + esc(t.id) + '">' +
      '<span class="tc-main"><strong>' + esc(t.name) + '</strong>' +
      '<span class="muted">' + (t.memberIds || []).length + ' kişi · toplam ' + money(st.total, t.currency) + '</span></span>' +
      '<span class="pill ' + cls + '">' + esc(txt) + '</span></button></li>';
  }).join('') + '</ul>';
}

function renderTrip(t) {
  const cur = t.currency || '₺';
  const uid = myId();
  const isOwner = t.ownerId === uid;
  const members = t.memberIds || [];

  if (S.lastTrip !== t.id) {
    S.lastTrip = t.id; S.found = null; S.searchMsg = ''; S.editing = null; S.pendingForm = null; S.formSig = '';
    $('memberEmail').value = ''; $('desc').value = ''; $('amount').value = ''; $('amtHint').textContent = '';
    setMsg('memberMsg', ''); setMsg('expMsg', ''); setMsg('toolMsg', '');
    $('copyOut').style.display = 'none';
    $('among').innerHTML = '';
  }
  $('tripTitle').textContent = t.name;

  /* Kişiler */
  $('members').innerHTML = members.map((id) => {
    const canRemove = isOwner && id !== uid && !usedInExpenses(t, id);
    return '<span class="chip"><span class="who"><span>' + esc(nameOf(id)) + '</span>' +
      (id === t.ownerId ? '<span class="badge">kurucu</span>' : '') + '</span>' +
      (canRemove
        ? '<button type="button" data-del-member="' + esc(id) + '" title="Geziden çıkar" aria-label="Geziden çıkar">×</button>'
        : '<span style="width:12px"></span>') +
      '</span>';
  }).join('');

  /* Kişi arama (e-posta ile) */
  show('addMemberBox', isOwner);
  if (isOwner) {
    const f = S.found;
    $('memberResults').innerHTML = (f && members.indexOf(f.id) === -1)
      ? '<button type="button" class="person" data-add-member="' + esc(f.id) + '"><span>' +
        esc(rawName(f.id) || 'İsimsiz kullanıcı') + '</span><span class="plus">Ekle +</span></button>'
      : '';
    $('memberHint').textContent = S.searchMsg ||
      (f ? '' : 'Arkadaşının uygulamaya kayıt olduğu e-posta adresini yaz.');
    $('memberFindBtn').disabled = !!S.busy.find;
  }

  /* Harcama formu (kişi listesi değişmedikçe seçenekleri yeniden kurma) */
  const sig = members.map((id) => id + ':' + nameOf(id)).join('|');
  const pf = S.pendingForm;
  if (pf || S.formSig !== sig) {
    const paySel = $('payer');
    const prev = pf ? pf.payer : paySel.value;
    paySel.innerHTML = members.map((id) =>
      '<option value="' + esc(id) + '">' + esc(nameOf(id)) + '</option>').join('');
    paySel.value = (prev && members.indexOf(prev) !== -1) ? prev
      : (members.indexOf(uid) !== -1 ? uid : (members[0] || ''));

    const checked = {};
    if (pf) members.forEach((id) => { checked[id] = pf.among.indexOf(id) !== -1; });
    else document.querySelectorAll('#among input').forEach((i) => { checked[i.value] = i.checked; });
    $('among').innerHTML = members.map((id) => {
      const on = (id in checked) ? checked[id] : true;
      return '<label><input type="checkbox" value="' + esc(id) + '"' + (on ? ' checked' : '') + '> ' + esc(shortName(id)) + '</label>';
    }).join('');
    S.formSig = sig;
    S.pendingForm = null;
  }

  if (S.editing && !tripExps(t).some((e) => e.id === S.editing)) S.editing = null;
  $('formTitle').textContent = S.editing ? 'Harcamayı düzenle' : 'Harcama ekle';
  $('addExpenseBtn').textContent = S.editing ? 'Değişikliği kaydet' : 'Harcamayı ekle';
  show('cancelEditBtn', !!S.editing);

  /* Özet */
  const st = stats(t);
  const my = st.net[uid] || 0;
  const big = my > 0 ? money(my, cur) + ' alacaklısın'
    : my < 0 ? money(my, cur) + ' borçlusun'
      : (st.total ? 'Hesabın kapalı' : 'Henüz harcama yok');
  $('hero').innerHTML =
    '<span class="muted">Senin durumun</span>' +
    '<div class="big ' + (my > 0 ? 'pos' : my < 0 ? 'neg' : '') + '">' + esc(big) + '</div>' +
    '<div class="stats">' +
    '<div><span class="muted">Gezinin toplamı</span><b>' + money(st.total, cur) + '</b></div>' +
    '<div><span class="muted">Senin ödediğin</span><b>' + money(st.paid[uid] || 0, cur) + '</b></div>' +
    '<div><span class="muted">Senin payın</span><b>' + money(st.share[uid] || 0, cur) + '</b></div>' +
    '</div>';

  /* Ödeme önerileri */
  const sets = settlements(st.net).sort((a, b) => {
    const am = (a.from === uid || a.to === uid) ? 0 : 1;
    const bm = (b.from === uid || b.to === uid) ? 0 : 1;
    return am - bm;
  });
  if (!tripExps(t).length) {
    $('settle').innerHTML = '<div class="empty">Harcama girince önerilen ödemeler burada görünür.</div>';
  } else if (!sets.length) {
    $('settle').innerHTML = '<div class="empty">Kimsenin kimseye borcu yok.</div>';
  } else {
    $('settle').innerHTML = '<ul>' + sets.map((s) => {
      const mine = s.from === uid || s.to === uid;
      return '<li class="item' + (mine ? ' mine' : '') + '"><div class="pay"><strong>' + esc(shortName(s.from)) +
        '</strong><span class="arrow">→</span><strong>' + esc(shortName(s.to)) + '</strong></div>' +
        '<span class="amt">' + money(s.amount, cur) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* Bakiyeler */
  const ids = Object.keys(st.net).sort((a, b) => (a === uid ? -1 : b === uid ? 1 : 0));
  $('balances').innerHTML = '<ul>' + ids.map((id) => {
    const v = st.net[id] || 0;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted';
    const txt = v > 0 ? money(v, cur) + ' alacaklı' : v < 0 ? money(v, cur) + ' borçlu' : 'Hesabı kapalı';
    return '<li class="item"><strong>' + esc(nameOf(id)) + '</strong><span class="amt ' + cls + '">' + esc(txt) + '</span></li>';
  }).join('') + '</ul>';

  /* Harcamalar */
  const list = tripExps(t).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!list.length) {
    $('expenses').innerHTML = '<div class="empty">Henüz harcama yok.</div>';
  } else {
    $('expenses').innerHTML = '<div class="total"><span>Toplam harcama</span><span>' + money(st.total, cur) + '</span></div><ul>' +
      list.map((e) => {
        const among = e.amongIds || [];
        const who = among.length === members.length ? 'herkes' : among.map(shortName).join(', ');
        const canEdit = e.by === uid || isOwner;
        const armedDel = !!S.armed['exp:' + e.id];
        return '<li class="item"><div><strong>' + esc(e.desc) + '</strong><br><span class="muted">' +
          esc(shortName(e.payerId)) + ' ödedi · ' + esc(who) + ' arasında</span></div>' +
          '<div><div class="amt">' + money(e.amount, cur) + '</div>' +
          (canEdit
            ? '<div class="actions"><button class="ghost small" type="button" data-edit-exp="' + esc(e.id) + '">Düzenle</button>' +
              '<button class="ghost small danger" type="button" data-del-exp="' + esc(e.id) + '">' + (armedDel ? 'Emin misin?' : 'Sil') + '</button></div>'
            : '') +
          '</div></li>';
      }).join('') + '</ul>';
  }

  /* Araçlar */
  show('leaveBtn', !isOwner);
  show('deleteTripBtn', isOwner);
  $('leaveBtn').textContent = S.armed.leave ? 'Emin misin? Tekrar dokun' : 'Geziden ayrıl';
  $('deleteTripBtn').textContent = S.armed.deltrip ? 'Herkes için silinecek. Tekrar dokun' : 'Geziyi sil';
}

function updateAmtHint() {
  const t = curTrip();
  const el = $('amtHint');
  const v = $('amount').value.trim();
  if (!v || !t) { el.textContent = ''; return; }
  const a = parseAmount(v);
  el.textContent = (isFinite(a) && a > 0) ? 'Okunan tutar: ' + money(a, t.currency) : 'Tutarı 125,50 gibi yaz.';
}

/* ---------- Hesap işlemleri ---------- */
function setAuthMode(mode) {
  S.authMode = mode;
  setMsg('authMsg', '');
  renderAll();
}

async function saveProfile(user, name) {
  const email = (user.email || '').toLowerCase();
  S.names[user.uid] = { name };
  try {
    await setDoc(doc(db, 'users', user.uid), { name, createdAt: Date.now() });
    if (email && email.indexOf('/') === -1) await setDoc(doc(db, 'emails', email), { uid: user.uid });
  } catch (e) {
    console.warn('Profil kaydedilemedi', e);
  }
}

async function loadProfile(user) {
  const uid = user.uid;
  const email = (user.email || '').toLowerCase();
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) {
      S.names[uid] = { name: s.data().name || user.displayName || '' };
    } else {
      await saveProfile(user, user.displayName || (user.email || '').split('@')[0] || 'Kullanıcı');
    }
    if (email && email.indexOf('/') === -1) {
      const es = await getDoc(doc(db, 'emails', email));
      if (!es.exists() || es.data().uid !== uid) await setDoc(doc(db, 'emails', email), { uid });
    }
  } catch (e) {
    console.warn('Profil yüklenemedi', e);
  }
  if (S.user && S.user.uid === uid) {
    $('acctName').value = rawName(uid);
    renderAll();
  }
}

function stopListeners() {
  if (tripsUnsub) { tripsUnsub(); tripsUnsub = null; }
  Object.keys(expUnsubs).forEach((id) => { expUnsubs[id](); delete expUnsubs[id]; });
}

function syncExpenseSubs() {
  const want = {};
  S.trips.slice(0, MAX_TRIPS_LIVE).forEach((t) => { want[t.id] = 1; });
  Object.keys(expUnsubs).forEach((id) => {
    if (!want[id]) { expUnsubs[id](); delete expUnsubs[id]; delete S.exps[id]; }
  });
  Object.keys(want).forEach((id) => {
    if (expUnsubs[id]) return;
    expUnsubs[id] = onSnapshot(collection(db, 'trips', id, 'expenses'), (snap) => {
      S.exps[id] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      renderAll();
    }, () => { S.exps[id] = S.exps[id] || []; renderAll(); });
  });
}

function enterApp(user) {
  if (S.user && S.user.uid === user.uid && tripsUnsub) { S.user = user; renderAll(); return; }
  stopListeners();
  S.user = user; S.booting = false; S.ready = false; S.loadError = '';
  S.trips = []; S.exps = {}; S.view = null; S.lastTrip = null;
  S.names[user.uid] = { name: user.displayName || '' };
  renderAll();
  loadProfile(user);

  tripsUnsub = onSnapshot(
    query(collection(db, 'trips'), where('memberIds', 'array-contains', user.uid)),
    (snap) => {
      S.trips = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      if (S.view && !S.trips.some((t) => t.id === S.view) && !snap.metadata.hasPendingWrites) S.view = null;
      S.ready = true; S.loadError = '';
      syncExpenseSubs();
      renderAll();
    },
    (e) => {
      S.ready = true;
      S.loadError = 'Geziler yüklenemedi. ' + errText(e);
      renderAll();
    }
  );
}

function leaveApp() {
  stopListeners();
  S.user = null; S.booting = false; S.ready = false; S.loadError = '';
  S.trips = []; S.exps = {}; S.names = {}; S.view = null; S.lastTrip = null;
  S.found = null; S.editing = null; S.armed = {}; S.authMode = 'login';
  setMsg('authMsg', '');
  $('authPass').value = ''; $('delPass').value = ''; $('acctName').value = '';
  renderAll();
}

async function submitAuth(ev) {
  ev.preventDefault();
  if (S.busy.auth) return;
  const reg = S.authMode === 'register';
  const email = $('authEmail').value.trim();
  const pass = $('authPass').value;
  const name = $('authName').value.trim();
  setMsg('authMsg', '');
  if (reg && !name) { setMsg('authMsg', 'Adını yaz.'); return; }
  if (!email) { setMsg('authMsg', 'E-posta adresini yaz.'); return; }
  if (!pass) { setMsg('authMsg', 'Şifreni yaz.'); return; }
  if (reg && pass.length < 6) { setMsg('authMsg', 'Şifre en az 6 karakter olmalı.'); return; }

  S.busy.auth = true; renderAll();
  try {
    if (reg) {
      S.registering = true;
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      try { await updateProfile(cred.user, { displayName: name }); } catch (e) { /* önemli değil */ }
      await saveProfile(cred.user, name);
      S.registering = false;
      enterApp(cred.user);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (e) {
    S.registering = false;
    setMsg('authMsg', authErr(e));
  }
  S.busy.auth = false; renderAll();
}

async function resetPassword() {
  const email = $('authEmail').value.trim();
  if (!email) { setMsg('authMsg', 'Önce e-posta adresini yaz.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setMsg('authMsg', 'Şifre sıfırlama bağlantısı e-postana gönderildi (spam klasörüne de bak).', true);
  } catch (e) {
    setMsg('authMsg', authErr(e));
  }
}

async function saveName() {
  const name = $('acctName').value.trim();
  if (!name) { setMsg('acctMsg', 'Bir ad yaz.'); return; }
  const uid = myId();
  try {
    await updateDoc(doc(db, 'users', uid), { name });
    try { await updateProfile(S.user, { displayName: name }); } catch (e) { /* önemli değil */ }
    S.names[uid] = { name };
    setMsg('acctMsg', 'Kaydedildi.', true);
    renderAll();
  } catch (e) {
    setMsg('acctMsg', errText(e));
  }
}

async function deleteAccount() {
  setMsg('delMsg', '');
  const pass = $('delPass').value;
  if (!pass) { setMsg('delMsg', 'Şifreni yaz.'); return; }
  if (S.trips.length) {
    setMsg('delMsg', 'Önce tüm gezilerden ayrılmalı ya da sahibi olduğun gezileri silmelisin. Ayrılamıyorsan harcamalarını gezi sahibinden sildirmelisin.');
    return;
  }
  if (!confirmArm('delacct')) { setMsg('delMsg', 'Emin misin? Silmek için bir kez daha dokun.'); return; }
  try {
    const u = S.user;
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pass));
    const email = (u.email || '').toLowerCase();
    await deleteDoc(doc(db, 'users', u.uid));
    if (email) { try { await deleteDoc(doc(db, 'emails', email)); } catch (e) { /* yoksa sorun değil */ } }
    await deleteUser(u);
  } catch (e) {
    setMsg('delMsg', authErr(e));
  }
}

/* ---------- Gezi işlemleri ---------- */
function createTrip() {
  setMsg('createMsg', '');
  const name = $('newTripName').value.trim();
  if (!name) { setMsg('createMsg', 'Gezinin adını yaz.'); return; }
  if (S.busy.create) return;
  const ref = doc(collection(db, 'trips'));
  S.busy.create = true;
  setDoc(ref, {
    name, currency: $('newTripCur').value, ownerId: myId(), memberIds: [myId()], at: Date.now()
  }).catch((e) => {
    setMsg('createMsg', errText(e));
  });
  $('newTripName').value = '';
  S.view = ref.id;
  setTimeout(() => { S.busy.create = false; renderAll(); }, 600);
  renderAll();
}

async function findMember() {
  const t = curTrip();
  if (!t || t.ownerId !== myId() || S.busy.find) return;
  const email = $('memberEmail').value.trim().toLowerCase();
  S.found = null; S.searchMsg = ''; setMsg('memberMsg', '');
  if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email)) { S.searchMsg = 'Geçerli bir e-posta adresi yaz.'; renderAll(); return; }
  if (email === (S.user.email || '').toLowerCase()) { S.searchMsg = 'Bu sensin, zaten gezidesin.'; renderAll(); return; }
  S.busy.find = true; renderAll();
  try {
    const es = await getDoc(doc(db, 'emails', email));
    if (!es.exists()) {
      S.searchMsg = 'Bu e-posta ile kayıtlı kullanıcı yok. Arkadaşının önce uygulamaya kayıt olması gerekir.';
    } else {
      const id = es.data().uid;
      if ((t.memberIds || []).indexOf(id) !== -1) {
        S.searchMsg = 'Bu kişi zaten gezide.';
      } else {
        const us = await getDoc(doc(db, 'users', id));
        S.names[id] = { name: us.exists() ? (us.data().name || '') : '' };
        S.found = { id };
      }
    }
  } catch (e) {
    S.searchMsg = errText(e);
  }
  S.busy.find = false; renderAll();
}

function addMember(id) {
  const t = curTrip();
  if (!t || t.ownerId !== myId()) return;
  if ((t.memberIds || []).indexOf(id) !== -1) return;
  setMsg('memberMsg', '');
  updateDoc(doc(db, 'trips', t.id), { memberIds: arrayUnion(id) })
    .catch((e) => setMsg('memberMsg', errText(e)));
  S.found = null; S.searchMsg = ''; $('memberEmail').value = '';
  renderAll();
}

function removeMember(id, selfLeave) {
  const t = curTrip();
  if (!t) return;
  if (usedInExpenses(t, id)) {
    setMsg(selfLeave ? 'toolMsg' : 'memberMsg',
      selfLeave
        ? 'Harcamalarda geçtiğin için ayrılamazsın. Önce o harcamaların silinmesi gerekir.'
        : 'Bu kişi harcamalarda geçiyor. Önce o harcamaları sil.');
    return;
  }
  updateDoc(doc(db, 'trips', t.id), { memberIds: arrayRemove(id) })
    .catch((e) => setMsg(selfLeave ? 'createMsg' : 'memberMsg', errText(e)));
  if (selfLeave) { S.view = null; S.lastTrip = null; renderAll(); }
}

function deleteTrip() {
  const t = curTrip();
  if (!t || t.ownerId !== myId()) return;
  const refs = tripExps(t).map((e) => doc(db, 'trips', t.id, 'expenses', e.id));
  const batches = [];
  let b = writeBatch(db);
  let n = 0;
  refs.forEach((r) => {
    b.delete(r);
    if (++n >= 400) { batches.push(b); b = writeBatch(db); n = 0; }
  });
  b.delete(doc(db, 'trips', t.id));
  batches.push(b);
  S.view = null; S.lastTrip = null;
  renderAll();
  batches.reduce((p, x) => p.then(() => x.commit()), Promise.resolve())
    .catch((e) => setMsg('createMsg', 'Gezi silinemedi. ' + errText(e)));
}

/* ---------- Harcama işlemleri ---------- */
function saveExpense() {
  const t = curTrip();
  if (!t) return;
  setMsg('expMsg', '');
  const desc = $('desc').value.trim();
  const amount = parseAmount($('amount').value);
  const payer = $('payer').value;
  const among = Array.prototype.slice.call(document.querySelectorAll('#among input:checked')).map((i) => i.value);
  const members = t.memberIds || [];
  if (!S.editing && members.length < 2) { setMsg('expMsg', 'Önce geziye en az bir kişi daha ekle.'); return; }
  if (!desc) { setMsg('expMsg', 'Harcamanın ne için olduğunu yaz.'); return; }
  if (!isFinite(amount) || amount <= 0) { setMsg('expMsg', 'Geçerli bir tutar gir.'); return; }
  if (amount > 100000000000) { setMsg('expMsg', 'Tutar çok büyük.'); return; }
  if (members.indexOf(payer) === -1) { setMsg('expMsg', 'Ödeyen kişiyi seç.'); return; }
  if (!among.length) { setMsg('expMsg', 'Bölüşülecek en az bir kişi seç.'); return; }

  const p = S.editing
    ? updateDoc(doc(db, 'trips', t.id, 'expenses', S.editing), { desc, amount, payerId: payer, amongIds: among })
    : addDoc(collection(db, 'trips', t.id, 'expenses'), { desc, amount, payerId: payer, amongIds: among, by: myId(), at: Date.now() });
  p.catch((e) => setMsg('expMsg', errText(e)));

  /* Bir sonraki harcama için herkes yeniden seçili gelsin (yanlışlıkla eksik bölüşmeyi önler) */
  S.pendingForm = { payer: S.editing ? myId() : payer, among: members.slice() };
  S.editing = null;
  $('desc').value = ''; $('amount').value = ''; $('amtHint').textContent = '';
  $('desc').focus();
  renderAll();
}

/* Düzenlemeden sonra "kim ödedi / kimler arasında" seçimlerini varsayılana döndür */
function resetFormChoices(t) {
  S.pendingForm = { payer: myId(), among: (t.memberIds || []).slice() };
}

function startEdit(id) {
  const t = curTrip();
  if (!t) return;
  const e = tripExps(t).find((x) => x.id === id);
  if (!e) return;
  S.editing = id;
  $('desc').value = e.desc;
  $('amount').value = (e.amount / 100).toFixed(2).replace('.', ',');
  S.pendingForm = { payer: e.payerId, among: (e.amongIds || []).slice() };
  setMsg('expMsg', '');
  updateAmtHint();
  renderAll();
  $('expenseForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEdit() {
  const t = curTrip();
  if (t) resetFormChoices(t);
  S.editing = null;
  $('desc').value = ''; $('amount').value = ''; $('amtHint').textContent = '';
  setMsg('expMsg', '');
  renderAll();
}

function deleteExpense(eid) {
  const t = curTrip();
  if (!t) return;
  if (!confirmArm('exp:' + eid)) return;
  deleteDoc(doc(db, 'trips', t.id, 'expenses', eid)).catch((e) => setMsg('expMsg', errText(e)));
  if (S.editing === eid) cancelEdit();
}

function copySummary() {
  const t = curTrip();
  if (!t) return;
  const st = stats(t);
  const cur = t.currency || '₺';
  const lines = [t.name, 'Toplam harcama: ' + money(st.total, cur), '', 'Ödemeler:'];
  const sets = settlements(st.net);
  if (!sets.length) lines.push('Kimsenin borcu yok.');
  sets.forEach((s) => {
    lines.push((rawName(s.from) || 'Biri') + ' → ' + (rawName(s.to) || 'Biri') + ': ' + money(s.amount, cur));
  });
  const text = lines.join('\n');
  const btn = $('copyBtn');
  const done = () => { btn.textContent = 'Kopyalandı ✓'; setTimeout(() => { btn.textContent = 'Özeti kopyala'; }, 1500); };
  const fallback = () => { const o = $('copyOut'); o.style.display = 'block'; o.value = text; o.focus(); o.select(); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  } catch (e) { fallback(); }
}

/* ---------- Olaylar ---------- */
function bindEvents() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
  $('authForm').addEventListener('submit', submitAuth);
  $('resetBtn').addEventListener('click', resetPassword);
  $('logoutBtn').addEventListener('click', () => { signOut(auth); });
  $('saveNameBtn').addEventListener('click', saveName);
  $('delAcctBtn').addEventListener('click', deleteAccount);

  $('createTripBtn').addEventListener('click', createTrip);
  $('newTripName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); createTrip(); } });
  $('addExpenseBtn').addEventListener('click', saveExpense);
  $('cancelEditBtn').addEventListener('click', cancelEdit);
  ['desc', 'amount'].forEach((id) => {
    $(id).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveExpense(); } });
  });
  $('amount').addEventListener('input', updateAmtHint);
  $('backBtn').addEventListener('click', () => { S.view = null; S.lastTrip = null; renderAll(); });
  $('copyBtn').addEventListener('click', copySummary);

  $('tripList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-open]');
    if (!b) return;
    S.view = b.getAttribute('data-open');
    renderAll();
    window.scrollTo(0, 0);
  });
  $('members').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-del-member]');
    if (b) removeMember(b.getAttribute('data-del-member'), false);
  });
  $('memberResults').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-add-member]');
    if (b) addMember(b.getAttribute('data-add-member'));
  });
  $('memberFindBtn').addEventListener('click', findMember);
  $('memberEmail').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); findMember(); } });
  $('expenses').addEventListener('click', (ev) => {
    const d = ev.target.closest('[data-del-exp]');
    if (d) { deleteExpense(d.getAttribute('data-del-exp')); return; }
    const e = ev.target.closest('[data-edit-exp]');
    if (e) startEdit(e.getAttribute('data-edit-exp'));
  });
  $('leaveBtn').addEventListener('click', () => { if (confirmArm('leave')) removeMember(myId(), true); });
  $('deleteTripBtn').addEventListener('click', () => { if (confirmArm('deltrip')) deleteTrip(); });

  window.addEventListener('online', () => { S.online = true; renderAll(); });
  window.addEventListener('offline', () => { S.online = false; renderAll(); });

  /* Android geri tuşu */
  try {
    const p = CapApp.addListener('backButton', () => {
      if (S.user && S.view) { S.view = null; S.lastTrip = null; renderAll(); }
      else if (!S.user && S.authMode === 'register') setAuthMode('login');
      else CapApp.exitApp();
    });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* tarayıcıda geri tuşu yok */ }
}

/* ---------- Başlat ---------- */
bindEvents();
renderAll();
onAuthStateChanged(auth, (user) => {
  if (S.registering) return;
  if (user) enterApp(user); else leaveApp();
});
