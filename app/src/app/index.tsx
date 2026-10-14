import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api/index.ts";
import { checkHealth } from "../lib/api/health.ts";
import type { HealthResult } from "../lib/api/health.ts";
import { config } from "../lib/config/index.ts";
import { colors } from "../lib/theme.ts";

export default function Index() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const inFlight = useRef(false);

  async function onCheck() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkHealth(api));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>여행회의</Text>
      <Text style={styles.line}>모드: {config.useMock ? "가짜 데이터" : "서버"}</Text>
      <Text style={styles.line}>
        서버 주소: {config.apiBaseUrl === "" ? "없음 (가짜 데이터 사용)" : config.apiBaseUrl}
      </Text>
      {config.warning !== null && <Text style={styles.warning}>{config.warning}</Text>}

      <Pressable
        style={[styles.button, checking && styles.buttonDisabled]}
        onPress={onCheck}
        disabled={checking}
      >
        <Text style={styles.buttonText}>{checking ? "확인 중..." : "서버 연결 확인"}</Text>
      </Pressable>

      {checking && <ActivityIndicator style={styles.spinner} color={colors.primary} />}
      {result !== null && result.ok && (
        <Text style={styles.line}>연결 성공 · 응답 시간 {result.latencyMs}ms</Text>
      )}
      {result !== null && !result.ok && (
        <Text style={styles.warning}>
          연결 실패 · {result.error.code}: {result.error.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: 16,
  },
  line: {
    marginTop: 8,
    fontSize: 16,
    color: colors.text,
    textAlign: "center",
  },
  warning: {
    marginTop: 8,
    fontSize: 14,
    color: colors.text,
    textAlign: "center",
  },
  button: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.background,
  },
  spinner: {
    marginTop: 16,
  },
});
