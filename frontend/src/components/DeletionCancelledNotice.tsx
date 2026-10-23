/** Batch B — one-shot toast when a login cancelled a pending account deletion. */
import { useEffect } from "react";
import { useAuth } from "@/src/auth-context";
import { useToast } from "@/src/components/Toast";
import { useI18n } from "@/src/i18n";

export function DeletionCancelledNotice() {
  const { user } = useAuth();
  const toast = useToast();
  const { isRTL } = useI18n();
  const flag = !!user?.deletion_cancelled;
  useEffect(() => {
    if (flag) toast.success(isRTL ? "تم إلغاء طلب حذف حسابك بنجاح" : "Your account deletion request was cancelled", 3500);
  }, [flag]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
