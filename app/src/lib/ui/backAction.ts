/** 폰의 뒤로 가기에서 할 일. history는 내비게이터 기록대로(숨은 화면을 연 화면으로) 돌아간다. */
export type BackAction = 'history' | 'home' | 'exitParty' | 'exitApp';

/** 탭 막대에 나오는 큰 탭(홈 '/'은 따로 본다). */
const MAIN_TABS = new Set(['/meeting', '/plan', '/persona', '/community']);

/**
 * 뒤로 가기를 홈으로 모은다(11/3 결정). 예전에는 있었던 탭을 차례로 끝없이 거슬러 갔다.
 * 숨은 화면(설정·장소·여행 조건·성향 검사 등)은 연 화면으로, 큰 탭에서는 홈으로,
 * 홈에서는 파티 안이면 파티 목록으로 나가고 파티 밖이면 앱을 닫는다.
 */
export function backAction(pathname: string, inParty: boolean): BackAction {
  if (pathname === '/') return inParty ? 'exitParty' : 'exitApp';
  if (MAIN_TABS.has(pathname)) return 'home';
  return 'history';
}
