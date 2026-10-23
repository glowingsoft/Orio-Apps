import { CountryFlag } from "@/src/components/CountryFlag";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  apiPosts,
  apiLikePost,
  apiDeletePost,
  apiUserPosts,
  apiPostComments,
  apiAddPostComment,
  apiPostVisibility,
} from "@/src/api";
import { ActionSheet } from "@/src/components/ActionSheet";
import { PostShareSheet } from "@/src/posts/PostShareSheet";
import { CommentsSheet } from "@/src/posts/CommentsSheet";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { UserAvatar } from "@/src/components/UserAvatar";
import { OrioRefreshControl } from "@/src/components/OrioRefreshControl";
import { VipBadge } from "@/src/components/VipBadge";
import { TabBackground } from "@/src/components/TabBackground";
import { VipName } from "@/src/components/VipName";
import { HashtagChips, PostMedia } from "@/src/posts/PostParts";

type PostAuthor = {
  id: string;
  nickname?: string;
  avatar_url?: string;
  vip_level?: number;
  country_flag?: string;
};

type PostItem = {
  id: string;
  author?: PostAuthor;
  text: string;
  image_url?: string | null;
  likes_count: number;
  comments_count: number;
  liked_by_me: boolean;
  created_at: string;
};

type Comment = {
  post_id: string;
  author: PostAuthor;
  text: string;
  created_at: string;
};

const AVATAR_FALLBACK =
  "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=200&auto=format&fit=facearea&facepad=3";

export default function Posts() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, isRTL, lang } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();

  const [commentsFor, setCommentsFor] = useState<PostItem | null>(null);
  const [menuFor, setMenuFor] = useState<PostItem | null>(null);
  const [visFor, setVisFor] = useState<PostItem | null>(null);
  const [shareFor, setShareFor] = useState<PostItem | null>(null);
  const [reportFor, setReportFor] = useState<PostItem | null>(null);
  const setVis = async (p: PostItem, v: "public" | "mutual") => {
    try { await apiPostVisibility(p.id, v); } catch (e: any) { Alert.alert(t.error, e?.message ?? "Failed"); }
    qc.invalidateQueries({ queryKey: ["posts"] });
  };
  // Iter-105 — Popular / Friends feeds. Iter-117 — + hashtag filter.
  const [feed, setFeed] = useState<"popular" | "friends">("popular");
  const [tag, setTag] = useState<string | null>(null);
  const [media, setMedia] = useState<"photos" | "videos" | null>(null);
  // Author mode (/user-posts?author_id=&focus=): that user's complete posts list,
  // scrolled to the tapped post. Same interactive cards as the feed.
  const params = useLocalSearchParams<{ author_id?: string; focus?: string }>();
  const authorId = typeof params.author_id === "string" ? params.author_id : null;
  const focusId = typeof params.focus === "string" ? params.focus : null;
  const feedKey = authorId ? ["posts", "author", authorId] : ["posts", feed, tag, media];

  const { data: posts = [], isLoading, refetch, isRefetching } = useQuery<PostItem[]>({
    queryKey: feedKey,
    queryFn: () => (authorId ? apiUserPosts(authorId, 200) : apiPosts(feed, tag, media)),
  });
  const listRef = useRef<FlatList<PostItem>>(null);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!authorId || !focusId || focusedOnce.current || !posts.length) return;
    const idx = posts.findIndex((p) => p.id === focusId);
    if (idx < 0) return;
    focusedOnce.current = true;
    setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0 }), 50);
  }, [authorId, focusId, posts]);
  const [delFor, setDelFor] = useState<string | null>(null);
  const openCompose = () => router.push("/create-post" as any);

  // Optimistic like toggle
  const like = useMutation({
    mutationFn: (id: string) => apiLikePost(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: feedKey });
      const prev = qc.getQueryData<PostItem[]>(feedKey) ?? [];
      qc.setQueryData<PostItem[]>(feedKey, (old) =>
        (old ?? []).map((p) =>
          p.id === id
            ? {
                ...p,
                liked_by_me: !p.liked_by_me,
                likes_count: p.liked_by_me ? Math.max(0, p.likes_count - 1) : p.likes_count + 1,
              }
            : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(feedKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDeletePost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  const confirmDelete = useCallback(
    (id: string) => {
      setDelFor(id);
    },
    [],
  );

  const timeAgo = useCallback(
    (iso: string) => {
      const d = new Date(iso).getTime();
      const diff = (Date.now() - d) / 1000;
      if (diff < 60) return t.justNow;
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      return `${Math.floor(diff / 86400)}d`;
    },
    [t],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="posts-screen">
      {/* Iter-66 — soft purple top glow only. */}
      <TabBackground />
      {authorId ? (
        <View style={[styles.header]}>
          <Pressable testID="user-posts-back" onPress={() => router.back()} hitSlop={10}>
            <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={26} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.feedTabTextActive}>{isRTL ? "المنشورات" : "Posts"}</Text>
          <View style={{ width: 26 }} />
        </View>
      ) : (<>
      <View style={[styles.header]}>
        <View style={styles.feedTabs}>
          {([
            { id: "popular" as const, label: lang === "ar" ? "شائع" : "Popular" },
            { id: "friends" as const, label: lang === "ar" ? "الأصدقاء" : "Friends" },
          ]).map((f) => (
            <Pressable key={f.id} testID={`posts-feed-${f.id}`} onPress={() => setFeed(f.id)} hitSlop={8} style={styles.feedTab}>
              <Text style={[styles.feedTabText, feed === f.id && styles.feedTabTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          testID="new-post-btn"
          onPress={openCompose}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.8 }]}
        >
          <Icon name="add" size={30} color="#FFFFFF" />
        </Pressable>
      </View>
      {/* Smaller sub-tabs: Photos / Videos (tap again → all posts). */}
      <View style={styles.subTabs}>
        {([
          { id: "photos" as const, label: lang === "ar" ? "صور" : "Photos", icon: "images-outline" },
          { id: "videos" as const, label: lang === "ar" ? "فيديوهات" : "Videos", icon: "videocam-outline" },
        ]).map((m) => (
          <Pressable key={m.id} testID={`posts-media-${m.id}`} onPress={() => setMedia((cur) => (cur === m.id ? null : m.id))}
            style={[styles.subTab, media === m.id && styles.subTabOn]}>
            <Icon name={m.icon as any} size={14} color={media === m.id ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            <Text style={[styles.subTabText, media === m.id && { color: colors.onBrandPrimary }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      <HashtagChips horizontal testIDPrefix="posts-tag" selected={tag ? [tag] : []} onToggle={(tg) => setTag((cur) => (cur === tg ? null : tg))} />
      </>)}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Icon name="newspaper-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyText}>{t.noPostsYet}</Text>
          <Text style={styles.emptySub}>{t.beFirstToShare}</Text>
          <Pressable onPress={openCompose} style={styles.emptyCta}>
            <Text style={styles.emptyCtaText}>{t.writeAPost}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={posts}
          keyExtractor={(p) => p.id}
          onScrollToIndexFailed={(info) => setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false }), 250)}
          contentContainerStyle={{ paddingBottom: spacing.xxxl }}
          refreshControl={
            <OrioRefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={({ item }) => (
            <View style={styles.post} testID={`post-${item.id}`}>
              <View style={[styles.postHead]}>
                <UserAvatar
                  userId={item.author?.id}
                  avatarUrl={item.author?.avatar_url || AVATAR_FALLBACK}
                  size={40}
                />
                <Pressable
                  onPress={() => item.author?.id && router.push(`/user/${item.author.id}` as any)}
                  style={{ flex: 1 }}
                  testID={`post-author-${item.author?.id}`}
                >
                  <View style={[styles.nameRow]}>
                    <VipName
                      name={item.author?.nickname ?? t.userFallback}
                      color={(item.author as any)?.name_color}
                      style={styles.postName}
                      numberOfLines={1}
                    />
                    {!!item.author?.country_flag && <CountryFlag flag={item.author.country_flag} size={16} />}
                  </View>
                  {/* Age · VIP · Wealth · Charm beneath the name */}
                  <View style={styles.postBadges} testID={`post-badges-${item.id}`}>
                    {!!(item.author as any)?.age && <AgeBadge age={(item.author as any).age} gender={(item.author as any).gender} />}
                    {(item.author?.vip_level ?? 0) > 0 && <VipBadge level={item.author?.vip_level} size="sm" />}
                    <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number((item.author as any)?.wealth_level ?? 0))} />
                    {Number((item.author as any)?.charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number((item.author as any).charm_level)} />}
                  </View>
                  <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
                </Pressable>
                {(item as any).visibility === "mutual" && (
                  <Icon name="people" size={14} color={colors.muted} testID={`post-vis-mutual-${item.id}`} />
                )}
                <Pressable testID={`share-post-${item.id}`} onPress={() => setShareFor(item)} hitSlop={10} style={styles.deleteBtn}>
                  <Icon name="arrow-redo-outline" size={19} color={colors.onSurfaceSecondary} />
                </Pressable>
                {item.author?.id === user?.id ? (
                  <Pressable testID={`post-menu-${item.id}`} onPress={() => setMenuFor(item)} hitSlop={10} style={styles.deleteBtn}>
                    <Icon name="ellipsis-horizontal" size={19} color={colors.onSurfaceSecondary} />
                  </Pressable>
                ) : (
                  <Pressable testID={`post-more-${item.id}`} onPress={() => setReportFor(item)} hitSlop={10} style={styles.deleteBtn}>
                    <Icon name="ellipsis-horizontal" size={19} color={colors.onSurfaceSecondary} />
                  </Pressable>
                )}
              </View>

              {!!item.text && (
                <Text style={[styles.postText, isRTL && { textAlign: "right" }]}>{item.text}</Text>
              )}

              <PostMedia testID={`post-media-${item.id}`} images={(item as any).images?.length ? (item as any).images : (item.image_url ? [item.image_url] : [])} video={(item as any).video_url} />
              {!!(item as any).hashtags?.length && (
                <Text style={[styles.postTags, isRTL && { textAlign: "right" }]} testID={`post-tags-${item.id}`}>
                  {(item as any).hashtags.map((h: string) => `#${h}`).join("  ")}
                </Text>
              )}

              <View style={[styles.postActions]}>
                <Pressable
                  testID={`like-${item.id}`}
                  onPress={() => like.mutate(item.id)}
                  style={styles.actBtn}
                  hitSlop={8}
                >
                  <Icon
                    name={item.liked_by_me ? "heart" : "heart-outline"}
                    size={20}
                    color={item.liked_by_me ? colors.error : colors.muted}
                  />
                  <Text
                    style={[
                      styles.actTxt,
                      item.liked_by_me && { color: colors.error, fontWeight: "700" },
                    ]}
                  >
                    {item.likes_count}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`open-comments-${item.id}`}
                  onPress={() => setCommentsFor(item)}
                  style={styles.actBtn}
                  hitSlop={8}
                >
                  <Icon name="chatbubble-outline" size={18} color={colors.muted} />
                  <Text style={styles.actTxt}>{item.comments_count}</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenuFor(null)}
        testID="post-actions"
        cancelLabel={t.cancel}
        actions={menuFor ? [
          { key: "delete", icon: "trash-outline", label: isRTL ? "حذف المنشور" : "Delete Post", destructive: true, onPress: () => confirmDelete(menuFor.id) },
          { key: "visibility", icon: "eye-outline", label: isRTL ? "تغيير الظهور" : "Change Visibility", onPress: () => { const p = menuFor; setTimeout(() => setVisFor(p), 250); } },
        ] : []}
      />
      <ActionSheet
        visible={!!visFor}
        onClose={() => setVisFor(null)}
        testID="post-visibility"
        cancelLabel={t.cancel}
        actions={visFor ? [
          { key: "public", icon: "earth-outline", label: isRTL ? "عام" : "Public", onPress: () => setVis(visFor, "public") },
          { key: "mutual", icon: "people-outline", label: isRTL ? "الأصدقاء المتبادلون فقط" : "Mutual Friends Only", onPress: () => setVis(visFor, "mutual") },
        ] : []}
      />
      <ActionSheet
        visible={!!reportFor}
        onClose={() => setReportFor(null)}
        testID="post-other-actions"
        cancelLabel={t.cancel}
        actions={reportFor ? [
          { key: "report", icon: "flag-outline", label: isRTL ? "إبلاغ" : "Report", destructive: true, onPress: () => { const p = reportFor; setReportFor(null); router.push(`/report?post_id=${p.id}` as any); } },
        ] : []}
      />
      <PostShareSheet post={shareFor} onClose={() => setShareFor(null)} />
      <ConfirmModal
        visible={!!delFor}
        title="تنبيه"
        body="إذا قمت بالحذف، سوف يتم إخفاء هذا المنشور وحذف جميع تفاعلاته، بما فيها الإعجابات والتعليقات. هل أنت متأكد من الاستمرار؟"
        primaryLabel="نعم"
        secondaryLabel="لا"
        primaryTone="danger"
        onPrimary={() => { const id = delFor; setDelFor(null); if (id) del.mutate(id); }}
        onSecondary={() => setDelFor(null)}
        testID="post-delete-confirm"
      />
      {/* Comments Bottom Sheet */}
      <CommentsSheet
        post={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCommentAdded={() => qc.invalidateQueries({ queryKey: ["posts"] })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: spacing.md,
  },
  rowRtl: { flexDirection: "row-reverse" },
  title: { flex: 1, color: colors.onSurface, fontSize: 26, fontWeight: "800" },
  feedTabs: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.lg },
  feedTab: { minHeight: 40, justifyContent: "center" },
  subTabs: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.lg, marginBottom: 6 },
  subTab: { flexDirection: "row", alignItems: "center", gap: 4, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  subTabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  subTabText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  // White labels on the purple artwork (identical in both themes).
  feedTabText: { color: colors.muted, fontSize: 20, fontWeight: "800" },
  feedTabTextActive: { color: colors.onSurface },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  postTags: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700", marginTop: spacing.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  emptyText: { color: colors.onSurface, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: "center" },
  emptyCta: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: "800" },
  post: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  postHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  postBadges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 3 },
  deleteBtn: { padding: 8 },
  postAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  postName: { color: colors.onSurface, fontWeight: "800", fontSize: 14, maxWidth: 180 },
  postTime: { color: colors.muted, fontSize: 11, marginTop: 2 },
  vipTag: {
    backgroundColor: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  vipTagSm: {
    backgroundColor: colors.gold,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  vipTagText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" },
  postText: { color: colors.onSurface, fontSize: 15, lineHeight: 22 },
  postImage: {
    marginTop: spacing.md,
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  postActions: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.md },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actTxt: { color: colors.muted, fontSize: 13, fontWeight: "600" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  modalTitle: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  modalInput: {
    minHeight: 120,
    color: colors.onSurface,
    fontSize: 16,
    textAlignVertical: "top",
    padding: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
  },
  counter: { color: colors.muted, fontSize: 11, textAlign: "right", marginTop: 4 },
  postBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },

  commentsSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    height: "75%",
  },
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceTertiary,
  },
  commentBubble: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  commentName: { color: colors.onSurface, fontWeight: "800", fontSize: 13, maxWidth: 160 },
  commentText: { color: colors.onSurface, fontSize: 14, marginTop: 2, lineHeight: 20 },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
});
