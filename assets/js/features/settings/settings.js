// Settings.js
// Settings 섹션 관련 스크립트 (site.js 로드 후 window.appTheme 사용 가능)

(function () {
    "use strict";
    function initThemeSelect() {
        var sel = document.getElementById("appThemeSelect");
        if (!sel || typeof window.appTheme === "undefined") return;
        sel.value = window.appTheme.get();
        sel.addEventListener("change", function () {
            var old = window.appTheme.get();
            window.appTheme.set(sel.value);
            window.appTheme.setPrevious(old);
        });
    }
    document.addEventListener("DOMContentLoaded", function () {
        if (window.settings && window.settings.section === "PREFER") initThemeSelect();
    });
})();
