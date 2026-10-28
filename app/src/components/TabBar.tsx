import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { pressedOpacity, useStyles, useTheme, type Theme } from "../theme/index.ts";
import AppText from "./AppText.tsx";
import Avatar, { type AvatarChip } from "./Avatar.tsx";

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

/** 탭 한 칸의 높이(손가락으로 누르기 좋게 48 이상). 눌리는 영역은 보이는 아이콘보다 훨씬 넓게 잡는다. */
const ITEM_HEIGHT = 64;
/** 눌리는 영역을 위로 더 넓힌다(탭바 위 경계 근처에서 눌러도 잡히게) */
const TOUCH_TOP = 8;
/** 켜진 탭의 둥근 바탕 지름 */
const DOT = 40;
const ICON = 24;

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

/**
 * 아래 탭바. 평소엔 아이콘 밑에 작은 글자로 이름이 떠 있고,
 * 켜진 탭은 글자가 사라지고 아이콘만 둥근 바탕 안에 들어간다. 연결은 화면(_layout)이 한다.
 */
export default function TabBar({ items, me }: TabBarProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      <View style={styles.row}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: item.focused }}
            accessibilityLabel={item.label}
            hitSlop={{ top: TOUCH_TOP }}
            style={({ pressed }) => [styles.item, pressed && { opacity: pressedOpacity }]}
          >
            {item.focused ? (
              <View style={styles.dot}>
                <TabIcon icon={item.icon} color={colors.onAccent} focused me={me} />
              </View>
            ) : (
              <>
                <TabIcon icon={item.icon} color={colors.iconFaint} focused={false} me={me} />
                <AppText variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.15} style={styles.label}>
                  {item.label}
                </AppText>
              </>
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
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
    },
    item: {
      flex: 1,
      height: ITEM_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      backgroundColor: t.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "600",
    },
  });
