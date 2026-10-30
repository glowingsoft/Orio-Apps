/**
 * Create Room — Iter-67.
 *
 * Premium create flow with a real avatar picker, Room Name, User Notice
 * (owner → auto-mentions the entering user), Room Notice (owner-posted
 * welcome message), and Mic Capacity (8 / 15 / 20). The Confirm button
 * stays dimmed until every required field is populated, then turns
 * purple + active. Everything is persisted via the backend; the avatar
 * is routed through `/rooms/cover/moderate` so inappropriate images are
 * blocked for 3 days.
 */
import { useMemo, useState } from "react";
import { pickAndCrop } from "@/src/media/ImageCropper";
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { apiCreateRoom, apiModerateRoomCover } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { TopPurpleGlow } from "@/src/components/TopPurpleGlow";

const SEAT_OPTIONS: { value: 8 | 15 | 20; sub: string }[] = [
  { value: 8,  sub: "mic" },
  { value: 15, sub: "mic" },
  { value: 20, sub: "mic" },
];

const USER_NOTICE_DEFAULT_EN = "Welcome @user";
const USER_NOTICE_DEFAULT_AR = "مرحباً @user";
const ROOM_NOTICE_DEFAULT_EN = "Welcome to the room";
const ROOM_NOTICE_DEFAULT_AR = "مرحباً بكم في الغرفة";

export default function CreateRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL } = useI18n();
  const { user } = useAuth();

  const [cover, setCover] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [userNotice, setUserNotice] = useState(isRTL ? USER_NOTICE_DEFAULT_AR : USER_NOTICE_DEFAULT_EN);
  const [roomNotice, setRoomNotice] = useState(isRTL ? ROOM_NOTICE_DEFAULT_AR : ROOM_NOTICE_DEFAULT_EN);
  const [seats, setSeats] = useState<8 | 15 | 20>(8);
  const [loading, setLoading] = useState(false);
  const [moderating, setModerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const t = useMemo(() => ({
    title:        isRTL ? "إنشاء غرفة" : "Create Room",
    coverLabel:   isRTL ? "صورة الغرفة" : "Room Avatar",
    coverHint:    isRTL ? "اضغط لاختيار الصورة" : "Tap to pick a photo",
    name:         isRTL ? "اسم الغرفة" : "Room Name",
    namePh:       isRTL ? "اسم مميز لغرفتك" : "A premium name for your room",
    userNotice:   isRTL ? "رسالة الترحيب بالداخلين" : "User Notice",
    userNoticePh: isRTL ? "مثال: مرحبا @أحمد" : "e.g. Welcome @Ahmed",
    userHint:     isRTL ? "ستُرسل تلقائيًا باسم المالك وتذكر الداخل" : "Sent from your account; auto-mentions whoever enters",
    roomNotice:   isRTL ? "إشعار الغرفة" : "Room Notice",
    roomNoticePh: isRTL ? "مثال: مرحباً بكم في وكالة YemKing" : "e.g. Welcome to YemKing Agency",
    roomHint:     isRTL ? "ستُرسل باسم المالك عند دخول المستخدمين" : "Posted from your account to greet everyone",
    seatsLabel:   isRTL ? "عدد المايكات" : "Mic Capacity",
    confirm:      isRTL ? "تأكيد" : "Confirm",
    blocked:      isRTL ? "تم حظر هذه الصورة" : "Image blocked",
    pickErr:      isRTL ? "تعذّر اختيار الصورة" : "Could not pick image",
    perms:        isRTL ? "يُرجى منح إذن الوصول إلى الصور" : "Photo library permission required",
    nameTooShort: isRTL ? "الاسم قصير جدًا (3 أحرف على الأقل)" : "Name must be at least 3 characters",
  }), [isRTL]);

  const isValid = cover !== null && name.trim().length >= 3 && userNotice.trim().length > 0 && roomNotice.trim().length > 0 && !loading && !moderating;

  const pickCover = async () => {
    setErr(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert(t.coverLabel, t.perms); return; }
      const res = await pickAndCrop({ aspect: [1, 1], base64: true, maxSide: 1080 });
      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a) return;
      const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
      // Moderation gate — if blocked, show the server reason and DO NOT keep
      // the local picked image so the user is forced to pick a different one.
      setModerating(true);
      try {
        await apiModerateRoomCover(dataUri);
        setCover(dataUri);
      } catch (e: any) {
        setCover(null);
        setErr(e?.message || t.blocked);
      } finally {
        setModerating(false);
      }
    } catch (e: any) {
      setErr(e?.message || t.pickErr);
    }
  };

  const submit = async () => {
    if (!isValid) return;
    setErr(null);
    if (name.trim().length < 3) { setErr(t.nameTooShort); return; }
    setLoading(true);
    try {
      // User-Notice is a template that includes the entering user's @mention.
      // We keep the raw template server-side; the room UI replaces `@user` or
      // `@username` with the live user's handle on each entry.
      const welcome = userNotice.trim();
      const notice = roomNotice.trim();
      const r = await apiCreateRoom({
        name: name.trim(),
        description: notice,            // Room Notice doubles as the public description.
        category: "chat",
        num_seats: seats,
        is_private: false,
        cover_url: cover,
        welcome_msg: welcome,
        notice,
      });
      router.replace(`/room/${r.id}` as any);
    } catch (e: any) {
      setErr(e?.message || "Failed to create");
    } finally {
      setLoading(false);
    }
  };

  const avatarInitial = (name.trim() || user?.nickname || "O").charAt(0).toUpperCase();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <TopPurpleGlow />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, flexDirection: "row" }]}>
        <Pressable testID="back-btn" onPress={() => safeBack(router)} style={styles.iconBtn}>
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* -------- Room avatar picker -------- */}
        <Pressable
          testID="pick-cover-btn"
          onPress={pickCover}
          style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.9 }]}
          disabled={moderating}
        >
          {cover ? (
            <Image source={cover} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Icon name="camera" size={30} color={colors.brandPrimary} />
              <Text style={{ color: colors.brandPrimary, fontSize: 44, fontWeight: "900", marginTop: 4 }}>{avatarInitial}</Text>
            </View>
          )}
          <View style={styles.avatarPen}>
            {moderating
              ? <ActivityIndicator color={colors.onBrandPrimary} />
              : <Icon name="camera" size={16} color={colors.onBrandPrimary} />}
          </View>
        </Pressable>
        <Text style={styles.hintCenter}>{t.coverHint}</Text>

        {/* -------- Room Name -------- */}
        <Text style={styles.label}>{t.name}</Text>
        <TextInput
          testID="room-name-input"
          value={name}
          onChangeText={setName}
          placeholder={t.namePh}
          placeholderTextColor={colors.muted}
          style={styles.input}
          maxLength={40}
          textAlign={isRTL ? "right" : "left"}
        />

        {/* -------- User Notice -------- */}
        <Text style={styles.label}>{t.userNotice}</Text>
        <TextInput
          testID="user-notice-input"
          value={userNotice}
          onChangeText={setUserNotice}
          placeholder={t.userNoticePh}
          placeholderTextColor={colors.muted}
          style={styles.input}
          maxLength={120}
          textAlign={isRTL ? "right" : "left"}
        />
        <Text style={styles.hint}>{t.userHint}</Text>

        {/* -------- Room Notice -------- */}
        <Text style={styles.label}>{t.roomNotice}</Text>
        <TextInput
          testID="room-notice-input"
          value={roomNotice}
          onChangeText={setRoomNotice}
          placeholder={t.roomNoticePh}
          placeholderTextColor={colors.muted}
          style={[styles.input, { height: 80 }]}
          multiline
          maxLength={300}
          textAlign={isRTL ? "right" : "left"}
        />
        <Text style={styles.hint}>{t.roomHint}</Text>

        {/* -------- Mic capacity -------- */}
        <Text style={styles.label}>{t.seatsLabel}</Text>
        <View style={[styles.seatRow, { flexDirection: "row" }]}>
          {SEAT_OPTIONS.map((opt) => {
            const active = seats === opt.value;
            return (
              <Pressable
                key={opt.value}
                testID={`seat-${opt.value}`}
                onPress={() => setSeats(opt.value)}
                style={[styles.seatCard, active && styles.seatCardActive]}
              >
                <Text style={[styles.seatBig, active && styles.seatBigActive]}>{opt.value}</Text>
                <Text style={[styles.seatSub, active && styles.seatSubActive]}>{opt.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        {err && <Text style={styles.err}>{err}</Text>}

        {/* -------- Confirm button (dim/purple states) -------- */}
        <Pressable
          testID="confirm-btn"
          onPress={submit}
          disabled={!isValid}
          style={({ pressed }) => [
            styles.cta,
            !isValid ? styles.ctaDim : styles.ctaActive,
            pressed && isValid && { opacity: 0.9 },
          ]}
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={[styles.ctaText, !isValid && styles.ctaTextDim]}>{t.confirm}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const PURPLE = "#8B5CF6";
const PURPLE_SOFT = "#2A1655";

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },

  avatarWrap: {
    alignSelf: "center",
    width: 128, height: 128, borderRadius: 64,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: PURPLE + "88",
    alignItems: "center", justifyContent: "center",
    overflow: "visible",
    shadowColor: PURPLE,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  avatarImg: { width: 124, height: 124, borderRadius: 62 },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarPen: {
    position: "absolute",
    right: 4, bottom: 4,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: PURPLE,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.surface,
  },
  hintCenter: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8 },

  label: { color: colors.onSurface, fontSize: 13, marginTop: spacing.lg, marginBottom: 8, fontWeight: "800" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 50,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
  },
  hint: { color: colors.muted, fontSize: 11, marginTop: 6, lineHeight: 15 },

  seatRow: { gap: 10 },
  seatCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(139,92,246,0.25)",
  },
  seatCardActive: {
    backgroundColor: PURPLE_SOFT,
    borderColor: PURPLE,
  },
  seatBig: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  seatBigActive: { color: "#FFFFFF" },
  seatSub: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2, letterSpacing: 0.5 },
  seatSubActive: { color: "#E9D5FF" },

  err: { color: colors.error, textAlign: "center", marginTop: spacing.md, fontSize: 13, fontWeight: "700" },

  cta: {
    marginTop: spacing.xl,
    height: 54,
    borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  ctaDim: {
    backgroundColor: "rgba(139,92,246,0.18)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
  },
  ctaActive: {
    backgroundColor: PURPLE,
    shadowColor: PURPLE,
    shadowOpacity: 0.7,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { color: "#FFFFFF", fontWeight: "900", fontSize: 17, letterSpacing: 0.6 },
  ctaTextDim: { color: "rgba(255,255,255,0.55)" },
});
