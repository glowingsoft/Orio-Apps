/**
 * Batch B — APK size: ORIO uses Agora for AUDIO only (voice rooms + private
 * voice calls). Strip the Agora full-SDK video/vision extension libraries
 * from the release package. Audio extensions (AI noise suppression, AI echo
 * cancellation, spatial audio) are kept so call/room quality is unchanged.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const EXCLUDES = [
  "lib/**/libagora_segmentation_extension.so",
  "lib/**/libagora_face_detection_extension.so",
  "lib/**/libagora_face_capture_extension.so",
  "lib/**/libagora_clear_vision_extension.so",
  "lib/**/libagora_video_quality_analyzer_extension.so",
  "lib/**/libagora_content_inspect_extension.so",
  "lib/**/libagora_screen_capture_extension.so",
  "lib/**/libagora_video_decoder_extension.so",
  "lib/**/libagora_video_encoder_extension.so",
  "lib/**/libagora_video_av1_decoder_extension.so",
  "lib/**/libagora_video_av1_encoder_extension.so",
  "lib/**/libagora_lip_sync_extension.so",
];

module.exports = function withAgoraSlim(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy" || cfg.modResults.contents.includes("ORIO_AGORA_SLIM")) return cfg;
    const block = `
// ORIO_AGORA_SLIM — audio-only app: drop unused Agora video extensions.
android {
    packagingOptions {
        jniLibs {
${EXCLUDES.map((e) => `            excludes += ["${e}"]`).join("\n")}
        }
    }
}
`;
    cfg.modResults.contents += block;
    return cfg;
  });
};
