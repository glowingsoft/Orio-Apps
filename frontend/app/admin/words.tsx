/** Iter-135 — Web Admin: editable blocked-words list (server-side moderation). */
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminBannedWords, apiAdminSetBannedWords } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

export default function AdminWords() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-words"], queryFn: apiAdminBannedWords });
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setText(data.words.join("\n")); }, [data]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const words = text.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
      const r = await apiAdminSetBannedWords(words);
      setMsg(`Saved ${r.words.length} words · تم الحفظ`);
      qc.invalidateQueries({ queryKey: ["admin-words"] });
    } catch (e: any) { setMsg(e?.message || "Failed"); } finally { setBusy(false); }
  };

  return (
    <AdminShell title="Blocked Words · الكلمات المحظورة">
      {isLoading ? <ActivityIndicator color={colors.gold} /> : (
        <View style={{ gap: spacing.md }}>
          <View style={adminStyles.card}>
            <Text style={styles.h}>Custom words (one per line) · كلمات مخصصة (كلمة في كل سطر)</Text>
            <Text style={styles.sub}>Applied instantly to private messages, posts, comments, room chat, room names/notices and profiles.</Text>
            <TextInput testID="admin-words-input" value={text} onChangeText={setText} multiline
              style={[adminStyles.input, styles.area]} placeholder="word…" placeholderTextColor={colors.muted} />
            <Pressable testID="admin-words-save" onPress={save} disabled={busy} style={styles.btn}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Save · حفظ</Text>}
            </Pressable>
            {!!msg && <Text style={styles.sub} testID="admin-words-msg">{msg}</Text>}
          </View>
          <View style={adminStyles.card}>
            <Text style={styles.h}>Built-in list (always active) · القائمة المدمجة</Text>
            <Text style={styles.sub}>{[...(data?.builtin_en || []), ...(data?.builtin_ar || [])].join(" · ")}</Text>
          </View>
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  h: { color: colors.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 4 },
  sub: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  area: { minHeight: 220, textAlignVertical: "top", marginTop: spacing.sm },
  btn: { marginTop: spacing.md, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: spacing.xl },
  btnText: { color: colors.onBrandPrimary, fontWeight: "800" },
});
