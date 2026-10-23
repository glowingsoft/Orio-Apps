/**
 * UserAvatar — a small helper that renders an avatar and opens the user's
 * ProfileView on tap. Use everywhere a user avatar/nickname is rendered so we
 * get consistent tap-to-open-profile behavior across the app.
 */
import { Pressable, StyleProp, ViewStyle } from "react-native";
import { Image, ImageStyle } from "expo-image";
import { useRouter } from "expo-router";
import { colors } from "@/src/theme";

type Props = {
  userId?: string | null;
  avatarUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  disabled?: boolean;
  testID?: string;
};

export function UserAvatar({
  userId,
  avatarUrl,
  size = 40,
  style,
  imageStyle,
  disabled,
  testID,
}: Props) {
  const router = useRouter();
  const onPress = () => {
    if (disabled || !userId) return;
    router.push(`/user/${userId}` as any);
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !userId}
      testID={testID ?? (userId ? `user-avatar-${userId}` : undefined)}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          backgroundColor: colors.surfaceSecondary,
        },
        style,
      ]}
    >
      <Image
        source={avatarUrl ?? undefined}
        style={[{ width: size, height: size, borderRadius: size / 2 }, imageStyle]}
        contentFit="cover"
        transition={150}
      />
    </Pressable>
  );
}
