import sys
import time

_BIT = [0] + [1 << d for d in range(1, 10)]
_ALL = 0x1FF
_EVEN, _ODD = 0x154, 0x2AA

_PEERS = [[] for _ in range(81)]
for i in range(81):
    r, c, b = i // 9, i % 9, (i // 27) * 3 + (i % 9 // 3)
    for j in range(81):
        if i != j and (j // 9 == r or j % 9 == c or (j // 27) * 3 + (j % 9 // 3) == b):
            _PEERS[i].append(j)


class State:
    def __init__(self):
        self.grid = [0] * 81
        self.cands = [_ALL] * 81
        self.flags = [0] * 81
        self.t_map = [[] for _ in range(81)]
        self.a_map = [[] for _ in range(81)]
        self.k_map = [[] for _ in range(81)]
        self.kp_map = [[] for _ in range(81)]
        self.ts = [];
        self.as_ = [];
        self.ks = [];
        self.kps = []
        self.asum = [];
        self.afill = [];
        self.ksum = [];
        self.kfill = []
        self.sols = []
        self.start = time.perf_counter()
        self.abort = False


def _place(s, i, d):
    s.grid[i] = d
    b = _BIT[d]
    for p in _PEERS[i]: s.cands[p] &= ~b


def _check(s, i, d):
    if not (s.cands[i] & _BIT[d]): return False
    f = s.flags[i]
    if f & 1:
        for tid, pos in s.t_map[i]:
            seq = s.ts[tid]
            for j in range(pos):
                if s.grid[seq[j]] != 0 and s.grid[seq[j]] >= d: return False
            for j in range(pos + 1, len(seq)):
                if s.grid[seq[j]] != 0 and s.grid[seq[j]] <= d: return False
    if f & 2:
        for aid, role in s.a_map[i]:
            ci, st = s.as_[aid]
            if role == 'circle':
                if s.asum[aid] > d or (s.afill[aid] == len(st) and s.asum[aid] != d): return False
            else:
                cv = s.grid[ci]
                ns, nf = s.asum[aid] + d, s.afill[aid] + 1
                if cv != 0 and (ns > cv or (nf == len(st) and ns != cv)):
                    return False
                elif ns > 9:
                    return False
    if f & 4:
        for kid in s.k_map[i]:
            t, cells = s.ks[kid]
            ns, nf = s.ksum[kid] + d, s.kfill[kid] + 1
            if ns > t or (nf == len(cells) and ns != t): return False
            for c in cells:
                if c != i and s.grid[c] == d: return False
    if f & 8:
        for kid in s.kp_map[i]:
            a, b, typ = s.kps[kid]
            ov = s.grid[b if i == a else a]
            if ov != 0:
                if typ == 'black' and (d != 2 * ov and ov != 2 * d): return False
                if typ == 'white' and abs(d - ov) != 1: return False
    return True


def _solve(s, lim=1.0):
    if s.abort or len(s.sols) >= 2: return True
    if time.perf_counter() - s.start > lim:
        s.abort = True
        return True

    bi, bc = -1, 10
    for i in range(81):
        if s.grid[i] == 0:
            c = bin(s.cands[i]).count('1')
            if c == 0: return False
            if c < bc: bc, bi = c, i
            if bc == 1: break
    if bi == -1:
        s.sols.append(list(s.grid))
        return False

    m = s.cands[bi]
    while m:
        lsb = m & -m;
        m &= ~lsb;
        d = lsb.bit_length() - 1
        if _check(s, bi, d):
            sv = [(p, s.cands[p]) for p in _PEERS[bi] if s.cands[p] & lsb]
            _place(s, bi, d)
            for k in s.k_map[bi]: s.ksum[k] += d; s.kfill[k] += 1
            for a, r in s.a_map[bi]:
                if r == 'stem': s.asum[a] += d; s.afill[a] += 1
            if _solve(s, lim): return True
            for a, r in s.a_map[bi]:
                if r == 'stem': s.asum[a] -= d; s.afill[a] -= 1
            for k in s.k_map[bi]: s.ksum[k] -= d; s.kfill[k] -= 1
            s.grid[bi] = 0
            for p, c in sv: s.cands[p] = c
    return False


def run(rows, con, lim=1.0):
    s = State()
    eo = con.get('even_odd', {})
    for c in eo.get('even_cells', []): s.cands[c['row'] * 9 + c['col']] &= _EVEN
    for c in eo.get('odd_cells', []): s.cands[c['row'] * 9 + c['col']] &= _ODD
    for t in con.get('thermo', {}).get('thermometers', []):
        sq = [x['row'] * 9 + x['col'] for x in t['cells']];
        tid = len(s.ts);
        s.ts.append(sq)
        for p, idx in enumerate(sq): s.t_map[idx].append((tid, p)); s.flags[idx] |= 1
    for a in con.get('arrow', {}).get('arrows', []):
        ci = a['circle']['row'] * 9 + a['circle']['col']
        st = [x['row'] * 9 + x['col'] for x in a['arrow_cells']]
        aid = len(s.as_);
        s.as_.append((ci, st));
        s.asum.append(0);
        s.afill.append(0)
        s.a_map[ci].append((aid, 'circle'));
        s.flags[ci] |= 2
        for x in st: s.a_map[x].append((aid, 'stem')); s.flags[x] |= 2
    for k in con.get('killer', {}).get('cages', []):
        cl = [x['row'] * 9 + x['col'] for x in k['cells']]
        kid = len(s.ks);
        s.ks.append((k['sum'], cl));
        s.ksum.append(0);
        s.kfill.append(0)
        for idx in cl: s.k_map[idx].append(kid); s.flags[idx] |= 4
    for d in con.get('kropki', {}).get('dots', []):
        a, b = d['cell_a']['row'] * 9 + d['cell_a']['col'], d['cell_b']['row'] * 9 + d['cell_b']['col']
        kid = len(s.kps);
        s.kps.append((a, b, d['type']))
        s.kp_map[a].append(kid);
        s.kp_map[b].append(kid);
        s.flags[a] |= 8;
        s.flags[b] |= 8

    for r in range(9):
        for c in range(9):
            val = rows[r][c]
            if val != 0:
                idx = r * 9 + c
                if not _check(s, idx, val): return []
                _place(s, idx, val)
                for k in s.k_map[idx]: s.ksum[k] += val; s.kfill[k] += 1
                for a, role in s.a_map[idx]:
                    if role == 'stem': s.asum[a] += val; s.afill[a] += 1
    _solve(s, lim)
    return s.sols


def solve_puzzle(p):
    g = p.get('grid', {})
    rows = g.get('rows', [])
    if not rows: return None
    con = p.get('constraints', {})
    res = run(rows, con, 1.5)
    if len(res) == 1:
        return [res[0][i:i + 9] for i in range(0, 81, 9)]
    if not res:
        c_res = run(rows, {}, 0.5)
        if len(c_res) == 1:
            return [c_res[0][i:i + 9] for i in range(0, 81, 9)]
    return None
