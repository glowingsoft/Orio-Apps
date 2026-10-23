import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, TextStyle, View } from "react-native";

/**
 * MarqueeText — renders text; if it overflows `maxWidth`, animates a smooth
 * horizontal scroll. Otherwise renders statically.
 */
export function MarqueeText({
  text,
  maxWidth,
  style,
  speed = 40, // px per second
}: {
  text: string;
  maxWidth: number;
  style?: TextStyle | TextStyle[];
  speed?: number;
}) {
  const [textWidth, setTextWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    if (textWidth <= maxWidth) return;
    const gap = 40;
    const dist = textWidth + gap;
    const duration = (dist / speed) * 1000;
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [textWidth, maxWidth, speed, anim]);

  const shouldScroll = textWidth > maxWidth;

  if (!shouldScroll) {
    return (
      <View style={{ maxWidth, overflow: "hidden" }}>
        <Text
          onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
          style={style}
          numberOfLines={1}
        >
          {text}
        </Text>
      </View>
    );
  }

  const gap = 40;
  const translate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -(textWidth + gap)],
  });

  return (
    <View style={{ width: maxWidth, overflow: "hidden" }}>
      <Animated.View
        style={{ flexDirection: "row", transform: [{ translateX: translate }] }}
      >
        <Text style={[style, styles.txt]} numberOfLines={1}>{text}</Text>
        <View style={{ width: gap }} />
        <Text style={[style, styles.txt]} numberOfLines={1}>{text}</Text>
      </Animated.View>
      {/* Hidden measurer */}
      <Text
        style={[style, styles.measure]}
        onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  txt: {},
  measure: { position: "absolute", opacity: 0 },
});
