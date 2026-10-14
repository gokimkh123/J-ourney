import { createHash, randomBytes, randomInt } from 'node:crypto';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// 초대 코드는 사람이 읽고 입력하므로 헷갈리는 0·O·1·I를 뺌
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pick(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** 접두사가 붙은 ID (명세서 3장: trp_ 여행, mem_ 구성원) */
export const newId = (prefix: 'trp' | 'mem') => `${prefix}_${pick(ID_ALPHABET, 10)}`;

/** 6자리 초대 코드 (예: BSN482) */
export const newInviteCode = () => pick(INVITE_ALPHABET, 6);

/** 인증 토큰: 응답으로 한 번만 돌려주고 DB에는 해시만 저장함 */
export const newToken = () => `tok_${randomBytes(24).toString('base64url')}`;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
