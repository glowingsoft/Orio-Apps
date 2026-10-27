const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "node_modules");

const patches = [
  {
    packageName: "react-native-svg",
    file: "android/src/main/jni/CMakeLists.txt",
    target: "react_codegen_rnsvg",
  },
  {
    packageName: "react-native-worklets",
    file: "android/CMakeLists.txt",
    target: "worklets",
    original: `target_link_libraries(worklets android log ReactAndroid::reactnative
                      ReactAndroid::jsi fbjni::fbjni)`,
  },
  {
    packageName: "react-native-screens",
    file: "android/CMakeLists.txt",
    target: "rnscreens",
    original: `target_link_libraries(rnscreens
    ReactAndroid::reactnative
    ReactAndroid::jsi
    fbjni::fbjni
    android
)`,
  },
  {
    packageName: "react-native-reanimated",
    file: "android/CMakeLists.txt",
    target: "reanimated",
    original: `target_link_libraries(
  reanimated
  log
  ReactAndroid::reactnative
  ReactAndroid::jsi
  fbjni::fbjni
  android
  react-native-worklets::worklets)`,
  },
  {
    packageName: "react-native-keyboard-controller",
    file: "android/build/generated/source/codegen/jni/CMakeLists.txt",
    target: "react_codegen_RNKC",
  },
  {
    packageName: "react-native-screens",
    file: "android/build/generated/source/codegen/jni/CMakeLists.txt",
    target: "react_codegen_rnscreens",
  },
  {
    packageName: "react-native-safe-area-context",
    file: "android/build/generated/source/codegen/jni/CMakeLists.txt",
    target: "react_codegen_safeareacontext",
  },
  {
    packageName: "@react-native-community/slider",
    file: "android/build/generated/source/codegen/jni/CMakeLists.txt",
    target: "react_codegen_RNCSlider",
  },
];

let failed = false;

for (const patch of patches) {
  const file = path.join(root, patch.packageName, ...patch.file.split("/"));

  if (!fs.existsSync(file)) {
    console.log(`${patch.packageName}: file not generated yet; skipping.`);
    continue;
  }

  let source = fs.readFileSync(file, "utf8");
  const escapedTarget = patch.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(
    `(target_link_libraries\\(\\s*${escapedTarget}\\s+[\\s\\S]*?\\n\\s*\\))`,
  );
  const match = source.match(blockPattern);

  if (!match) {
    if (patch.original && source.includes(patch.original)) {
      source = source.replace(
        patch.original,
        `${patch.original}\ntarget_link_libraries(${patch.target} c++_shared)`,
      );
      fs.writeFileSync(file, source);
      console.log(`${patch.packageName}: linked c++_shared.`);
      continue;
    }

    console.error(`${patch.packageName}: target ${patch.target} not found.`);
    failed = true;
    continue;
  }

  if (/\bc\+\+_shared\b/.test(match[1])) {
    console.log(`${patch.packageName} (${patch.target}): already linked.`);
    continue;
  }

  source = source.replace(
    blockPattern,
    match[1].replace(/\n\s*\)$/, "\n  c++_shared\n)"),
  );

  fs.writeFileSync(file, source);
  console.log(`${patch.packageName} (${patch.target}): linked c++_shared.`);
}


// Persistent fix for native CMake targets using ${LIB_TARGET_NAME}.
const sourceCmakeFiles = [
  "react-native-keyboard-controller/android/src/main/jni/CMakeLists.txt",
  "react-native-safe-area-context/android/src/main/jni/CMakeLists.txt",
  "react-native-screens/android/src/main/jni/CMakeLists.txt",
];

for (const relativeFile of sourceCmakeFiles) {
  const file = path.join(root, ...relativeFile.split("/"));

  if (!fs.existsSync(file)) {
    console.log(`${relativeFile}: not present; skipping.`);
    continue;
  }

  let source = fs.readFileSync(file, "utf8");
  const pattern =
    /(target_link_libraries\(\s*\$\{LIB_TARGET_NAME\}[\s\S]*?\n\s*\))/g;
  let changed = false;

  source = source.replace(pattern, (block) => {
    if (/\bc\+\+_shared\b/.test(block)) return block;
    changed = true;
    return block.replace(/\n\s*\)$/, "\n    c++_shared\n  )");
  });

  if (changed) {
    fs.writeFileSync(file, source);
    console.log(`${relativeFile}: linked c++_shared.`);
  } else {
    console.log(`${relativeFile}: already patched.`);
  }
}

if (failed) process.exit(1);
