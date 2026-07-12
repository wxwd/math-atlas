import { scanAllQuestionsMeta } from '@/lib/questions';
import { splitModules } from '@/lib/modules';

export const dynamic = 'force-dynamic';

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function GET() {
  const questions = scanAllQuestionsMeta();

  return Response.json({
    sourceTypes: uniqueSorted(questions.map(question => question.source_type)),
    sourceNames: uniqueSorted(questions.map(question => question.source_name)),
    modules: uniqueSorted(questions.flatMap(question => splitModules(question.module))),
  });
}
