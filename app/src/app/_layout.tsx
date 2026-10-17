import { NavigationBar } from "expo-navigation-bar";
import { Tabs, useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { Appearance, Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import TabBar, { type TabBarIcon, type TabBarItem } from "../components/TabBar.tsx";
import { config } from "../lib/config/index.ts";
import { meetingResultStore } from "../lib/meeting/resultStore.ts";
import { session } from "../lib/session/index.ts";
import { useSession } from "../lib/session/useSession.ts";
import { themeMode } from "../lib/settings/index.ts";
import { useThemeMode } from "../lib/settings/useThemeMode.ts";
import { conditionsStore } from "../lib/trip/conditionsStore.ts";
import { watchTripChange } from "../lib/trip/tripReset.ts";
import { ThemeProvider, useTheme } from "../theme/index.ts";

/** 탭바에 나오는 화면과 아이콘. 순서가 탭 순서다. */
const TAB_ICONS: Record<string, TabBarIcon> = {
  index: "home",
  persona: "me",
  meeting: "chat",
  plan: "plan",
  settings: "settings",
};

/** 여행에 참여(초대)한 뒤에만 보이는 탭 */
const TRIP_ONLY = new Set(["persona", "meeting", "plan"]);

/** 홈에서 이어지는 숨은 화면(설문·초대 링크)이 열려 있을 때는 홈 탭이 켜진 것으로 본다. */
const HOME_FLOW = new Set(["questionnaire", "invite/[code]", "conditions"]);
/** 회의 탭에서 이어지는 숨은 화면은 회의 탭이 켜진 것으로 본다. */
const MEETING_FLOW = new Set(["agreement"]);
/** 일정 탭에서 이어지는 숨은 화면(장소 근거 보기)은 일정 탭이 켜진 것으로 본다. */
const PLAN_FLOW = new Set(["place/[id]"]);

function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const hasTrip = useSession() !== null;
  const focusedName = state.routes[state.index]?.name;
  const items: TabBarItem[] = [];

  for (const route of state.routes) {
    const options = descriptors[route.key]?.options;
    const icon = TAB_ICONS[route.name];
    if (options === undefined || icon === undefined) continue;
    // expo-router는 href: null 옵션을 지우고 display:none으로 바꾸므로, 보일 탭은 여기서 직접 정한다.
    if (TRIP_ONLY.has(route.name) && !hasTrip) continue;

    const focused =
      focusedName === route.name ||
      (route.name === "index" && focusedName !== undefined && HOME_FLOW.has(focusedName)) ||
      (route.name === "meeting" && focusedName !== undefined && MEETING_FLOW.has(focusedName)) ||
      (route.name === "plan" && focusedName !== undefined && PLAN_FLOW.has(focusedName));
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

function ThemedTabs() {
  const { scheme, colors } = useTheme();
  const hasTrip = useSession() !== null;
  const tripTab = (title: string) => ({ title, href: hasTrip ? undefined : null });

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
        // 폰의 뒤로 가기는 방금 있던 화면으로 돌아간다(기본값은 어디서든 첫 탭인 홈으로 간다).
        backBehavior="history"
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "홈" }} />
        <Tabs.Screen name="persona" options={tripTab("내 캐릭터")} />
        <Tabs.Screen name="meeting" options={tripTab("AI 회의")} />
        <Tabs.Screen name="plan" options={tripTab("일정")} />
        <Tabs.Screen name="settings" options={{ title: "설정" }} />
        <Tabs.Screen name="conditions" options={{ href: null, title: "여행 조건", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="agreement" options={{ href: null, title: "AI 합의안", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="place/[id]" options={{ href: null, title: "장소", headerLeft: () => <BackButton /> }} />
        <Tabs.Screen name="questionnaire" options={{ href: null }} />
        <Tabs.Screen name="invite/[code]" options={{ href: null }} />
      </Tabs>
    </>
  );
}

/**
 * 저장된 세션을 읽는다. 가짜 데이터 모드의 가짜 서버는 앱을 다시 켜면 기억이 사라지므로,
 * 그때 저장돼 있던 세션은 이미 없는 여행을 가리킨다. 그대로 두면 "여행에 다시 참여해 주세요" 오류가 나서 지운다.
 */
async function loadSession() {
  const saved = await session.load();
  if (saved !== null && config.useMock) await session.clear();
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

  // 나가거나 다른 여행에 들어가면 이전 여행의 회의 조건·합의안을 비운다.
  useEffect(
    () =>
      watchTripChange(session, () => {
        conditionsStore.set(null);
        meetingResultStore.set(null);
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    // 저장된 화면 모드와 세션을 먼저 읽어 둔다. 하나가 실패해도 앱은 뜬다.
    void Promise.allSettled([themeMode.load(), loadSession()]).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ThemeProvider mode={mode}>
      {ready ? <ThemedTabs /> : <Splash />}
    </ThemeProvider>
  );
}

function Splash() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
