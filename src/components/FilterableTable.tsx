'use client';

import { useState, useMemo, Fragment, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { QuestionMetaLight } from '@/lib/questions';
import JSZip from 'jszip';

import MathText from '@/components/MathText';
import BrowseView from '@/components/BrowseView';
import { buildLatexHandout } from '@/lib/latex';
import { splitModules } from '@/lib/modules';
import styles from './FilterableTable.module.css';

const PAGE_SIZE = 25;
const BROWSE_PAGE_SIZE = 10;
type SortField = 'source_name' | 'source_year' | 'source_qno' | 'difficulty' | 'type' | 'created_time' | 'modified_time';
type BatchField = 'grade' | 'source_type' | 'source_year' | 'source_name' | 'module' | 'type' | 'difficulty' | 'skill' | 'tags';

const BATCH_FIELDS: { value: BatchField; label: string }[] = [
  { value: 'grade', label: '年级' },
  { value: 'source_type', label: '来源类型' },
  { value: 'source_year', label: '来源年份' },
  { value: 'source_name', label: '来源名称' },
  { value: 'module', label: '知识模块' },
  { value: 'type', label: '题型' },
  { value: 'difficulty', label: '难度' },
  { value: 'skill', label: '技能' },
  { value: 'tags', label: '标签' },
];

function MultiSelect({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeWhenClickingOutside = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    };

    document.addEventListener('pointerdown', closeWhenClickingOutside);
    return () => document.removeEventListener('pointerdown', closeWhenClickingOutside);
  }, []);

  const summary = values.length === 0
    ? '全部'
    : values.length <= 2
      ? values.join('、')
      : `已选 ${values.length} 项`;

  const toggle = (value: string) => {
    onChange(values.includes(value)
      ? values.filter(item => item !== value)
      : [...values, value]);
  };

  return (
    <details ref={detailsRef} className={styles.multiSelect}>
      <summary className={styles.multiSelectSummary} title={values.join('、')}>{summary}</summary>
      <div className={styles.multiSelectMenu}>
        <label className={styles.multiSelectOption}>
          <input type="checkbox" checked={values.length === 0} onChange={() => onChange([])} />
          全部
        </label>
        {options.map(option => (
          <label className={styles.multiSelectOption} key={option}>
            <input type="checkbox" checked={values.includes(option)} onChange={() => toggle(option)} />
            {option}
          </label>
        ))}
      </div>
    </details>
  );
}

export default function FilterableTable({ questions }: { questions: QuestionMetaLight[] }) {
  const router = useRouter();
  const [gradesSelected, setGradesSelected] = useState<string[]>([]);
  const [sourceTypesSelected, setSourceTypesSelected] = useState<string[]>([]);
  const [sourceYearsSelected, setSourceYearsSelected] = useState<string[]>([]);
  const [sourceNamesSelected, setSourceNamesSelected] = useState<string[]>([]);
  const [modulesSelected, setModulesSelected] = useState<string[]>([]);
  const [qnoMin, setQnoMin] = useState('');
  const [qnoMax, setQnoMax] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  const [skillsSelected, setSkillsSelected] = useState<string[]>([]);
  const [tagsSelected, setTagsSelected] = useState<string[]>([]);
  const [qidInput, setQidInput] = useState('');
  const [page, setPage] = useState(1);
  const [expandedQid, setExpandedQid] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [selectedQids, setSelectedQids] = useState<Set<number>>(new Set());
  const [loadedContents, setLoadedContents] = useState<Record<number, Record<string, string>>>({});
  const [loadingQid, setLoadingQid] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'browse'>('table');
  const [sortBy, setSortBy] = useState<SortField>('source_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [deleting, setDeleting] = useState(false);
  const [showBatchEditor, setShowBatchEditor] = useState(false);
  const [batchField, setBatchField] = useState<BatchField>('module');
  const [batchValue, setBatchValue] = useState('');
  const [batchUpdating, setBatchUpdating] = useState(false);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseSelection: Set<number>;
    active: boolean;
  } | null>(null);
  const suppressRowClickRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const allGrades = useMemo(() => [...new Set(questions.map(q => q.grade).filter(Boolean))].sort(), [questions]);
  const allSourceTypes = useMemo(() => [...new Set(questions.map(q => q.source_type).filter(Boolean))].sort(), [questions]);
  const allSourceYears = useMemo(() => [...new Set(questions.map(q => q.source_year).filter((y): y is number => y != null))].sort((a, b) => a - b), [questions]);
  const allSourceNames = useMemo(() => [...new Set(questions.map(q => q.source_name).filter(Boolean))].sort(), [questions]);
  const allModules = useMemo(() => [...new Set(questions.flatMap(q => splitModules(q.module)))].sort(), [questions]);
  const allSkills = useMemo(() => [...new Set(questions.flatMap(q => q.skill).filter(Boolean))].sort(), [questions]);
  const allTags = useMemo(() => [...new Set(questions.flatMap(q => q.tags).filter(Boolean))].sort(), [questions]);

  const { grades, sourceTypes, sourceYears, sourceNames, modules, skills, tags } = useMemo(() => {
    type Facet = 'grade' | 'sourceType' | 'sourceYear' | 'sourceName' | 'module' | 'skill' | 'tag';
    const matchesOtherFacets = (q: QuestionMetaLight, omitted: Facet) => {
      if (omitted !== 'grade' && gradesSelected.length > 0 && !gradesSelected.includes(q.grade)) return false;
      if (omitted !== 'sourceType' && sourceTypesSelected.length > 0 && !sourceTypesSelected.includes(q.source_type)) return false;
      if (omitted !== 'sourceYear' && sourceYearsSelected.length > 0 && !sourceYearsSelected.includes(String(q.source_year))) return false;
      if (omitted !== 'sourceName' && sourceNamesSelected.length > 0 && !sourceNamesSelected.includes(q.source_name)) return false;
      if (omitted !== 'module' && modulesSelected.length > 0 && !splitModules(q.module).some(value => modulesSelected.includes(value))) return false;
      if (omitted !== 'skill' && skillsSelected.length > 0 && !q.skill.some(value => skillsSelected.includes(value))) return false;
      if (omitted !== 'tag' && tagsSelected.length > 0 && !q.tags.some(value => tagsSelected.includes(value))) return false;
      const sourceQno = parseInt(q.source_qno.replace(/^[A-Za-z]+/, ''), 10);
      if (qnoMin && sourceQno < Number(qnoMin)) return false;
      if (qnoMax && sourceQno > Number(qnoMax)) return false;
      if (difficultyMin && q.difficulty < Number(difficultyMin)) return false;
      if (difficultyMax && q.difficulty > Number(difficultyMax)) return false;
      return true;
    };
    const forFacet = (facet: Facet) => questions.filter(q => matchesOtherFacets(q, facet));

    return {
      grades: [...new Set(forFacet('grade').map(q => q.grade).filter(Boolean))].sort(),
      sourceTypes: [...new Set(forFacet('sourceType').map(q => q.source_type).filter(Boolean))].sort(),
      sourceYears: [...new Set(forFacet('sourceYear').map(q => q.source_year).filter((y): y is number => y != null))].sort((a, b) => a - b),
      sourceNames: [...new Set(forFacet('sourceName').map(q => q.source_name).filter(Boolean))].sort(),
      modules: [...new Set(forFacet('module').flatMap(q => splitModules(q.module)))].sort(),
      skills: [...new Set(forFacet('skill').flatMap(q => q.skill).filter(Boolean))].sort(),
      tags: [...new Set(forFacet('tag').flatMap(q => q.tags).filter(Boolean))].sort(),
    };
  }, [questions, gradesSelected, sourceTypesSelected, sourceYearsSelected, sourceNamesSelected, modulesSelected, skillsSelected, tagsSelected, qnoMin, qnoMax, difficultyMin, difficultyMax]);
  const batchSuggestions = useMemo(() => {
    const values: Partial<Record<BatchField, string[]>> = {
      grade: allGrades,
      source_type: allSourceTypes,
      source_year: allSourceYears.map(String),
      source_name: allSourceNames,
      module: allModules,
      type: [...new Set(questions.map(q => q.type).filter(Boolean))].sort(),
      skill: allSkills,
      tags: allTags,
    };
    return values[batchField] || [];
  }, [batchField, allGrades, allSourceTypes, allSourceYears, allSourceNames, allModules, questions, allSkills, allTags]);

  const qidOrder = useMemo(() => {
    return qidInput
      .split(/[\n, ]+/)
      .filter(s => s.trim() !== '')
      .map(s => Number(s.trim()))
      .filter(n => !isNaN(n));
  }, [qidInput]);

  const qidSet = useMemo(() => new Set(qidOrder), [qidOrder]);

  const toNum = (numStr: string) => parseInt(numStr.replace(/^[A-Za-z]+/, ''), 10);

  const filtered = (() => {
    const base = questions.filter(q => {
      if (qidSet.size > 0 && !qidSet.has(q.qid)) return false;
      if (gradesSelected.length > 0 && !gradesSelected.includes(q.grade)) return false;
      if (sourceTypesSelected.length > 0 && !sourceTypesSelected.includes(q.source_type)) return false;
      if (sourceYearsSelected.length > 0 && !sourceYearsSelected.includes(String(q.source_year))) return false;
      if (sourceNamesSelected.length > 0 && !sourceNamesSelected.includes(q.source_name)) return false;
      if (modulesSelected.length > 0 && !splitModules(q.module).some(value => modulesSelected.includes(value))) return false;
      const num = toNum(q.source_qno);
      if (qnoMin && num < Number(qnoMin)) return false;
      if (qnoMax && num > Number(qnoMax)) return false;
      if (difficultyMin && q.difficulty < Number(difficultyMin)) return false;
      if (difficultyMax && q.difficulty > Number(difficultyMax)) return false;
      if (skillsSelected.length > 0 && !q.skill.some(value => skillsSelected.includes(value))) return false;
      if (tagsSelected.length > 0 && !q.tags.some(value => tagsSelected.includes(value))) return false;
      return true;
    });
    // 按输入框的 qid 顺序排列（优先级最高）
    if (qidOrder.length > 0) {
      const idx = new Map(qidOrder.map((id, i) => [id, i]));
      base.sort((a, b) => {
        const ai = idx.get(a.qid) ?? Infinity;
        const bi = idx.get(b.qid) ?? Infinity;
        return ai - bi;
      });
    } else {
      // 用户选择的排序
      const dir = sortOrder === 'asc' ? 1 : -1;
      base.sort((a, b) => {
        let va: string | number, vb: string | number;
        switch (sortBy) {
          case 'source_qno':
            va = toNum(a.source_qno); vb = toNum(b.source_qno); break;
          case 'source_year':
            va = a.source_year ?? 0; vb = b.source_year ?? 0; break;
          case 'difficulty':
            va = a.difficulty ?? 0; vb = b.difficulty ?? 0; break;
          case 'type':
            va = a.type || ''; vb = b.type || ''; break;
          case 'created_time':
            va = a.createdTime; vb = b.createdTime; break;
          case 'modified_time':
            va = a.modifiedTime; vb = b.modifiedTime; break;
          case 'source_name':
          default:
            va = a.source_name; vb = b.source_name; break;
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return (a.qid - b.qid) * dir;
      });
    }
    return base;
  })();

  const pageSize = viewMode === 'browse' ? BROWSE_PAGE_SIZE : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const clearAll = () => {
    setGradesSelected([]); setSourceTypesSelected([]); setSourceYearsSelected([]); setSourceNamesSelected([]); setModulesSelected([]); setQnoMin(''); setQnoMax('');
    setDifficultyMin(''); setDifficultyMax('');
    setSkillsSelected([]); setTagsSelected([]); setQidInput('');
    setSelectedQids(new Set());
    setPage(1);
  };

  const handoutQuestions = selectedQids.size > 0
    ? filtered.filter(q => selectedQids.has(q.qid))
    : filtered;

  /** 加载缺失的正文内容，取回后合并到缓存 */
  const fetchMissing = async (qids: number[]): Promise<Record<number, Record<string, string>>> => {
    const needed = [...new Set(qids.filter(qid => !loadedContents[qid]))];
    if (needed.length === 0) return loadedContents;

    const results = await Promise.all(needed.map(async (qid) => {
      try {
        const res = await fetch(`/api/questions/${qid}`);
        if (res.ok) {
          return { qid, sections: (await res.json()).sections as Record<string, string> };
        }
      } catch { /* ignore */ }
      return { qid, sections: null as null | Record<string, string> };
    }));

    const fresh: Record<number, Record<string, string>> = {};
    for (const r of results) {
      if (r.sections) fresh[r.qid] = r.sections;
    }

    setLoadedContents(prev => ({ ...prev, ...fresh }));
    return { ...loadedContents, ...fresh };
  };

  /** 构建讲义 + 收集图片映射（原始 hash 名 → 新编号名） */
  const buildHandoutWithImages = async (): Promise<{ markdown: string; imageMap: Map<string, string> }> => {
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const imageMap = new Map<string, string>();

    /**
     * 把文本中的图片引用统一转换为 ![](zip内文件名)
     * 支持两种格式：
     *   1. Obsidian: ![[images/hash.jpg|342]]
     *   2. Markdown: ![](images/hash.jpg)  或  ![alt](images/hash.jpg)
     */
    const convertImages = (text: string, questionNum: number, counter: Map<number, number>): string => {
      // 辅助函数：把哈希文件名映射为 zip 内的新文件名，去重
      const mapImage = (hashFilename: string): string => {
        if (imageMap.has(hashFilename)) {
          return `![](${imageMap.get(hashFilename)})`;
        }
        const ext = hashFilename.split('.').pop() || 'jpg';
        const count = counter.get(questionNum) || 0;
        const newCount = count + 1;
        counter.set(questionNum, newCount);
        const newName = `${questionNum}-${newCount}.${ext}`;
        imageMap.set(hashFilename, newName);
        return `![](${newName})`;
      };

      // 格式一：Obsidian ![[images/hash.jpg|342]]
      text = text.replace(
        /!\[\[images\/([^\]|]+)(?:\|\d+)?\]\]/g,
        (_, hash: string) => mapImage(hash)
      );

      // 格式二：Markdown ![任意alt](images/hash.jpg) — 之前漏了这种！
      text = text.replace(
        /!\[[^\]]*\]\(images\/([^)]+)\)/g,
        (_, hash: string) => mapImage(hash)
      );

      return text;
    };

    const md = handoutQuestions.map((q, i) => {
      const s = allContents[q.qid];
      const num = i + 1;
      const imgCounter = new Map<number, number>();

      if (!s?.['题目']) {
        return `${num}. （内容加载失败）`;
      }

      let questionText = s['题目'];

      const type = q.type || '';
      const isMultiSelect = type === '多选题' || questionText.includes('[多选]');
      const isSingleSelect = type === '单选题' || questionText.includes('[选]');
      const numberPrefix = isMultiSelect ? `${num}.(多选)` : `${num}.`;

      questionText = questionText
        .replace(/\[多选\]/g, '')
        .replace(/\[选\]/g, '')
        .replace(/\[填\]/g, '____')
        .trim();

      if ((isSingleSelect || isMultiSelect) && !questionText.endsWith('()')) {
        questionText += '()';
      }

      questionText = convertImages(questionText, num, imgCounter);

      const lines: string[] = [];
      lines.push(`${numberPrefix} ${questionText}`);

      // 选项
      if ((isSingleSelect || isMultiSelect) && s['选项']) {
        lines.push(convertImages(s['选项'], num, imgCounter));
      }

      // 【答案】
      if (s['答案']) {
        lines.push(`【答案】${convertImages(s['答案'], num, imgCounter)}`);
      }

      // 【来源】
      lines.push(`【来源】${q.source_year}${q.source_name}${q.source_qno}`);

      // 【备注】
      if (s['我的备注']) {
        lines.push(`【备注】${convertImages(s['我的备注'], num, imgCounter)}`);
      }

      // 【AI备注】
      const aiNote = s['AI 备注'] || s['AI备注'];
      if (aiNote) {
        lines.push(`【AI备注】${convertImages(aiNote, num, imgCounter)}`);
      }

      // 【解析】
      if (s['解析']) {
        lines.push(`【解析】${convertImages(s['解析'], num, imgCounter)}`);
      }

      return lines.join('\n');
    }).join('\n\n\n');

    return { markdown: md, imageMap };
  };

  /** 复制为纯文本 Markdown（图片保持 Obsidian 语法，不处理） */
  const copyAsMarkdown = async () => {
    const { markdown } = await buildHandoutWithImages();
    // 还原回 Obsidian 格式（复制时用原始格式）
    await navigator.clipboard.writeText(markdown);
    alert(`已复制 ${handoutQuestions.length} 道题目（含完整题干）到剪贴板`);
  };

  /** 打包下载 zip（讲义 .md + 图片） */
  const downloadZip = async () => {
    const { markdown, imageMap } = await buildHandoutWithImages();

    const zip = new JSZip();

    // 添加讲义
    zip.file('讲义.md', markdown);

    // 批量获取图片
    const downloadPromises: Promise<void>[] = [];
    imageMap.forEach((newName, hashFilename) => {
      downloadPromises.push(
        fetch(`/api/images/${encodeURIComponent(hashFilename)}`)
          .then(async (res) => {
            if (res.ok) {
              const blob = await res.blob();
              zip.file(newName, blob);
            } else {
              console.warn(`图片缺失: ${hashFilename}`);
            }
          })
          .catch(() => console.warn(`图片加载失败: ${hashFilename}`))
      );
    });

    await Promise.all(downloadPromises);

    // 生成时间戳文件名（精确到秒）
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `讲义_Markdown_${ts}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 一键导出到本地 LATEX 目录 */
  const exportToLocal = async () => {
    const qids = handoutQuestions.map(q => q.qid);
    try {
      const res = await fetch('/api/export-latex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qids }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`已导出 ${data.count} 道题目 → ${data.folder}`);
      } else {
        alert('导出失败：' + (data.error || '未知错误'));
      }
    } catch (e: unknown) {
      alert('导出失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  /** 复制为 LaTeX 代码 */
  const copyAsLatex = async () => {
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const { tex } = buildLatexHandout(handoutQuestions, allContents);
    await navigator.clipboard.writeText(tex);
    alert(`已复制 ${handoutQuestions.length} 道题目的 LaTeX 代码到剪贴板`);
  };

  /** 打包下载 LaTeX zip（.tex + .sty + 图片） */
  const downloadLatexZip = async () => {
    const allContents = await fetchMissing(handoutQuestions.map(q => q.qid));
    const { tex, imageMap } = buildLatexHandout(handoutQuestions, allContents);
    const zip = new JSZip();

    // 添加 .tex 文件
    zip.file('讲义.tex', tex);

    // 添加 .sty 样式文件
    try {
      const styRes = await fetch('/mathatlas.sty');
      if (styRes.ok) {
        const styText = await styRes.text();
        zip.file('mathatlas.sty', styText);
      }
    } catch { /* .sty 获取失败不影响导出 */ }

    // 批量获取图片（放入 images/ 子目录）
    const downloadPromises: Promise<void>[] = [];
    imageMap.forEach((newName, hashFilename) => {
      downloadPromises.push(
        fetch(`/api/images/${encodeURIComponent(hashFilename)}`)
          .then(async (res) => {
            if (res.ok) {
              const blob = await res.blob();
              zip.file(`images/${newName}`, blob);
            } else {
              console.warn(`图片缺失: ${hashFilename}`);
            }
          })
          .catch(() => console.warn(`图片加载失败: ${hashFilename}`))
      );
    });

    await Promise.all(downloadPromises);

    // 生成时间戳文件名（精确到秒）
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `讲义_LaTeX_${ts}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (qid: number) => {
    setSelectedQids(prev => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedQids.size === filtered.length) {
      setSelectedQids(new Set());
    } else {
      setSelectedQids(new Set(filtered.map(q => q.qid)));
    }
  };

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !tableAreaRef.current) return;
    const target = event.target as HTMLElement;
    if (!target.closest('tbody tr[data-selectable-row]') || target.closest('input, button, a')) return;

    const bounds = tableAreaRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      baseSelection: new Set(selectedQids),
      active: false,
    };
  };

  const handleSelectionPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const area = tableAreaRef.current;
    if (!drag || !area || drag.pointerId !== event.pointerId) return;

    const bounds = area.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width));
    const currentY = Math.max(0, Math.min(event.clientY - bounds.top, bounds.height));
    if (!drag.active && Math.hypot(currentX - drag.startX, currentY - drag.startY) < 6) return;

    drag.active = true;
    suppressRowClickRef.current = true;
    area.setPointerCapture(event.pointerId);
    event.preventDefault();

    const box = {
      left: Math.min(drag.startX, currentX),
      top: Math.min(drag.startY, currentY),
      width: Math.abs(currentX - drag.startX),
      height: Math.abs(currentY - drag.startY),
    };
    setSelectionBox(box);

    const boxTop = bounds.top + box.top;
    const boxBottom = boxTop + box.height;
    const boxLeft = bounds.left + box.left;
    const boxRight = boxLeft + box.width;
    const hitQids = Array.from(area.querySelectorAll<HTMLTableRowElement>('tr[data-selectable-row]'))
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.top <= boxBottom && rect.bottom >= boxTop && rect.left <= boxRight && rect.right >= boxLeft;
      })
      .map(row => Number(row.dataset.qid));

    const nextSelection = new Set(drag.baseSelection);
    hitQids.forEach(qid => {
      if (nextSelection.has(qid)) nextSelection.delete(qid);
      else nextSelection.add(qid);
    });
    setSelectedQids(nextSelection);
  };

  const finishSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (tableAreaRef.current?.hasPointerCapture(event.pointerId)) {
      tableAreaRef.current.releasePointerCapture(event.pointerId);
    }
    const wasActive = drag.active;
    dragRef.current = null;
    setSelectionBox(null);
    if (wasActive) window.setTimeout(() => { suppressRowClickRef.current = false; }, 0);
  };

  const deleteSelected = async () => {
    const qids = [...selectedQids];
    if (qids.length === 0 || deleting) return;

    setDeleting(true);
    try {
      const previewRes = await fetch('/api/delete-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qids, action: 'preview' }),
      });
      const preview = await previewRes.json();
      if (!previewRes.ok) throw new Error(preview.error || '删除预检失败');
      if (preview.questionCount === 0) throw new Error('未找到可删除的题目');

      const missingText = preview.missingQids.length > 0
        ? `\n未找到的 qid：${preview.missingQids.join('、')}`
        : '';
      const confirmed = window.confirm(
        `即将永久删除 ${preview.questionCount} 道题目和 ${preview.deletableImageCount} 张独有配图。\n` +
        `${preview.sharedImageCount} 张被其他题目引用的配图将保留。${missingText}\n\n此操作无法撤销，确定继续吗？`
      );
      if (!confirmed) return;

      const deleteRes = await fetch('/api/delete-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qids, action: 'delete' }),
      });
      const result = await deleteRes.json();
      if (!deleteRes.ok) throw new Error(result.error || '删除失败');

      const deleted = new Set<number>(result.deletedQids);
      setSelectedQids(prev => new Set([...prev].filter(qid => !deleted.has(qid))));
      setLoadedContents(prev => {
        const next = { ...prev };
        deleted.forEach(qid => delete next[qid]);
        return next;
      });
      if (expandedQid !== null && deleted.has(expandedQid)) setExpandedQid(null);

      const issues = [
        ...result.errors.map((item: { qid?: number; filename?: string; message: string }) =>
          `${item.qid ?? item.filename ?? '文件'}: ${item.message}`),
        ...(result.missingImages.length > 0 ? [`配图原本就不存在：${result.missingImages.join('、')}`] : []),
      ];
      alert(
        `已删除 ${result.deletedQids.length} 道题目和 ${result.deletedImages.length} 张配图。` +
        (result.sharedImages.length > 0 ? `\n已保留 ${result.sharedImages.length} 张共享配图。` : '') +
        (issues.length > 0 ? `\n\n部分项目未处理：\n${issues.join('\n')}` : '')
      );
      router.refresh();
    } catch (error) {
      alert('删除失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setDeleting(false);
    }
  };

  const updateSelected = async () => {
    if (selectedQids.size === 0 || batchUpdating) return;
    if (batchField === 'difficulty' && batchValue !== '') {
      const value = Number(batchValue);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        alert('难度必须是 0 到 1 之间的数字');
        return;
      }
    }

    const isArrayField = batchField === 'module' || batchField === 'skill' || batchField === 'tags';
    const value = isArrayField
      ? batchValue.split(/[，,\n]+/).map(item => item.trim()).filter(Boolean)
      : batchValue;
    const fieldLabel = BATCH_FIELDS.find(item => item.value === batchField)?.label || batchField;
    const displayValue = isArrayField ? (value as string[]).join('、') || '空列表' : batchValue || '空值';
    if (!confirm(`确定将 ${selectedQids.size} 道题目的“${fieldLabel}”覆盖为“${displayValue}”吗？`)) return;

    setBatchUpdating(true);
    try {
      const res = await fetch('/api/batch-update-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qids: [...selectedQids], field: batchField, value }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '批量修改失败');

      const issues = (result.errors as { qid: number; message: string }[])
        .map(item => `${item.qid}: ${item.message}`);
      alert(
        `已修改 ${result.updatedQids.length} 道题目。` +
        (issues.length > 0 ? `\n\n未修改：\n${issues.join('\n')}` : ''),
      );
      if (result.updatedQids.length > 0) {
        setShowBatchEditor(false);
        setBatchValue('');
        router.refresh();
      }
    } catch (error) {
      alert('批量修改失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleRowClick = async (qid: number) => {
    if (expandedQid === qid) {
      setExpandedQid(null);
    } else {
      setExpandedQid(qid);
      setShowAnswer(false);
      setShowSolution(false);
      if (!loadedContents[qid]) {
        setLoadingQid(qid);
        await fetchMissing([qid]);
        setLoadingQid(null);
      }
    }
  };

  // 生成页码列表（带省略号）
  const pageNumbers = useMemo(() => {
    const pages: (number | '...')[] = [];
    const delta = 2; // 当前页两侧各显示几个页码
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= safePage - delta && i <= safePage + delta)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  }, [totalPages, safePage]);

  return (
    <div className={styles.container}>
      {/* 手动输入 qid */}
      <div className={styles.qidArea}>
        <label className={styles.qidLabel}>
          手动输入 qid
          <br />
          <textarea
            rows={3}
            className={styles.qidTextarea}
            placeholder="粘贴 qid，每行一个，或空格/逗号分隔&#10;例如：&#10;1780921807044&#10;1780921807045&#10;1780921807046"
            value={qidInput}
            onChange={e => { setQidInput(e.target.value); setPage(1); }}
          />
        </label>
      </div>

      {/* 筛选栏 */}
      <div className={styles.filterBar}>
        <label className={styles.filterLabel}>
          年级
          <MultiSelect values={gradesSelected} options={grades} onChange={values => { setGradesSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          来源类型
          <MultiSelect values={sourceTypesSelected} options={sourceTypes} onChange={values => { setSourceTypesSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          来源年份
          <MultiSelect values={sourceYearsSelected} options={sourceYears.map(String)} onChange={values => { setSourceYearsSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          来源名称
          <MultiSelect values={sourceNamesSelected} options={sourceNames} onChange={values => {
            setSourceNamesSelected(values);
            const availableModules = new Set(questions
              .filter(q => values.length === 0 || values.includes(q.source_name))
              .flatMap(q => splitModules(q.module)));
            setModulesSelected(current => current.filter(value => availableModules.has(value)));
            setPage(1);
          }} />
        </label>

        <label className={styles.filterLabel}>
          知识模块
          <MultiSelect values={modulesSelected} options={modules} onChange={values => { setModulesSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          来源题号范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={qnoMin} onChange={e => { setQnoMin(e.target.value); setPage(1); }} min={1} step={1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={qnoMax} onChange={e => { setQnoMax(e.target.value); setPage(1); }} min={1} step={1} />
          </span>
        </label>

        <label className={styles.filterLabel}>
          难度范围
          <span className={styles.rangeGroup}>
            <input className={styles.filterInput} type="number" placeholder="最小" value={difficultyMin} onChange={e => { setDifficultyMin(e.target.value); setPage(1); }} min={0} max={1} step={0.1} />
            ~
            <input className={styles.filterInput} type="number" placeholder="最大" value={difficultyMax} onChange={e => { setDifficultyMax(e.target.value); setPage(1); }} min={0} max={1} step={0.1} />
          </span>
        </label>

        <label className={styles.filterLabel}>
          技能
          <MultiSelect values={skillsSelected} options={skills} onChange={values => { setSkillsSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          标签
          <MultiSelect values={tagsSelected} options={tags} onChange={values => { setTagsSelected(values); setPage(1); }} />
        </label>

        <label className={styles.filterLabel}>
          排序
          <span className={styles.rangeGroup}>
            <select className={styles.filterSelect} value={sortBy} onChange={e => {
              const nextSortBy = e.target.value as SortField;
              setSortBy(nextSortBy);
              if (nextSortBy === 'created_time' || nextSortBy === 'modified_time') setSortOrder('desc');
              setPage(1);
            }}>
              <option value="source_name">来源名称</option>
              <option value="source_year">来源年份</option>
              <option value="source_qno">来源题号</option>
              <option value="difficulty">难度</option>
              <option value="type">题型</option>
              <option value="created_time">创建时间</option>
              <option value="modified_time">修改时间</option>
            </select>
            <button
              className={styles.sortToggle}
              onClick={() => { setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); setPage(1); }}
              title={sortOrder === 'asc' ? '升序 → 降序' : '降序 → 升序'}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        </label>

        <button className={styles.btnClear} onClick={clearAll}>清除筛选</button>
      </div>

      {/* 视图切换 */}
      <div className={styles.viewTabs}>
        <button
          className={`${styles.viewTab} ${viewMode === 'table' ? styles.viewTabActive : ''}`}
          onClick={() => { setViewMode('table'); setPage(1); }}
        >
          📋 表格
        </button>
        <button
          className={`${styles.viewTab} ${viewMode === 'browse' ? styles.viewTabActive : ''}`}
          onClick={() => { setViewMode('browse'); setPage(1); }}
        >
          📖 浏览
        </button>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.resultCount}>
          筛选结果：{filtered.length} 道题目
          {selectedQids.size > 0 && ` · 已勾选 ${selectedQids.size} 道`}
        </span>
        {selectedQids.size > 0 && (
          <>
            <button
              className={styles.btnSecondary}
              onClick={() => setShowBatchEditor(open => !open)}
              aria-expanded={showBatchEditor}
            >
              批量设置属性
            </button>
            <button className={styles.btnDanger} onClick={deleteSelected} disabled={deleting}>
              {deleting ? '处理中...' : `删除选中题目 (${selectedQids.size})`}
            </button>
          </>
        )}
        {filtered.length > 0 && (
          <>
            <button className={styles.btnAction} onClick={copyAsMarkdown}>复制为 Markdown</button>
            <button className={styles.btnAction} onClick={downloadZip}>打包下载 Markdown (.zip)</button>
            <button className={styles.btnAction} onClick={copyAsLatex}>复制为 LaTeX</button>
            <button className={styles.btnAction} onClick={downloadLatexZip}>打包下载 LaTeX (.zip)</button>
            <button className={styles.btnAction} onClick={exportToLocal}>LaTeX 导出到本地</button>
          </>
        )}
      </div>

      {selectedQids.size > 0 && showBatchEditor && (
        <div className={styles.batchEditor}>
          <strong>批量设置 {selectedQids.size} 道题目</strong>
          <label className={styles.batchLabel}>
            属性
            <select
              className={styles.filterSelect}
              value={batchField}
              onChange={event => {
                setBatchField(event.target.value as BatchField);
                setBatchValue('');
              }}
              disabled={batchUpdating}
            >
              {BATCH_FIELDS.map(field => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.batchLabel}>
            新值
            <input
              className={styles.batchInput}
              type={batchField === 'difficulty' ? 'number' : 'text'}
              min={batchField === 'difficulty' ? 0 : undefined}
              max={batchField === 'difficulty' ? 1 : undefined}
              step={batchField === 'difficulty' ? 0.01 : undefined}
              list={batchSuggestions.length > 0 ? 'batch-value-suggestions' : undefined}
              value={batchValue}
              onChange={event => setBatchValue(event.target.value)}
              placeholder={batchField === 'module' || batchField === 'skill' || batchField === 'tags' ? '多个值用逗号分隔；留空则清空' : '留空则设为空值'}
              disabled={batchUpdating}
            />
            {batchSuggestions.length > 0 && (
              <datalist id="batch-value-suggestions">
                {batchSuggestions.map(value => <option key={value} value={value} />)}
              </datalist>
            )}
          </label>
          <button className={styles.btnAction} onClick={updateSelected} disabled={batchUpdating}>
            {batchUpdating ? '正在修改...' : '应用'}
          </button>
          <button className={styles.btnClear} onClick={() => setShowBatchEditor(false)} disabled={batchUpdating}>
            取消
          </button>
          <span className={styles.batchHint}>此操作会覆盖所选题目的原属性值</span>
        </div>
      )}

      {viewMode === 'browse' ? (
        <BrowseView
          questions={paginated}
          loadedContents={loadedContents}
          selectedQids={selectedQids}
          loadingQid={loadingQid}
          onToggleSelect={toggleSelect}
          onLoadContent={(qid) => {
            if (!loadedContents[qid]) {
              setLoadingQid(qid);
              fetchMissing([qid]).then(() => setLoadingQid(null));
            }
          }}
          onRefresh={(qid) => {
            setLoadedContents(prev => {
              const next = { ...prev };
              delete next[qid];
              return next;
            });
            setLoadingQid(qid);
            fetchMissing([qid]).then(() => setLoadingQid(null));
          }}
        />
      ) : (
      <div
        ref={tableAreaRef}
        className={`${styles.tableArea} ${selectionBox ? styles.selecting : ''}`}
        onPointerDown={handleSelectionPointerDown}
        onPointerMove={handleSelectionPointerMove}
        onPointerUp={finishSelection}
        onPointerCancel={finishSelection}
        onClickCapture={event => {
          if (!suppressRowClickRef.current) return;
          event.stopPropagation();
          event.preventDefault();
          suppressRowClickRef.current = false;
        }}
      >
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <input
                type="checkbox"
                checked={filtered.length > 0 && selectedQids.size === filtered.length}
                onChange={toggleSelectAll}
              />
            </th>
            <th>qid</th>
            <th>来源类型</th>
            <th>来源年份</th>
            <th>来源名称</th>
            <th>来源题号</th>
            <th>知识模块</th>
            <th>题型</th>
            <th>年级</th>
            <th>难度</th>
            <th>技能</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map(q => {
            const isExpanded = expandedQid === q.qid;
            const s = loadedContents[q.qid];
            const isLoading = loadingQid === q.qid;
            const isSelected = selectedQids.has(q.qid);
            return (
              <Fragment key={q.qid}>
                <tr
                  data-selectable-row
                  data-qid={q.qid}
                  className={`${isExpanded ? styles.expandedRow : ''} ${isSelected ? styles.selectedRow : ''}`.trim() || undefined}
                  onClick={() => handleRowClick(q.qid)}
                >
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedQids.has(q.qid)}
                      onChange={() => toggleSelect(q.qid)}
                    />
                  </td>
                  <td>{q.qid}</td>
                  <td>{q.source_type}</td>
                  <td>{q.source_year}</td>
                  <td>{q.source_name}</td>
                  <td>{q.source_qno}</td>
                  <td>{q.module.join('、')}</td>
                  <td>{q.type}</td>
                  <td>{q.grade}</td>
                  <td>{q.difficulty}</td>
                  <td>{q.skill.join('、')}</td>
                  <td>{q.tags.join('、')}</td>
                </tr>
                {isExpanded && (
                  <tr key={`${q.qid}-detail`}>
                    <td colSpan={12} style={{ padding: '1.5rem', border: 'none' }}>
                      <div className={styles.detail} style={{ marginTop: 0 }}>
                        <div className={styles.detailMeta}>
                          <strong>{q.source_year} {q.source_name}</strong> · {q.source_qno} · {q.source_type} · {q.module.join('、')} · {q.type} · {q.grade} · 难度 {q.difficulty}
                          {' · '}
                          <a
                            href={`obsidian://open?vault=${encodeURIComponent((process.env.NEXT_PUBLIC_VAULT_PATH || './demo-vault').split(/[\\\/]/).pop() || '高中数学')}&file=${encodeURIComponent(q.filePath.replace(/\\/g, '/').split(((process.env.NEXT_PUBLIC_VAULT_PATH || './demo-vault').split(/[\\\/]/).pop() || '高中数学') + '/').pop() || '')}`}
                            style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            title="在 Obsidian 中打开"
                          >
                            Obsidian
                          </a>
                        </div>

                        {isLoading && (
                          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            加载中...
                          </div>
                        )}

                        {s && (
                          <>
                            {s['题目'] && (
                              <div className={styles.detailSection}>
                                <h3>题目</h3>
                                <MathText text={s['题目']} />
                              </div>
                            )}

                            {s['选项'] && (
                              <div className={styles.detailSection}>
                                <h3>选项</h3>
                                <MathText text={s['选项']} />
                              </div>
                            )}

                            {s['我的备注'] && (
                              <div className={`${styles.detailNote} ${styles.detailNoteMine}`}>
                                <h3>我的备注</h3>
                                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, color: 'var(--text)' }}>{s['我的备注']}</pre>
                              </div>
                            )}

                            {(s['AI 备注'] || s['AI备注']) && (
                              <div className={`${styles.detailNote} ${styles.detailNoteAI}`}>
                                <h3>AI 备注</h3>
                                <MathText text={s['AI 备注'] || s['AI备注']} />
                              </div>
                            )}

                            {s['答案'] && (
                              <div className={styles.detailSection}>
                                <h3 className={styles.detailFold} onClick={() => setShowAnswer(!showAnswer)}>
                                  {showAnswer ? '▼' : '▶'} 答案
                                </h3>
                                {showAnswer && <MathText text={s['答案']} />}
                              </div>
                            )}

                            {s['解析'] && (
                              <div className={styles.detailSection}>
                                <h3 className={styles.detailFold} onClick={() => setShowSolution(!showSolution)}>
                                  {showSolution ? '▼' : '▶'} 解析
                                </h3>
                                {showSolution && <MathText text={s['解析']} />}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {selectionBox && <div className={styles.selectionBox} style={selectionBox} />}
      </div>
      )}

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            上一页
          </button>

          {pageNumbers.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className={styles.pageEllipsis}>…</span>
            ) : (
              <button
                key={p}
                className={`${styles.pageBtn} ${p === safePage ? styles.pageActive : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className={styles.pageBtn}
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>

          <span className={styles.pageInfo}>
            第 {safePage}/{totalPages} 页
          </span>
        </div>
      )}
    </div>
  );
}
