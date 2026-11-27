'use strict';

/**
 * Deterministic pseudo-random number generator (LCG).
 *
 * Uses the same algorithm as Java's java.util.Random (Knuth TAOCP Vol 2 §3.2.1)
 * so that the same numeric seed always produces the same sequence, making every
 * factory call fully reproducible across machines and Node versions.
 *
 * Usage:
 *   const { createRng } = require('./seed');
 *   const rng = createRng(42);
 *   rng.int(0, 100);   // 0–100 inclusive, deterministic
 *   rng.pick(['a','b','c']);
 */

const DEFAULT_SEED = 12345;

/**
 * @param {number} [seed=12345]
 */
function createRng(seed = DEFAULT_SEED) {
  // LCG parameters (same as glibc / Java)
  const A  = 1664525n;
  const C  = 1013904223n;
  const M  = 2n ** 32n;

  let state = BigInt(seed >>> 0); // ensure unsigned 32-bit

  function next() {
    state = (A * state + C) % M;
    return Number(state) / Number(M); // 0 ≤ x < 1
  }

  return {
    /** Integer in [min, max] inclusive */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** Float in [min, max) */
    float(min, max, decimals = 2) {
      return parseFloat((min + next() * (max - min)).toFixed(decimals));
    },
    /** Pick a random element from an array */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** Shuffle a copy of an array */
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** Hex string of given length */
    hex(len = 16) {
      let out = '';
      while (out.length < len) {
        out += Math.floor(next() * 0xFFFFFF).toString(16).padStart(6, '0');
      }
      return out.slice(0, len);
    },
    /** Alphanumeric string of given length */
    alphanum(len = 8) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let out = '';
      for (let i = 0; i < len; i++) out += chars[Math.floor(next() * chars.length)];
      return out;
    },
    /** Email-safe string */
    email(prefix = 'user') {
      return `${prefix}+${this.alphanum(6).toLowerCase()}@example.com`;
    },
  };
}

module.exports = { createRng, DEFAULT_SEED };
