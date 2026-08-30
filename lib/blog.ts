import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

export interface PostMeta {
  slug: string;
  title: string;
  /** One-line hook shown in the list and as the meta description */
  summary: string;
  /** ISO date, e.g. 2026-08-30 */
  date: string;
  /** Problem domain, e.g. "행정", "육아" */
  category: string;
  tags: string[];
}

export interface Post extends PostMeta {
  html: string;
  readingMinutes: number;
}

/**
 * YAML 은 따옴표 없는 `date: 2026-08-30` 을 Date 로 파싱한다.
 * 문자열로 쓰든 안 쓰든 `YYYY-MM-DD` 로 맞춘다.
 */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`날짜 형식은 YYYY-MM-DD 여야 합니다: '${s}'`);
  }
  return s;
}

function parse(file: string): { meta: PostMeta; body: string } {
  const slug = file.replace(/\.md$/, "");
  const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf8");
  const { data, content } = matter(raw);

  for (const key of ["title", "summary", "date", "category"] as const) {
    if (!data[key]) throw new Error(`content/blog/${file}: '${key}' 누락`);
  }

  return {
    meta: {
      slug,
      title: String(data.title),
      summary: String(data.summary),
      date: toIsoDate(data.date),
      category: String(data.category),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    },
    body: content,
  };
}

function files(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
}

/** Newest first. */
export function getAllPosts(): PostMeta[] {
  return files()
    .map((f) => parse(f).meta)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(slug: string): Post | null {
  const file = `${slug}.md`;
  if (!files().includes(file)) return null;

  const { meta, body } = parse(file);
  return {
    ...meta,
    html: marked.parse(body, { async: false }),
    // 한국어 기준 분당 약 500자
    readingMinutes: Math.max(1, Math.round(body.replace(/\s/g, "").length / 500)),
  };
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}. ${Number(m)}. ${Number(d)}.`;
}
