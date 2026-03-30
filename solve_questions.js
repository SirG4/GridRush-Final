const fs = require('fs');
const path = require('path');
const { solvePuzzle } = require('./solver_fast');

function toInternalVariants(constraints) {
  const variants = {};
  if (!constraints) return variants;

  // even_odd
  if (constraints.even_odd) {
    const eo = constraints.even_odd;
    variants.evenodd = {
      even: (eo.even_cells || []).map(p => [p.row, p.col]),
      odd: (eo.odd_cells || []).map(p => [p.row, p.col]),
    };
  } else if (constraints.evenodd) {
    // already internal-ish
    variants.evenodd = constraints.evenodd;
  }

  // killer
  if (constraints.killer) {
    variants.killer = {
      cages: (constraints.killer.cages || []).map(c => ({
        cells: (c.cells || []).map(p => [p.row, p.col]),
        sum: c.sum,
      })),
    };
  }

  // thermo
  if (constraints.thermo) {
    variants.thermo = {
      thermos: (constraints.thermo.thermometers || []).map(t => t.cells.map(p => [p.row, p.col])),
    };
  } else if (constraints.thermo?.thermos) {
    variants.thermo = constraints.thermo;
  } else if (constraints.thermometers) {
    // alternate shape
    variants.thermo = { thermos: constraints.thermometers.map(t => t.cells.map(p => [p.row, p.col])) };
  }

  // arrow
  if (constraints.arrow) {
    variants.arrow = {
      arrows: (constraints.arrow.arrows || []).map(a => ({
        circle: [a.circle.row, a.circle.col],
        arrow: (a.arrow_cells || []).map(p => [p.row, p.col]),
      })),
    };
  } else if (constraints.arrow?.arrows) {
    variants.arrow = constraints.arrow;
  }

  // kropki
  if (constraints.kropki) {
    variants.kropki = {
      dots: (constraints.kropki.dots || []).map(d => ({
        type: d.type,
        cells: [
          [d.cell_a.row, d.cell_a.col],
          [d.cell_b.row, d.cell_b.col],
        ],
      })),
    };
  }

  return variants;
}

function extractGridRows(puzzle) {
  // Expected template schema: puzzle.grid.rows
  if (puzzle.grid?.rows) return puzzle.grid.rows;
  if (puzzle.grid && Array.isArray(puzzle.grid)) return puzzle.grid;
  throw new Error('Puzzle grid missing rows');
}

function normalizePuzzles(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.puzzles)) return input.puzzles;
  if (input && Array.isArray(input.questions)) return input.questions;
  throw new Error('Unsupported JSON shape: expected an array or { puzzles: [...] }');
}

function solveFromQuestions(questionsJson) {
  const puzzles = normalizePuzzles(questionsJson);
  const outAnswers = [];
  const errors = [];

  for (const puzzle of puzzles) {
    const id = puzzle.id;
    const name = puzzle.name;
    const difficulty = puzzle.difficulty;
    const active_constraints = puzzle.active_constraints || [];

    // Internal solver expects { grid, variants }
    let internalVariants = {};
    if (puzzle.variants || puzzle.variant) {
      internalVariants = puzzle.variants || puzzle.variant || {};
    } else if (puzzle.constraints) {
      internalVariants = toInternalVariants(puzzle.constraints);
    }

    const grid = extractGridRows(puzzle);

    let resultGrid = solvePuzzle({ grid, variants: internalVariants });

    // Some datasets use the opposite kropki convention.
    // Retry once with black/white swapped (still a valid variant interpretation).
    if (!resultGrid && internalVariants?.kropki?.dots?.length) {
      const swapped = {
        ...internalVariants,
        kropki: {
          dots: internalVariants.kropki.dots.map(d => ({
            ...d,
            type: d.type === 'black' ? 'white' : d.type === 'white' ? 'black' : d.type,
          })),
        },
      };
      resultGrid = solvePuzzle({ grid, variants: swapped });
      if (resultGrid) internalVariants = swapped;
    }

    let comment = '9x9 grid. Use 0 for empty cells.';
    if (!resultGrid) {
      // Keep going so you can still render results for other puzzles in the UI.
      // We keep the original grid for this puzzle (unsolved).
      resultGrid = grid;
      comment = `UNSOLVED: solver could not find a solution for ${id || name || '(unknown)'}.`;
      errors.push({ id, name, error: 'No solution found (or constraints inconsistent)' });
    }

    outAnswers.push({
      id,
      name,
      difficulty,
      active_constraints,
      grid: {
        _comment: comment,
        rows: resultGrid,
      },
    });
  }

  return { answers: outAnswers, _errors: errors.length ? errors : undefined };
}

function main() {
  const questionsPath = process.argv[2] || 'questions.json';
  const answerPath = process.argv[3] || 'answer.json';

  const absQuestions = path.resolve(process.cwd(), questionsPath);
  const absAnswer = path.resolve(process.cwd(), answerPath);

  if (!fs.existsSync(absQuestions)) {
    throw new Error(`Missing input file: ${absQuestions}`);
  }
  const stat = fs.statSync(absQuestions);
  if (stat.size === 0) {
    throw new Error(
      `Input file is empty (${stat.size} bytes): ${absQuestions}\n` +
        `For local testing, run with: pwsh ./run.ps1 -QuestionsPath ./template.json -AnswerPath ./answer.json`
    );
  }

  const raw = fs.readFileSync(absQuestions, 'utf8');
  let questionsJson;
  try {
    questionsJson = JSON.parse(raw);
  } catch (e) {
    const preview = raw.slice(0, 250);
    throw new Error(
      `Invalid JSON in ${absQuestions}.\n` +
        `Parse error: ${e.message}\n` +
        `First 250 chars: ${JSON.stringify(preview)}`
    );
  }

  const answers = solveFromQuestions(questionsJson);
  fs.writeFileSync(absAnswer, JSON.stringify(answers, null, 2), 'utf8');
}

main();

