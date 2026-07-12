import fs from 'fs';
import matter from 'gray-matter';
import { invalidateMetaCache, scanAllQuestionsMeta } from '@/lib/questions';

const EDITABLE_FIELDS = new Set([
  'grade',
  'source_type',
  'source_year',
  'module',
  'type',
  'difficulty',
  'skill',
  'tags',
]);
const ARRAY_FIELDS = new Set(['skill', 'tags']);

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
        return Response.json({ error: '技能和标签必须是字符串数组' }, { status: 400 });
      }
      value = [...new Set(body.value.map(item => item.trim()).filter(Boolean))];
    } else if (field === 'difficulty') {
      if (body.value === '') {
        value = '';
      } else {
        const difficulty = Number(body.value);
        if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1) {
          return Response.json({ error: '难度必须是 0 到 1 之间的数字' }, { status: 400 });
        }
        value = difficulty;
      }
    } else {
      if (typeof body.value !== 'string') {
        return Response.json({ error: '属性值格式不正确' }, { status: 400 });
      }
      value = body.value.trim();
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
        const tempPath = `${question.filePath}.mathatlas-tmp`;
        fs.writeFileSync(tempPath, next, 'utf8');
        fs.renameSync(tempPath, question.filePath);
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
