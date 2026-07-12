import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { invalidateMetaCache } from '@/lib/questions';

// Vault 内容是运行时数据，不应被 Turbopack 当作应用依赖递归追踪。
const VAULT_PATH = path.resolve(/*turbopackIgnore: true*/ process.env.VAULT_PATH || './demo-vault');
const BANK_PATH = path.join(VAULT_PATH, '题库');
const IMAGES_PATH = path.join(VAULT_PATH, 'images');

type DeleteAction = 'preview' | 'delete';

interface QuestionFile {
  qid: number;
  filePath: string;
  raw: string;
}

interface DeleteError {
  type: 'question' | 'image';
  qid?: number;
  filename?: string;
  message: string;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.bak')) files.push(entryPath);
  }
  return files;
}

function scanQuestionFiles(): QuestionFile[] {
  const questions: QuestionFile[] = [];
  for (const filePath of listMarkdownFiles(BANK_PATH)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const qid = Number(matter(raw).data.qid);
      if (Number.isFinite(qid)) questions.push({ qid, filePath, raw });
    } catch {
      // Invalid Markdown/YAML is not a deletable question and is ignored here.
    }
  }
  return questions;
}

export function extractImageReferences(raw: string): Set<string> {
  const images = new Set<string>();
  const add = (value: string) => {
    const filename = value.trim().replace(/\\/g, '/');
    if (filename) images.add(filename);
  };

  for (const match of raw.matchAll(/!\[\[images\/([^\]|]+)(?:\|[^\]]+)?\]\]/g)) add(match[1]);
  for (const match of raw.matchAll(/!\[[^\]]*\]\(\s*<?images\/([^)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) add(match[1]);
  return images;
}

function safeImagePath(filename: string): string | null {
  const candidate = path.resolve(IMAGES_PATH, filename);
  return isInside(IMAGES_PATH, candidate) ? candidate : null;
}

function analyze(qids: number[], questions: QuestionFile[]) {
  const requested = new Set(qids);
  const selected = questions.filter(question => requested.has(question.qid));
  const foundQids = new Set(selected.map(question => question.qid));
  const missingQids = qids.filter(qid => !foundQids.has(qid));
  const selectedImages = new Set<string>();
  const remainingImages = new Set<string>();

  for (const question of selected) {
    for (const image of extractImageReferences(question.raw)) selectedImages.add(image);
  }
  for (const question of questions) {
    if (requested.has(question.qid)) continue;
    for (const image of extractImageReferences(question.raw)) remainingImages.add(image);
  }

  const sharedImages = [...selectedImages].filter(image => remainingImages.has(image)).sort();
  const deletableImages = [...selectedImages].filter(image => !remainingImages.has(image)).sort();
  return { selected, missingQids, sharedImages, deletableImages };
}

export async function POST(request: Request) {
  let body: { qids?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是 JSON' }, { status: 400 });
  }

  const action = body.action as DeleteAction;
  const qids = Array.isArray(body.qids)
    ? [...new Set(body.qids.map(Number).filter(qid => Number.isFinite(qid) && qid > 0))]
    : [];
  if (qids.length === 0) return Response.json({ error: '请提供有效的题目 qid 列表' }, { status: 400 });
  if (action !== 'preview' && action !== 'delete') {
    return Response.json({ error: 'action 必须是 preview 或 delete' }, { status: 400 });
  }

  try {
    const questions = scanQuestionFiles();
    const preview = analyze(qids, questions);
    if (action === 'preview') {
      return Response.json({
        ok: true,
        action,
        questionCount: preview.selected.length,
        deletableImageCount: preview.deletableImages.length,
        sharedImageCount: preview.sharedImages.length,
        missingQids: preview.missingQids,
        deletableImages: preview.deletableImages,
        sharedImages: preview.sharedImages,
        errors: [],
      });
    }

    const deletedQids: number[] = [];
    const errors: DeleteError[] = [];
    for (const question of preview.selected) {
      const resolved = path.resolve(question.filePath);
      if (!isInside(BANK_PATH, resolved)) {
        errors.push({ type: 'question', qid: question.qid, message: '题目路径超出题库目录' });
        continue;
      }
      try {
        fs.unlinkSync(resolved);
        deletedQids.push(question.qid);
      } catch (error) {
        errors.push({ type: 'question', qid: question.qid, message: error instanceof Error ? error.message : '删除失败' });
      }
    }

    // Re-scan after question deletion so images remain safe if a question failed to delete.
    const remainingReferences = new Set<string>();
    for (const question of scanQuestionFiles()) {
      for (const image of extractImageReferences(question.raw)) remainingReferences.add(image);
    }
    const originallySelectedImages = new Set(preview.selected.flatMap(question => [...extractImageReferences(question.raw)]));
    const sharedImages = [...originallySelectedImages].filter(image => remainingReferences.has(image)).sort();
    const deletedImages: string[] = [];
    const missingImages: string[] = [];

    for (const filename of originallySelectedImages) {
      if (remainingReferences.has(filename)) continue;
      const imagePath = safeImagePath(filename);
      if (!imagePath) {
        errors.push({ type: 'image', filename, message: '图片路径超出 images 目录' });
        continue;
      }
      if (!fs.existsSync(imagePath)) {
        missingImages.push(filename);
        continue;
      }
      try {
        fs.unlinkSync(imagePath);
        deletedImages.push(filename);
      } catch (error) {
        errors.push({ type: 'image', filename, message: error instanceof Error ? error.message : '删除失败' });
      }
    }

    invalidateMetaCache();
    return Response.json({
      ok: errors.length === 0,
      action,
      deletedQids,
      deletedImages,
      sharedImages,
      missingQids: preview.missingQids,
      missingImages,
      errors,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '删除题目时发生未知错误' }, { status: 500 });
  }
}
