import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('🚀 Starting certified Android APK compilation for YouPI SMS Gateway...');

// Resolve Toolchain Paths
const JDK_DIR = 'C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot\\bin';
const JAVAC = path.join(JDK_DIR, 'javac.exe');
const KEYTOOL = path.join(JDK_DIR, 'keytool.exe');

const CLT_BUILD_TOOLS = 'C:\\Users\\gaura\\scoop\\apps\\android-clt\\current\\build-tools\\34.0.0';
const AAPT = path.join(CLT_BUILD_TOOLS, 'aapt.exe');
const D8 = path.join(CLT_BUILD_TOOLS, 'd8.bat');
const ZIPALIGN = path.join(CLT_BUILD_TOOLS, 'zipalign.exe');
const APKSIGNER = path.join(CLT_BUILD_TOOLS, 'apksigner.bat');
const ANDROID_JAR = 'C:\\Users\\gaura\\scoop\\apps\\android-clt\\current\\platforms\\android-34\\android.jar';

const APP_DIR = path.resolve(REPO_ROOT, 'apps/android-observer-app/app');
const MANIFEST = path.resolve(APP_DIR, 'src/main/AndroidManifest.xml');
const RES_DIR = path.resolve(APP_DIR, 'src/main/res');
const JAVA_DIR = path.resolve(APP_DIR, 'src/main/java/com/youpi/observer');

const WORK_DIR = path.resolve(REPO_ROOT, '.tmp_apk_build');
if (fs.existsSync(WORK_DIR)) {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}
fs.mkdirSync(WORK_DIR, { recursive: true });

const BIN_DIR = path.join(WORK_DIR, 'bin');
fs.mkdirSync(BIN_DIR, { recursive: true });

try {
  // 1. Compile Java Source Code into Bytecode (.class)
  console.log('📦 [1/6] Compiling Java source files with javac...');
  const LIBS_DIR = path.resolve(APP_DIR, 'libs');
  const libJars = fs.existsSync(LIBS_DIR)
    ? fs.readdirSync(LIBS_DIR).filter(f => f.endsWith('.jar')).map(f => path.join(LIBS_DIR, f))
    : [];
  const cpSeparator = process.platform === 'win32' ? ';' : ':';
  const classpath = [ANDROID_JAR, ...libJars].map(p => `"${p}"`).join(cpSeparator);

  const javaFiles = fs.readdirSync(JAVA_DIR)
    .filter(f => f.endsWith('.java'))
    .map(f => `"${path.join(JAVA_DIR, f)}"`)
    .join(' ');

  execSync(`"${JAVAC}" -encoding UTF-8 -cp ${classpath} -d "${BIN_DIR}" ${javaFiles}`, {
    stdio: 'inherit'
  });
  console.log('   ✅ Java compilation succeeded.');

  // 2. Convert .class files to Dalvik Executable (classes.dex) using D8
  console.log('⚡ [2/6] Converting Java bytecode to Dalvik Executable (classes.dex) with D8...');
  const classFiles = [];
  function collectClasses(dir) {
    for (const item of fs.readdirSync(dir)) {
      const p = path.join(dir, item);
      if (fs.statSync(p).isDirectory()) {
        collectClasses(p);
      } else if (p.endsWith('.class')) {
        classFiles.push(`"${p}"`);
      }
    }
  }
  collectClasses(BIN_DIR);

  const d8Inputs = [...classFiles, ...libJars.map(j => `"${j}"`)];
  execSync(`cmd.exe /c ""${D8}" --lib "${ANDROID_JAR}" --output "${WORK_DIR}" ${d8Inputs.join(' ')}"`, {
    stdio: 'inherit'
  });

  const dexPath = path.join(WORK_DIR, 'classes.dex');
  if (!fs.existsSync(dexPath)) {
    throw new Error('D8 failed to generate classes.dex');
  }
  console.log(`   ✅ Dalvik classes.dex created (${fs.statSync(dexPath).size} bytes).`);

  // 3. Package Resources and compiled binary AndroidManifest.xml into initial APK with AAPT
  console.log('📜 [3/6] Packaging resources & compiled binary AndroidManifest with AAPT...');
  const unalignedApk = path.join(WORK_DIR, 'unaligned.apk');
  execSync(`"${AAPT}" package -f -M "${MANIFEST}" -S "${RES_DIR}" -I "${ANDROID_JAR}" -F "${unalignedApk}"`, {
    stdio: 'inherit'
  });

  // Add classes.dex into unaligned APK
  process.chdir(WORK_DIR);
  execSync(`"${AAPT}" add -v "${unalignedApk}" classes.dex`, {
    stdio: 'pipe'
  });
  console.log('   ✅ Base APK packaged with classes.dex and compiled binary manifest.');

  // 4. Align 4-byte boundaries using zipalign
  console.log('📐 [4/6] 4-byte boundary zip-aligning APK...');
  const alignedApk = path.join(WORK_DIR, 'aligned.apk');
  execSync(`"${ZIPALIGN}" -f -v 4 "${unalignedApk}" "${alignedApk}"`, {
    stdio: 'pipe'
  });
  console.log('   ✅ APK 4-byte alignment verified.');

  // 5. Generate Keystore & Sign APK with apksigner (v1, v2, and v3 signatures)
  console.log('🔏 [5/6] Signing APK with Android v2 + v3 cryptographic certificate...');
  const keystorePath = path.join(WORK_DIR, 'release.keystore');
  const ksPass = 'youpipg123';
  const alias = 'youpi_gateway';

  execSync(`"${KEYTOOL}" -genkeypair -v -keystore "${keystorePath}" -alias "${alias}" -keyalg RSA -keysize 2048 -validity 10000 -storepass "${ksPass}" -keypass "${ksPass}" -dname "CN=YouPI SMS Gateway, OU=Merchant Payments, O=YouPI PG, L=Mumbai, ST=MH, C=IN"`, {
    stdio: 'pipe'
  });

  const signedApk = path.join(WORK_DIR, 'signed.apk');
  execSync(`cmd.exe /c ""${APKSIGNER}" sign --ks "${keystorePath}" --ks-pass pass:${ksPass} --key-pass pass:${ksPass} --ks-key-alias "${alias}" --out "${signedApk}" "${alignedApk}""`, {
    stdio: 'inherit'
  });

  // Verify APK signature
  const verifyOutput = execSync(`cmd.exe /c ""${APKSIGNER}" verify --verbose "${signedApk}""`, {
    encoding: 'utf8'
  });
  console.log('   ✅ Verification Report:\n' + verifyOutput.trim().split('\n').map(l => '      ' + l).join('\n'));

  // 6. Copy final APK to all distribution endpoints
  console.log('🚚 [6/6] Distributing final APK to app portals...');
  const apkBuffer = fs.readFileSync(signedApk);
  const targets = [
    path.resolve(REPO_ROOT, 'apps/android-observer-app/youpi-sms-gateway.apk'),
    path.resolve(REPO_ROOT, 'apps/payment-api/public/youpi-sms-gateway.apk'),
    path.resolve(REPO_ROOT, 'apps/merchant-admin/public/youpi-sms-gateway.apk')
  ];

  for (const t of targets) {
    const dir = path.dirname(t);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(t, apkBuffer);
    console.log(`   🎉 Saved signed installable APK: ${t} (${apkBuffer.length.toLocaleString()} bytes)`);
  }

  console.log('\n✨ Android APK compilation and signing completed successfully!');
} finally {
  try {
    process.chdir(REPO_ROOT);
    if (fs.existsSync(WORK_DIR)) {
      fs.rmSync(WORK_DIR, { recursive: true, force: true });
    }
  } catch {}
}
