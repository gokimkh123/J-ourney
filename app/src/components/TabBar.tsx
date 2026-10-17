import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { pressedOpacity, spacing, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { type AvatarChip } from "./Avatar.tsx";
import { tabFlexes } from "./tabBarLayout.ts";

export type TabBarIcon = "home" | "chat" | "plan" | "me" | "settings";

export type TabBarItem = {
  key: string;
  /** "홈", "내 캐릭터", "AI 회의", "일정", "설정" */
  label: string;
  icon: TabBarIcon;
  focused: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export type TabBarProps = {
  items: TabBarItem[];
  /** 'me' 탭 아이콘에 보여 줄 내 캐릭터. 없으면 사람 모양 선 아이콘. */
  me?: { color: string; chips?: AvatarChip[]; name?: string };
};

const PILL = 44;
const ICON = 26;

function IconShape({ icon, color, width }: { icon: Exclude<TabBarIcon, "me">; color: string; width: number }) {
  const common = { stroke: color, strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (icon) {
    case "home":
      return <Path {...common} d="M4 11.2L12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />;
    case "chat":
      return (
        <>
          <Path {...common} d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.2 3.4V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <Path {...common} d="M8.5 10h7" />
        </>
      );
    case "plan":
      return (
        <>
          <Rect {...common} x={4} y={5.5} width={16} height={14.5} rx={2.5} />
          <Path {...common} d="M8 3.5v4M16 3.5v4M4 10h16" />
        </>
      );
    case "settings":
      // 슬라이더 모양: 선 세 줄과 동그란 손잡이
      return (
        <>
          <Path {...common} d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
          <Circle {...common} cx={15} cy={7} r={2} />
          <Circle {...common} cx={9} cy={12} r={2} />
          <Circle {...common} cx={17} cy={17} r={2} />
        </>
      );
  }
}

function TabIcon({ icon, color, focused, me }: { icon: TabBarIcon; color: string; focused: boolean; me: TabBarProps["me"] }) {
  const width = focused ? 2.2 : 1.8;
  if (icon === "me" && me !== undefined) {
    return <Avatar color={me.color} chips={me.chips} name={me.name} diameter={ICON - 4} separatorColor="transparent" />;
  }
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      {icon === "me" ? (
        <>
          <Circle cx={12} cy={8.5} r={3.5} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />
          <Path d="M5 20c1-4 4-6 7-6s6 2 7 6" stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />
        </>
      ) : (
        <IconShape icon={icon} color={color} width={width} />
      )}
    </Svg>
  );
}

/** 아래 탭바(납작 + 알약). 켜진 탭만 알약 안에 아이콘과 라벨이 같이 나온다. 연결은 화면(_layout)이 한다. */
export default function TabBar({ items, me }: TabBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const focusedIndex = items.findIndex((item) => item.focused);
  const flexes = tabFlexes(items.length, focusedIndex);

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      <View style={styles.row}>
        {items.map((item, i) => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: item.focused }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [
              styles.item,
              { flex: flexes[i] },
              item.focused && styles.itemFocused,
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <TabIcon icon={item.icon} color={item.focused ? colors.onAccent : colors.iconFaint} focused={item.focused} me={me} />
            {item.focused && (
              <AppText variant="label" tone="onAccent" numberOfLines={1} style={styles.label}>
                {item.label}
              </AppText>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      backgroundColor: t.colors.surface,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
      paddingTop: 10,
      paddingHorizontal: spacing.md - spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xxs,
    },
    item: {
      height: PILL,
      minHeight: PILL,
      borderRadius: PILL / 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    itemFocused: {
      backgroundColor: t.colors.accent,
    },
    label: {
      fontWeight: "700",
      fontSize: 14,
    },
  });
