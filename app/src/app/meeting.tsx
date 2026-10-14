import { Text, View, StyleSheet } from "react-native";

import { colors } from "../lib/theme.ts";

export default function Meeting() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>AI 회의</Text>
      <Text style={styles.notice}>준비 중입니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: colors.text,
  },
  notice: {
    marginTop: 8,
    fontSize: 16,
    color: colors.text,
  },
});
