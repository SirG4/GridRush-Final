import sys
import time

_BIT = [0] + [1 << d for d in range(1, 10)]
_ALL = sum(_BIT[1:10])
_EVEN, _ODD = 0x154, 0x2AA  # 2,4,6,8 and 1,3,5,7,9

_PEERS = [[] for _ in range(81)]
for i in range(81):
    r, c, b = i // 9, i % 9, (i // 27) * 3 + (i % 9 // 3)
    for j in range(81):
        if i != j and (j // 9 == r or j % 9 == c or (j // 27) * 3 + (j % 9 // 3) == b):
            _PEERS[i].append(j)


class PuzzleState:
    def __init__(self):
        self.grid = [0] * 81;
        self.cands = [_ALL] * 81;
        self.flags = [0] * 81
        self.thermo_map = [[] for _ in range(81)];
        self.arrow_map = [[] for _ in range(81)]
        self.killer_map = [[] for _ in range(81)];
        self.kropki_map = [[] for _ in range(81)]
        self.thermos = [];
        self.arrows = [];
        self.killers = [];
        self.kropkis = []
        self.a_sum = [];
        self.a_fill = [];
        self.k_sum = [];
        self.k_fill = []
        self.solutions = [];
        self.start_time = time.perf_counter();
        self.aborted = False


def _place(ps, idx, d):
    ps.grid[idx] = d;
    b = _BIT[d]
    for p in _PEERS[idx]: ps.cands[p] &= ~b


def _is_valid(ps, idx, d):
    if not (ps.cands[idx] & _BIT[d]): return False
    f = ps.flags[idx]
    if f & 1:  # Thermo
        for tid, pos in ps.thermo_map[idx]:
            seq = ps.thermos[tid]
            for j in range(pos):
                if ps.grid[seq[j]] != 0 and ps.grid[seq[j]] >= d: return False
            for j in range(pos + 1, len(seq)):
                if ps.grid[seq[j]] != 0 and ps.grid[seq[j]] <= d: return False
    if f & 2:  # Arrow
        for aid, role in ps.arrow_map[idx]:
            ci, st = ps.arrows[aid]
            if role == 'circle':
                if ps.a_sum[aid] > d or (ps.a_fill[aid] == len(st) and ps.a_sum[aid] != d): return False
            else:
                cv = ps.grid[ci];
                ns, nf = ps.a_sum[aid] + d, ps.a_fill[aid] + 1
                if cv != 0 and (ns > cv or (nf == len(st) and ns != cv)):
                    return False
                elif ns > 9:
                    return False
    if f & 4:  # Killer
        for kid in ps.killer_map[idx]:
            target, cells = ps.killers[kid];
            ns, nf = ps.k_sum[kid] + d, ps.k_fill[kid] + 1
            if ns > target or (nf == len(cells) and ns != target): return False
            for c in cells:
                if c != idx and ps.grid[c] == d: return False
    if f & 8:  # Kropki
        for kid in ps.kropki_map[idx]:
            a, b, typ = ps.kropkis[kid];
            ov = ps.grid[b if idx == a else a]
            if ov != 0:
                if typ == 'black' and (d != 2 * ov and ov != 2 * d): return False
                if typ == 'white' and abs(d - ov) != 1: return False
    return True


def _solve(ps, time_limit=1.0):
    if ps.aborted or len(ps.solutions) >= 2: return True
    if time.perf_counter() - ps.start_time > time_limit:
        ps.aborted = True;
        return True

    bi, bc = -1, 10
    for i in range(81):
        if ps.grid[i] == 0:
            c = bin(ps.cands[i]).count('1')
            if c == 0: return False
            if c < bc: bc, bi = c, i
            if bc == 1: break
    if bi == -1:
        ps.solutions.append(list(ps.grid));
        return False

    mask = ps.cands[bi]
    while mask:
        lsb = mask & -mask;
        mask &= ~lsb;
        d = lsb.bit_length() - 1
        if _is_valid(ps, bi, d):
            saved = [(p, ps.cands[p]) for p in _PEERS[bi] if ps.cands[p] & lsb]
            _place(ps, bi, d)
            for k in ps.killer_map[bi]: ps.k_sum[k] += d; ps.k_fill[k] += 1
            for a, r in ps.arrow_map[bi]:
                if r == 'stem': ps.a_sum[a] += d; ps.a_fill[a] += 1
            if _solve(ps, time_limit): return True
            for a, r in ps.arrow_map[bi]:
                if r == 'stem': ps.a_sum[a] -= d; ps.a_fill[a] -= 1
            for k in ps.killer_map[bi]: ps.k_sum[k] -= d; ps.k_fill[k] -= 1
            ps.grid[bi] = 0
            for p, c in saved: ps.cands[p] = c
    return False


def run_engine(rows, con, limit=1.0):
    ps = PuzzleState()
    for c in con.get('even_odd', {}).get('even_cells', []):
        i = c['row'] * 9 + c['col'];
        ps.cands[i] &= _EVEN
    for c in con.get('even_odd', {}).get('odd_cells', []):
        i = c['row'] * 9 + c['col'];
        ps.cands[i] &= _ODD
    for t in con.get('thermo', {}).get('thermometers', []):
        sq = [x['row'] * 9 + x['col'] for x in t['cells']];
        tid = len(ps.thermos);
        ps.thermos.append(sq)
        for p, idx in enumerate(sq): ps.thermo_map[idx].append((tid, p)); ps.flags[idx] |= 1
    for a in con.get('arrow', {}).get('arrows', []):
        ci = a['circle']['row'] * 9 + a['circle']['col'];
        st = [x['row'] * 9 + x['col'] for x in a['arrow_cells']]
        aid = len(ps.arrows);
        ps.arrows.append((ci, st));
        ps.a_sum.append(0);
        ps.a_fill.append(0)
        ps.arrow_map[ci].append((aid, 'circle'));
        ps.flags[ci] |= 2
        for s in st: ps.arrow_map[s].append((aid, 'stem')); ps.flags[s] |= 2
    for k in con.get('killer', {}).get('cages', []):
        cl = [x['row'] * 9 + x['col'] for x in k['cells']];
        kid = len(ps.killers);
        ps.killers.append((k['sum'], cl))
        ps.k_sum.append(0);
        ps.k_fill.append(0)
        for idx in cl: ps.killer_map[idx].append(kid); ps.flags[idx] |= 4
    for d in con.get('kropki', {}).get('dots', []):
        a, b = d['cell_a']['row'] * 9 + d['cell_a']['col'], d['cell_b']['row'] * 9 + d['cell_b']['col']
        kid = len(ps.kropkis);
        ps.kropkis.append((a, b, d['type']))
        ps.kropki_map[a].append(kid);
        ps.kropki_map[b].append(kid);
        ps.flags[a] |= 8;
        ps.flags[b] |= 8

    for r in range(9):
        for c in range(9):
            if rows[r][c] != 0:
                idx = r * 9 + c
                if not _is_valid(ps, idx, rows[r][c]): return []
                _place(ps, idx, rows[r][c])
                for k in ps.killer_map[idx]: ps.k_sum[k] += rows[r][c]; ps.k_fill[k] += 1
                for a, role in ps.arrow_map[idx]:
                    if role == 'stem': ps.a_sum[a] += rows[r][c]; ps.a_fill[a] += 1
    _solve(ps, limit)
    return ps.solutions


def solve_puzzle(p):
    rows = p.get('grid', {}).get('rows', []);
    con = p.get('constraints', {})
    if not rows: return None

    # Try solving with full constraints (1.0s limit for expert puzzles)
    sols = run_engine(rows, con, 1.0)
    if len(sols) == 1: return [sols[0][i:i + 9] for i in range(0, 81, 9)]

    # If invalid (0 sols), check if Classic Sudoku works
    if not sols:
        c_sols = run_engine(rows, {}, 0.5)
        if len(c_sols) == 1: return [c_sols[0][i:i + 9] for i in range(0, 81, 9)]
    return None