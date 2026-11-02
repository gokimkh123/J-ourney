import test from "node:test";
import assert from "node:assert/strict";

import { cameraXY, computeArtViewport, VIEW_W } from "./regionArt.ts";

// 말하는 캐릭터를 늘 화면 안에(11/2): 카메라가 캐릭터들 가운데만 잡아 말하는 캐릭터가 빠지던 문제

const W = 390;
const H = 300;
const scale = W / VIEW_W;
const viewH = H / scale;

// 그림 좌표에서 화면 안(여백 포함)인지: 좌우 56px, 위 120px(말풍선), 아래 24px
function shown(cam: { x: number; y: number }, p: { x: number; y: number }) {
  return p.x - cam.x >= 56 / scale && cam.x + VIEW_W - p.x >= 56 / scale && p.y - cam.y >= 120 / scale && cam.y + viewH - p.y >= 24 / scale;
}

// 동쪽·서쪽 끝에 흩어진 캐릭터들(한 화면에 다 안 들어감)
const agents = [
  { x: 150, y: 500 },
  { x: 300, y: 520 },
  { x: 700, y: 480 },
  { x: 820, y: 510 },
];

test("다 못 담을 때 말하는 캐릭터가 가장자리여도 화면 안에 든다", () => {
  for (const speaker of agents) {
    const cam = cameraXY(null, agents, W, H, agents, speaker);
    assert.ok(shown(cam, speaker), `말하는 캐릭터 ${speaker.x}가 화면 밖`);
  }
});

test("말하는 캐릭터가 없으면 예전과 같은 자리(가운데)", () => {
  const view = computeArtViewport(agents, W, H, "full", agents);
  assert.deepEqual(cameraXY(null, agents, W, H, agents), { x: view.x, y: view.y });
});

test("이미 화면 안이면 덜 옮긴다(조금 어긋남은 그대로)", () => {
  const near = [
    { x: 400, y: 500 },
    { x: 450, y: 510 },
  ];
  const first = cameraXY(null, near, W, H, near, near[0]);
  const again = cameraXY(first, [...near, { x: 455, y: 512 }], W, H, near, near[1]);
  assert.deepEqual(again, first);
});

test("말하는 캐릭터가 지금 화면 밖이면 어긋남이 작아도 옮겨서 담는다", () => {
  const cam = cameraXY(null, agents, W, H, agents, agents[0]);
  const next = cameraXY(cam, agents, W, H, agents, agents[3]);
  assert.ok(shown(next, agents[3]));
});

test("그림 밖으로는 나가지 않는다", () => {
  const edge = [{ x: 5, y: 5 }];
  const cam = cameraXY(null, edge, W, H, edge, edge[0]);
  assert.ok(cam.x >= 0 && cam.y >= 0);
});
