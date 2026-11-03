export type SocketLink = {
  /** ws.onopen */
  opened(): void;
  /** ws.onmessage로 받은 글 */
  received(text: string): void;
  /** ws.onclose */
  closed(code: number, reason: string): void;
  /** 이쪽에서 닫는다. 연결 중이었어도 열리는 즉시 닫힌다. */
  close(): void;
};

/**
 * 소켓 하나의 콜백을 넘기고, 이쪽에서 닫은 뒤에는 아무것도 넘기지 않는다.
 * 안드로이드(RN WebSocketModule)는 연결 중(CONNECTING)에 부른 close()를 무시하고, 그 연결을 나중에 그대로 연다.
 * 그대로 두면 닫은 줄 아는 소켓이 열린 채 남아 서버 이벤트를 계속 받고 구성원 연결 수도 차지한다.
 * 그래서 닫은 뒤에 열렸다는 소식이 오면 그 자리에서 다시 닫는다.
 */
export function linkSocket(
  socket: { close(): void },
  on: { open(): void; message(text: string): void; close(code: number, reason: string): void },
): SocketLink {
  let shut = false;
  return {
    opened() {
      if (shut) socket.close();
      else on.open();
    },
    received(text) {
      if (!shut) on.message(text);
    },
    closed(code, reason) {
      if (shut) return;
      shut = true;
      on.close(code, reason);
    },
    close() {
      shut = true;
      socket.close();
    },
  };
}
