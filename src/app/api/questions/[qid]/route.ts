import { NextRequest } from 'next/server';
import { getQuestionByQid, parseSections } from '@/lib/questions';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ qid: string }> }
) {
  const { qid } = await params;
  const qidNum = Number(qid);

  if (isNaN(qidNum)) {
    return Response.json({ error: 'Invalid qid' }, { status: 400 });
  }

  const question = getQuestionByQid(qidNum);

  if (!question) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({
    qid: question.qid,
    source_type: question.source_type,
    source_year: question.source_year,
    source_name: question.source_name,
    source_qno: question.source_qno,
    filePath: question.filePath,
    sections: parseSections(question.content),
  });
}
