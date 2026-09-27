/* harness.js — mini test runner untuk blackbox testing engine */
"use strict";
let passed = 0, failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error("  ✗ FAIL:", msg); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) passed++;
  else { failed++; failures.push(`${msg} | got=${sa} want=${sb}`); console.error(`  ✗ FAIL: ${msg}\n    got : ${sa}\n    want: ${sb}`); }
}
function section(name) { console.log("▶", name); }
function done(name) {
  console.log(`\n■ ${name}: ${passed} lulus, ${failed} gagal`);
  if (failed > 0) { console.log(failures.map(f => "   - " + f).join("\n")); process.exit(1); }
  process.exit(0);
}

/* PRNG deterministik (mulberry32) untuk test yang reprodusibel */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { ok, eq, section, done, rng };
