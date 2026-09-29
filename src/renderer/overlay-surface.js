'use strict';
window.mountOverlayPanel(document.getElementById('panel'));
window.mountOverlayLive(document.getElementById('panel'));
window.overlayRuntime.onPreferences(value=>{
 const root=document.getElementById('panel');window.applyOverlayTheme(root,value);
 const k=value.hotkey.key,name=k>=112?`F${k-111}`:({32:'Space',33:'PageUp',34:'PageDown',35:'End',37:'Left',38:'Up',39:'Right',40:'Down',45:'Insert',46:'Delete'}[k]||String.fromCharCode(k));
 root.dataset.overlayHotkey=[value.hotkey.mods&1?'Ctrl':'',value.hotkey.mods&2?'Alt':'',value.hotkey.mods&4?'Shift':'',name].filter(Boolean).join(' + ');
 const footer=root.querySelector('.ol-live-hotkey');if(footer)footer.textContent=window.overlayText(`${root.dataset.overlayHotkey}: show/hide · Drag header: move · Esc: close · Home: original tools`,`${root.dataset.overlayHotkey}: إظهار/إخفاء · اسحب الترويسة: تحريك · Esc: إغلاق · Home: الأدوات الأصلية`,`${root.dataset.overlayHotkey}：显示/隐藏 · 拖动页眉：移动 · Esc：关闭 · Home：原有工具`);
});
