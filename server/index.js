const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';
const SOLVER_TIMEOUT_MS = Number(process.env.SOLVER_TIMEOUT_MS || 180000);
let cachedWindowsRuntimeBin = null;
const SOLVER_CANDIDATES = [
  path.join(ROOT, 'build-win', 'sudoku_solver.exe'),
  path.join(ROOT, 'build-win', 'Debug', 'sudoku_solver.exe'),
  path.join(ROOT, 'build-win', 'Release', 'sudoku_solver.exe'),
  path.join(ROOT, 'build', 'sudoku_solver.exe'),
  path.join(ROOT, 'build', 'sudoku_solver'),
  path.join(ROOT, 'build', 'Debug', 'sudoku_solver.exe'),
  path.join(ROOT, 'build', 'Release', 'sudoku_solver.exe'),
  path.join(ROOT, 'build', 'RelWithDebInfo', 'sudoku_solver.exe'),
  path.join(ROOT, 'build', 'MinSizeRel', 'sudoku_solver.exe'),
];

const BUILD_HELP_MESSAGE = [
  'Solver binary not found or failed to run.',
  'Build backend from repository root with ./install.bat (Windows) or ./install.sh (macOS/Linux).',
  'If CMake is not in PATH: set CMAKE_EXE_OVERRIDE on Windows or CMAKE_BIN on macOS/Linux.',
].join(' ');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'frontend')));

function isValidGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== 9) return false;
  return grid.every((row) =>
    Array.isArray(row) &&
    row.length === 9 &&
    row.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)
  );
}

async function resolveSolverBinary() {
  for (const candidate of SOLVER_CANDIDATES) {
    if (IS_WINDOWS && path.extname(candidate).toLowerCase() !== '.exe') {
      continue;
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next location.
    }
  }
  return null;
}

async function resolveWindowsRuntimeBin() {
  if (!IS_WINDOWS) return null;
  if (cachedWindowsRuntimeBin) return cachedWindowsRuntimeBin;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const packagesRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');

  try {
    const packageDirs = await fs.readdir(packagesRoot, { withFileTypes: true });
    const llvmPkgDir = packageDirs.find((d) =>
      d.isDirectory() && d.name.startsWith('MartinStorsjo.LLVM-MinGW.UCRT')
    );

    if (!llvmPkgDir) return null;

    const llvmPkgPath = path.join(packagesRoot, llvmPkgDir.name);
    const contentDirs = await fs.readdir(llvmPkgPath, { withFileTypes: true });
    const toolchainDir = contentDirs.find((d) => d.isDirectory() && d.name.startsWith('llvm-mingw-'));
    if (!toolchainDir) return null;

    const binPath = path.join(llvmPkgPath, toolchainDir.name, 'bin');
    await fs.access(binPath);
    cachedWindowsRuntimeBin = binPath;
    return binPath;
  } catch {
    return null;
  }
}

function buildPuzzlePayload(category, givensGrid, variantData, checkUniqueness, checkAllSolutions, maxSolutionCount) {
  const pickThermos = (data) => {
    if (Array.isArray(data?.thermos)) return data.thermos;
    if (Array.isArray(data?.thermo)) return data.thermo;
    return [];
  };

  const pickArrows = (data) => {
    if (Array.isArray(data?.arrows)) return data.arrows;
    if (Array.isArray(data?.arrow)) return data.arrow;
    return [];
  };

  const puzzle = {
    category,
    check_uniqueness: Boolean(checkUniqueness),
    emit_logs: true,
    givens_grid: givensGrid,
  };

  if (category === 'classic') {
    puzzle.count_all_solutions = Boolean(checkAllSolutions);
    if (Number.isInteger(maxSolutionCount) && maxSolutionCount > 0) {
      puzzle.max_solution_count = maxSolutionCount;
    }
  }

  switch (category) {
    case 'classic':
      break;
    case 'even-odd':
      puzzle.even_cells = Array.isArray(variantData?.even_cells) ? variantData.even_cells : [];
      puzzle.odd_cells = Array.isArray(variantData?.odd_cells) ? variantData.odd_cells : [];
      break;
    case 'killer':
      puzzle.killer_cages = Array.isArray(variantData?.killer_cages) ? variantData.killer_cages : [];
      break;
    case 'thermo':
      puzzle.thermos = pickThermos(variantData);
      break;
    case 'arrow':
      puzzle.arrows = pickArrows(variantData);
      break;
    case 'kropki':
      puzzle.kropki = Array.isArray(variantData?.kropki) ? variantData.kropki : [];
      break;
    case 'hybrid':
      if (variantData && typeof variantData === 'object') {
        Object.assign(puzzle, variantData);
        // Accept singular aliases users commonly type in the JSON editor.
        puzzle.thermos = pickThermos(variantData);
        puzzle.arrows = pickArrows(variantData);
      }
      break;
    default:
      throw new Error(`Unsupported category: ${category}`);
  }

  return puzzle;
}

function parseSolverOutput(stdout) {
  const lines = stdout.split(/\r?\n/);

  const solvedIdx = lines.findIndex((l) => l.trim() === 'Solved grid:');
  const uniqueIdx = lines.findIndex((l) => l.trim().startsWith('Unique:'));
  const logIdx = lines.findIndex((l) => l.trim() === 'Glassbox solving log:');

  if (solvedIdx < 0 || uniqueIdx < 0) {
    throw new Error('Unexpected solver output format.');
  }

  const gridLines = lines.slice(solvedIdx + 1, solvedIdx + 10);
  if (gridLines.length !== 9) {
    throw new Error('Solver did not return a full 9x9 grid.');
  }

  const solvedGrid = gridLines.map((line) => {
    const nums = line.trim().split(/\s+/).map((n) => Number(n));
    if (nums.length !== 9 || nums.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) {
      throw new Error('Invalid solved grid row from solver output.');
    }
    return nums;
  });

  const uniqueLine = lines[uniqueIdx].trim().toLowerCase();
  let unique = null;
  let uniquenessChecked = false;
  if (uniqueLine.includes('true')) {
    unique = true;
    uniquenessChecked = true;
  } else if (uniqueLine.includes('false')) {
    unique = false;
    uniquenessChecked = true;
  }

  const solutionCountIdx = lines.findIndex((l) => l.trim().startsWith('Solution count:'));
  const countCompleteIdx = lines.findIndex((l) => l.trim().startsWith('Count complete:'));
  let solutionCount = null;
  let solutionCountComplete = null;

  if (solutionCountIdx >= 0) {
    const raw = lines[solutionCountIdx].split(':').slice(1).join(':').trim().toLowerCase();
    if (raw !== 'skipped') {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 0) {
        solutionCount = parsed;
      }
    }
  }

  if (countCompleteIdx >= 0) {
    const raw = lines[countCompleteIdx].split(':').slice(1).join(':').trim().toLowerCase();
    if (raw === 'true') {
      solutionCountComplete = true;
    } else if (raw === 'false') {
      solutionCountComplete = false;
    }
  }

  const logs = logIdx >= 0
    ? lines.slice(logIdx + 1).filter((l) => l.trim().length > 0)
    : [];

  return {
    solved: true,
    solvedGrid,
    unique,
    uniquenessChecked,
    solutionCount,
    solutionCountComplete,
    logs,
    raw: stdout,
  };
}

function parseNoSolutionOutput(output) {
  const lines = output.split(/\r?\n/);
  const logsStart = lines.findIndex((l) => l.trim() === 'Glassbox solving log:');
  const logs = logsStart >= 0
    ? lines.slice(logsStart + 1).filter((l) => l.trim().length > 0)
    : lines.filter((l) => l.trim().length > 0 && l.trim() !== 'No valid solution found.');

  return {
    solved: false,
    solvedGrid: null,
    unique: null,
    uniquenessChecked: false,
    solutionCount: null,
    solutionCountComplete: null,
    logs,
    message: 'No valid solution found for the provided constraints.',
    raw: output,
  };
}

app.get('/api/health', async (_req, res) => {
  const solverPath = await resolveSolverBinary();
  return res.json({ ok: true, solverFound: Boolean(solverPath), solverPath });
});

app.post('/api/solve', async (req, res) => {
  try {
    const {
      category,
      givensGrid,
      variantData,
      checkUniqueness,
      checkAllSolutions,
      maxSolutionCount,
      includeLogs,
    } = req.body || {};
    const shouldIncludeLogs = includeLogs !== false;

    if (typeof category !== 'string') {
      return res.status(400).json({ ok: false, error: 'category is required.' });
    }

    if (!isValidGrid(givensGrid)) {
      return res.status(400).json({ ok: false, error: 'givensGrid must be a 9x9 matrix of integers 0..9.' });
    }

    const puzzle = buildPuzzlePayload(
      category,
      givensGrid,
      variantData || {},
      checkUniqueness,
      checkAllSolutions,
      maxSolutionCount
    );
    puzzle.emit_logs = shouldIncludeLogs;
    const solverBin = await resolveSolverBinary();

    if (!solverBin) {
      return res.status(500).json({
        ok: false,
        error: BUILD_HELP_MESSAGE,
        lookedIn: SOLVER_CANDIDATES,
      });
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `gridrush-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );

    await fs.writeFile(tmpFile, JSON.stringify(puzzle, null, 2), 'utf8');

    const runtimeBin = await resolveWindowsRuntimeBin();
    const solverDir = path.dirname(solverBin);
    const pathDelimiter = path.delimiter;
    const childPath = [
      solverDir,
      runtimeBin,
      process.env.PATH || '',
    ].filter(Boolean).join(pathDelimiter);

    execFile(solverBin, [tmpFile], {
      timeout: SOLVER_TIMEOUT_MS,
      env: { ...process.env, PATH: childPath },
    }, async (err, stdout, stderr) => {
      await fs.rm(tmpFile, { force: true });

      if (err) {
        const output = `${stdout || ''}\n${stderr || ''}`.trim();

        if (err.code === 'ETIMEDOUT' || err.killed) {
          const timeoutResult = {
            ok: true,
            solved: false,
            solvedGrid: null,
            unique: null,
            uniquenessChecked: false,
            solutionCount: null,
            solutionCountComplete: null,
            timedOut: true,
            logs: output ? output.split(/\r?\n/).filter((line) => line.trim().length > 0) : [],
            message: `Solver timed out after ${SOLVER_TIMEOUT_MS}ms. This puzzle is likely under-constrained or too expensive to prove uniqueness. Add more givens/constraints and try again.`,
            raw: output,
          };
          if (!shouldIncludeLogs) {
            timeoutResult.logs = [];
            delete timeoutResult.raw;
            timeoutResult.logsSuppressed = true;
          }
          return res.json(timeoutResult);
        }

        if (err.code === 2 || output.includes('No valid solution found.')) {
          const parsed = parseNoSolutionOutput(output);
          if (!shouldIncludeLogs) {
            parsed.logs = [];
            delete parsed.raw;
            parsed.logsSuppressed = true;
          }
          return res.json({ ok: true, ...parsed });
        }

        return res.status(500).json({
          ok: false,
          error: BUILD_HELP_MESSAGE,
          details: output || err.message,
        });
      }

      try {
        const parsed = parseSolverOutput(stdout);
        if (!shouldIncludeLogs) {
          parsed.logs = [];
          delete parsed.raw;
          parsed.logsSuppressed = true;
        }
        return res.json({ ok: true, ...parsed });
      } catch (parseErr) {
        return res.status(500).json({
          ok: false,
          error: parseErr.message,
          details: stdout,
        });
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Unknown server error.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GridRush server running at http://localhost:${PORT}`);
});
