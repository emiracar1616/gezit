import assert from 'node:assert/strict';
import { parseAmount, computeStats, settlements, money } from '../src/logic.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

ok('parseAmount: Türkçe ve düz yazımlar', () => {
  assert.equal(parseAmount('1.234,50'), 123450);
  assert.equal(parseAmount('1234,5'), 123450);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('300'), 30000);
  assert.equal(parseAmount(' 0,01 '), 1);
  assert.equal(parseAmount('125,50'), 12550);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('1,2,3')));
  assert.ok(Number.isNaN(parseAmount('-5')));
});

ok('parseAmount: "12.500" binlik ayraç olarak okunur', () => {
  assert.equal(parseAmount('12.500'), 1250000);
});

ok('computeStats: artan kuruşlar dağıtılır, toplam tutar korunur', () => {
  const st = computeStats(['a', 'b', 'c'], [
    { amount: 1000, payerId: 'a', amongIds: ['a', 'b', 'c'] }
  ]);
  assert.equal(st.total, 1000);
  assert.equal(st.share.a + st.share.b + st.share.c, 1000);
  assert.equal(st.net.a + st.net.b + st.net.c, 0);
  assert.equal(st.net.a, 1000 - 334);
});

ok('computeStats: geçersiz kayıtlar atlanır', () => {
  const st = computeStats(['a', 'b'], [
    { amount: 0, payerId: 'a', amongIds: ['a', 'b'] },
    { amount: 500, payerId: 'a', amongIds: [] }
  ]);
  assert.equal(st.total, 0);
});

ok('settlements: basit durum', () => {
  const st = computeStats(['a', 'b'], [
    { amount: 5000, payerId: 'a', amongIds: ['a', 'b'] }
  ]);
  assert.deepEqual(settlements(st.net), [{ from: 'b', to: 'a', amount: 2500 }]);
});

ok('settlements: rastgele 2000 gezide herkesin hesabı kapanır', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let t = 0; t < 2000; t++) {
    const people = 2 + Math.floor(rnd() * 7);
    const ids = Array.from({ length: people }, (_, i) => 'u' + i);
    const exps = [];
    const count = 1 + Math.floor(rnd() * 12);
    for (let i = 0; i < count; i++) {
      const among = ids.filter(() => rnd() < 0.6);
      if (!among.length) among.push(ids[0]);
      exps.push({
        amount: 1 + Math.floor(rnd() * 500000),
        payerId: ids[Math.floor(rnd() * people)],
        amongIds: among
      });
    }
    const st = computeStats(ids, exps);
    const sum = Object.values(st.net).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0);
    const bal = { ...st.net };
    const sets = settlements(st.net);
    sets.forEach((s) => {
      assert.ok(s.amount > 0);
      bal[s.from] += s.amount;
      bal[s.to] -= s.amount;
    });
    Object.values(bal).forEach((v) => assert.equal(v, 0));
    assert.ok(sets.length <= people - 1);
    // Aynı veri her zaman aynı öneriyi vermeli (herkesin ekranında aynı sonuç)
    assert.deepEqual(settlements({ ...st.net }), sets);
  }
});

ok('money: Türkçe biçim', () => {
  assert.equal(money(123450, '₺'), '1.234,50 ₺');
  assert.equal(money(-5, '€'), '0,05 €');
});

console.log(`\n${n} test grubu geçti`);
