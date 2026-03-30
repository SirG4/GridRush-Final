import argparse
import json
import random
from pathlib import Path
from typing import Any


def generate_valid_grid(rng: random.Random) -> list[list[int]]:
    base = 3
    side = base * base

    def pattern(r: int, c: int) -> int:
        return (base * (r % base) + r // base + c) % side

    def shuffled(values: list[int]) -> list[int]:
        values_copy = values[:]
        rng.shuffle(values_copy)
        return values_copy

    r_base = list(range(base))
    rows = [g * base + r for g in shuffled(r_base) for r in shuffled(r_base)]
    cols = [g * base + c for g in shuffled(r_base) for c in shuffled(r_base)]
    nums = shuffled(list(range(1, side + 1)))

    return [[nums[pattern(r, c)] for c in cols] for r in rows]


def punch_holes(grid: list[list[int]], num_holes: int, rng: random.Random) -> list[list[int]]:
    puzzle = [row[:] for row in grid]
    cells = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(cells)

    holes = max(0, min(num_holes, 81))
    for r, c in cells[:holes]:
        puzzle[r][c] = 0

    return puzzle


def extract_even_odd_constraints(
    ground_truth: list[list[int]],
    num_constraints: int,
    rng: random.Random,
) -> dict[str, list[dict[str, int]]]:
    even_cells: list[dict[str, int]] = []
    odd_cells: list[dict[str, int]] = []

    cells = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(cells)

    picks = max(0, min(num_constraints, 81))
    for r, c in cells[:picks]:
        val = ground_truth[r][c]
        if val % 2 == 0:
            even_cells.append({"row": r, "col": c})
        else:
            odd_cells.append({"row": r, "col": c})

    return {"even_cells": even_cells, "odd_cells": odd_cells}


def next_puzzle_index(existing_puzzles: list[dict[str, Any]]) -> int:
    max_idx = 0
    for p in existing_puzzles:
        pid = str(p.get("id", ""))
        if len(pid) == 4 and pid.startswith("P") and pid[1:].isdigit():
            max_idx = max(max_idx, int(pid[1:]))
    return max_idx + 1


def ensure_base_shape(data: dict[str, Any]) -> dict[str, Any]:
    if "_meta" not in data or not isinstance(data["_meta"], dict):
        data["_meta"] = {
            "total_puzzles": 0,
            "description": "GridRush puzzle collection.",
            "constraint_types": ["even_odd"],
        }

    if "puzzles" not in data or not isinstance(data["puzzles"], list):
        data["puzzles"] = []

    constraint_types = data["_meta"].get("constraint_types")
    if not isinstance(constraint_types, list):
        data["_meta"]["constraint_types"] = ["even_odd"]
    elif "even_odd" not in constraint_types:
        constraint_types.append("even_odd")

    return data


def generate_and_append(
    file_path: Path,
    count: int,
    holes: int,
    constraints: int,
    seed: int | None,
) -> tuple[int, int]:
    rng = random.Random(seed)

    raw = file_path.read_text(encoding="utf-8")
    if not raw.strip():
        data: dict[str, Any] = {}
    else:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Recover from placeholder/comment-only files and rebuild expected shape.
            data = {}

    if not isinstance(data, dict):
        raise ValueError("question.json root must be an object")

    data = ensure_base_shape(data)
    puzzles: list[dict[str, Any]] = data["puzzles"]

    start_idx = next_puzzle_index(puzzles)

    for i in range(count):
        ground_truth = generate_valid_grid(rng)
        puzzle_grid = punch_holes(ground_truth, num_holes=holes, rng=rng)
        eo_constraints = extract_even_odd_constraints(ground_truth, num_constraints=constraints, rng=rng)

        puzzle_num = start_idx + i
        puzzle_obj = {
            "id": f"P{puzzle_num:03d}",
            "name": f"Synthetic Generation {puzzle_num}",
            "difficulty": "medium",
            "active_constraints": ["even_odd"],
            "grid": {
                "_comment": "9x9 grid. Use 0 for empty cells.",
                "rows": puzzle_grid,
            },
            "constraints": {
                "even_odd": eo_constraints,
            },
        }
        puzzles.append(puzzle_obj)

    data["_meta"]["total_puzzles"] = len(puzzles)

    with file_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    return start_idx, len(puzzles)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Append synthetic even/odd Sudoku puzzles into question.json",
    )
    parser.add_argument("--file", default="question.json", help="Path to the question JSON file")
    parser.add_argument("--count", type=int, default=10, help="Number of new puzzles to append")
    parser.add_argument("--holes", type=int, default=45, help="How many cells to blank out per puzzle")
    parser.add_argument("--constraints", type=int, default=8, help="How many even/odd markers to add")
    parser.add_argument("--seed", type=int, default=None, help="Optional deterministic seed")

    args = parser.parse_args()

    if args.count < 1:
        raise ValueError("--count must be >= 1")

    file_path = Path(args.file)
    if not file_path.exists():
        raise FileNotFoundError(f"Input file not found: {file_path}")

    start_idx, total = generate_and_append(
        file_path=file_path,
        count=args.count,
        holes=args.holes,
        constraints=args.constraints,
        seed=args.seed,
    )

    print(f"Appended {args.count} puzzle(s) starting at P{start_idx:03d}")
    print(f"Updated total_puzzles: {total}")
    print(f"Output file: {file_path}")


if __name__ == "__main__":
    main()
