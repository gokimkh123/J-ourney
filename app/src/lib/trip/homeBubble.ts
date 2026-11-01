import type { HomeStep } from './homeStep.ts';

export type BubbleMember = { id: string; nickname: string; personaReady: boolean };

export type HomeBubble = { speakerId: string; text: string };

/** 이름 뒤 부르는 말: 받침이 있으면 "아", 없으면 "야"(지은아, 현우야). 한글로 끝나지 않으면 "이름,". */
export function callName(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return `${name},`;
  return (last - 0xac00) % 28 === 0 ? `${name}야,` : `${name}아,`;
}

/** 기다리는 사람 카드 제목: 한 명이면 "현우를 기다리는 중", 여럿이면 "친구 2명을 기다리는 중". */
export function waitingTitle(names: string[]): string {
  if (names.length !== 1) return `친구 ${names.length}명을 기다리는 중`;
  const name = names[0]!;
  const last = name.charCodeAt(name.length - 1);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  const particle = !hangul ? '을(를)' : (last - 0xac00) % 28 === 0 ? '를' : '을';
  return `${name}${particle} 기다리는 중`;
}

/**
 * 파티 홈 무대에서 캐릭터 한 명이 하는 말. 말할 사람이 없으면 null.
 * persona: 준비된 친구가 나를 부른다. waiting: 내가 아직 안 한 친구를 부른다.
 * conditions·meeting·result: 첫 구성원이 지금 상황을 말한다.
 */
export function homeBubble(step: HomeStep, members: BubbleMember[], myMemberId: string): HomeBubble | null {
  const me = members.find((m) => m.id === myMemberId);
  const notReady = members.filter((m) => !m.personaReady);
  const first = members[0];
  if (me === undefined || first === undefined) return null;

  switch (step) {
    case 'persona': {
      const friend = members.find((m) => m.personaReady && m.id !== myMemberId);
      if (friend === undefined) return null;
      const onlyMe = notReady.length === 1 && notReady[0]!.id === myMemberId;
      return { speakerId: friend.id, text: onlyMe ? `${me.nickname}만 오면 돼요!` : '같이 성향 검사해요!' };
    }
    case 'waiting': {
      const target = notReady.find((m) => m.id !== myMemberId);
      if (target === undefined) return null;
      const others = notReady.filter((m) => m.id !== myMemberId).length;
      return { speakerId: me.id, text: others === 1 ? `${callName(target.nickname)} 같이 가자!` : '얘들아, 같이 가자!' };
    }
    case 'conditions':
      return { speakerId: first.id, text: '다 모였어요!' };
    case 'meeting':
      return { speakerId: first.id, text: '어디 갈지 정하는 중!' };
    case 'result':
      return { speakerId: first.id, text: 'AI들이 합의했어요!' };
  }
}
