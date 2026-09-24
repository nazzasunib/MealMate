"use client";

import * as React from "react";

/**
 * Decorative "MEALMATE" pixel sequence drawn by lighting cells of a small grid
 * (legacy manual patch 9): full word -> each letter -> blank, looping.
 * Hidden on small/short screens and under prefers-reduced-motion.
 */
const FONT: Record<string, string[]> = {
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  E: ["#####", "#....", "###..", "#....", "#####"],
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
};
const WORD = "MEALMATE";
const ROWS = 5;
const GAP = 1;

function glyph(letter: string, startCol: number) {
  const g = FONT[letter];
  const cells: string[] = [];
  g.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && cells.push(`${startCol + c}:${r}`)));
  return { cells, width: g[0].length };
}

const WORD_CELLS: string[] = [];
let col = 0;
for (const ch of WORD) {
  const g = glyph(ch, col);
  WORD_CELLS.push(...g.cells);
  col += g.width + GAP;
}
const COLS = col - GAP;

const STEPS: { cells: Set<string>; hold: number }[] = [
  { cells: new Set(WORD_CELLS), hold: 2000 },
  ...[...WORD].map((ch) => {
    const g = glyph(ch, 0);
    const offset = Math.round((COLS - g.width) / 2);
    return { cells: new Set(glyph(ch, offset).cells), hold: 700 };
  }),
  { cells: new Set<string>(), hold: 1000 },
];

export function GridBackground() {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEPS[step].hold);
    return () => clearTimeout(t);
  }, [step]);

  const lit = STEPS[step].cells;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 hidden justify-center pb-8 [@media(min-width:821px)_and_(min-height:761px)_and_(prefers-reduced-motion:no-preference)]:flex"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, 12px)`, gridTemplateRows: `repeat(${ROWS}, 12px)`, gap: 2 }}>
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const key = `${i % COLS}:${Math.floor(i / COLS)}`;
          const on = lit.has(key);
          return (
            <span
              key={key}
              className="rounded-[2px] transition-[background-color,opacity] duration-500"
              style={{ background: on ? "var(--color-navy-700)" : "var(--color-border)", opacity: on ? 0.85 : 0.35 }}
            />
          );
        })}
      </div>
    </div>
  );
}
