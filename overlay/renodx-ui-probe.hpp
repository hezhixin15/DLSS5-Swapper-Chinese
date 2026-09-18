// Lab-only proof: route one known RenoDX build's own UI callback through a
// temporary private copy of its ImGui dispatch table. No global ReShade hooks,
// no writes to NR settings by address, no binary-file modifications.
#pragma once
#include <wincrypt.h>
#include <cstdio>
namespace nr_probe {
inline bool hash_matches(HMODULE module, DWORD required_size = 1732608, const unsigned char *required_hash = nullptr) {
    wchar_t filename[32768];
    if (!GetModuleFileNameW(module, filename, 32768)) return false;
    HANDLE file = CreateFileW(filename, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    const DWORD size = GetFileSize(file, nullptr);
    std::vector<unsigned char> data(size == required_size ? size : 0); DWORD read = 0;
    const bool ok = !data.empty() && ReadFile(file, data.data(), size, &read, nullptr) && read == size;
    CloseHandle(file); if (!ok) return false;
    HCRYPTPROV provider = 0; HCRYPTHASH hash = 0; BYTE digest[32]; DWORD length = 32;
    bool matches = false;
    if (CryptAcquireContextW(&provider, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT) &&
        CryptCreateHash(provider, CALG_SHA_256, 0, 0, &hash) &&
        CryptHashData(hash, data.data(), size, 0) && CryptGetHashParam(hash, HP_HASHVAL, digest, &length, 0)) {
        constexpr unsigned char expected[] = {0xd5,0xad,0xf8,0x2e,0xb4,0x4b,0x06,0x5f,0x4c,0x59,0x0a,0xc9,0x1f,0xe8,0x24,0xba,0xb0,0x7a,0xfe,0xa0,0xeb,0x9f,0x99,0x4b,0xde,0x93,0x67,0x10,0xc8,0x59,0x39,0x52};
        matches = length == 32 && memcmp(digest, required_hash ? required_hash : expected, 32) == 0;
    }
    if (hash) CryptDestroyHash(hash); if (provider) CryptReleaseContext(provider, 0);
    return matches;
}
inline const imgui_function_table *original = nullptr;
inline unsigned frame = 0;
inline bool applied = false, verified = false;
inline bool slider(const char *label, float *value, float lo, float hi, const char *format, ImGuiSliderFlags flags) {
    if (frame == 1) {
        char msg[256]; snprintf(msg, sizeof(msg), "NR_PROBE_CONTROL %s = %.3f range %.3f..%.3f", label, *value, lo, hi);
        reshade::log::message(reshade::log::level::info, msg);
    }
    if (strcmp(label, "Structure Intensity") == 0) {
        if (frame == 10 && lo <= .43f && hi >= .43f) { *value = .43f; applied = true; return true; }
        if (frame == 11 && applied && std::abs(*value - .43f) < .00001f) {
            verified = true; reshade::log::message(reshade::log::level::info, "NR_PROBE_ORIGINAL_CALLBACK_READBACK_OK Structure Intensity=0.43");
        }
    }
    return original->SliderFloat(label, value, lo, hi, format, flags);
}
inline void tick(reshade::api::effect_runtime *runtime) {
    if (frame >= 12) return;
    HMODULE module = GetModuleHandleW(L"renodx-dlss5.addon64"); if (!module) return;
    static bool checked = false, valid = false;
    if (!checked) { valid = hash_matches(module); checked = true; }
    if (!valid) return;
    auto base = reinterpret_cast<unsigned char *>(module);
    // Static provenance: GetImGuiFunctionTable(19250) result stored at 0x196ca0;
    // ReShadeRegisterOverlay("RenoDX-DLSSNR", module+0x2a600).
    auto slot = reinterpret_cast<const imgui_function_table **>(base + 0x196ca0);
    original = imgui_function_table_instance();
    if (*slot != original) return; // Never chain unknown replacements.
    imgui_function_table table = *original; table.SliderFloat = slider;
    ++frame;
    ImGui::SetNextWindowPos(ImVec2(-30000, -30000));
    ImGui::SetNextWindowSize(ImVec2(600, 1000));
    ImGui::Begin("##NRLabProbe", nullptr, ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBackground);
    *slot = &table;
    reinterpret_cast<void (*)(reshade::api::effect_runtime *)>(base + 0x2a600)(runtime);
    *slot = original;
    ImGui::End();
}
}
