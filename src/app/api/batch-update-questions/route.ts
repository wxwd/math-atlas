import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { invalidateMetaCache, scanAllQuestionsMeta } from '@/lib/questions';

const VAULT_PATH = process.env.VAULT_PATH || './demo-vault';
const BANK_PATH = path.resolve(VAULT_PATH, '题库');

const EDITABLE_FIELDS = new Set([
  'grade',
  'source_type',
  'source_year',
  'source_name',
  'module',
  'type',
  'difficulty',
  'skill',
  'tags',
]);
const ARRAY_FIELDS = new Set(['module', 'skill', 'tags']);

export async function POST(req: Request) {
  try {
    const body = await req.json() as { qids?: unknown; field?: unknown; value?: unknown };
    const qids = Array.isArray(body.qids)
      ? [...new Set(body.qids.map(Number).filter(Number.isFinite))]
      : [];
    const field = typeof body.field === 'string' ? body.field : '';

    if (qids.length === 0) {
      return Response.json({ error: '请选择至少一道题目' }, { status: 400 });
    }
    if (!EDITABLE_FIELDS.has(field)) {
      return Response.json({ error: '不支持修改该属性' }, { status: 400 });
    }

    let value: string | number | string[];
    if (ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(body.value) || body.value.some(item => typeof item !== 'string')) {
        return Response.json({ error: '知识模块、技能和标签必须是字符串数组' }, { status: 400 });
      }
      value = [...new Set(body.value.map(item => item.trim()).filter(Boolean))];
    } else if (field === 'difficulty' || field === 'source_year') {
      if (body.value === '') {
        value = '';
      } else {
        const difficulty = Number(body.value);
        if (!Number.isFinite(difficulty) || (field === 'difficulty' && (difficulty < 0 || difficulty > 1))) {
          return Response.json({ error: field === 'difficulty' ? '难度必须是 0 到 1 之间的数字' : '来源年份必须是数字' }, { status: 400 });
        }
        value = difficulty;
      }
    } else {
      if (typeof body.value !== 'string') {
        return Response.json({ error: '属性值格式不正确' }, { status: 400 });
      }
      value = body.value.trim();
    }

    if (field === 'source_name') {
      if (!value || typeof value !== 'string') {
        return Response.json({ error: '来源名称不能为空' }, { status: 400 });
      }
      if (value === '.' || value === '..' || /[\\/:*?"<>|]/.test(value)) {
        return Response.json({ error: '来源名称包含不能用于文件名的字符' }, { status: 400 });
      }
    }

    const requested = new Set(qids);
    const questions = scanAllQuestionsMeta().filter(question => requested.has(question.qid));
    const errors: { qid: number; message: string }[] = [];
    const updatedQids: number[] = [];

    for (const question of questions) {
      try {
        const raw = fs.readFileSync(question.filePath, 'utf8');
        const parsed = matter(raw);
        parsed.data[field] = value;
        const next = matter.stringify(parsed.content, parsed.data);

        if (field === 'source_name' || field === 'source_year') {
          const sourceName = field === 'source_name' ? String(value) : question.source_name;
          const sourceYear = field === 'source_year' ? value : question.source_year;
          const dirName = [sourceYear, sourceName].filter(Boolean).join('-') || '未分类';
          const fileName = [sourceYear, sourceName, question.source_qno].filter(Boolean).join('-') || String(question.qid);
          const targetPath = path.resolve(BANK_PATH, dirName, `${fileName}.md`);
          const currentPath = path.resolve(question.filePath);
          if (!targetPath.startsWith(BANK_PATH + path.sep)) {
            throw new Error('目标路径超出题库目录');
          }
          if (targetPath !== currentPath && fs.existsSync(targetPath)) {
            throw new Error(`目标文件已存在：${path.basename(targetPath)}`);
          }
          if (targetPath !== currentPath) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            try {
              fs.renameSync(currentPath, targetPath);
              fs.writeFileSync(targetPath, next, 'utf8');
            } catch (error) {
              if (fs.existsSync(targetPath) && !fs.existsSync(currentPath)) {
                fs.renameSync(targetPath, currentPath);
              }
              throw error;
            }
            updatedQids.push(question.qid);
            continue;
          }
        }

        fs.writeFileSync(question.filePath, next, 'utf8');
        updatedQids.push(question.qid);
      } catch (error) {
        errors.push({
          qid: question.qid,
          message: error instanceof Error ? error.message : '写入失败',
        });
      }
    }

    const found = new Set(questions.map(question => question.qid));
    for (const qid of qids) {
      if (!found.has(qid)) errors.push({ qid, message: '未找到题目' });
    }
    if (updatedQids.length > 0) invalidateMetaCache();

    return Response.json({ updatedQids, errors });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '批量修改失败' },
      { status: 500 },
    );
  }
}
