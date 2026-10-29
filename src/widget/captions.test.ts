import { describe, expect, it } from "vitest";

import { CAPTION_LINGER, captionAt, captionLines } from "./captions";

const words = "Hi there. I'm the assistant of this site, and I talk a lot".split(" ")
  .map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));

describe("captions", () => {
  it("cuts lines at a sentence's end or at the word limit", () => {
    const lines = captionLines(words, 5);
    expect(lines.map((l) => l.words.map((w) => w.word).join(" "))).toEqual([
      "Hi there.", "I'm the assistant of this", "site, and I talk a", "lot",
    ]);
    expect(lines[0]).toMatchObject({ start: 0, end: 0.9 });
  });

  it("shows the line being said with its word, lingers, and gives way to the next line", () => {
    const lines = captionLines(words, 5);
    expect(captionAt(lines, 0.1)).toMatchObject({ line: lines[0], word: 0 });
    expect(captionAt(lines, 0.95)).toMatchObject({ line: lines[0], word: -1 }); // between words: the line stays
    expect(captionAt(lines, 1.0)?.line).toBe(lines[1]);
    const last = lines[lines.length - 1];
    expect(captionAt(lines, last.end + CAPTION_LINGER - 0.01)?.line).toBe(last);
    expect(captionAt(lines, last.end + CAPTION_LINGER + 0.01)).toBeNull();
    expect(captionAt(lines, -1)).toBeNull();
  });
});
