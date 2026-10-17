import { Text, View, StyleSheet } from "react-native";

import { useStyles, type Theme } from "../theme/index.ts";

export default function Plan() {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>일정</Text>
      <Text style={styles.notice}>준비 중입니다.</Text>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      color: t.colors.text,
    },
    notice: {
      marginTop: 8,
      fontSize: 16,
      color: t.colors.text,
    },
  });
