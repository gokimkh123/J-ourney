/** 띄어쓰기를 하나로 모으고 앞뒤 공백을 지움 (없으면 빈 글) */
export const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** 빈 글이 아니고 max자 안인지 */
export const fits = (s: string, max: number) => s.length > 0 && s.length <= max;

/** HTML 태그를 지우고 띄어쓰기를 모음 (관광공사 소개·영업시간 글) */
export const stripTags = (s: string | null | undefined) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
