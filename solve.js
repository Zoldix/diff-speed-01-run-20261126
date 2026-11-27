// diff-speed-01: an exact-output, faster drop-in for makefun-diff 1.0.0.
//
// run(input) returns, for { old, new }, byte-for-byte the patch makefun-diff 1.0.0 returns.
// The rule reproduced is the reference's own (its header states it): lines are cut after
// every "\n" ("\r" belongs to its line; a last line without "\n" is a line); the common
// prefix of lines is kept, then the common suffix of the rest; between them Myers's greedy
// search runs from the first lines — on each diagonal the path reaching furthest into the
// old text, a deletion winning a tie against an insertion, no edge diagonal pruned, every
// snake followed as far as it goes — and the first path reaching both ends is the script.
// The patch format (header, hunks with 3 lines of context, runs at most 6 kept lines apart
// sharing a hunk, deletions before insertions in a run, "%" after a line that ends its
// text without a newline) is the reference's as well.
//
// How this stays exact while running faster: the reference keeps, per diagonal, a linked
// list of path objects and copies token slices. Here the lines are interned once to
// integer ids (a Map from the line string, so equality is an integer compare), the search
// keeps only the furthest-x value per diagonal per round in Int32Arrays, and the winning
// path's history is rebuilt by walking those snapshots back: at each step the predecessor
// is recomputed with the reference's own candidate rule from the previous round's values,
// which is exactly the predecessor the forward pass chose. No caches are kept between
// calls; every call recomputes from its input alone.

const KEEP = 0;
const DEL = 1;
const INS = 2;
const CONTEXT = 3;

/** A text's lines (each with its "\n", the last without when the text lacks one) interned to ids. */
function tokenizeIds(text, map, strs) {
  let start = 0;
  const len = text.length;
  let idx = text.indexOf('\n', start);
  while (idx !== -1) {
    strs.push(text.slice(start, idx + 1));
    start = idx + 1;
    idx = text.indexOf('\n', start);
  }
  if (start < len) strs.push(text.slice(start));
  const ids = new Int32Array(strs.length);
  for (let i = 0; i < strs.length; i++) {
    const s = strs[i];
    let id = map.get(s);
    if (id === undefined) {
      id = map.size;
      map.set(s, id);
    }
    ids[i] = id;
  }
  return ids;
}

/**
 * The edit runs ([kind, count] pairs, kinds merged) of old ids a into new ids b, by the
 * reference's Myers rule. Positions follow the reference: x is the index of the last old
 * line consumed (-1 for none), a diagonal is k = x - y, and -2 marks "no path", the
 * reference's own sentinel for an invalid candidate.
 */
function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  const snaps = [];
  // Round 0: the initial snake from (-1, -1).
  let x = -1;
  let y = -1;
  while (x + 1 < n && y + 1 < m && a[x + 1] === b[y + 1]) {
    x++;
    y++;
  }
  const v0 = new Int32Array(1);
  v0[0] = x;
  snaps.push(v0);
  let dStar = 0;
  let kStar = 0;
  let found = x + 1 >= n && y + 1 >= m;
  for (let d = 1; !found && d <= n + m; d++) {
    const vp = snaps[d - 1];
    const po = d - 1;
    const vc = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      const remX = k - 1 >= -po && k - 1 <= po ? vp[k - 1 + po] : -2;
      const addX = k + 1 >= -po && k + 1 <= po ? vp[k + 1 + po] : -2;
      const canRemove = remX !== -2 && remX + 1 < n;
      const canAdd = addX !== -2 && addX - k < m;
      if (!canRemove && !canAdd) {
        vc[k + d] = -2;
        continue;
      }
      const byDel = canRemove ? remX + 1 : -2;
      const byIns = canAdd ? addX : -2;
      let cx = byDel >= byIns ? remX + 1 : addX;
      let cy = cx - k;
      while (cx + 1 < n && cy + 1 < m && a[cx + 1] === b[cy + 1]) {
        cx++;
        cy++;
      }
      vc[k + d] = cx;
      if (cx + 1 >= n && cy + 1 >= m) {
        dStar = d;
        kStar = k;
        found = true;
        break;
      }
    }
    snaps.push(vc);
  }
  if (!found) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk the snapshots back from the winning point, recomputing each step's predecessor
  // with the forward rule; runs are collected in reverse as a flat [kind, count] list.
  const rev = [];
  let bx = snaps[dStar][kStar + dStar];
  let by = bx - kStar;
  for (let d = dStar; d >= 1; d--) {
    const k = bx - by;
    const vp = snaps[d - 1];
    const po = d - 1;
    const remX = k - 1 >= -po && k - 1 <= po ? vp[k - 1 + po] : -2;
    const addX = k + 1 >= -po && k + 1 <= po ? vp[k + 1 + po] : -2;
    const canRemove = remX !== -2 && remX + 1 < n;
    const canAdd = addX !== -2 && addX - k < m;
    const byDel = canRemove ? remX + 1 : -2;
    const byIns = canAdd ? addX : -2;
    if (byDel >= byIns) {
      const s = bx - remX - 1;
      if (s > 0) rev.push(KEEP, s);
      rev.push(DEL, 1);
      bx = remX;
      by = remX - (k - 1);
    } else {
      const s = bx - addX;
      if (s > 0) rev.push(KEEP, s);
      rev.push(INS, 1);
      bx = addX;
      by = addX - (k + 1);
    }
  }
  if (bx + 1 > 0) rev.push(KEEP, bx + 1);
  const runs = [];
  for (let i = rev.length - 2; i >= 0; i -= 2) {
    const kind = rev[i];
    const count = rev[i + 1];
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, and "%" on its own line when it had no newline. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's patch of input.old into input.new, computed faster. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const map = new Map();
  const aStrs = [];
  const bStrs = [];
  const aIds = tokenizeIds(input.old, map, aStrs);
  const bIds = tokenizeIds(input.new, map, bStrs);
  const n = aStrs.length;
  const m = bStrs.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;

  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  };
  pushRun(KEEP, prefix);
  const mid = editRuns(aIds.subarray(prefix, n - suffix), bIds.subarray(prefix, m - suffix));
  for (let i = 0; i < mid.length; i++) pushRun(mid[i][0], mid[i][1]);
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between two kept lines.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const kind = runs[i][0];
    const count = runs[i][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c[0] + c[2] !== o || c[1] + c[3] !== p) {
      c = [o, p, 0, 0];
      changes.push(c);
    }
    if (kind === DEL) {
      c[2] += count;
      o += count;
      deleted += count;
    } else {
      c[3] += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c[0] - (prev[0] + prev[2]) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first[0] - CONTEXT);
    const newStart = first[1] - (first[0] - oldStart);
    const after = Math.min(CONTEXT, n - (last[0] + last[2]));
    const oldEnd = last[0] + last[2] + after;
    const newEnd = last[1] + last[3] + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c[0]; at++) out.push(written('=', aStrs[at]));
      for (let i = 0; i < c[2]; i++) out.push(written('-', aStrs[c[0] + i]));
      for (let i = 0; i < c[3]; i++) out.push(written('+', bStrs[c[1] + i]));
      at = c[0] + c[2];
    }
    for (; at < oldEnd; at++) out.push(written('=', aStrs[at]));
  }
  return out.join('');
}
