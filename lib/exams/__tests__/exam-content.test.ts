import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { questionBankSchema, syllabusSchema, type Syllabus } from "../schema";

const examsDir = path.resolve(__dirname, "../../../data/exams");
const banksDir = path.join(examsDir, "question-banks");
const misconceptionsDir = path.resolve(__dirname, "../../../data/misconceptions");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown;

const syllabusFiles = readdirSync(examsDir).filter((f) => f.endsWith(".json"));
const syllabi = new Map<string, Syllabus>();

describe("exam syllabus files", () => {
  it.each(syllabusFiles)("%s matches the schema and its file name", (file) => {
    const result = syllabusSchema.safeParse(read(path.join(examsDir, file)));
    if (!result.success) throw new Error(`${file}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    expect(result.data.exam).toBe(file.replace(/\.json$/, ""));
    syllabi.set(result.data.exam, result.data);
  });

  it("covers NISM XV, CFA Level I, GATE and a board exam", () => {
    for (const exam of ["nism-xv", "cfa-l1", "gate-cs", "board"]) expect(syllabi.has(exam)).toBe(true);
  });
});

describe("question banks", () => {
  const bankFiles = readdirSync(banksDir).filter((f) => f.endsWith(".json"));
  const misconceptionIds = new Set(
    readdirSync(misconceptionsDir).flatMap((f) =>
      (read(path.join(misconceptionsDir, f)) as { entries: { id: string }[] }).entries.map((e) => e.id),
    ),
  );

  it.each(bankFiles)("%s is valid and points at real chapters and misconceptions", (file) => {
    const result = questionBankSchema.safeParse(read(path.join(banksDir, file)));
    if (!result.success) throw new Error(`${file}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const bank = result.data;
    expect(bank.exam).toBe(file.replace(/\.json$/, ""));
    const syllabus = syllabusSchema.parse(read(path.join(examsDir, `${bank.exam}.json`)));
    const chapterIds = new Set(syllabus.chapters.map((c) => c.id));
    for (const q of bank.questions) {
      expect(chapterIds, `${q.id} chapterId`).toContain(q.chapterId);
      if (q.misconceptionId) expect(misconceptionIds, `${q.id} misconceptionId`).toContain(q.misconceptionId);
    }
  });
});

describe("schema rules", () => {
  const base = {
    exam: "x",
    name: "X",
    conductedBy: "Y",
    status: "draft",
    source: { document: null, version: null, url: null, verifiedOn: null },
    format: { questions: null, durationMinutes: null, totalMarks: null, passPercent: null, negativeMarking: null },
  };
  const chapter = (id: string, w: number | null) => ({ id, title: id, weightagePercent: w, topics: [] });

  it("requires filled weightages to add up to 100", () => {
    expect(syllabusSchema.safeParse({ ...base, chapters: [chapter("a", 60), chapter("b", 30)] }).success).toBe(false);
    expect(syllabusSchema.safeParse({ ...base, chapters: [chapter("a", 60), chapter("b", 40)] }).success).toBe(true);
    expect(syllabusSchema.safeParse({ ...base, chapters: [chapter("a", 60), chapter("b", null)] }).success).toBe(true);
  });

  it("refuses 'verified' without a source and date", () => {
    expect(syllabusSchema.safeParse({ ...base, status: "verified", chapters: [chapter("a", 100)] }).success).toBe(false);
  });

  it("rejects an answer index outside the options", () => {
    const q = {
      id: "q1", chapterId: "a", concept: "c", difficulty: "easy", type: "mcq", stem: "s",
      options: ["a", "b"], answerIndex: 2, explanation: "e", marks: 1, negativeMarks: 0,
      source: { document: null, page: null }, status: "draft",
    };
    expect(questionBankSchema.safeParse({ exam: "x", status: "draft", questions: [q] }).success).toBe(false);
  });
});
