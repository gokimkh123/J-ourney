import { NavigationBar } from "expo-navigation-bar";
import { Tabs, usePathname, useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Appearance, BackHandler, Pressable, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";

import LoginScreen from "../components/LoginScreen.tsx";
import TabBar, { type TabBarIcon, type TabBarItem } from "../components/TabBar.tsx";
import TabFade from "../components/TabFade.tsx";
import ToastHost from "../components/Toast.tsx";
import { CharacterSvg } from "../components/character/Bean.tsx";
import type { CharacterProps } from "../components/character/props.ts";
import TopBar from "../components/TopBar.tsx";
import Wordmark from "../components/Wordmark.tsx";
import { login } from "../lib/auth/index.ts";
import { loginGate, restoreAfterLogin, signInWithKakao, useLoginGateOpen } from "../lib/auth/kakaoLogin.ts";
import { loginErrorText } from "../lib/auth/login.ts";
import { config } from "../lib/config/index.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { meetingImmersive } from "../lib/meeting/stageStore.ts";
import { chosenPlanStore } from "../lib/plan/chosenPlan.ts";
import { decidedTrips } from "../lib/plan/decidedStore.ts";
import { planTimes } from "../lib/plan/planTimesStore.ts";
import { profile } from "../lib/persona/profileStore.ts";
import { parties, partyActions, session } from "../lib/session/index.ts";
import { usePartyInfos, useRefreshParty } from "../lib/session/usePartyInfo.ts";
import { useSession } from "../lib/session/useSession.ts";
import { themeMode } from "../lib/settings/index.ts";
import { useThemeMode } from "../lib/settings/useThemeMode.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { tripTabs } from "../lib/trip/tabVisibility.ts";
import { backAction } from "../lib/ui/backAction.ts";
import { startedMeetingStore } from "../lib/meeting/startedMeeting.ts";
import { keepPerTrip } from "../lib/trip/tripState.ts";
import { ThemeProvider, memberColors, outline, pastel, useTheme } from "../theme/index.ts";
import { describeError } from "../lib/ui/format.ts";

// 웹에서 카카오 로그인 창(팝업)이 앱 주소로 돌아오면 결과를 연 창에 넘기고 닫는다. 앱에서는 아무 일도 안 한다.
WebBrowser.maybeCompleteAuthSession();

/** 탭바에 나오는 화면과 아이콘. 순서가 탭 순서다. 설정은 탭이 아니라 위쪽 줄의 버튼으로 연다. */
const TAB_ICONS: Record<string, TabBarIcon> = {
  community: "community",
  index: "home",
  persona: "me",
  meeting: "chat",
  plan: "plan",
};

/** 파티(여행) 안에서만 보이는 탭. 초기 화면에는 홈·내 캐릭터만 있다. */
const TRIP_ONLY = new Set(["meeting", "plan"]);
/** 파티 밖(메인)에서만 보이는 탭. 파티 밖 탭은 커뮤니티 · 홈 · 내 캐릭터(홈이 가운데) */
const OUTSIDE_ONLY = new Set(["community"]);

/** 홈에서 이어지는 숨은 화면(설문·초대 링크)이 열려 있을 때는 홈 탭이 켜진 것으로 본다. */
const HOME_FLOW = new Set(["invite/[code]", "conditions"]);
/** 성향 검사(문항 화면)는 내 캐릭터 탭이 켜진 것으로 본다. */
const PERSONA_FLOW = new Set(["questionnaire"]);
/** 회의 탭에서 이어지는 숨은 화면은 회의 탭이 켜진 것으로 본다. */
const MEETING_FLOW = new Set(["agreement"]);
/** 일정 탭에서 이어지는 숨은 화면(장소 근거 보기)은 일정 탭이 켜진 것으로 본다. */
const PLAN_FLOW = new Set(["place/[id]"]);
/** 커뮤니티에서 이어지는 숨은 화면(장소 하나)은 커뮤니티 탭이 켜진 것으로 본다. */
const COMMUNITY_FLOW = new Set(["community/[id]"]);

function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const me = useSession();
  const hasTrip = me !== null;
  // A·B가 정해지면 회의 탭을 뺀다(실서버: 일정 표 상태, 가짜 서버: 이 폰에서 고른 안). 지금 보고 있는 동안은 남긴다.
  const decided = useSyncExternalStore(decidedTrips.subscribe, decidedTrips.get, decidedTrips.get);
  const chosen = useSyncExternalStore(chosenPlanStore.subscribe, chosenPlanStore.get, chosenPlanStore.get);
  const meetingDone = me !== null && (config.useMock ? chosen !== null : decided[me.tripId] === true);
  // 회의 탭은 회의가 시작된 뒤부터, 일정 탭은 회의가 끝난 뒤부터 보인다(11/3 결정).
  const conditions = useSyncExternalStore(conditionsStore.subscribe, conditionsStore.get, conditionsStore.get);
  const result = useSyncExternalStore(meetingResultStore.subscribe, meetingResultStore.get, meetingResultStore.get);
  const started = useSyncExternalStore(startedMeetingStore.subscribe, startedMeetingStore.get, startedMeetingStore.get);
  const infos = usePartyInfos();
  const tabs =
    me === null
      ? { meeting: false, plan: false }
      : tripTabs({
          tripStatus: infos[me.tripId]?.trip.status,
          hasConditions: conditions !== null,
          startedHere: started[me.tripId] !== undefined,
          hasResult: result !== null,
          decided: meetingDone,
        });
  // 회의가 재생되는 동안은 탭바를 숨겨 지도를 넓게 쓴다. 일시정지하거나 끝나면 다시 나온다.
  const immersive = useSyncExternalStore(meetingImmersive.subscribe, meetingImmersive.get, meetingImmersive.get);
  const focusedName = state.routes[state.index]?.name;
  const items: TabBarItem[] = [];

  for (const route of state.routes) {
    const options = descriptors[route.key]?.options;
    const icon = TAB_ICONS[route.name];
    if (options === undefined || icon === undefined) continue;
    // expo-router는 href: null 옵션을 지우고 display:none으로 바꾸므로, 보일 탭은 여기서 직접 정한다.
    if (TRIP_ONLY.has(route.name) && !hasTrip) continue;
    if (OUTSIDE_ONLY.has(route.name) && hasTrip) continue;
    // 지금 보고 있는 탭(과 그 탭에서 이어진 화면)은 숨기지 않는다.
    if (route.name === "meeting" && !tabs.meeting && focusedName !== "meeting" && !MEETING_FLOW.has(focusedName ?? "")) continue;
    if (route.name === "plan" && !tabs.plan && focusedName !== "plan" && !PLAN_FLOW.has(focusedName ?? "")) continue;

    const focused =
      focusedName === route.name ||
      (route.name === "index" && focusedName !== undefined && HOME_FLOW.has(focusedName)) ||
      (route.name === "persona" && focusedName !== undefined && PERSONA_FLOW.has(focusedName)) ||
      (route.name === "meeting" && focusedName !== undefined && MEETING_FLOW.has(focusedName)) ||
      (route.name === "plan" && focusedName !== undefined && PLAN_FLOW.has(focusedName)) ||
      (route.name === "community" && focusedName !== undefined && COMMUNITY_FLOW.has(focusedName));
    items.push({
      key: route.key,
      label: typeof options.title === "string" ? options.title : route.name,
      icon,
      focused,
      onPress: () => {
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        // 켜짐 표시는 부모 탭 기준이지만, 이동은 실제 화면 기준으로 판단한다(조건 화면에서 홈 탭을 누르면 홈으로).
        if (focusedName !== route.name && !event.defaultPrevented) navigation.navigate(route.name, route.params);
      },
      onLongPress: () => navigation.emit({ type: "tabLongPress", target: route.key }),
    });
  }

  // 성향 검사는 문항에 집중하도록 탭바 없이 화면 전체를 쓴다.
  if (immersive || focusedName === "questionnaire") return null;
  return <TabBar items={items} />;
}

/** 탭에 없는 화면(여행 조건 등) 왼쪽 위의 뒤로 가기. 돌아갈 곳이 없으면 홈으로. */
function BackButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      accessibilityRole="button"
      accessibilityLabel="뒤로 가기"
      hitSlop={8}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path d="M15 5l-7 7 7 7" stroke={colors.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </Pressable>
  );
}

/** 탭 화면 맨 위 줄: 파티 안이면 "‹ 내 파티"로 초기 화면에 나갈 수 있고, 오른쪽에는 설정 버튼이 있다. */
function AppTopBar() {
  const router = useRouter();
  const me = useSession();
  const infos = usePartyInfos();
  const refresh = useRefreshParty();
  const tripId = me?.tripId ?? null;
  const name = tripId === null ? null : (infos[tripId]?.trip.title ?? null);

  // 이름을 아직 모르면(앱을 막 켠 경우) 한 번 받아 둔다.
  useEffect(() => {
    if (me !== null && name === null) void refresh(me);
  }, [me, name, refresh]);

  return (
    // 위쪽 줄도 내용(screenLayout)과 같이 탭을 열 때 밝아진다.
    <TabFade>
      <TopBar
        party={me === null ? undefined : { name }}
        onExitParty={() => {
          void partyActions.exit();
          router.navigate("/");
        }}
        onSettings={() => router.push("/settings")}
      />
    </TabFade>
  );
}

/** 화면 이름을 크게 적는 위쪽 줄(내 캐릭터). 오른쪽에 설정 버튼 */
function PageTopBar({ title }: { title: string }) {
  const router = useRouter();
  return (
    <TabFade>
      <TopBar title={title} onSettings={() => router.push("/settings")} />
    </TabFade>
  );
}

/** 홈의 위쪽 줄: 파티 안 홈은 무대 위에 떠 있는 줄을 따로 그려서 비운다. */
function HomeTopBar() {
  return useSession() === null ? <AppTopBar /> : null;
}

/**
 * 폰의 뒤로 가기를 홈으로 모은다(11/3 결정, 할 일은 backAction). 숨은 화면은 연 화면으로, 큰 탭은 홈으로,
 * 파티 안 홈은 초기 화면(내 파티)으로 나가고 파티 밖 홈은 앱을 닫는다.
 * 경로가 바뀔 때마다 다시 달아서 내비게이터의 뒤로 가기(있었던 탭을 거슬러 감)보다 먼저 받는다.
 */
function useHardwareBack() {
  const pathname = usePathname();
  const router = useRouter();
  const hasTrip = useSession() !== null;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const action = backAction(pathname, hasTrip);
      if (action === "home") router.navigate("/");
      else if (action === "exitParty") void partyActions.exit();
      else if (action === "exitApp") BackHandler.exitApp();
      return action !== "history";
    });
    return () => sub.remove();
  }, [hasTrip, pathname, router]);
}

function ThemedTabs() {
  const { scheme, colors } = useTheme();
  const hasTrip = useSession() !== null;
  const tripTab = (title: string) => ({ title, href: hasTrip ? undefined : null, header: () => <AppTopBar /> });
  useHardwareBack();

  // 앱 바탕색을 시스템 창 바탕에도 깔아, 키보드·스크롤 끝·시스템 바 뒤에 다른 색이 비치지 않게 한다.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/* 안드로이드 아래 시스템 막대(버튼 3개 방식)의 버튼 색. 막대 바탕을 앱과 잇는 설정은 app.json 플러그인에 있다. */}
      <NavigationBar style={scheme === "dark" ? "light" : "dark"} />
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
        // 커뮤니티를 탭 맨 앞에 두지만 처음 여는 화면은 홈이다(로그인 화면을 지나 탭이 새로 그려질 때도).
        initialRouteName="index"
        // 숨은 화면(설정·장소 등)의 뒤로 가기는 방금 있던 화면으로 돌아간다(기본값은 어디서든 첫 탭인 홈으로 간다).
        // 큰 탭·홈에서 폰의 뒤로 가기는 useHardwareBack이 홈으로 모은다(11/3).
        backBehavior="history"
        // 탭을 열 때 화면이 살짝 흐렸다가 밝아진다(11/3 결정: 탭 페이드). 내비게이터 애니메이션 대신 TabFade가 한다.
        screenLayout={({ children }) => <TabFade fill>{children}</TabFade>}
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.background },
          // 내비게이터의 탭 애니메이션은 끈다(11/3). 켜면 지금 탭보다 앞 순서(왼쪽)의 탭이 안 보여도 폰 화면에서
          // 떼어지지 않아, 회의가 끝난 뒤 일정·내 캐릭터 탭 뒤에 회의 지도·대화가 통째로 붙어 있다가 탭을 옮길 때마다 다시
          // 그려져 끊겼다. 여는 탭에만 페이드를 걸면 새 탭이 투명한 채로 붙고 앞 탭은 바로 떼어져서, 페이드가 늦게 시작하면
          // 화면이 비어 보였다(내 캐릭터). 안 보이는 탭은 바로 떼어지고 내용과 상태는 그대로 남는다. 페이드는 위 screenLayout.
          animation: "none",
        }}
      >
        <Tabs.Screen name="community" options={{ title: "커뮤니티", href: hasTrip ? null : undefined, header: () => <PageTopBar title="커뮤니티" /> }} />
        <Tabs.Screen name="index" options={{ title: "홈", header: () => <HomeTopBar /> }} />
        <Tabs.Screen name="meeting" options={tripTab("회의")} />
        <Tabs.Screen name="plan" options={tripTab("일정")} />
        <Tabs.Screen name="persona" options={{ title: "내 캐릭터", header: () => <PageTopBar title="내 캐릭터" /> }} />
        <Tabs.Screen name="settings" options={{ href: null, title: "설정", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="conditions" options={{ href: null, title: "여행 조건", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="agreement" options={{ href: null, title: "AI 합의안", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="place/[id]" options={{ href: null, title: "장소", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="questionnaire" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="invite/[code]" options={{ href: null }} />
        <Tabs.Screen name="auth" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="community/[id]" options={{ href: null, headerShown: false }} />
      </Tabs>
    </>
  );
}

/**
 * 저장된 세션을 읽는다. 가짜 데이터 모드의 가짜 서버는 앱을 다시 켜면 기억이 사라지므로,
 * 그때 저장돼 있던 세션은 이미 없는 여행을 가리킨다. 그대로 두면 "여행에 다시 참여해 주세요" 오류가 나서 지운다.
 */
async function loadSession() {
  // 내 성향(1~12번)은 폰에만 있고 서버와 상관없으니 가짜 데이터 모드에서도 지우지 않는다.
  // 일정 탭에서 바꾼 시각도 폰에만 있다. 못 읽어도 짐작한 시각으로 보이면 되니 실패는 넘긴다.
  const [saved, joined] = await Promise.all([session.load(), parties.load(), profile.load(), planTimes.load().catch(() => undefined)]);
  if (config.useMock) {
    if (saved !== null) await session.clear();
    if (joined.length > 0) await parties.clear();
  }
}

export default function RootLayout() {
  const mode = useThemeMode();
  const [ready, setReady] = useState(false);

  // 앱 안에서 고른 모드를 시스템 바(상태·내비게이션 막대) 글자색에도 알린다. 시스템이면 휴대폰 설정을 따른다.
  useEffect(() => {
    try {
      Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
    } catch {
      // 지원하지 않는 환경에서는 앱 안 색만 바뀐다.
    }
  }, [mode]);

  // 파티를 오가면 떠나는 파티의 회의 조건·합의안은 맡아 두고, 들어가는 파티의 것으로 바꾼다(초기 화면에서는 비어 있다).
  useEffect(() => keepPerTrip(session, [conditionsStore, meetingResultStore]), []);

  useEffect(() => {
    let alive = true;
    // 저장된 화면 모드와 세션을 먼저 읽어 둔다. 하나가 실패해도 앱은 뜬다. 준비 화면은 다 읽어도 SPLASH_MIN_MS까지는 보여 준다.
    const shown = new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS));
    void Promise.allSettled([themeMode.load(), loadSession(), login.load(), shown]).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 손가락 동작(지도 끌기·확대)을 앱 맨 바깥에서 받는다. 지도 안에만 두면 일정 화면의 스크롤이 손가락을 먼저 가져가 지도가 안 움직였다.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider mode={mode}>
        {ready ? <AfterSplash /> : <Splash />}
        {/* 동작이 끝났다는 짧은 알림(showToast). 모든 화면 위에 하나만 둔다. */}
        <ToastHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/** 준비 화면 다음: 로그인하지 않았고 이번 실행에서 아직 넘기지 않았으면 로그인 화면, 아니면 탭 화면 */
function AfterSplash() {
  return useLoginGateOpen() ? <LoginScreen onKakao={kakaoThenRestore} onSkip={loginGate.pass} /> : <ThemedTabs />;
}

/** 카카오로 시작하기: 로그인하고 내 여행을 되찾은 뒤 홈으로. 실패하면 화면에 보일 문장, 성공·취소면 null */
async function kakaoThenRestore(): Promise<string | null> {
  try {
    const result = await signInWithKakao();
    if (result.kind === "cancelled") return null;
    if (result.kind === "error") return loginErrorText(result.code);
    await restoreAfterLogin();
    loginGate.pass();
    return null;
  } catch (error) {
    return describeError(error);
  }
}

/** 저장된 설정을 읽는 동안 보이는 준비 화면: 메인 색 바탕에 앱 이름과 민수 한 명. */
function Splash() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.hero, alignItems: "center", justifyContent: "center" }}>
      <StatusBar style="light" />
      <Wordmark width={250} color={colors.onHero} />
      <View style={{ marginTop: 176, width: 64, height: 78 }} accessible accessibilityRole="image" accessibilityLabel="모자 쓴 민수 캐릭터">
        <View style={{ position: "absolute", left: 0, top: 66, width: 64, height: 12, borderRadius: 32, backgroundColor: colors.heroFloor }} />
        <View style={{ position: "absolute", left: 4, top: 0 }}>
          <CharacterSvg width={56} height={73} body={pastel(SPLASH_COLOR)} line={outline(SPLASH_COLOR)} props={SPLASH_PROPS} />
        </View>
      </View>
    </View>
  );
}

/** 준비 화면을 보여 주는 가장 짧은 시간 */
const SPLASH_MIN_MS = 1500;
// 준비 화면의 민수: 첫 구성원 색, 모자와 책.
const SPLASH_COLOR = memberColors[0]!;
const SPLASH_PROPS: CharacterProps = { head: "cap", hand: "book" };
