import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";

import TabBar, { type TabBarIcon, type TabBarItem } from "../components/TabBar.tsx";
import { session } from "../lib/session/index.ts";
import { useSession } from "../lib/session/useSession.ts";
import { themeMode } from "../lib/settings/index.ts";
import { useThemeMode } from "../lib/settings/useThemeMode.ts";
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
const HOME_FLOW = new Set(["questionnaire", "invite/[code]"]);

function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const focusedName = state.routes[state.index]?.name;
  const items: TabBarItem[] = [];

  for (const route of state.routes) {
    const options = descriptors[route.key]?.options;
    const icon = TAB_ICONS[route.name];
    if (options === undefined || icon === undefined) continue;
    if ((options as { href?: unknown }).href === null) continue;

    const focused = focusedName === route.name || (route.name === "index" && focusedName !== undefined && HOME_FLOW.has(focusedName));
    items.push({
      key: route.key,
      label: typeof options.title === "string" ? options.title : route.name,
      icon,
      focused,
      onPress: () => {
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
      },
      onLongPress: () => navigation.emit({ type: "tabLongPress", target: route.key }),
    });
  }

  return <TabBar items={items} />;
}

function ThemedTabs() {
  const { scheme, colors } = useTheme();
  const hasTrip = useSession() !== null;
  const tripTab = (title: string) => ({ title, href: hasTrip ? undefined : null });

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
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
        <Tabs.Screen name="questionnaire" options={{ href: null }} />
        <Tabs.Screen name="invite/[code]" options={{ href: null }} />
      </Tabs>
    </>
  );
}

export default function RootLayout() {
  const mode = useThemeMode();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // 저장된 화면 모드와 세션을 먼저 읽어 둔다. 하나가 실패해도 앱은 뜬다.
    void Promise.allSettled([themeMode.load(), session.load()]).then(() => {
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
