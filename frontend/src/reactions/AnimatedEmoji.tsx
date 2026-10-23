/** Batch B — a single animated emoji (transparent Lottie). "_m" keys render mirrored. */
import React from "react";
import { Pressable, View } from "react-native";
import LottieView from "lottie-react-native";
import { reactionLottie, isMirrored } from "./emojis";

export function AnimatedEmoji({ emoji, size, loop = true, playKey, onPress, testID }: {
  emoji: string; size: number; loop?: boolean; playKey?: string | number; onPress?: () => void; testID?: string;
}) {
  const view = (
    <View style={isMirrored(emoji) ? { transform: [{ scaleX: -1 }] } : undefined}>
      <LottieView
        key={`${emoji}-${playKey ?? ""}`}
        source={{ uri: reactionLottie(emoji) }}
        autoPlay
        loop={loop}
        style={{ width: size, height: size }}
        webStyle={{ width: size, height: size }}
      />
    </View>
  );
  if (!onPress) return view;
  return <Pressable onPress={onPress} testID={testID} hitSlop={4}>{view}</Pressable>;
}
