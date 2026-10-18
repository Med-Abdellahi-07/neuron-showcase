import Papa from "papaparse";
import { z } from "zod";
import type { DictKey } from "@/lib/i18n/dictionaries";

/** خطأ استيراد: مفاتيح قاموس تُترجم في الواجهة + تفصيل تقني اختياري (يبقى كما هو) */
export interface ImportError {
  row: number;
  keys: DictKey[];
  detail?: string;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? undefined : String(v).trim());
const emptyToUndef = (v: unknown) => (str(v) === "" ? undefined : str(v));

const rowSchema = z
  .object({
    subject: z.preprocess(str, z.string({ message: "imp.err.subject" }).min(1, "imp.err.subject")),
    lesson_kind: z.preprocess((v) => emptyToUndef(v)?.toLowerCase(), z.enum(["cm", "td", "tp", "resume"]).optional()),
    lesson_number: z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional()),
    type: z.preprocess((v) => str(v)?.toLowerCase(), z.enum(["mcq", "written"], { message: "imp.err.type" })),
    difficulty: z.preprocess(
      (v) => emptyToUndef(v)?.toLowerCase() ?? "medium",
      z.enum(["easy", "medium", "hard"], { message: "imp.err.difficulty" })
    ),
    statement: z.preprocess(str, z.string({ message: "imp.err.statement" }).min(3, "imp.err.statement")),
    options: z.array(z.preprocess(str, z.string().min(1))).max(6).optional(),
    correct: z.preprocess((v) => emptyToUndef(v)?.toUpperCase(), z.string().optional()),
    model_answer: z.preprocess(emptyToUndef, z.string().optional()),
    explanation: z.preprocess(emptyToUndef, z.string().optional()),
    // اختياري: سؤال مخصّص للاختبار المصنّف فقط (لا يظهر في التدريب الحر ولا في تنزيل QCM)
    exam_only: z.preprocess((v) => {
      if (typeof v === "boolean") return v;
      const x = emptyToUndef(v)?.toLowerCase();
      return x === undefined ? false : ["1", "true", "yes", "oui", "y", "x", "نعم"].includes(x);
    }, z.boolean()),
  })
  .superRefine((r, ctx) => {
    if (r.type === "mcq") {
      if (!r.options || r.options.length < 2) {
        ctx.addIssue({ code: "custom", message: "imp.err.options" });
        return;
      }
      const idx = r.correct ? LETTERS.indexOf(r.correct as (typeof LETTERS)[number]) : -1;
      if (idx < 0 || idx >= r.options.length) {
        ctx.addIssue({ code: "custom", message: "imp.err.correct" });
      }
    } else if (!r.model_answer) {
      ctx.addIssue({ code: "custom", message: "imp.err.modelAnswer" });
    }
    if (r.lesson_number && !r.lesson_kind) {
      ctx.addIssue({ code: "custom", message: "imp.err.lessonKind" });
    }
  });

export interface ImportQuestion {
  subject: string;
  lesson_kind?: "cm" | "td" | "tp" | "resume";
  lesson_number?: number;
  type: "mcq" | "written";
  difficulty: "easy" | "medium" | "hard";
  statement: string;
  options?: string[];
  correct_index?: number;
  model_answer?: string;
  explanation?: string;
  exam_only: boolean;
}

export interface ParseResult {
  valid: ImportQuestion[];
  errors: ImportError[];
}

/** يحوّل صف CSV (option_a…option_f) إلى الشكل الموحّد. */
function fromCsvRow(raw: Record<string, unknown>): Record<string, unknown> {
  const options = ["a", "b", "c", "d", "e", "f"]
    .map((l) => str(raw[`option_${l}`]))
    .filter((o): o is string => !!o);
  return { ...raw, options: options.length ? options : undefined };
}

export function parseQuestionInput(text: string): ParseResult {
  const trimmed = text.trim();
  const result: ParseResult = { valid: [], errors: [] };
  if (!trimmed) return result;

  let rawRows: Record<string, unknown>[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      const list = Array.isArray(json) ? json : Array.isArray(json?.questions) ? json.questions : [json];
      rawRows = list.filter((x: unknown) => x && typeof x === "object") as Record<string, unknown>[];
    } catch (e) {
      result.errors.push({ row: 0, keys: ["imp.err.json"], detail: (e as Error).message });
      return result;
    }
  } else {
    const parsed = Papa.parse<Record<string, unknown>>(trimmed, { header: true, skipEmptyLines: true });
    if (parsed.errors.length && !parsed.data.length) {
      result.errors.push({ row: 0, keys: ["imp.err.csv"], detail: parsed.errors[0].message });
      return result;
    }
    rawRows = parsed.data.map(fromCsvRow);
  }

  rawRows.forEach((raw, i) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ row: i + 1, keys: [...new Set(parsed.error.issues.map((x) => x.message as DictKey))] });
      return;
    }
    const r = parsed.data;
    result.valid.push({
      subject: r.subject.toUpperCase(),
      lesson_kind: r.lesson_kind,
      lesson_number: r.lesson_number,
      type: r.type,
      difficulty: r.difficulty,
      statement: r.statement,
      options: r.type === "mcq" ? r.options : undefined,
      correct_index: r.type === "mcq" ? LETTERS.indexOf(r.correct as (typeof LETTERS)[number]) : undefined,
      model_answer: r.model_answer,
      explanation: r.explanation,
      exam_only: r.exam_only,
    });
  });
  return result;
}

export const QUESTION_PROMPT = `Tu es un enseignant en Intelligence Artificielle. À partir du cours joint, génère {N} questions d'entraînement en FRANÇAIS.

Règles :
- Mélange les niveaux : "easy", "medium", "hard".
- Mélange les types : "mcq" (QCM à UNE seule bonne réponse, 4 options) et "written" (exercice rédigé avec une correction type complète).
- Les formules mathématiques s'écrivent en LaTeX : $x^2$ en ligne, $$\\sum_i x_i$$ en bloc.
- Le code s'écrit entre triples backticks.
- Chaque question doit être vérifiable à partir du cours (pas de piège ambigu).
- "correct" est la LETTRE de la bonne option (A, B, C ou D).
- Optionnel : "exam_only": true pour réserver une question au test classé (elle n'apparaîtra ni dans l'entraînement libre ni dans le QCM PDF). Par défaut : false.
- Renseigne "subject" avec le code de la matière (ex : LIAA311) et "lesson_kind" (cm, td, tp ou resume) + "lesson_number" de la séance concernée.

Réponds UNIQUEMENT par un tableau JSON valide (sans texte autour), au format :

[
  {
    "subject": "LIAA311",
    "lesson_kind": "cm",
    "lesson_number": 3,
    "type": "mcq",
    "difficulty": "easy",
    "statement": "Quelle est la fonction de coût usuelle en régression linéaire ?",
    "options": ["Entropie croisée", "Erreur quadratique moyenne", "Distance de Hamming", "Indice de Gini"],
    "correct": "B",
    "explanation": "La régression linéaire minimise l'erreur quadratique moyenne (MSE)."
  },
  {
    "subject": "LIAA311",
    "lesson_kind": "td",
    "lesson_number": 2,
    "type": "written",
    "difficulty": "hard",
    "statement": "Démontrer que la solution des moindres carrés vérifie $X^TX\\\\theta = X^Ty$.",
    "model_answer": "On dérive $J(\\\\theta)=\\\\|X\\\\theta-y\\\\|^2$ ... d'où $X^TX\\\\theta = X^Ty$.",
    "explanation": "Équations normales."
  }
]`;

export const QUESTION_CSV_EXAMPLE = `subject,lesson_kind,lesson_number,type,difficulty,statement,option_a,option_b,option_c,option_d,correct,model_answer,explanation,exam_only
LIAA311,cm,3,mcq,easy,"Quelle est la fonction de coût usuelle en régression linéaire ?",Entropie croisée,Erreur quadratique moyenne,Distance de Hamming,Indice de Gini,B,,La régression linéaire minimise la MSE.,
LIAA311,td,2,written,hard,"Démontrer les équations normales.",,,,,,"On dérive J(θ) puis on annule le gradient.",Équations normales.,`;
