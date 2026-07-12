import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { invalidateMetaCache } from '@/lib/questions';
import matter from 'gray-matter';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.join(VAULT_PATH, '题库');

interface QuestionInput {
  content: string;
  source_type?: string;
  source_year: number | null;
  source_name: string;
  source_qno: string;
  module?: string[];
  type: string;
  grade?: string;
  difficulty?: number | null;
  skill?: string[];
  tags?: string[];
}

/**
 * 根据 source_year、source_name 和 source_qno 计算文件路径
 */
function buildFilePath(sourceYear: number | null, sourceName: string, sourceQno: string, qid?: number): string {
  const dirName = sourceName || '未分类';
  const nameParts = [sourceYear, sourceName, sourceQno].filter(Boolean);
  const baseName = nameParts.length > 0 ? nameParts.join('-') : String(qid);
  return path.join(BANK_PATH, dirName, `${baseName}.md`);
}

/**
 * POST /api/add-questions
 *
 * 两种模式：
 *   action = "check"  → 只检查哪些文件已存在，不写入
 *   action = "write"  → 实际写入（配合 onConflict: "skip" | "overwrite"）
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    questions,
    action,
    onConflict,
  } = body as {
    questions: QuestionInput[];
    action?: string;          // "check" | "write"，默认 "write"（兼容旧版）
    onConflict?: string;      // "skip" | "overwrite"
  };

  if (!Array.isArray(questions) || questions.length === 0) {
    return Response.json({ error: '缺少题目数据' }, { status: 400 });
  }
  if (questions.some(q => !Number.isFinite(q.source_year) || !q.source_name?.trim() || !q.source_qno?.trim())) {
    return Response.json({ error: '来源年份、来源名称和来源题号不能为空' }, { status: 400 });
  }

  // ===== action = "check"：只检查冲突，不写入 =====
  if (action === 'check') {
    const conflicts: { index: number; source_qno: string; source_name: string; fileName: string }[] = [];
    // 先用一个占位 qid 算路径（目录和文件名不依赖 qid，但 source/number 都空时需要）
    const dummyQid = Date.now();

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const filePath = buildFilePath(q.source_year, q.source_name, q.source_qno, dummyQid);
      if (fs.existsSync(filePath)) {
        const fileName = path.basename(filePath);
        conflicts.push({ index: i, source_qno: q.source_qno, source_name: q.source_name, fileName });
      }
    }

    return Response.json({ conflicts });
  }

  // ===== action = "write"（或未指定，兼容旧版）=====
  const results: { qid: number; source_qno: string; source_name: string; skipped?: boolean; error?: string }[] = [];
  let lastQid = Date.now();

  for (const q of questions) {
    try {
      // 生成 qid
      const now = Date.now();
      const qid = now > lastQid ? now : lastQid + 1;
      lastQid = qid;

      // 先算文件路径，检查冲突
      const filePath = buildFilePath(q.source_year, q.source_name, q.source_qno, qid);
      const exists = fs.existsSync(filePath);

      // 文件已存在 + 用户选跳过 → 不写入
      if (exists && onConflict === 'skip') {
        results.push({ qid, source_qno: q.source_qno, source_name: q.source_name, skipped: true });
        continue;
      }

      // 组装 YAML
      const yaml: Record<string, unknown> = {
        qid,
        grade: q.grade || '高中',
        source_type: q.source_type || '',
        source_year: q.source_year ?? '',
        source_name: q.source_name,
        source_qno: q.source_qno,
        module: q.module || [],
        type: q.type,
        difficulty: q.difficulty ?? '',
        skill: q.skill || [],
        ai_tags: [],
        tags: q.tags || [],
        status: '待入库',
        selected: false,
      };

      // 剥离残留 YAML
      let cleanContent = q.content.trim();
      if (cleanContent.startsWith('---\n')) {
        const endIdx = cleanContent.indexOf('\n---\n', 4);
        if (endIdx !== -1) {
          cleanContent = cleanContent.slice(endIdx + 5).trim();
        }
      }

      const frontmatter = matter.stringify(cleanContent, yaml);

      // 确保目录存在
      const outDir = path.dirname(filePath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(filePath, frontmatter, 'utf-8');
      results.push({ qid, source_qno: q.source_qno, source_name: q.source_name });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ qid: 0, source_qno: q.source_qno, source_name: q.source_name, error: message });
    }
  }

  // 新增题目后清空缓存，下次扫描会重新读取
  invalidateMetaCache();

  return Response.json({ results });
}
