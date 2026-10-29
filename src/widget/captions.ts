/**
 * Captions from a clip's word times: the words cut into short lines (a sentence's end or `maxWords` closes a line),
 * and the line showing at a time, with the word being said.
 */
import type { ClipWord } from "../clip";

export interface CaptionLine {
  words: ClipWord[];
  start: number;
  end: number;
}

/** A line stays up this long after its last word, unless the next one starts first. */
export const CAPTION_LINGER = 1.2;

export function captionLines(words: readonly ClipWord[], maxWords = 7): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: ClipWord[] = [];
  const close = () => {
    if (current.length) lines.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
  };
  for (const w of words) {
    current.push(w);
    if (current.length >= maxWords || /[.!?…:;]["')\]]*$/.test(w.word)) close();
  }
  close();
  return lines;
}

/** The line showing at `t` and the index of the word being said in it (-1 between words); null when none shows. */
export function captionAt(lines: readonly CaptionLine[], t: number): { line: CaptionLine; word: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const until = Math.min(line.end + CAPTION_LINGER, next ? next.start : Infinity);
    if (t >= line.start && t < until) {
      return { line, word: line.words.findIndex((w) => t >= w.start && t < w.end) };
    }
  }
  return null;
}
