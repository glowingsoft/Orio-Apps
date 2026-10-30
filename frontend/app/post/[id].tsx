/**
 * Single post page (shared links + posts shared in private chat). The server
 * returns 404 when visibility/blocking rules don't allow the viewer.
 */
import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiGetPost } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { VipName } from "@/src/components/VipName";
import { PostMedia } from "@/src/posts/PostParts";

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const { data: post, isLoading, isError } = useQuery({ queryKey: ["post", id], queryFn: () => apiGetPost(id!), enabled: !!id });
  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="post-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/posts" as any))} hitSlop={10} style={styles.back} testID="post-detail-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isRTL ? "منشور" : "Post"}</Text>
        <View style={styles.back} />
      </View>
      {isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : isError || !post ? (
        <Text style={styles.unavailable} testID="post-detail-unavailable">{isRTL ? "هذا المنشور غير متاح" : "This post isn't available"}</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          <Pressable style={styles.author} onPress={() => post.author?.id && router.push(`/user/${post.author.id}` as any)}>
            <Image source={post.author?.avatar_url} style={styles.avatar} contentFit="cover" />
            <VipName name={post.author?.nickname || "User"} color={post.author?.name_color} vipLevel={post.author?.vip_level} style={styles.name} numberOfLines={1} />
          </Pressable>
          {!!post.text && <Text style={styles.text}>{post.text}</Text>}
          <PostMedia testID="post-detail-media" images={post.images} video={post.video_url} videoThumb={(post as any).video_thumb_url} videoDuration={(post as any).video_duration} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, height: 52 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 17, fontWeight: "900" },
  unavailable: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
  author: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  text: { color: colors.onSurface, fontSize: 15, lineHeight: 22 },
});
