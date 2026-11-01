type: security-assessment
format: machine-readable
consumer: ai-agent
human_prose: not-intended
language: en + verbatim-zh-report-strings
task: judge whether `DLSS5-Swapper-Setup-2.0.4.exe` is malicious, and enumerate real defects
marker-key: status = `fact` | `inference` | `unresolved`
confidence-scale: high | medium | low

---

meta:
  assessment_date: 2026-11-01
  analyst: qoder-agent (code audit) + 2 external sandbox reports
  repo_local: C:/DLSS/DLSS5-Swapper-Chinese-main
  git_head_at_assessment: 890d88f
  git_branch_at_assessment: feat/anti-cheat-list
  package_version_at_head: 2.0.5
  release_tag_examined: v2.0.4
  online_github_access: NOT-PERFORMED (network egress deliberately withheld; release page unverified)

---

target:
  file: dist/DLSS5-Swapper-Setup-2.0.4.exe
  sha256: 8840636f41cfca29c067af7ebd7f1a0fc77de61405ac48cc8223a5b59abeded3
  sha1: 7fdff0a19dc8ae0e129d62edfa492d98808b45b8
  md5: 6fadbb5d979a1f8b0691ab0f419ad626
  size_bytes: 258748834
  size_reported_mb: 246.76
  format: PE32 / NSIS self-extracting installer
  authenticode: NotSigned
  mtime: 2026-10-26T23:36
  identity_to_sandbox_sample: SAME-BYTES (sha256 match, size match)
  status: fact
  verified_by: sha256sum + Get-AuthenticodeSignature

sibling-artifacts:
  - {file: dist/DLSS5-Swapper-Setup-2.0.3.exe, sha256_prefix: bcbb4b03, authenticode: NotSigned}
  - {file: dist/DLSS5-Swapper-2.0.4-portable.exe, sha256_prefix: 0d2cc3ce}
  - {file: dist/DLSS5-Swapper-2.0.3-portable.exe, sha256_prefix: 65765525}

---

inputs:
  report_a:
    name: 样本分析报告_8840636f41cfca29c067af7ebd7f1a0fc77de61405ac48cc8223a5b59abeded3.pdf
    vendor: MicroStep (微步)
    sample_id: S-261101-884063
    verdict: 未知
    av_engines: 0/28
    mitre_techniques: 7
    high_risk_behaviors: 3
      - 试图解除沙箱监控组件的函数钩子
      - 在用户目录下创建可执行文件
      - 暴力枚举进程
    suspicious_behaviors: 15
      - 获取按键信息
      - 安装消息钩子
      - 检测内核调试器
      - 疑似创建Shellcode
      - 访问代码托管网站
      - 此可执行文件没有导入任何函数
    sigma_rules: [PsExec Service Start, Non Interactive PowerShell, PsExec Tool Execution, New Application in AppCompat]
    sigma_severity: low/info
    processes_observed: 5
    network_observed: api.github.com -> 20.205.243.168:443 (微步=安全/白名单, ASN8075, JA3 7ca906205189eef6464df6b512d55f6c)
    dropped_files_observed: 100
    status: fact (as reported; report content is not independently re-runnable here)
  report_b:
    name: 奇安信情报沙箱-7fdff0a19dc8ae0e129d62edfa492d98808b45b8.pdf
    vendor: QiAnXin (奇安信)
    malice_score: 3
    verdict: 未发现风险
    tags: [HTTP通信, 加壳程序]
    gene: Contain_PE32
    av_engines: 1/89
    av_positive: clamav -> Win.Packed.Mikey-9859574-0
    iocs: all classified 安全/未知
      - 74.151.238.97:443
      - 184.85.77.161:80
      - tile-service.weather.microsoft.com
      - mobile.events.data.microsoft.com
    http_observed: GET weather livetile, UA Microsoft-WNS/10.0
    entropy_rsrc: 7.8329
    nsis_plugindir: [System.dll, UAC.dll, StdUtils.dll, nsDialogs.dll, nsExec.dll, nsis7z.dll, WinShell.dll]
    status: fact (as reported)

---

verdict:
  is_trojan: NO
  is_worm_or_dropper: NO
  is_crypto_miner: NO
  is_ransomware: NO
  is_persistent_backdoor: NO
  is_advertised_as_what: it is — Electron game-mod installer (ReShade/OptiScaler/RenoDX/DLSS5-Feeder hook deployment)
  malicious_confidence: low
  risk_level: HIGH (non-malicious but structurally unsafe)
  one_line: 不是木马；是"真实功能 + 无签名 + 无校验 + 不可复现"的高风险游戏模组安装器
  rationale_order:
    - every behavioral flag in report_a maps to a named line of source or to electron-builder/NSIS machinery
    - observed network egress is api.github.com only; the app's own update-check code path produces exactly that
    - no anti-analysis primitive exists in any shipped code (see anti_evasion_absence)
    - the two sandbox "加壳"/"无导入" labels are artifacts of NSIS 7z payload + asar, not packing for concealment
    - risk concentrates in supply-chain integrity, not in payload behavior

---

architecture_summary:
  shell: NSIS (electron-builder target `nsis`)
  app: Electron 33.2-33.4 / Chromium
  code: resources/app.asar
  assets: resources/payload, resources/addons, resources/overlay
  install_scope: perMachine=false, oneClick=false -> %LOCALAPPDATA%\Programs\DLSS 5 Swapper
  uninstall: deleteAppDataOnUninstall=true
  renderer_flags: {contextIsolation: true, nodeIntegration: false}
  overlay_window: {sandbox: true, offscreen: true}
  deps_runtime: [extract-zip]
  status: fact
  verified_by: package.json + asar extraction

---

sandbox_flag_map:
  columns: [flag, source_report, explanation, code_or_build_evidence, classification]
  rows:
    - flag: 在用户目录下创建可执行文件
      report: a
      explanation: per-user NSIS install path; electron-builder default
      evidence: package.json build.nsis.perMachine=false; report_a own dropped-file list = AppData\Local\Programs\DLSS 5 Swapper + Uninstall DLSS 5 Swapper.exe
      classification: benign
    - flag: 暴力枚举进程
      report: a
      explanation: preflight that refuses installing into a running game; full process table via WMI once per install
      evidence: src/core/install-guards.js:45 (`Get-CimInstance Win32_Process | Select ProcessId,Name,ExecutablePath`); fallback src/core/install-guards.js:25 executableLocked()
      classification: benign-by-design / privacy-noteworthy
    - flag: Non Interactive PowerShell (Sigma)
      report: a
      explanation: same install-guards call plus electron-builder/NSIS environment probes
      evidence: report_a process PIDs 5996/1208/6784 commandlines are `-NoProfile -NonInteractive -Command` capability+path+count checks; matches install-guards.js:44-45
      classification: benign
    - flag: PsExec Service Start / PsExec Tool Execution (Sigma)
      report: a
      explanation: no PsExec anywhere in tree or payload; sigma matches on generic service-start shape in a sandbox-instrumented process
      evidence: grep -R "psexec" repo = 0 hits (source); no psexec.exe in report_a dropped list
      classification: noise
    - flag: 此可执行文件没有导入任何函数
      report: a
      explanation: NSIS stub loads imports dynamically; report itself lists 7 imported DLLs -> self-contradictory
      evidence: NSIS installer convention; report_a internal inconsistency
      classification: noise
    - flag: 加壳程序 / Win.Packed.Mikey-9859574-0 (clamav 1/89)
      report: b
      explanation: nsis7z compressed payload + 165.8MB model DLL => generic packer heuristic; Mikey has no family meaning
      evidence: report_b .rsrc entropy 7.8329; nsis_plugindir contains nsis7z.dll; ClamAV generic-signature naming pattern
      classification: noise
    - flag: 访问代码托管网站
      report: a
      explanation: self-update check
      evidence: main.js UPDATE_REPO='hezhixin15/DLSS5-Swapper-Chinese' + api.github.com/releases/latest fetch
      classification: benign-function / risky-mechanism (see RISK-1)
    - flag: 获取按键信息 + 安装消息钩子
      report: a
      explanation: ReShade add-on hotkey polls the ReShade runtime key state inside the game process to toggle the overlay panel (default VK_F8); ReShade itself installs hooks
      evidence: overlay/overlay-hotkey.hpp:26-47 `r->is_key_pressed(key)`; no SetWindowsHookEx / GetAsyncKeyState / CallWindowProc anywhere in JS or overlay/
      classification: benign-by-design / privacy-noteworthy
    - flag: 检测内核调试器
      report: a
      explanation: sandbox-side inference from ordinary system-info queries; no debugger-evasion construct in shipped code
      evidence: absence check (see anti_evasion_absence)
      classification: unresolved-low-confidence
    - flag: 疑似创建Shellcode
      report: a
      explanation: executable memory from Chromium V8 JIT / NSIS 7z decompression buffer
      evidence: Electron/Chromium runtime behavior; no WriteProcessMemory/CreateRemoteThread/QueueUserAPC in shipped code
      classification: noise
    - flag: tile-service.weather.microsoft.com / mobile.events.data.microsoft.com / 184.85.77.161:80
      report: b
      explanation: Windows live-tile + WNS telemetry emitted by the sandbox host OS, UA=Microsoft-WNS/10.0; not produced by the app
      evidence: report_b own HTTP request fields; no such hostname in repo (`grep -r weather` = 0)
      classification: noise (environment, not sample)
    - flag: New Application in AppCompat (Sigma)
      report: a
      explanation: first-run shim-db entry; expected for any newly installed exe
      classification: noise

---

ntfreevirtualmemory_record:
  label_displayed: 高危行为 -> 反检测技术 -> 试图解除沙箱监控组件的函数钩子
  raw_record:
    timestamp: 2026-11-01T02:21:53
    source: __anomaly__
    subcategory: monitor
    tid: 3632
    function_name: NtFreeVirtualMemory
    message: Dropped 1 asynchronous NtFreeVirtualMemory events.
    status: 1
    return: 0
  decode:
    - the record is an ANOMALY row produced by the sandbox monitor, not an API call the sample made deliberately
    - `Dropped 1 asynchronous ... events` = monitor's own async event queue overflowed and discarded 1 event
    - NtFreeVirtualMemory = backing syscall for VirtualFree/HeapFree/munmap; emitted on every normal deallocation; overwhelmingly Chromium/JVMTI noise
    - return 0 = STATUS_SUCCESS = the free succeeded, not a stealth free
  negative_checks:
    grep_symbols_in_js_and_overlay_and_payload_scripts: [NtFreeVirtualMemory, NtProtectVirtualMemory, ThreadHideFromDebugger, UnhookWindowsHookEx]
    hits: 0
    ascii_probe:
      dist/DLSS5-Swapper-Setup-2.0.4.exe: 0
      dist/win-unpacked/DLSS 5 Swapper.exe: 1
      payload/ReShade_Setup_6.8.0_Addon.exe: 0
      payload/feeder/dlss5-feed-host64.exe: 0
      overlay-bin/dlss5-lab-overlay.addon64: 0
    note: the single occurrence sits in the Electron main binary (normal Windows API surface)
    real_unhook_primitives_needed_for_the_claim: [WriteProcessMemory, CreateRemoteThread, QueueUserAPC, SetWindowsHookEx+UnhookWindowsHookEx, MinHook, Detours]
    hits_of_those: 0
  verdict_on_label:
    status: inference-not-evidence
    severity_of_label: overstated
    likely_cause: sandbox monitor event drop during high-volume allocation churn
    confidence: low that any unhooking occurred
    recording_rule: 记录为「未闭环 / 低置信度 / 更像沙箱侧丢事件」；不得记为已证实反沙箱行为
  followup_to_close:
    - fetch 查看完整结果 -> process name + full callstack for tid 3632
    - if callstack root module = nsis/loader and no protection-change or cross-process write precedes it -> mark benign permanently
    - if callstack shows a code-region free immediately after a page-recommit of foreign code -> reopen as real finding
  status: unresolved

---

anti_evasion_absence:
  checked_symbols: [SetWindowsHookEx, GetAsyncKeyState, WriteProcessMemory, CreateRemoteThread, QueueUserAPC, VirtualProtectEx, NtUnmapViewOfSection, MinHook, Detours, TLS-callback anti-debug, IsDebuggerPresent, NtQueryInformationProcess(ProcessDebugPort), NtSetInformationThread(ThreadHideFromDebugger)]
  scope: main.js, src/**, scripts/**, overlay/**, payload/feeder/Verify-DLSS5Feeder.ps1, resources/app.asar (extracted)
  hits: 0
  status: fact
  caveat: 8 native binaries were string-probed and version-inspected but NOT disassembled (objdump/pefile unavailable on this host)

---

risk_register:

RISK-1 self-updater executes unverified binary:
  severity: high
  likelihood_of_exploit: medium-requires-account-or-CDN-compromise
  status: fact
  code_head: main.js:1391-1534
  flow: releases/latest -> updateAsset() picks first /\.exe$/i preferring /setup/i -> fetch(asset.browser_download_url) -> write %TEMP%/DLSS5-Swapper-<ver>-<ts>.exe -> shell.openPath(file) -> app.quit()
  missing: sha256 check; authenticode check; publisher allowlist; size sanity; detached signature
  evidence_missing: grep sha256/createHash in update block = 0 hits
  blast_radius: one click on "update" = arbitrary code with user integrity level, if the GitHub/Gitee release asset is replaced
  note_2.0.4_shipped_version: asar main.js (b5ac7a3c...) = GitHub-only variant; HEAD adds Gitee mirror + tag-match guard, still no integrity verification
  fix: pin sha256 (or use an in-repo signed manifest) and refuse to run on mismatch; on Windows also assert Get-AuthenticodeSignature Status -eq Valid with an expected signer thumbprint

RISK-2 release built from dirty tree:
  severity: high (traceability)
  status: fact
  evidence:
    app.asar:src/core/compatibility.js = 165f434b9de82708582199284fa2c684625fb096182e6046ab506951cc7d0528
    git show v2.0.4:src/core/compatibility.js = 6317b76388a08487d098f3d3706f874c749ff0d9eace39a2b729db24ab843809
    app.asar:main.js = b5ac7a3c00e479e4d48e78c552e3a40301cbe4da66513a4e92012c633de4055e = git show v2.0.4:main.js (equal)
  reading: only compatibility.js drifted; the shipped binary is not reproducible from tag v2.0.4
  consequence: source audit cannot certify the exact bytes shipped; a reviewer diffing against the tag sees code that was not in the release
  fix: CI builds from a clean tag; publish per-file sha256 manifest next to each artifact

RISK-3 payload not version-controlled nor reproducible:
  severity: high
  status: fact
  evidence: .gitignore lines 2-5 = payload/ addons/ overlay-bin/ dist/ ; `git ls-files payload addons overlay-bin` empty
  collection_logic: scripts/collect-payload.js:30-35 DEFAULT_SOURCES scans repo-parent, Desktop, OneDrive\Desktop for "dlss 5 swapper"; :39-44 RESHADE_DIRS includes ~/Downloads; :252-267 copies every *.dll|*.txt from streamline/; loose DLL in source root OVERRIDES the streamline copy
  destructive_step: scripts/collect-payload.js:249 fs.rmSync(PAYLOAD,{recursive:true,force:true})
  consequence: build output depends on whoever's Downloads folder was present; "audit the repo" != "audit the binary"
  fix: commit a payload lockfile {filename, version, source-url, sha256}; refuse build on hash mismatch; never accept root-level overrides implicitly

RISK-4 unsigned artifacts end-to-end:
  severity: medium-high
  status: fact
  evidence:
    Setup-2.0.4.exe: NotSigned
    Uninstall DLSS 5 Swapper.exe (aa1797d1...): NotSigned
    DLSS 5 Swapper.exe (154e26ac...): NotSigned
    payload/feeder/dlss5-feed-host64.exe (169472 B): NotSigned
    overlay-bin/dlss5-lab-overlay.addon64 (879616 B, 1d4c71b194f9ce4900c559d9a1e9119708b2fe6f67bf5a199e928f039f95a613): NotSigned
    payload/ReShade_Setup_6.8.0_Addon.exe (CN=ReShade): UnknownError
  note: .tmp-build.log records electron-builder 26.15.3 "signing with signtool.exe" for payload exes and the installer, yet every shipped artifact is NotSigned -> signing configured but not effective (no cert, or cert unavailable at publish)
  consequence: SmartScreen/AV friction, no publisher continuity, RISK-1 becomes total
  fix: Authenticode-sign installer + main exe + native add-ons with one cert; publish cert thumbprint in README

RISK-5 third-party runtime binary with broken signature chain:
  severity: medium (integrity, not malware)
  status: fact
  file: payload/streamline/nvngx_dlssnr.dll
  size_bytes: 165840496
  version: 310.8.0.0
  sha256: 8270b350cd82de5ce89806872cdd6b6a9249b80836b91bbeb3573470744cc206 (identical in dist/win-unpacked/resources/payload)
  authenticode: HashMismatch
  signer: CN=NVIDIA Corporation, OU=1005bk6
  thumbprint: 7B7B0B6697AFB438CF6F65A155F00E86676FB186
  validity: 2025-07-02 -> 2028-07-06, DigiCert TSA
  reading: file was modified after NVIDIA signed it (or the copy is tampered); signature no longer matches content
  corroboration_that_modification_is_intended_by_the_project:
    - docs/releases/v2.2.3.md:5-9 instructs obtaining "the modified nvngx_dlssnr.dll made for your GPU from the RenoDX Discord"
    - payload/feeder/Verify-DLSS5Feeder.ps1:1976-1987 same guidance
    - main.js:1934-1937 same
    - src/core/install-guards.js: OPTI_DRIVER=61656, NEURAL_FAULT_DRIVER=61664 driver-range notes
  license_exposure: payload/streamline/nvngx_dlss.license.txt §1c allows object-code redistribution only inside an app with material additional functionality; §4b forbids modification and stand-alone distribution; §4d forbids bypassing technical limitations
  note_THIRD_PARTY_NOTICES.md:32-34 already disclaims: NVIDIA neural runtime "is not supplied by this OptiScaler release ... uses the existing Swapper payload's nvngx_dlssnr.dll; it does not relicense that file or imply NVIDIA support" -> but the 165.8MB file IS physically shipped in the installer
  sandboxes: neither report deep-analyzed this 165.8MB DLL (sandbox deep-scan limits)
  fix: remove the modded DLL from the shipped installer; fetch pinned URL+sha256 at install time like the other components (pattern already exists in src/core/runtime-components.js:101-104); ship official NVIDIA SDK copies only

RISK-6 anti-cheat exposure for users:
  severity: medium-high for the user (ban risk), zero for the app (not a backdoor)
  status: fact
  app_behavior: detect-and-consent, never evade
  evidence: src/core/compatibility.js:1-3 header 「Read-only preflight. Never remove/bypass anti-cheat or overwrite another graphics injector」; assertAntiCheatConsent() requires explicit acknowledgement; RICOCHET_EXES + KNOWN_ANTI_CHEAT_DIRS + guards.antiCheatPresent() (src/core/install-guards.js:106-121, ≤2000 entries, depth ≤2, pattern easyanticheat|battleye|eac/be launcher|eaanticheat)
  limitation: detection is best-effort; kernel-driver ACs outside the game folder are matched only by exe-name allowlists -> false negatives possible
  documentation_gap: README.md / README.zh-TW.md contain NO anti-cheat/ban warning, NO 「非 NVIDIA 官方」 disclaimer, NO sha256/signature section, NO rollback instructions
  fix: add a prominent ban-risk section + a per-game unsupported list to README (all 3 languages) before the install button is ever described

RISK-7 registry + hook deployment (normal for the genre, still needs disclosure):
  severity: low
  status: fact
  registry: src/core/vulkan-layer.js:11 HKCU\Software\Khronos\Vulkan\ImplicitLayers, written via reg.exe query/add/delete (:40/:70/:88); per-user, reference-counted, only registry write in the app
  file_hooks: src/core/apply.js:290-294 deploys dxgi.dll / d3d11.dll / d3d9.dll / opengl32.dll proxy names into the game directory
  restore: src/core/apply.js:618-632 + journal-based undo via src/core/file-journal.js:14-30 safePath (rejects absolute, drive-colon, .. escape, symlink/junction chains)
  conflict_policy: refuses to overwrite a foreign injector; multiple-ReShade-hook check; MO2/Root-Builder managed root refused (compatibility.js managedModRoot)
  user-visible_gap: uninstaller only MessageBox-warns that games are not restored (build/installer.nsh customUnInit); no automated "restore all games" batch
  ipc_surface: src/overlay-bridge.js:11 crypto.randomBytes(16) pipe token, :17 \\.\pipe\<profile>-overlay-<token>, :27 sandbox:true+contextIsolation, token file mode 0600, sendInputEvent scoped to its own hidden window

RISK-8 community/network stack (present in 2.0.4, removed at HEAD):
  severity: was medium, now closed
  status: fact-for-2.0.4 / resolved-at-HEAD
  in_shipped_2.0.4_asar: src/community-client.js:7 DEFAULT_API='https://5.rakanki.com'; :28-31 installId=crypto.randomBytes(24) base64url persisted; :47 header x-install on writes; renderer CSP allows 5.rakanki.com + media.rakanki.com; src/admin-vault.js safeStorage/DPAPI token at userData/community-admin.bin (mode 0600)
  in_current_head: src/community-client.js and src/admin-vault.js DO NOT EXIST (commit 890d88f "remove the chat and community network stack outright"); grep -r rakanki in tracked tree = 0 (only stale .archify artifacts)
  residual: users on 2.0.4 still phone 5.rakanki.com until they upgrade
  fix: none needed in code; ensure the release notes state the removal so 2.0.4 users know why hosts changed

RISK-9 no CI / no publish pipeline:
  severity: medium
  status: fact
  evidence: .github/ contains only FUNDING.yml
  consequence: RISK-1/RISK-2/RISK-4 all trace to the absence of an automated, clean-tree, signing, hash-pinning pipeline

---

commandline_semantics_observed_in_report_a:
  - pid: 1856
    role: installer
  - pid: 5996
    cmd: powershell -C "if (Get-Command Get-CimInstance ...)"
    meaning: capability probe (does WMI cmdlet exist) -> install-guards fallback decision
  - pid: 1208
    cmd: powershell -C "if ((Get-ExecutionPolicy -Scope Process) -eq 'Restricted') ..."
    meaning: policy probe before invoking a .ps1 (Verify-DLSS5Feeder.ps1 is copied for diagnostics, never executed by the app)
  - pid: 6784
    cmd: powershell -C "if ((Get-CimInstance Win32_Process | ? {$_.Path -and $_.Path.StartsWith('C:\Users\Administrator\AppData\Local\Programs\DLSS 5 Swapper',...)}).Count -gt 0) ..."
    meaning: "is my own app already running" instance check; path literal == electron-builder perMachine:false default target
  - pid: 5072
    role: explorer
    meaning: shell reacting to shortcut/uninstall registration, not sample code

dropped_file_hashes_reported:
  - {name: Uninstall DLSS 5 Swapper.exe, sha256: aa1797d1b5a6c3770ddb46178509c8052af8ab602612d72483a093d86640db3d}
  - {name: DLSS 5 Swapper.exe, sha256: 154e26ac8fc2d0dcaa78d0ae2d952c65a5acbf5f077106e7daa7f08e1643d72d}
  - {name: LICENSE.electron.txt}
  - {name: LICENSES.chromium.html}
  - {name: chrome_100_percent.pak}

---

remediation_ordered:
  P0: add sha256 + Authenticode verification to the self-updater before shell.openPath; abort on mismatch
  P0: stop shipping a HashMismatch NVIDIA DLL inside the installer; pin official URL+hash, fetch at install
  P1: build releases from a clean tag in CI; emit sha256 manifest per artifact; publish it in the release body
  P1: sign installer + main exe + all native add-ons with one certificate; document the thumbprint
  P1: commit a payload lockfile so `payload/` is reproducible; drop implicit root-level DLL overrides in collect-payload.js
  P2: README (en/zh-CN/zh-TW): anti-cheat ban risk, "not NVIDIA official", hash-verify instructions, rollback instructions
  P2: release note for 2.0.4 users explaining community-stack removal
  P3: keep the 3-language README convention with 「AI 参与、人工已审核」 declaration at the bottom

user_preconditions_if_running_2.0.4:
  - do not click in-app "check for update"; download installers manually and compare sha256 against the release note
  - expect SmartScreen/AV prompts; cause is RISK-4, not RISK-malware
  - do not install into any online-mode/anti-cheat title; consent dialog is not a safety guarantee (RISK-6)
  - install only into a game you can re-verify file-integrity for (Steam "verify integrity of game files")
  - prefer the portable build for testing; snapshot the game dir before hook deployment
  - back up the game directory before each install
  - treat %APPDATA%\dlss5-swapper as containing an install identifier on 2.0.4 (community-client installId)

unresolved:
  - tid 3632 attribution (see ntfreevirtualmemory_record.followup_to_close)
  - 8 native binaries not disassembled: nvngx_dlssnr.dll, nvngx_dlss.dll, nvngx_dlssg.dll, ReShade_Setup_6.8.0_Addon.exe, dlss5-feed-host64.exe, dlss5-lab-overlay.addon64, NSIS plugins (nsis7z/WinShell/nsExec)
  - GitHub release page / asset list not fetched (network egress withheld; requires Clash Verge system-proxy confirmation first)
  - whether the release assets currently published carry the same sha256 as local dist/ (unverified)
  - 0/28 and 1/89 engine results are weak signal, not proof of safety

---

repro_commands:
  identity: sha256sum dist/DLSS5-Swapper-Setup-2.0.4.exe   # 8840636f... , 258748834 B
  signature: pwsh -NoProfile -Command 'Get-AuthenticodeSignature <file> | Select Status,SignerCertificate'
  asar_extract: node -e "require('@electron/asar').extractAll('dist/win-unpacked/resources/app.asar','OUTDIR')"
  asar_list: npx @electron/asar list dist/win-unpacked/resources/app.asar
  dirty_tree_proof: git show v2.0.4:src/core/compatibility.js | sha256sum   # 6317b763...  vs asar 165f434b...
  updater_read: sed -n '1391,1534p' main.js
  process_enum_read: sed -n '20,70p' src/core/install-guards.js
  anti_evasion_probe: grep -rnE "WriteProcessMemory|CreateRemoteThread|QueueUserAPC|SetWindowsHookEx|ThreadHideFromDebugger|UnhookWindowsHookEx" main.js src scripts overlay payload/feeder
  binary_string_probe: grep -aoc "NtFreeVirtualMemory" <file>
  payload_tracking_gap: git ls-files payload addons overlay-bin   # empty
  ci_gap: ls .github   # FUNDING.yml only
  tooling_notes: Read-tool PDF path fails (no pdftoppm) -> use pdftotext -enc UTF-8 -layout; objdump/pefile/mupdf unavailable; asar CLI has no extractFile/extractAll subcommands, use the node API; quote whole pwsh -Command strings in single quotes from Git Bash

---

delta_head_vs_shipped_2.0.4:
  package.json version: 2.0.5 (shipped installer says 2.0.4)
  removed_at_head: src/community-client.js, src/admin-vault.js, chat/community pages and their CSP hosts
  added_at_head: Gitee as an update/list source (main.js:1393-1407), anti-cheat list maintenance
  unchanged_at_head: self-updater still lacks integrity verification; payload still gitignored; artifacts still unsigned locally
  consequence_for_auditor: a source audit at 890d88f cannot certify the 2.0.4 bytes and cannot certify the next release either until RISK-2/RISK-3 are closed
