import { useLocalSearchParams } from "expo-router";
import { ProfileView } from "@/src/profile/ProfileView";

export default function UserProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView userId={id} />;
}
