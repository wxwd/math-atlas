import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.join(VAULT_PATH, '题库');
const CACHE_VERSION_PATH = path.join(VAULT_PATH, '.mathatlas-cache-version');

// 轻量元数据（不含正文，用于首页表格）
export interface QuestionMetaLight {
  qid: number;
  grade: string;
  source_type: string;
  source_year: number | null;
  source_name: string;
  source_qno: string;
  module: string[];
  type: string;
  filePath: string;
  difficulty: number;
  skill: string[];
  tags: string[];
}

// 完整题目（含正文，用于展开详情和讲义）
export interface QuestionMeta extends QuestionMetaLight {
  content: string;
}

type Frontmatter = Record<string, unknown>;

function toStringArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter(value => value != null && value !== '')
    .map(value => typeof value === 'string' ? value : String(value));
}

/** 解析题目的 Markdown 正文为各个 section（题目、答案、解析等） */
export function parseSections(raw: string): Record<string, string> {
  raw = raw.replace(/\r\n/g, '\n');
  const result: Record<string, string> = {};
  const parts = raw.split(/\n(?=## )/);
  for (const block of parts) {
    const m = block.match(/^## (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const body = m[2].trim();
    if (title === '备注') {
      const subs = body.split(/\n(?=### )/);
      let noteBody = '';
      for (const sub of subs) {
        const sm = sub.match(/^### (.+?)\n([\s\S]*)$/);
        if (sm) {
          result[sm[1].trim()] = sm[2].trim();
        } else {
          noteBody += sub;
        }
      }
      if (noteBody.trim()) result['备注'] = noteBody.trim();
    } else {
      result[title] = body;
    }
  }
  return result;
}

// 内存缓存：避免每次请求都重读 5000+ 文件
let _metaCache: QuestionMetaLight[] | null = null;
let _metaCacheVersion: string | null = null;
let _metaCacheFingerprint: string | null = null;

interface QuestionFileSnapshot {
  filePath: string;
  fingerprintPart: string;
}

/**
 * Collect the Markdown files and the bits of filesystem metadata that change
 * when Obsidian saves, creates, renames, or deletes a question.
 *
 * We intentionally do this lightweight stat pass on every request. Reading
 * file metadata is much cheaper than reparsing the full question bank, while
 * still allowing edits made outside the web app to invalidate the cache.
 */
function snapshotQuestionFiles(): QuestionFileSnapshot[] {
  const snapshots: QuestionFileSnapshot[] = [];
  const sourceDirs = fs.readdirSync(BANK_PATH).sort();

  for (const dirName of sourceDirs) {
    const dirPath = path.join(BANK_PATH, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const files = fs.readdirSync(dirPath).sort();
    for (const fileName of files) {
      if (!fileName.endsWith('.md') || fileName.endsWith('.bak')) continue;

      const filePath = path.join(dirPath, fileName);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        snapshots.push({
          filePath,
          fingerprintPart: `${dirName}/${fileName}\0${stat.size}\0${stat.mtimeMs}`,
        });
      } catch {
        // Obsidian may replace a file atomically while this scan is running.
        // Skip that transient entry; the next request will see the saved file.
      }
    }
  }

  return snapshots;
}

function readCacheVersion(): string {
  try {
    return fs.readFileSync(CACHE_VERSION_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

/** 清空缓存（新增/修改题目后调用） */
export function invalidateMetaCache(): void {
  _metaCache = null;
  _metaCacheFingerprint = null;
  const version = `${Date.now()}-${Math.random()}`;
  _metaCacheVersion = version;
  try {
    // Persist the invalidation so other Next.js server bundles/processes see it too.
    fs.writeFileSync(CACHE_VERSION_PATH, version, 'utf8');
  } catch (error) {
    console.warn(`无法写入题库缓存版本: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 扫描题库，只返回元数据（不含 content 正文） */
export function scanAllQuestionsMeta(): QuestionMetaLight[] {
  // The version file makes cache invalidation visible across separate route bundles.
  const currentVersion = readCacheVersion();
  const fileSnapshots = snapshotQuestionFiles();
  const currentFingerprint = fileSnapshots.map(file => file.fingerprintPart).join('\n');
  if (
    _metaCache
    && _metaCacheVersion === currentVersion
    && _metaCacheFingerprint === currentFingerprint
  ) return _metaCache;

  const results: QuestionMetaLight[] = [];
  for (const { filePath } of fileSnapshots) {
    const raw = fs.readFileSync(filePath, 'utf-8');

    let data: Frontmatter;
    try {
      const parsed = matter(raw);
      data = parsed.data;
    } catch {
      console.warn(`YAML 解析失败，跳过: ${filePath}`);
      continue;
    }

    if (data.qid) {
      // 防御：确保 skill / tags 是字符串数组（YAML 冒号可能导致某些项被解析为对象）
      const safeSkill = toStringArray(data.skill);
      const safeModule = toStringArray(data.module);
      const safeTags = toStringArray(data.tags);
      results.push({
        qid: Number(data.qid),
        grade: String(data.grade || ''),
        source_type: String(data.source_type || ''),
        source_year: data.source_year == null || data.source_year === '' ? null : Number(data.source_year),
        source_name: String(data.source_name || ''),
        source_qno: String(data.source_qno || ''),
        module: safeModule,
        type: String(data.type || ''),
        filePath,
        difficulty: Number(data.difficulty ?? 0),
        skill: safeSkill,
        tags: safeTags,
      });
    }
  }

  results.sort((a, b) => b.qid - a.qid);

  // 存入缓存，下次直接返回
  _metaCache = results;
  _metaCacheVersion = currentVersion;
  _metaCacheFingerprint = currentFingerprint;
  return results;
}

/** 扫描题库，返回完整题目（含 content 正文） */
export function scanAllQuestions(): QuestionMeta[] {
  const results: QuestionMeta[] = [];
  const sourceDirs = fs.readdirSync(BANK_PATH);

  for (const dirName of sourceDirs) {
    const dirPath = path.join(BANK_PATH, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const files = fs.readdirSync(dirPath);
    for (const fileName of files) {
      if (!fileName.endsWith('.md') || fileName.endsWith('.bak')) continue;

      const filePath = path.join(dirPath, fileName);
      const raw = fs.readFileSync(filePath, 'utf-8');

      let data: Frontmatter;
      let body = '';
      try {
        const parsed = matter(raw);
        data = parsed.data;
        body = parsed.content;
      } catch {
        console.warn(`YAML 解析失败，跳过: ${filePath}`);
        continue;
      }

      if (data.qid) {
        const safeSkill = toStringArray(data.skill);
        const safeModule = toStringArray(data.module);
        const safeTags = toStringArray(data.tags);
        results.push({
          qid: Number(data.qid),
          grade: String(data.grade || ''),
          source_type: String(data.source_type || ''),
          source_year: data.source_year == null || data.source_year === '' ? null : Number(data.source_year),
          source_name: String(data.source_name || ''),
          source_qno: String(data.source_qno || ''),
          module: safeModule,
          type: String(data.type || ''),
          filePath,
          difficulty: Number(data.difficulty ?? 0),
          skill: safeSkill,
          tags: safeTags,
          content: body.trim(),
        });
      }
    }
  }

  results.sort((a, b) => b.qid - a.qid);
  return results;
}

/** 根据 qid 读取单道题的完整内容 */
export function getQuestionByQid(qid: number): QuestionMeta | null {
  const sourceDirs = fs.readdirSync(BANK_PATH);

  for (const dirName of sourceDirs) {
    const dirPath = path.join(BANK_PATH, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const files = fs.readdirSync(dirPath);
    for (const fileName of files) {
      if (!fileName.endsWith('.md') || fileName.endsWith('.bak')) continue;

      const filePath = path.join(dirPath, fileName);
      const raw = fs.readFileSync(filePath, 'utf-8');

      let data: Frontmatter;
      let body = '';
      try {
        const parsed = matter(raw);
        data = parsed.data;
        body = parsed.content;
      } catch {
        continue;
      }

      if (data.qid === qid) {
        const safeSkill = toStringArray(data.skill);
        const safeModule = toStringArray(data.module);
        const safeTags = toStringArray(data.tags);
        return {
          qid: Number(data.qid),
          grade: String(data.grade || ''),
          source_type: String(data.source_type || ''),
          source_year: data.source_year == null || data.source_year === '' ? null : Number(data.source_year),
          source_name: String(data.source_name || ''),
          source_qno: String(data.source_qno || ''),
          module: safeModule,
          type: String(data.type || ''),
          filePath,
          difficulty: Number(data.difficulty ?? 0),
          skill: safeSkill,
          tags: safeTags,
          content: body.trim(),
        };
      }
    }
  }

  return null;
}
