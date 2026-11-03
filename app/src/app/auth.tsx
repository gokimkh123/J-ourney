import { Redirect } from "expo-router";

/**
 * 카카오 브라우저 로그인이 돌아오는 앱 주소(APK journey://auth, Expo Go exp://…/--/auth, 명세 v2.6). 결과는 로그인 창을 연 쪽이 받으므로
 * 이 화면은 라우터가 이 주소로 왔을 때 홈으로 보내기만 한다.
 */
export default function KakaoReturn() {
  return <Redirect href="/" />;
}
