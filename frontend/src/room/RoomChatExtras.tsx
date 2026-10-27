/**
 * Iter-150 — room chat rows: mandatory system notice, gift message (identity +
 * "قام @A بإرسال هدية إلى @B ×N" + rounded gift image) and VIP5+ image message.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ChatIdentityRow } from "@/src/room/ChatIdentityRow";
import { useImageViewer } from "@/src/components/ImageViewer";
import { mediaUrl } from "@/src/media/upload";

const YELLOW = "#FFD54A";

export const ROOM_NOTICE_AR =
  "النظام: أهلاً بك في يازين | Yazeen.\n\nيُمنع منعاً باتاً نشر المحتوى الإباحي،\nأو الشتائم، أو ممارسة الأنشطة المخالفة للقوانين.\n\nتحرص الإدارة على مراقبة الغرف على مدار 24 ساعة من قبل فريق الإشراف.\nفي حال ملاحظة أي سلوك مخالف، يُرجى الإبلاغ عنه فوراً.";
export const ROOM_NOTICE_EN =
  "System: Welcome to Yazeen | يازين.\n\nPosting pornographic content, insults,\nor engaging in illegal activities is strictly prohibited.\n\nThe administration monitors rooms 24 hours a day through the moderation team.\nIf you notice any violating behavior, please report it immediately.";

export function RoomSystemNotice({ isRTL }: { isRTL: boolean }) {
  return (
    <Text testID="room-system-notice" style={[styles.notice, { textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr" }]}>
      {isRTL ? ROOM_NOTICE_AR : ROOM_NOTICE_EN}
    </Text>
  );
}

function identity(m: any) {
  return { id: m.user_id, nickname: m.nickname, avatar_url: m.avatar_url, vip_level: m.vip_level,
    wealth_level: m.wealth_level, charm_level: m.charm_level, age: m.age };
}

export function RoomGiftMessage({ m, isRTL, onOpen }: { m: any; isRTL: boolean; onOpen: (uid: string) => void }) {
  const rc: any[] = m.recipients || [];
  const qty = Number(m.quantity ?? 1);
  const name = (u: any) => (
    <Text key={u?.id} style={styles.mention} onPress={() => u?.id && onOpen(u.id)} testID={`gift-mention-${u?.id ?? ""}`}>
      @{u?.nickname || "User"}
    </Text>
  );
  const recips = rc.flatMap((u, i) => (i === 0 ? [name(u)] : [<Text key={`s${i}`} style={styles.giftText}>{isRTL ? "، " : ", "}</Text>, name(u)]));
  const sender = { id: m.user_id, nickname: m.nickname };
  const body = (
    <View testID={`chat-gift-${m.id}`}>
      <Text style={[styles.giftText, { writingDirection: isRTL ? "rtl" : "ltr" }]}>
        {isRTL ? "قام " : ""}{name(sender)}{isRTL ? " بإرسال هدية إلى " : " sent a gift to "}{recips}
        <Text style={styles.qty}>{` ×${qty}`}</Text>
      </Text>
      {!!m.gift?.image_url && (
        <Image source={mediaUrl(m.gift.image_url)} style={styles.giftImg} contentFit="contain" testID="chat-gift-image" />
      )}
    </View>
  );
  return <ChatIdentityRow user={identity(m)} text="" isRTL={isRTL} onOpen={onOpen} content={body} />;
}

export function RoomImageMessage({ m, isRTL, onOpen }: { m: any; isRTL: boolean; onOpen: (uid: string) => void }) {
  const viewer = useImageViewer();
  const uri = mediaUrl(m.image_url);
  return (
    <ChatIdentityRow
      user={identity(m)} text="" isRTL={isRTL} onOpen={onOpen} testID={`chat-image-author-${m.user_id ?? ""}`}
      content={
        <Pressable onPress={() => viewer.show(uri)} testID={`chat-image-${m.id}`}>
          <Image source={uri} style={styles.thumb} contentFit="cover" />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  notice: { color: YELLOW, fontSize: 12, lineHeight: 18, fontWeight: "600", maxWidth: 280 },
  giftText: { color: "#FFFFFF", fontSize: 12.5, lineHeight: 18 },
  mention: { color: YELLOW, fontWeight: "800" },
  qty: { color: YELLOW, fontWeight: "900" },
  giftImg: { width: 56, height: 56, borderRadius: 14, marginTop: 4, backgroundColor: "rgba(255,255,255,0.08)" },
  thumb: { width: 110, height: 110, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)" },
});
