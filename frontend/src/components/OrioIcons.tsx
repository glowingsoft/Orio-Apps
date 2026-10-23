/**
 * Custom ORIO iconography. Each glyph is a pure SVG so it never looks like the
 * system default. Blue heart for room follow, orange winged plus for room
 * membership, gold house for create-room and a diamond-pair transfer arrow for
 * move-mic. Sizes default to 20 and scale linearly.
 */
import { View } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop, Circle, G } from "react-native-svg";

type IconProps = { size?: number; active?: boolean };

export function OrioHeart({ size = 22, active }: IconProps) {
  // Sharper V-notch and pointed bottom — reads clearly as an ORIO glyph.
  const s = size;
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="orio-heart-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#5AD1FF" />
            <Stop offset="1" stopColor="#1E88FF" />
          </LinearGradient>
          <LinearGradient id="orio-heart-glow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#8AE1FF" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#3D93FF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {active && (
          <Path
            d="M12 3.5 L6.5 8.5 L2.5 12.5 L12 21.5 L21.5 12.5 L17.5 8.5 Z"
            fill="url(#orio-heart-glow)"
            opacity={0.5}
          />
        )}
        <Path
          d="M12 5.2 L7.6 9.6 L4.5 12.7 L12 20 L19.5 12.7 L16.4 9.6 Z"
          fill={active ? "url(#orio-heart-fill)" : "transparent"}
          stroke={active ? "#8FDDFF" : "#8AB6FF"}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

export function OrioMembership({ size = 22, active }: IconProps) {
  // Winged plus – ORIO's signature membership emblem
  const s = size;
  const wingStroke = active ? "#FFB03A" : "#FFCB6B";
  const bodyFill = active ? "url(#membership-body)" : "transparent";
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="membership-body" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE07A" />
            <Stop offset="1" stopColor="#FF7A00" />
          </LinearGradient>
        </Defs>
        {/* left wing */}
        <Path
          d="M8 12 C4 10 3 12.5 3 13.5 C4 13 5.5 13 7 13.4 M8 15 C5 16 4 15 3.5 14.6"
          stroke={wingStroke}
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />
        {/* right wing */}
        <Path
          d="M16 12 C20 10 21 12.5 21 13.5 C20 13 18.5 13 17 13.4 M16 15 C19 16 20 15 20.5 14.6"
          stroke={wingStroke}
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />
        {/* body diamond */}
        <Path
          d="M12 6 L16 12 L12 18 L8 12 Z"
          fill={bodyFill}
          stroke="#FFB03A"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* plus */}
        <Path
          d="M12 9.5 L12 14.5 M10 12 L14 12"
          stroke={active ? "#3C1E00" : "#FFCB6B"}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

export function OrioCreateRoom({ size = 24 }: IconProps) {
  // Gold house silhouette with a plus notch on the door — Create Room
  const s = size;
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="cr-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE281" />
            <Stop offset="1" stopColor="#F9B233" />
          </LinearGradient>
        </Defs>
        {/* roof and walls */}
        <Path
          d="M3.5 11 L12 3.5 L20.5 11 L20.5 20 L14.5 20 L14.5 14 L9.5 14 L9.5 20 L3.5 20 Z"
          fill="url(#cr-fill)"
          stroke="#8B5A00"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {/* plus in the door area */}
        <Path
          d="M12 15 L12 19 M10 17 L14 17"
          stroke="#3C1E00"
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

export function OrioMoveMic({ size = 22, active }: IconProps) {
  // Two circles with intersecting arrows — visual for "transfer mic".
  const s = size;
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="mm-fill" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFD37A" />
            <Stop offset="1" stopColor="#B87BFF" />
          </LinearGradient>
        </Defs>
        <G>
          <Circle cx={6} cy={12} r={3.2} fill="none" stroke="url(#mm-fill)" strokeWidth={1.8} />
          <Circle cx={18} cy={12} r={3.2} fill="none" stroke="url(#mm-fill)" strokeWidth={1.8} />
          <Path
            d="M9.5 10 L14.5 10 M14.5 10 L13 8.5 M14.5 10 L13 11.5"
            stroke={active ? "#FFD37A" : "#F0C260"}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Path
            d="M14.5 14 L9.5 14 M9.5 14 L11 12.5 M9.5 14 L11 15.5"
            stroke={active ? "#B87BFF" : "#9B62F0"}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      </Svg>
    </View>
  );
}
