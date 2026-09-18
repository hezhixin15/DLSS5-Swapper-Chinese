// Experimental, hash-pinned UI adapter, NOT a public RenoDX API.
// During a synchronous call to the original panel only, replace its private
// ImGui table pointer with a local copy. Restore it before returning. Slider
// pointers are callback-local; never retain them or write NR globals by offset.
#pragma once
#include "renodx-ui-probe.hpp"
#include <mutex>
namespace nr_live {
struct field {
    const char *label; uint32_t kind;
    float value = 0, min = 0, max = 1, requested = 0;
    bool seen = false, pending = false, confirming = false;
    std::vector<std::string> options;
};
struct controls;
inline thread_local controls *current = nullptr;
inline std::mutex invocation;
struct controls {
    bool enabled = true, active = false;
    std::string reason = "Bridge is off";
    HMODULE checked = nullptr;
    bool valid = false;
    const imgui_function_table *original = nullptr;
    unsigned disabled = 0;
    std::vector<bool> disabled_stack;
    std::array<field, 15> fields = {{
        {"Structure Intensity", 0}, {"Global Tone Intensity", 0},
        {"Enable DLSS Neural Rendering", 1}, {"Automatic / Character Mask", 1},
        {"Character/Skin Structure", 0}, {"Overall Intensity", 0},
        {"Local Tone Intensity", 0}, {"Diffuse White (nits)", 0},
        {"Motion Scale X Multiplier", 0}, {"Motion Scale Y Multiplier", 0},
        {"NR UI Correction", 1}, {"Enable Upscaling (WIP)", 1},
        {"NR Preset", 4}, {"NR Style", 4}, {"Depth Convention", 4}
    }};
    void clear() { active = false; for (auto &f : fields) { f.seen = f.pending = f.confirming = false; } }
    bool accept(uint32_t epoch, lab_live::command c) {
        if (c.epoch != epoch || !std::isfinite(c.value)) return false;
        if (c.id == 200) {
            if (c.kind != 1 || (c.value != 0 && c.value != 1)) return false;
            enabled = c.value != 0; clear(); return true;
        }
        if (!enabled || !active || c.id < 101 || c.id >= 101 + fields.size()) return false;
        auto &f = fields[c.id - 101];
        if (f.kind == 4 && std::floor(c.value) != c.value) return false;
        if (!f.seen || f.kind != c.kind || c.value < f.min || c.value > f.max || (f.kind == 1 && c.value != 0 && c.value != 1)) return false;
        f.requested = c.value; f.pending = true; return true;
    }
    bool visit(const char *label, uint32_t kind, float &value, float lo, float hi) {
        for (auto &f : fields) if (f.kind == kind && strcmp(f.label, label) == 0) {
            if (disabled || !std::isfinite(value) || !std::isfinite(lo) || !std::isfinite(hi) || lo >= hi) return false;
            f.seen = true; f.min = lo; f.max = hi; f.value = value;
            if (f.confirming) {
                if (std::abs(value - f.requested) < .0001f) {
                    char message[220]; snprintf(message, sizeof(message), "NR_LAB_READBACK %s=%.4f (original RenoDX callback)", label, value);
                    reshade::log::message(reshade::log::level::info, message);
                }
                f.confirming = false;
            }
            if (f.pending) {
                f.pending = false;
                if (f.requested < lo || f.requested > hi) return false;
                value = f.requested; f.confirming = true; return true;
            }
            return false;
        }
        return false;
    }
    static bool slider(const char *label, float *v, float lo, float hi, const char *format, ImGuiSliderFlags flags) {
        auto &s = *current;
        return s.visit(label, 0, *v, lo, hi); // Hidden evaluation must never react to user mouse input.
    }
    static bool checkbox(const char *label, bool *v) {
        float value = *v ? 1.f : 0.f;
        if (!current->visit(label, 1, value, 0, 1)) return false;
        *v = value != 0; return true;
    }
    static bool button(const char *, const ImVec2 &) { return false; }
    static bool small_button(const char *) { return false; }
    static bool invisible(const char *, const ImVec2 &, ImGuiButtonFlags) { return false; }
    static bool combo(const char *label, int *v, const char *const items[], int count, int) {
        if (count < 2 || count > 16 || *v < 0 || *v >= count) return false;
        for (auto &f : current->fields) if (f.kind == 4 && strcmp(f.label, label) == 0) {
            std::vector<std::string> names;
            for (int i = 0; i < count; ++i) {
                if (!items[i] || strnlen(items[i], 129) > 128) return false;
                names.emplace_back(items[i]);
            }
            f.options = std::move(names);
            float value = static_cast<float>(*v);
            if (!current->visit(label, 4, value, 0, static_cast<float>(count - 1))) return false;
            *v = static_cast<int>(value); return true;
        }
        return false;
    }
    static bool combo2(const char *label, int *v, const char *items, int height) {
        const char *names[16]; int count = 0; size_t used = 0;
        while (items && *items && count < 16 && used < 2064) {
            size_t n = strnlen(items, 129); if (n > 128) return false;
            names[count++] = items; items += n + 1; used += n + 1;
        }
        if (!items || *items) return false;
        return combo(label, v, names, count, height);
    }
    static void begin_disabled(bool v) {
        current->disabled_stack.push_back(v); if (v) ++current->disabled;
        current->original->BeginDisabled(v);
    }
    static void end_disabled() {
        if (!current->disabled_stack.empty()) { if (current->disabled_stack.back()) --current->disabled; current->disabled_stack.pop_back(); }
        current->original->EndDisabled();
    }
    void tick(reshade::api::effect_runtime *runtime) {
        if (!enabled) { clear(); reason = "Bridge is off"; return; }
        HMODULE module = GetModuleHandleW(L"renodx-dlss5.addon64");
        if (!module) { clear(); reason = "RenoDX is not loaded"; return; }
        if (module != checked) { checked = module; valid = nr_probe::hash_matches(module); }
        if (!valid) { clear(); reason = "Unsupported RenoDX binary; requires the supplied v4.7"; return; }
        auto base = reinterpret_cast<unsigned char *>(module);
        auto slot = reinterpret_cast<const imgui_function_table **>(base + 0x196ca0);
        original = imgui_function_table_instance();
        if (*slot != original) { clear(); reason = "Unexpected ImGui interface; bridge refused"; return; }
        // Validate the in-memory initialization and registration sites as well
        // as the on-disk hash. Never guess offsets for another build.
        const unsigned char init[] = {0xb9,0x32,0x4b,0,0,0xff,0xd0,0x48,0x89,0x05,0x9a,0x2c,0x17,0};
        const unsigned char callback[] = {0x48,0x8d,0x15,0x7d,0x45,0,0,0xff,0xd0};
        if (memcmp(base + 0x23ff8, init, sizeof(init)) || memcmp(base + 0x2607c, callback, sizeof(callback))) {
            clear(); reason = "RenoDX code fingerprint mismatch"; return;
        }
        std::unique_lock<std::mutex> lock(invocation, std::try_to_lock);
        if (!lock.owns_lock() || current) return;
        imgui_function_table table = *original;
        table.SliderFloat = slider; table.Checkbox = checkbox;
        table.Button = button; table.SmallButton = small_button; table.InvisibleButton = invisible;
        table.Combo = combo; table.Combo2 = combo2;
        table.BeginDisabled = begin_disabled; table.EndDisabled = end_disabled;
        disabled = 0; disabled_stack.clear();
        for (auto &f : fields) f.seen = false;
        ImGui::SetNextWindowPos(ImVec2(-30000, -30000)); ImGui::SetNextWindowSize(ImVec2(600, 1000));
        ImGui::Begin("##NRLabAdapter", nullptr, ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBackground);
        auto atomic_slot = reinterpret_cast<void *volatile *>(base + 0x196ca0);
        if (InterlockedCompareExchangePointer(atomic_slot, &table, const_cast<imgui_function_table *>(original)) != original) {
            ImGui::End(); clear(); reason = "UI dispatch changed; bridge refused"; return;
        }
        {
            struct guard {
                void *volatile *slot; const imgui_function_table *old; imgui_function_table *temporary;
                ~guard() { InterlockedCompareExchangePointer(slot, const_cast<imgui_function_table *>(old), temporary); current = nullptr; }
            } restore {atomic_slot, original, &table};
            current = this;
            reinterpret_cast<void (*)(reshade::api::effect_runtime *)>(base + 0x2a600)(runtime);
        }
        ImGui::End();
        // Commands for a hidden/disabled control expire, never apply later.
        for (auto &f : fields) if (!f.seen) f.pending = f.confirming = false;
        active = fields[0].seen && fields[1].seen && fields[2].seen;
        reason = active ? "" : "RenoDX controls unavailable";
    }
    std::string json() const {
        std::ostringstream out; out.imbue(std::locale::classic());
        out << ",\"nrAvailable\":" << (active ? "true" : "false") << ",\"nrReason\":" << lab_live::quoted(reason)
            << ",\"nrEnabled\":" << (enabled ? "true" : "false") << ",\"nrTools\":[";
        for (size_t i = 0; i < fields.size(); ++i) {
            const auto &f = fields[i]; if (i) out << ',';
            out << "{\"id\":" << 101+i << ",\"kind\":" << f.kind << ",\"name\":" << lab_live::quoted(f.label)
                << ",\"effect\":\"RenoDX v4.7\",\"min\":" << f.min << ",\"max\":" << f.max
                << ",\"step\":" << (f.kind == 0 ? "0.01" : "1") << ",\"value\":" << f.value << ",\"available\":" << (active && f.seen ? "true" : "false");
            if (f.kind == 4) {
                out << ",\"options\":[";
                for (size_t j = 0; j < f.options.size(); ++j) { if (j) out << ','; out << lab_live::quoted(f.options[j]); }
                out << ']';
            }
            out << '}';
        }
        return out.str() + "]";
    }
};
}
