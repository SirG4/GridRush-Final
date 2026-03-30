import os, time
import json

from solver_core import solve_puzzle


def main():
    start = time.perf_counter()
    file_path = 'questions.json' if os.path.exists('questions.json') else 'template.json'

    if not os.path.exists(file_path):
        print(f"[ERROR] Cannot find {file_path}")
        return

    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    results = []
    for p in data.get('puzzles', []):
        pid = p.get('id', 'Unknown')
        print(f"Solving {pid}...")

        # answer_rows ya toh solved grid hogi (P1, P2) ya None (P3, P4, P5, P6)
        ans_rows = solve_puzzle(p)

        if ans_rows is None:
            # Invalid ya Unsolvable case
            final_grid = {
                "_comment": "This puzzles as multiple solutions."
            }
        else:
            # Solved Case
            final_grid = {
                "_comment": "9x9 grid. Use 0 for empty cells.",
                "rows": ans_rows
            }

        results.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "difficulty": p.get("difficulty"),
            "active_constraints": p.get("active_constraints"),
            "grid": final_grid
        })

    out_dict = {"answers": results}

    with open('answer.json', 'w', encoding='utf-8') as f:
        json.dump(out_dict, f, indent=2)

    print(f"\n[SUCCESS] Time: {time.perf_counter() - start:.4f}s")


if __name__ == "__main__":
    main()