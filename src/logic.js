// Saf hesap fonksiyonları (DOM ya da Firebase gerektirmez, Node ile test edilir).

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function trLower(s) {
  return String(s || '').toLocaleLowerCase('tr');
}

/* kuruş (tam sayı) -> "1.234,50 ₺" */
export function money(cents, cur) {
  const n = (Math.abs(cents) / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return n + ' ' + (cur || '₺');
}

/* "1.234,50", "1234,5", "12.5", "300" yazımlarını kuruşa çevirir, geçersizse NaN */
export function parseAmount(s) {
  s = String(s).trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

/*
  Gezi istatistikleri.
  memberIds: gezideki kişilerin kimlikleri
  expenses : { amount (kuruş), payerId, amongIds[] } listesi
  Artan kuruşlar, bölüşülen kişilere sırayla birer kuruş dağıtılır.
*/
export function computeStats(memberIds, expenses) {
  const ids = {};
  (memberIds || []).forEach((i) => { ids[i] = 1; });
  const paid = {};
  const share = {};
  let total = 0;
  (expenses || []).forEach((e) => {
    const among = e.amongIds || [];
    const n = among.length;
    if (!n || !(e.amount > 0)) return;
    total += e.amount;
    ids[e.payerId] = 1;
    paid[e.payerId] = (paid[e.payerId] || 0) + e.amount;
    const base = Math.floor(e.amount / n);
    const rem = e.amount - base * n;
    among.forEach((id, i) => {
      ids[id] = 1;
      share[id] = (share[id] || 0) + base + (i < rem ? 1 : 0);
    });
  });
  const net = {};
  Object.keys(ids).forEach((id) => { net[id] = (paid[id] || 0) - (share[id] || 0); });
  return { net, paid, share, total };
}

/*
  Borç kapatma önerileri (açgözlü yöntem: en büyük borçlu -> en büyük alacaklı).
  Eşitlikler kimliğe göre kırılır, böylece herkesin ekranında aynı sonuç çıkar.
  Ödeme sayısı en fazla (kişi sayısı - 1) olur; her durumda kesin minimum olmayabilir.
*/
export function settlements(net) {
  const cred = [];
  const debt = [];
  Object.keys(net).forEach((id) => {
    if (net[id] > 0) cred.push({ id, v: net[id] });
    else if (net[id] < 0) debt.push({ id, v: -net[id] });
  });
  const cmp = (a, b) => (b.v - a.v) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [];
  while (cred.length && debt.length) {
    cred.sort(cmp);
    debt.sort(cmp);
    const c = cred[0];
    const d = debt[0];
    const x = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, amount: x });
    c.v -= x;
    d.v -= x;
    if (c.v === 0) cred.shift();
    if (d.v === 0) debt.shift();
  }
  return out;
}
