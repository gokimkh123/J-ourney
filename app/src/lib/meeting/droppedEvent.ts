import { parseEvent } from './parse.ts';

/**
 * 앱이 읽지 못해 버리게 될 서버 메시지의 종류와 번호만 한 줄로 알려 준다(내용은 담지 않는다).
 * 읽을 수 있는 메시지와 시험용 LLM 과정 이벤트(llm.*)는 null.
 */
export function droppedEventNote(text: string): string | null {
  if (parseEvent(text) !== null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return '못 읽은 메시지: JSON이 아님';
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '못 읽은 메시지: 객체가 아님';
  const { type, seq } = raw as Record<string, unknown>;
  const kind = typeof type === 'string' && /^[\w.-]{1,40}$/.test(type) ? type : '?';
  if (kind.startsWith('llm.')) return null;
  const no = typeof seq === 'number' && Number.isInteger(seq) ? String(seq) : '?';
  return `못 읽은 이벤트 type=${kind} seq=${no}`;
}
