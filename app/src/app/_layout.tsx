import { Tabs } from "expo-router";
import { Text } from "react-native";

import { colors } from "../lib/theme.ts";

function emojiIcon(emoji: string) {
  return function TabIcon() {
    return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
  };
}

export default function RootLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="index" options={{ title: "홈", tabBarIcon: emojiIcon("🏠") }} />
      <Tabs.Screen
        name="persona"
        options={{ title: "페르소나", tabBarIcon: emojiIcon("🧑") }}
      />
      <Tabs.Screen
        name="meeting"
        options={{ title: "AI 회의", tabBarIcon: emojiIcon("💬") }}
      />
      <Tabs.Screen name="plan" options={{ title: "일정", tabBarIcon: emojiIcon("🗓️") }} />
    </Tabs>
  );
}
